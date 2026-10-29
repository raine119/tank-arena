import { Vec2 } from './physics.ts';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  fade: boolean;
  type?: 'spark' | 'smoke' | 'debris' | 'flash';
}

export interface SkidMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  alpha: number;
  color: string;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private skidMarks: SkidMark[] = [];
  private maxSkids = 250;

  public update(dt: number) {
    // Update active particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96; // drag
      p.vy *= 0.96;
      p.life -= dt;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Slowly fade skid marks
    for (let i = this.skidMarks.length - 1; i >= 0; i--) {
      this.skidMarks[i].alpha -= dt * 0.05;
      if (this.skidMarks[i].alpha <= 0) {
        this.skidMarks.splice(i, 1);
      }
    }
  }

  // Add skid mark behind tank treads
  public addSkid(x1: number, y1: number, x2: number, y2: number, color = 'rgba(0, 0, 0, 0.45)') {
    if (this.skidMarks.length >= this.maxSkids) {
      this.skidMarks.shift();
    }
    this.skidMarks.push({
      x1, y1, x2, y2,
      alpha: 0.5,
      color
    });
  }

  // Bright sparks on wall bounce
  public createSparks(pos: Vec2, normal: Vec2, count = 8, color = '#ffcc00') {
    for (let i = 0; i < count; i++) {
      const angle = Math.atan2(normal.y, normal.x) + (Math.random() - 0.5) * 1.5;
      const speed = 80 + Math.random() * 180;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.15 + Math.random() * 0.25,
        maxLife: 0.4,
        size: 1.5 + Math.random() * 2,
        color,
        fade: true,
        type: 'spark'
      });
    }
  }

  // Muzzle flash puff on shooting
  public createMuzzleFlash(pos: Vec2, angle: number, color = '#ff9900') {
    // Flash dot
    this.particles.push({
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      life: 0.06,
      maxLife: 0.06,
      size: 10,
      color: '#ffffff',
      fade: true,
      type: 'flash'
    });

    // Smoke puff
    for (let i = 0; i < 4; i++) {
      const spread = angle + (Math.random() - 0.5) * 0.6;
      const spd = 40 + Math.random() * 60;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(spread) * spd,
        vy: Math.sin(spread) * spd,
        life: 0.3 + Math.random() * 0.3,
        maxLife: 0.6,
        size: 3 + Math.random() * 4,
        color: 'rgba(200, 210, 230, 0.5)',
        fade: true,
        type: 'smoke'
      });
    }
  }

  // Huge satisfying explosion when a tank is destroyed
  public createExplosion(pos: Vec2, mainColor = '#ff3344') {
    // Fireball particles
    for (let i = 0; i < 28; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 260;
      const colors = ['#ffffff', '#ffcc00', '#ff5500', mainColor];
      const color = colors[Math.floor(Math.random() * colors.length)];
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3 + Math.random() * 0.5,
        maxLife: 0.8,
        size: 4 + Math.random() * 8,
        color,
        fade: true,
        type: 'debris'
      });
    }

    // Heavy dark smoke ring
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 100;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6 + Math.random() * 0.7,
        maxLife: 1.3,
        size: 8 + Math.random() * 12,
        color: 'rgba(50, 55, 65, 0.6)',
        fade: true,
        type: 'smoke'
      });
    }
  }

  // Draw skid marks on bottom layer
  public drawSkids(ctx: CanvasRenderingContext2D) {
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (const skid of this.skidMarks) {
      ctx.strokeStyle = `rgba(10, 15, 25, ${skid.alpha})`;
      ctx.beginPath();
      ctx.moveTo(skid.x1, skid.y1);
      ctx.lineTo(skid.x2, skid.y2);
      ctx.stroke();
    }
  }

  // Draw foreground particles
  public drawParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const alpha = p.fade ? Math.max(0, p.life / p.maxLife) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;

      if (p.type === 'spark' || p.type === 'flash') {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'smoke') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.5 - alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Debris fragment
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }

      ctx.restore();
    }
  }

  public clear() {
    this.particles = [];
    this.skidMarks = [];
  }
}
