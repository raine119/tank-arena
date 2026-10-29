import { Tank, TankControls } from './tank.ts';
import { Maze } from './maze.ts';
import { ProjectileManager, Bullet } from './bullet.ts';
import { PowerUpManager } from './powerup.ts';
import { ParticleSystem } from './particles.ts';
import { BotController } from './bot.ts';
import { Physics, Vec2 } from './physics.ts';
import { sound } from './audio.ts';
import { GameSnapshot, MazeDataMessage } from './network.ts';

export type GameState = 'COUNTDOWN' | 'PLAYING' | 'ROUND_OVER' | 'MATCH_OVER';

export class GameManager {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;

  public maze: Maze;
  public particles: ParticleSystem;
  public projectiles: ProjectileManager;
  public powerups: PowerUpManager;
  public bot: BotController;

  public p1: Tank;
  public p2: Tank;
  public p1Score: number = 0;
  public p2Score: number = 0;
  public targetScore: number = 5;

  public p2IsBot: boolean = true;
  public state: GameState = 'COUNTDOWN';

  // 3, 2, 1 Countdown
  public countdownTimer: number = 3.2;
  private lastCountdownNumber: number = 4;

  // Timers
  public suddenDeathTime: number = 35; // seconds until collapse
  public suddenDeathActive: boolean = false;
  private collapseStep: number = 0;
  private collapseTimer: number = 0;

  // Round turnaround & slow-mo
  private roundOverTimer: number = 0;
  public timeScale: number = 1.0;

  // UI callbacks
  public onScoreChange?: (p1: number, p2: number) => void;
  public onTimerChange?: (seconds: number, isWarning: boolean) => void;
  public onWeaponChange?: (p1Weapon: string, p2Weapon: string) => void;
  public onSuddenDeath?: (active: boolean) => void;
  public onMatchEnd?: (winnerName: string, p1Score: number, p2Score: number) => void;
  public onKillMsg?: (msg: string) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;

    this.maze = new Maze(11, 7);
    this.particles = new ParticleSystem();
    this.projectiles = new ProjectileManager();
    this.powerups = new PowerUpManager();
    this.bot = new BotController();

