import { Vec2, Physics, Segment } from './physics.ts';
import { ParticleSystem } from './particles.ts';
import { sound } from './audio.ts';
import { WeaponType } from './powerup.ts';
import { ProjectileManager } from './bullet.ts';
import { Maze } from './maze.ts';

export interface TankControls {
  forward: boolean;
  reverse: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  shoot: boolean;
  boost: boolean;
}

export class Tank {
  public id: number;
  public name: string;
  public x: number;
  public y: number;
  public angle: number;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = 13.5;
  public color: string;
  public glowColor: string;
  public isAlive: boolean = true;

  // Calibrated to match original Tank Trouble (equal forward and reverse speed)
  public forwardSpeed = 96;       // Steady, authentic pace (~1 cell per second)
  public reverseSpeed = 96;       // Same speed backwards as forwards
  public turnSpeed = 2.85;        // ~2.2 seconds for full 360-degree rotation

  // Boost mechanic
  public boostCooldown = 0;
  public maxBoostCooldown = 3.5;
  public isBoosting = false;
  public boostDuration = 0;

  // Weapons & Ammo
  public weapon: WeaponType = 'STANDARD';
  public specialAmmo = 0;
  public shootCooldown = 0;
  private lastShootState = false;

  // Animated tread tracks
  private treadTimer = 0;
  private lastTrackPos: Vec2 | null = null;

  constructor(id: number, name: string, x: number, y: number, angle: number, color: string, glowColor: string) {
    this.id = id;
    this.name = name;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.color = color;
    this.glowColor = glowColor;
  }

