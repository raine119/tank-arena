import { Vec2, Physics, Segment } from './physics.ts';
import { ParticleSystem } from './particles.ts';
import { sound } from './audio.ts';
import { Maze } from './maze.ts';

export interface LaserBeam {
  points: Vec2[];
  alpha: number;
  life: number;
  maxLife: number;
  ownerId: number;
}

export class Bullet {
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public radius: number = 2.2; // Same size as original Tank Trouble (crisp ~4.4px diameter)
  public bounces: number = 0;
  public maxBounces: number = 100; // Bounces as long as the normal game without premature cutoff
  public life: number = 12.0;      // Authentic ~12s ricochet lifetime
  public maxLife: number = 12.0;
  public ownerId: number;
  public isAlive: boolean = true;
  public trail: Vec2[] = [];
  public isPellet: boolean = false;

  constructor(x: number, y: number, vx: number, vy: number, ownerId: number, isPellet = false) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.ownerId = ownerId;
    this.isPellet = isPellet;
    if (isPellet) {
      this.radius = 1.6;
      this.maxBounces = 12;
      this.life = 5.5;
      this.maxLife = 5.5;
    }
  }

  public update(dt: number, segments: Segment[], maze: Maze, particles: ParticleSystem) {
    if (!this.isAlive) return;

    this.life -= dt;
    if (this.life <= 0) {
      this.isAlive = false;
      return;
    }

    // Record trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > (this.isPellet ? 4 : 8)) {
      this.trail.shift();
    }

    let remainingDt = dt;
    const maxSteps = 4;

    for (let step = 0; step < maxSteps && remainingDt > 1e-5; step++) {
      const stepVel: Vec2 = { x: this.vx * remainingDt, y: this.vy * remainingDt };
      let earliestHit: { hit: any; seg: Segment } | null = null;

      for (const seg of segments) {
        const hit = Physics.sweepCircleSegment({ x: this.x, y: this.y }, stepVel, this.radius, seg);
        if (hit && hit.t >= 0 && hit.t <= 1) {
          if (!earliestHit || hit.t < earliestHit.hit.t) {
            earliestHit = { hit, seg };
          }
        }
      }

      if (earliestHit) {
        const { hit, seg } = earliestHit;

        // Position bullet cleanly outside the wall along the normal
        this.x = hit.point.x + hit.normal.x * (this.radius + 0.5);
        this.y = hit.point.y + hit.normal.y * (this.radius + 0.5);

        // Reflect velocity vector
        const currentV = { x: this.vx, y: this.vy };
        const reflected = Physics.reflect(currentV, hit.normal);

        // Ensure reflected velocity moves away from the wall
        const dotN = reflected.x * hit.normal.x + reflected.y * hit.normal.y;
        if (dotN <= 0) {
          reflected.x += hit.normal.x * (-dotN + 10);
          reflected.y += hit.normal.y * (-dotN + 10);
        }

        this.vx = reflected.x;
        this.vy = reflected.y;

        this.bounces++;
        sound.playRicochet(this.bounces);
        particles.createSparks({ x: this.x, y: this.y }, hit.normal, this.isPellet ? 5 : 8);

        // Damage destructible wall if applicable
        if (seg.id && seg.isDestructible) {
          maze.damageSegment(seg.id, particles);
        }

        if (this.bounces >= this.maxBounces) {
          this.isAlive = false;
          particles.createSparks({ x: this.x, y: this.y }, hit.normal, 12, '#ff3300');
          break;
        }

        // Remaining time after bounce
        remainingDt *= Math.max(0, 1 - hit.t);
      } else {
        // No collision this sub-step
        this.x += stepVel.x;
        this.y += stepVel.y;
        remainingDt = 0;
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D) {
    if (!this.isAlive) return;

    // Subtle fading motion trail
    if (this.trail.length > 1) {
      ctx.lineWidth = this.radius * 1.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = this.isPellet ? 'rgba(255, 170, 0, 0.35)' : 'rgba(240, 245, 255, 0.35)';
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (let i = 1; i < this.trail.length; i++) {
        ctx.lineTo(this.trail[i].x, this.trail[i].y);
      }
      ctx.stroke();
    }

    // Classic Tank Trouble bullet: crisp, high-visibility round projectile
    ctx.save();
    if (this.isPellet) {
      ctx.fillStyle = '#ffaa00';
      ctx.shadowColor = '#ff6600';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#f0f6ff';
      ctx.strokeStyle = '#0d1117';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class ProjectileManager {
  public bullets: Bullet[] = [];
  public laserBeams: LaserBeam[] = [];

  public update(dt: number, segments: Segment[], maze: Maze, particles: ParticleSystem) {
    // Update bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.update(dt, segments, maze, particles);
      if (!b.isAlive) {
        this.bullets.splice(i, 1);
      }
    }

    // Update active laser beam visuals
    for (let i = this.laserBeams.length - 1; i >= 0; i--) {
      const laser = this.laserBeams[i];
      laser.life -= dt;
      laser.alpha = Math.max(0, laser.life / laser.maxLife);
      if (laser.life <= 0) {
        this.laserBeams.splice(i, 1);
      }
    }
  }

  // Fire standard bouncing cannon bullet (speed ~300 px/s)
  public fireBullet(x: number, y: number, angle: number, ownerId: number, speed = 300) {
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    this.bullets.push(new Bullet(x, y, vx, vy, ownerId, false));
    sound.playShoot();
  }

  // Fire shotgun multi-pellet spread
  public fireShotgun(x: number, y: number, angle: number, ownerId: number) {
    const pelletCount = 5;
    const spreadAngle = 0.38; // ~22 degrees
    const baseSpeed = 340;

    for (let i = 0; i < pelletCount; i++) {
      const offset = (i - (pelletCount - 1) / 2) * (spreadAngle / (pelletCount - 1));
      const pelletAngle = angle + offset + (Math.random() - 0.5) * 0.08;
      const speed = baseSpeed + (Math.random() - 0.5) * 40;
      const vx = Math.cos(pelletAngle) * speed;
      const vy = Math.sin(pelletAngle) * speed;

      this.bullets.push(new Bullet(x, y, vx, vy, ownerId, true));
    }
    sound.playShotgun();
  }

  // Fire instant bouncing laser cannon
  public fireLaser(
    startX: number,
    startY: number,
    angle: number,
    ownerId: number,
    segments: Segment[],
    maze: Maze,
    particles: ParticleSystem
  ): LaserBeam {
    sound.playLaser();

    const points: Vec2[] = [{ x: startX, y: startY }];
    let currentOrigin: Vec2 = { x: startX, y: startY };
    let currentDir: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
    const maxBounces = 3;
    const maxRayDist = 1200;

    for (let bounce = 0; bounce <= maxBounces; bounce++) {
      let closestHit: any = null;

      for (const seg of segments) {
        const hit = Physics.raySegmentIntersect(currentOrigin, currentDir, maxRayDist, seg);
        if (hit && hit.t > 0.005) {
          if (!closestHit || hit.t < closestHit.t) {
            closestHit = hit;
          }
        }
      }

      if (closestHit) {
        points.push(closestHit.point);
        particles.createSparks(closestHit.point, closestHit.normal, 10, '#00ffff');

        if (closestHit.segment && closestHit.segment.id && closestHit.segment.isDestructible) {
          maze.damageSegment(closestHit.segment.id, particles);
        }

        // Reflect for next beam bounce with slight offset to avoid self-intersection
        const reflected = Physics.reflect(currentDir, closestHit.normal);
        currentOrigin = {
          x: closestHit.point.x + closestHit.normal.x * 0.5,
          y: closestHit.point.y + closestHit.normal.y * 0.5
        };
        currentDir = reflected;
      } else {
        points.push({
          x: currentOrigin.x + currentDir.x * maxRayDist,
          y: currentOrigin.y + currentDir.y * maxRayDist
        });
        break;
      }
    }

    const beam: LaserBeam = {
      points,
      alpha: 1.0,
      life: 0.35,
      maxLife: 0.35,
      ownerId
    };

    this.laserBeams.push(beam);
    return beam;
  }

  public draw(ctx: CanvasRenderingContext2D) {
    // Draw bullets
    for (const b of this.bullets) {
      b.draw(ctx);
    }

    // Draw laser beams
    for (const beam of this.laserBeams) {
      if (beam.points.length < 2) continue;

      ctx.save();
      ctx.globalAlpha = beam.alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Wide outer glow
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
      ctx.lineWidth = 9;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(beam.points[0].x, beam.points[0].y);
      for (let i = 1; i < beam.points.length; i++) {
        ctx.lineTo(beam.points[i].x, beam.points[i].y);
      }
      ctx.stroke();

      // Sharp inner cyan beam
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Pure white hot core
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.shadowBlur = 0;
      ctx.stroke();

      ctx.restore();
    }
  }

  public clear() {
    this.bullets = [];
    this.laserBeams = [];
  }
}