    this.p1 = new Tank(1, 'RED CORPS', 0, 0, 0, '#ff3355', 'rgba(255, 51, 85, 0.5)');
    this.p2 = new Tank(2, 'BLUE TANK', 0, 0, Math.PI, '#00d2ff', 'rgba(0, 210, 255, 0.5)');
  }

  public init() {
    this.resizeCanvas();
    this.startNewRound();
  }

  public resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth - 20;
    const height = parent.clientHeight - 20;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);

    // Re-fit maze to canvas
    this.maze.generate(width, height);
  }

  public startNewRound() {
    this.state = 'COUNTDOWN';
    this.countdownTimer = 3.3;
    this.lastCountdownNumber = 4;
    this.timeScale = 1.0;
    this.roundOverTimer = 0;
    this.suddenDeathTime = 35;
    this.suddenDeathActive = false;
    this.collapseStep = 0;
    this.collapseTimer = 0;

    // Clear active projectiles & crates
    this.projectiles.clear();
    this.powerups.clear();

    // Rebuild maze
    const parent = this.canvas.parentElement;
    const width = parent ? parent.clientWidth - 20 : 1000;
    const height = parent ? parent.clientHeight - 20 : 650;
    this.maze.generate(width, height);

    // Spawn tanks in opposite quadrants
    const p1Spawn = this.maze.getRandomOpenCellPos(0);
    const p2Spawn = this.maze.getRandomOpenCellPos(0);

    this.p1.reset(p1Spawn.x, p1Spawn.y, Math.random() * Math.PI * 2);
    this.p2.reset(p2Spawn.x, p2Spawn.y, Math.random() * Math.PI * 2);

    if (this.onSuddenDeath) this.onSuddenDeath(false);
    this.notifyUI();
  }

  public resetMatch() {
    this.p1Score = 0;
    this.p2Score = 0;
    if (this.onScoreChange) this.onScoreChange(0, 0);
    this.startNewRound();
  }

  public update(dtReal: number, p1Controls: TankControls, p2Controls: TankControls) {
    // 3, 2, 1 Countdown phase before game starts
    if (this.state === 'COUNTDOWN') {
      this.countdownTimer -= dtReal;
      const currentNumber = Math.ceil(this.countdownTimer);

      if (currentNumber !== this.lastCountdownNumber) {
        if (currentNumber >= 1 && currentNumber <= 3) {
          sound.playCountdownBeep(false);
        } else if (currentNumber <= 0 && this.lastCountdownNumber > 0) {
          sound.playCountdownBeep(true);
        }
        this.lastCountdownNumber = currentNumber;
      }

      if (this.countdownTimer <= -0.45) {
        this.state = 'PLAYING';
      }

      this.powerups.update(dtReal, this.maze, this.particles);
      this.particles.update(dtReal);

      if (this.onTimerChange) {
        this.onTimerChange(35, false);
      }
      return;
    }

    const dt = dtReal * this.timeScale;

    // Handle Sudden Death countdown
    if (this.state === 'PLAYING') {
      if (!this.suddenDeathActive) {
        this.suddenDeathTime -= dt;
        if (this.suddenDeathTime <= 0) {
          this.suddenDeathActive = true;
          this.suddenDeathTime = 0;
          sound.playAlarm();
          if (this.onSuddenDeath) this.onSuddenDeath(true);
          if (this.onKillMsg) this.onKillMsg('🚨 SUDDEN DEATH: MAZE COLLAPSING!');
        }
      } else {
        // Sudden death active: Collapse outer rings progressively
        this.collapseTimer += dt;
        if (this.collapseStep === 0) {
          this.maze.warnCollapse(0);
          if (this.collapseTimer > 3.0) {
            this.maze.executeCollapse(0, this.particles);
            this.collapseStep = 1;
            this.collapseTimer = 0;
            this.maze.warnCollapse(1);
          }
        } else if (this.collapseStep === 1) {
          if (this.collapseTimer > 4.5) {
            this.maze.executeCollapse(1, this.particles);
            this.collapseStep = 2;
            this.collapseTimer = 0;
            this.maze.warnCollapse(2);
          }
        } else if (this.collapseStep === 2) {
          if (this.collapseTimer > 5.0) {
            this.maze.executeCollapse(2, this.particles);
            this.collapseStep = 3;
          }
        }
      }

      if (this.onTimerChange) {
        this.onTimerChange(Math.max(0, Math.ceil(this.suddenDeathTime)), this.suddenDeathTime < 10);
      }
    }

    // AI Bot controls Player 2 if enabled
    let effectiveP2Controls = p2Controls;
    if (this.p2IsBot && this.state === 'PLAYING') {
      effectiveP2Controls = this.bot.update(
        dt,
        this.p2,
        this.p1,
        this.maze,
        this.powerups,
        this.projectiles
      );
    }

    // Update Tanks
    this.p1.update(dt, p1Controls, this.maze.segments, this.maze, this.projectiles, this.particles);
    this.p2.update(dt, effectiveP2Controls, this.maze.segments, this.maze, this.projectiles, this.particles);

    // Tank-on-Tank bumper collision
    if (this.p1.isAlive && this.p2.isAlive) {
      const dist = Math.hypot(this.p1.x - this.p2.x, this.p1.y - this.p2.y);
      const minD = this.p1.radius + this.p2.radius;
      if (dist < minD) {
        const overlap = minD - dist;
        const nx = (this.p1.x - this.p2.x) / (dist || 1);
        const ny = (this.p1.y - this.p2.y) / (dist || 1);
        this.p1.x += nx * overlap * 0.5;
        this.p1.y += ny * overlap * 0.5;
        this.p2.x -= nx * overlap * 0.5;
        this.p2.y -= ny * overlap * 0.5;

        // Re-resolve both tanks against walls so bumper bump never pushes a tank through a wall
        const r1 = Physics.resolveTankWalls({ x: this.p1.x, y: this.p1.y }, { x: this.p1.x, y: this.p1.y }, this.p1.radius, this.maze.segments);
        this.p1.x = r1.pos.x;
        this.p1.y = r1.pos.y;
        const r2 = Physics.resolveTankWalls({ x: this.p2.x, y: this.p2.y }, { x: this.p2.x, y: this.p2.y }, this.p2.radius, this.maze.segments);
        this.p2.x = r2.pos.x;
        this.p2.y = r2.pos.y;
      }
    }

    // Power-up pickups
    if (this.p1.isAlive) {
      const w1 = this.powerups.checkPickup({ x: this.p1.x, y: this.p1.y }, this.p1.radius);
      if (w1) {
        this.p1.setWeapon(w1);
        if (this.onKillMsg) this.onKillMsg(`Red Corps equipped ${w1}!`);
        this.notifyUI();
      }
    }

    if (this.p2.isAlive) {
      const w2 = this.powerups.checkPickup({ x: this.p2.x, y: this.p2.y }, this.p2.radius);
      if (w2) {
        this.p2.setWeapon(w2);
        if (this.onKillMsg) this.onKillMsg(`${this.p2.name} equipped ${w2}!`);
        this.notifyUI();
      }
    }

    // Update subsystems
    this.powerups.update(dt, this.maze, this.particles);
    this.projectiles.update(dt, this.maze.segments, this.maze, this.particles);
    this.particles.update(dt);

    // Check Bullet vs Tank Collisions
    if (this.state === 'PLAYING') {
      this.checkCombatCollisions();
    }

    // Round over transition / Slow-mo
    if (this.state === 'ROUND_OVER') {
      this.roundOverTimer += dtReal;
      if (this.roundOverTimer > 1.8) {
        if (this.p1Score >= this.targetScore || this.p2Score >= this.targetScore) {
          this.state = 'MATCH_OVER';
          const winner = this.p1Score >= this.targetScore ? this.p1.name : this.p2.name;
          if (this.onMatchEnd) this.onMatchEnd(winner, this.p1Score, this.p2Score);
        } else {
          this.startNewRound();
        }
      }
    }
  }

  private checkCombatCollisions() {
    const tanks = [this.p1, this.p2];

    // 1. Bullets vs Tanks
    for (const b of this.projectiles.bullets) {
      if (!b.isAlive) continue;

      for (const tank of tanks) {
        if (!tank.isAlive) continue;

        const dist = Math.hypot(b.x - tank.x, b.y - tank.y);
        if (dist <= b.radius + tank.radius) {
          b.isAlive = false;
          this.handleTankKilled(tank, b.ownerId, b.bounces);
          return;
        }
      }
    }

    // 2. Laser beams vs Tanks
    for (const beam of this.projectiles.laserBeams) {
      for (let i = 0; i < beam.points.length - 1; i++) {
        const seg = { p1: beam.points[i], p2: beam.points[i + 1] };
        for (const tank of tanks) {
          if (!tank.isAlive) continue;

          const closest = Physics.closestPointOnSegment({ x: tank.x, y: tank.y }, seg.p1, seg.p2);
          const dist = Math.hypot(tank.x - closest.x, tank.y - closest.y);
          if (dist <= tank.radius) {
            this.handleTankKilled(tank, beam.ownerId, 0, true);
            return;
          }
        }
      }
    }

    // 3. Check if tanks died by hazard void
    if (!this.p1.isAlive && this.p2.isAlive) {
      this.handleTankKilled(this.p1, 2, 0);
    } else if (!this.p2.isAlive && this.p1.isAlive) {
      this.handleTankKilled(this.p2, 1, 0);
    }
  }

  private handleTankKilled(victim: Tank, killerId: number, bounces = 0, isLaser = false) {
    victim.destroy(this.particles);
    this.state = 'ROUND_OVER';
    this.timeScale = 0.25; // Dramatic Slow-motion!

    let msg = '';
    const killer = killerId === 1 ? this.p1 : this.p2;

    if (victim.id === killerId) {
      // Self-kill via ricochet!
      msg = `${victim.name} eliminated themselves via ricochet!`;
      // Award point to other player
      if (victim.id === 1) this.p2Score++;
      else this.p1Score++;
    } else {
      // Frag on enemy
      if (isLaser) {
        msg = `${killer.name} vaporized ${victim.name} with Laser Beam!`;
      } else if (bounces > 1) {
        msg = `${killer.name} trick-shot ${victim.name} (${bounces}x Ricochet)!`;
      } else {
        msg = `${killer.name} destroyed ${victim.name}!`;
      }

      if (killerId === 1) this.p1Score++;
      else this.p2Score++;
    }

    if (this.onKillMsg) this.onKillMsg(msg);
    if (this.onScoreChange) this.onScoreChange(this.p1Score, this.p2Score);
  }

  public notifyUI() {
    if (this.onWeaponChange) {
      this.onWeaponChange(
        this.p1.weapon + (this.p1.specialAmmo > 0 ? ` (${this.p1.specialAmmo})` : ''),
        this.p2.weapon + (this.p2.specialAmmo > 0 ? ` (${this.p2.specialAmmo})` : '')
      );
    }
  }

  public render(time: number) {
    const parent = this.canvas.parentElement;
    const width = parent ? parent.clientWidth - 20 : 1000;
    const height = parent ? parent.clientHeight - 20 : 650;

    // Clear background
    this.ctx.fillStyle = '#06080b';
    this.ctx.fillRect(0, 0, width, height);

    // Draw bottom layer: Maze floor and walls
    this.maze.draw(this.ctx, time);

    // Draw tire skids
    this.particles.drawSkids(this.ctx);

    // Draw power-up crates
    this.powerups.draw(this.ctx, time);

    // Draw Tanks
    this.p1.draw(this.ctx);
    this.p2.draw(this.ctx);

    // Draw Projectiles (Bullets & Lasers)
    this.projectiles.draw(this.ctx);

    // Draw Particles & Explosions
    this.particles.drawParticles(this.ctx);

    // Draw in-canvas 3, 2, 1 Countdown Overlay
    if (this.state === 'COUNTDOWN') {
      const centerX = this.maze.originX + (this.maze.cols * this.maze.cellSize) / 2;
      const centerY = this.maze.originY + (this.maze.rows * this.maze.cellSize) / 2;

      let text = '3';
      let color = '#ff3355';
      if (this.countdownTimer > 2.0) {
        text = '3';
        color = '#ff3355';
      } else if (this.countdownTimer > 1.0) {
        text = '2';
        color = '#ffaa00';
      } else if (this.countdownTimer > 0.0) {
        text = '1';
        color = '#00d2ff';
      } else {
        text = 'FIGHT!';
        color = '#00ff88';
      }

      // Smooth pulsing scale animation per second
      const secFrac = this.countdownTimer > 0
        ? (this.countdownTimer - Math.floor(this.countdownTimer))
        : Math.max(0, (this.countdownTimer + 0.45) / 0.45);
      const scale = 1.0 + secFrac * 0.4;
      const alpha = Math.min(1, secFrac * 1.5 + 0.35);

      this.ctx.save();
      this.ctx.translate(centerX, centerY);
      this.ctx.scale(scale, scale);
      this.ctx.globalAlpha = alpha;

      this.ctx.font = '900 86px Chakra Petch, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = 30;
      this.ctx.fillStyle = color;
      this.ctx.fillText(text, 0, 0);

      if (this.countdownTimer > 0) {
        this.ctx.font = '700 18px JetBrains Mono, monospace';
        this.ctx.shadowBlur = 10;
        this.ctx.fillStyle = '#f0f4fc';
        this.ctx.fillText('GET READY', 0, 58);
      }

      this.ctx.restore();
    }
  }

  // ---- Network Serialization ----

  // Host: build a snapshot of the current game state for the guest
  public buildSnapshot(): GameSnapshot {
    return {
      type: 'state',
      p1: {
        x: this.p1.x, y: this.p1.y, angle: this.p1.angle,
        alive: this.p1.isAlive, weapon: this.p1.weapon,
        ammo: this.p1.specialAmmo, boostCd: this.p1.boostCooldown
      },
      p2: {
        x: this.p2.x, y: this.p2.y, angle: this.p2.angle,
        alive: this.p2.isAlive, weapon: this.p2.weapon,
        ammo: this.p2.specialAmmo, boostCd: this.p2.boostCooldown
      },
      bullets: this.projectiles.bullets.map(b => ({
        x: b.x, y: b.y, vx: b.vx, vy: b.vy,
        r: b.radius, ownerId: b.ownerId, isPellet: b.isPellet
      })),
      lasers: this.projectiles.laserBeams.map(l => ({
        points: l.points.map(p => ({ x: p.x, y: p.y })),
        alpha: l.alpha,
        ownerId: l.ownerId
      })),
      crates: this.powerups.crates.map(c => ({
        x: c.x, y: c.y, type: c.type, rotation: c.rotation
      })),
      scores: [this.p1Score, this.p2Score],
      state: this.state,
      countdownTimer: this.countdownTimer,
      suddenDeathTime: this.suddenDeathTime,
      suddenDeathActive: this.suddenDeathActive,
      timeScale: this.timeScale,
      timestamp: performance.now()
    };
  }

  // Target positions for guest smooth interpolation
  public targetP1 = { x: 0, y: 0, angle: 0 };
  public targetP2 = { x: 0, y: 0, angle: 0 };
  private isFirstSnapshot = true;

  // Guest: apply a received snapshot to render the game
  public applySnapshot(snap: GameSnapshot) {
    this.targetP1 = { x: snap.p1.x, y: snap.p1.y, angle: snap.p1.angle };
    this.targetP2 = { x: snap.p2.x, y: snap.p2.y, angle: snap.p2.angle };

    // Snap immediately if first snapshot or teleport/respawn
    if (this.isFirstSnapshot || Math.hypot(this.p1.x - snap.p1.x, this.p1.y - snap.p1.y) > 90) {
      this.p1.x = snap.p1.x;
      this.p1.y = snap.p1.y;
      this.p1.angle = snap.p1.angle;
      this.p2.x = snap.p2.x;
      this.p2.y = snap.p2.y;
      this.p2.angle = snap.p2.angle;
      this.isFirstSnapshot = false;
    }

    this.p1.isAlive = snap.p1.alive;
    this.p1.weapon = snap.p1.weapon as 'STANDARD' | 'LASER' | 'SHOTGUN';
    this.p1.specialAmmo = snap.p1.ammo;
    this.p1.boostCooldown = snap.p1.boostCd;

    this.p2.isAlive = snap.p2.alive;
    this.p2.weapon = snap.p2.weapon as 'STANDARD' | 'LASER' | 'SHOTGUN';
    this.p2.specialAmmo = snap.p2.ammo;
    this.p2.boostCooldown = snap.p2.boostCd;

    // Bullets — recreate from snapshot
    this.projectiles.bullets = snap.bullets.map(b => {
      const bullet = new Bullet(b.x, b.y, b.vx, b.vy, b.ownerId, b.isPellet);
      bullet.radius = b.r;
      return bullet;
    });

    // Lasers
    this.projectiles.laserBeams = snap.lasers.map(l => ({
      points: l.points, alpha: l.alpha, life: l.alpha * 0.35, maxLife: 0.35, ownerId: l.ownerId
    }));

    // Power-up crates
    this.powerups.crates = snap.crates.map((c, i) => ({
      id: i, x: c.x, y: c.y, type: c.type as 'LASER' | 'SHOTGUN',
      radius: 18, spawnTime: 0, rotation: c.rotation
    }));

    // Scores & State
    this.p1Score = snap.scores[0];
    this.p2Score = snap.scores[1];
    this.state = snap.state as GameState;
    this.countdownTimer = snap.countdownTimer;
    this.suddenDeathTime = snap.suddenDeathTime;
    this.suddenDeathActive = snap.suddenDeathActive;
    this.timeScale = snap.timeScale;
  }

  // Smooth position and angle interpolation on guest (eliminates school Wi-Fi jitter)
  public interpolateGuest(dt: number) {
    const factor = Math.min(1, dt * 26);

    // P1
    this.p1.x += (this.targetP1.x - this.p1.x) * factor;
    this.p1.y += (this.targetP1.y - this.p1.y) * factor;
    let diff1 = this.targetP1.angle - this.p1.angle;
    while (diff1 > Math.PI) diff1 -= Math.PI * 2;
    while (diff1 < -Math.PI) diff1 += Math.PI * 2;
    this.p1.angle += diff1 * factor;

    // P2
    this.p2.x += (this.targetP2.x - this.p2.x) * factor;
    this.p2.y += (this.targetP2.y - this.p2.y) * factor;
    let diff2 = this.targetP2.angle - this.p2.angle;
    while (diff2 > Math.PI) diff2 -= Math.PI * 2;
    while (diff2 < -Math.PI) diff2 += Math.PI * 2;
    this.p2.angle += diff2 * factor;
  }

  // Host: serialize maze layout for the guest
  public buildMazeData(): MazeDataMessage {
    return {
      type: 'maze',
      cols: this.maze.cols,
      rows: this.maze.rows,
      cellSize: this.maze.cellSize,
      originX: this.maze.originX,
      originY: this.maze.originY,
      gridData: JSON.stringify(this.maze.grid),
      segmentData: JSON.stringify(this.maze.segments),
      p1Spawn: { x: this.p1.x, y: this.p1.y, angle: this.p1.angle },
      p2Spawn: { x: this.p2.x, y: this.p2.y, angle: this.p2.angle },
      canvasWidth: (this.canvas.parentElement?.clientWidth ?? 1020) - 20,
      canvasHeight: (this.canvas.parentElement?.clientHeight ?? 670) - 20
    };
  }

  // Guest: apply maze layout from the host
  public applyMazeData(data: MazeDataMessage) {
    this.maze.cols = data.cols;
    this.maze.rows = data.rows;
    this.maze.cellSize = data.cellSize;
    this.maze.originX = data.originX;
    this.maze.originY = data.originY;
    this.maze.grid = JSON.parse(data.gridData);
    this.maze.segments = JSON.parse(data.segmentData);

    this.p1.reset(data.p1Spawn.x, data.p1Spawn.y, data.p1Spawn.angle);
    this.p2.reset(data.p2Spawn.x, data.p2Spawn.y, data.p2Spawn.angle);

    this.projectiles.clear();
    this.powerups.clear();
  }
}