  public reset(x: number, y: number, angle: number) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.vx = 0;
    this.vy = 0;
    this.isAlive = true;
    this.weapon = 'STANDARD';
    this.specialAmmo = 0;
    this.boostCooldown = 0;
    this.isBoosting = false;
    this.shootCooldown = 0;
    this.lastShootState = false;
    this.lastTrackPos = null;
  }

  public setWeapon(weapon: WeaponType) {
    this.weapon = weapon;
    if (weapon === 'LASER') {
      this.specialAmmo = 2; // 2 laser shots
    } else if (weapon === 'SHOTGUN') {
      this.specialAmmo = 3; // 3 shotgun bursts
    }
  }

  public update(
    dt: number,
    controls: TankControls,
    segments: Segment[],
    maze: Maze,
    projectiles: ProjectileManager,
    particles: ParticleSystem
  ) {
    if (!this.isAlive) return;

    // Cooldown timers
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.boostCooldown > 0) this.boostCooldown -= dt;

    if (this.isBoosting) {
      this.boostDuration -= dt;
      if (this.boostDuration <= 0) {
        this.isBoosting = false;
      }
    }

    // Authentic Tank Trouble Tread Steering: Rotate in place
    if (controls.turnLeft) this.angle -= this.turnSpeed * dt;
    if (controls.turnRight) this.angle += this.turnSpeed * dt;

    // Boost trigger (+45% speed surge, smooth and controlled)
    if (controls.boost && this.boostCooldown <= 0) {
      this.isBoosting = true;
      this.boostDuration = 0.28;
      this.boostCooldown = this.maxBoostCooldown;
      sound.playBoost();

      const backX = this.x - Math.cos(this.angle) * this.radius;
      const backY = this.y - Math.sin(this.angle) * this.radius;
      particles.createSparks({ x: backX, y: backY }, { x: -Math.cos(this.angle), y: -Math.sin(this.angle) }, 10, '#00ffff');
    }

    // Authentic Tank Trouble Forward/Reverse Drive (equal speeds)
    let targetSpeed = 0;
    if (controls.forward) {
      targetSpeed = this.isBoosting ? this.forwardSpeed * 1.45 : this.forwardSpeed;
    } else if (controls.reverse) {
      targetSpeed = this.isBoosting ? -this.reverseSpeed * 1.45 : -this.reverseSpeed;
    }

    const forwardX = Math.cos(this.angle);
    const forwardY = Math.sin(this.angle);

    // Snappy acceleration and braking (treads on floor, not ice)
    this.vx = forwardX * targetSpeed;
    this.vy = forwardY * targetSpeed;

    // Sub-stepped movement with continuous wall resolution
    // Guarantees zero tunneling through any walls
    const subSteps = 4;
    const subDt = dt / subSteps;

    const minX = maze.originX + this.radius;
    const maxX = maze.originX + maze.cols * maze.cellSize - this.radius;
    const minY = maze.originY + this.radius;
    const maxY = maze.originY + maze.rows * maze.cellSize - this.radius;

    for (let step = 0; step < subSteps; step++) {
      const prevPos: Vec2 = { x: this.x, y: this.y };
      const targetPos: Vec2 = {
        x: this.x + this.vx * subDt,
        y: this.y + this.vy * subDt
      };

      // Resolve against maze wall segments
      const resolved = Physics.resolveTankWalls(prevPos, targetPos, this.radius, segments);
      this.x = resolved.pos.x;
      this.y = resolved.pos.y;

      // Strict perimeter clamp
      this.x = Math.max(minX, Math.min(maxX, this.x));
      this.y = Math.max(minY, Math.min(maxY, this.y));
    }

    // Check if stepped into sudden-death collapsed void
    if (maze.isPointInHazard({ x: this.x, y: this.y })) {
      this.destroy(particles);
      return;
    }

    // Tread skid marks
    const currentSpeed = Math.abs(targetSpeed);
    if (currentSpeed > 20) {
      this.treadTimer += dt;
      if (this.treadTimer > 0.09) {
        this.treadTimer = 0;
        if (this.lastTrackPos) {
          particles.addSkid(this.lastTrackPos.x, this.lastTrackPos.y, this.x, this.y);
        }
        this.lastTrackPos = { x: this.x, y: this.y };
      }
    } else {
      this.lastTrackPos = null;
    }

    // Shooting
    const justPressedShoot = controls.shoot && !this.lastShootState;
    this.lastShootState = controls.shoot;

    if (justPressedShoot && this.shootCooldown <= 0) {
      this.shoot(projectiles, segments, maze, particles);
    }
  }

  // Shoot current weapon
  private shoot(
    projectiles: ProjectileManager,
    segments: Segment[],
    maze: Maze,
    particles: ParticleSystem
  ) {
    const activeBullets = projectiles.bullets.filter(b => b.ownerId === this.id && !b.isPellet).length;

    const barrelLength = 19;
    const barrelDir: Vec2 = { x: Math.cos(this.angle), y: Math.sin(this.angle) };
    const tankCenter: Vec2 = { x: this.x, y: this.y };

    // Prevent shooting through walls:
    // If the barrel is pressed into or penetrates a wall, clamp the spawn point to the near side of the wall
    let spawnDist = barrelLength;
    for (const seg of segments) {
      const hit = Physics.raySegmentIntersect(tankCenter, barrelDir, barrelLength + 3, seg);
      if (hit && hit.t >= 0 && hit.t <= 1) {
        const distToWall = hit.t * (barrelLength + 3);
        spawnDist = Math.min(spawnDist, Math.max(this.radius + 1.0, distToWall - 2.5));
      }
    }

    const tipX = this.x + barrelDir.x * spawnDist;
    const tipY = this.y + barrelDir.y * spawnDist;

    if (this.weapon === 'LASER') {
      projectiles.fireLaser(tipX, tipY, this.angle, this.id, segments, maze, particles);
      particles.createMuzzleFlash({ x: tipX, y: tipY }, this.angle, '#00ffff');
      this.shootCooldown = 0.45;
      this.specialAmmo--;
      if (this.specialAmmo <= 0) {
        this.weapon = 'STANDARD';
      }
    } else if (this.weapon === 'SHOTGUN') {
      projectiles.fireShotgun(tipX, tipY, this.angle, this.id);
      particles.createMuzzleFlash({ x: tipX, y: tipY }, this.angle, '#ffaa00');
      this.shootCooldown = 0.5;
      this.specialAmmo--;
      if (this.specialAmmo <= 0) {
        this.weapon = 'STANDARD';
      }
    } else {
      // Standard cannon (max 5 active bullets in flight)
      if (activeBullets < 5) {
        projectiles.fireBullet(tipX, tipY, this.angle, this.id);
        particles.createMuzzleFlash({ x: tipX, y: tipY }, this.angle, '#ffcc00');
        this.shootCooldown = 0.25;
      }
    }
  }

  public destroy(particles: ParticleSystem) {
    if (!this.isAlive) return;
    this.isAlive = false;
    sound.playExplosion();
    particles.createExplosion({ x: this.x, y: this.y }, this.color);
  }

  public draw(ctx: CanvasRenderingContext2D) {
    if (!this.isAlive) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Tread footprints (left and right dark rubber tracks)
    ctx.fillStyle = '#1a1f28';
    ctx.fillRect(-15, -14, 30, 5.5);
    ctx.fillRect(-15, 8.5, 30, 5.5);

    // Boost flame animation
    if (this.isBoosting) {
      ctx.fillStyle = '#00ffff';
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(-15, -5);
      ctx.lineTo(-24 + Math.random() * 6, 0);
      ctx.lineTo(-15, 5);
      ctx.fill();
    }

    // Main Chassis
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.glowColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(-13, -10, 26, 20, 3);
    ctx.fill();

    // Turret Barrel
    ctx.fillStyle = '#222733';
    ctx.shadowBlur = 0;
    ctx.fillRect(0, -3, 20, 6);

    // Barrel highlight muzzle
    ctx.fillStyle = this.weapon === 'LASER' ? '#00ffff' : (this.weapon === 'SHOTGUN' ? '#ffaa00' : '#8899aa');
    ctx.fillRect(16, -4, 4, 8);

    // Turret Dome
    ctx.fillStyle = '#12161f';
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Boost Cooldown Bar above tank (when recharging)
    if (this.boostCooldown > 0) {
      const barW = 24;
      const barH = 2.5;
      const frac = 1 - (this.boostCooldown / this.maxBoostCooldown);

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(this.x - barW / 2, this.y - 22, barW, barH);
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(this.x - barW / 2, this.y - 22, barW * frac, barH);
      ctx.restore();
    }
  }
}
