import { Vec2 } from './physics.ts';
import { Maze } from './maze.ts';
import { ParticleSystem } from './particles.ts';
import { sound } from './audio.ts';

export type WeaponType = 'STANDARD' | 'LASER' | 'SHOTGUN';

export interface PowerUpCrate {
  id: number;
  x: number;
  y: number;
  type: WeaponType;
  radius: number;
  spawnTime: number;
  rotation: number;
}

export class PowerUpManager {
  public crates: PowerUpCrate[] = [];
  private nextId = 1;
  private spawnCooldown = 6.0; // Initial crate spawns quickly
  private minInterval = 10.0;

  public update(dt: number, maze: Maze, particles: ParticleSystem) {
    this.spawnCooldown -= dt;

    if (this.spawnCooldown <= 0 && this.crates.length < 3) {
      this.spawnCrate(maze, particles);
      this.spawnCooldown = this.minInterval + Math.random() * 5.0;
    }

    // Animate crates bobbing and rotation
    for (const crate of this.crates) {
      crate.rotation += dt * 1.5;
    }
  }

  public spawnCrate(maze: Maze, particles: ParticleSystem) {
    const pos = maze.getRandomOpenCellPos(1);
    // Alternate between LASER and SHOTGUN
    const types: WeaponType[] = ['LASER', 'SHOTGUN'];
    const chosenType = types[Math.floor(Math.random() * types.length)];

    this.crates.push({
      id: this.nextId++,
      x: pos.x,
      y: pos.y,
      type: chosenType,
      radius: 18,
      spawnTime: performance.now(),
      rotation: 0
    });

    // Spawn arrival sparks
    particles.createSparks(pos, { x: 0, y: -1 }, 16, chosenType === 'LASER' ? '#00ffee' : '#ff9900');
  }

  // Check if tank picks up crate
  public checkPickup(tankPos: Vec2, tankRadius: number): WeaponType | null {
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      const dist = Math.hypot(tankPos.x - c.x, tankPos.y - c.y);
      if (dist < tankRadius + c.radius) {
        const weapon = c.type;
        sound.playPickup();
        this.crates.splice(i, 1);
        return weapon;
      }
    }
    return null;
  }

  public draw(ctx: CanvasRenderingContext2D, time: number) {
    for (const c of this.crates) {
      const isLaser = c.type === 'LASER';
      const glowColor = isLaser ? '#00ffff' : '#ff9900';
      const bob = Math.sin(time * 3 + c.id) * 3;

      ctx.save();
      ctx.translate(c.x, c.y + bob);

      // Outer glow pulse
      const pulse = (Math.sin(time * 4) + 1) / 2;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12 + pulse * 8;

      // Rotating crate border
      ctx.rotate(c.rotation * 0.4);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(15, 20, 30, 0.9)';
      ctx.fillRect(-c.radius, -c.radius, c.radius * 2, c.radius * 2);
      ctx.strokeRect(-c.radius, -c.radius, c.radius * 2, c.radius * 2);

      // Icon symbol in center
      ctx.rotate(-c.rotation * 0.4); // un-rotate for text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px Chakra Petch, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isLaser ? '⚡' : '💥', 0, 0);

      ctx.restore();
    }
  }

  public clear() {
    this.crates = [];
    this.spawnCooldown = 4.0;
  }
}
