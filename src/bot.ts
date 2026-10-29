import { Tank, TankControls } from './tank.ts';
import { Vec2, Physics, Segment } from './physics.ts';
import { PowerUpManager } from './powerup.ts';
import { ProjectileManager } from './bullet.ts';

export class BotController {
  private thinkTimer = 0;
  private currentControls: TankControls = {
    forward: false,
    reverse: false,
    turnLeft: false,
    turnRight: false,
    shoot: false,
    boost: false
  };

  public update(
    dt: number,
    bot: Tank,
    target: Tank,
    segments: Segment[],
    powerups: PowerUpManager,
    projectiles: ProjectileManager
  ): TankControls {
    this.thinkTimer -= dt;

    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.08; // AI updates decisions 12 times a second
      this.think(bot, target, segments, powerups, projectiles);
    }

    return this.currentControls;
  }

  private think(
    bot: Tank,
    target: Tank,
    segments: Segment[],
    powerups: PowerUpManager,
    projectiles: ProjectileManager
  ) {
    // Reset controls
    this.currentControls.forward = false;
    this.currentControls.reverse = false;
    this.currentControls.turnLeft = false;
    this.currentControls.turnRight = false;
    this.currentControls.shoot = false;
    this.currentControls.boost = false;

    if (!bot.isAlive || !target.isAlive) return;

    const botPos: Vec2 = { x: bot.x, y: bot.y };
    const targetPos: Vec2 = { x: target.x, y: target.y };

    // 1. Evasive action: Check for incoming lethal bullets
    let threatClose = false;
    for (const b of projectiles.bullets) {
      const dist = Math.hypot(b.x - bot.x, b.y - bot.y);
      if (dist < 90) {
        // Is bullet moving towards bot?
        const toBot = { x: bot.x - b.x, y: bot.y - b.y };
        const dot = b.vx * toBot.x + b.vy * toBot.y;
        if (dot > 0) {
          threatClose = true;
          // Dodge!
          if (bot.boostCooldown <= 0 && Math.random() < 0.6) {
            this.currentControls.boost = true;
          }
          // Turn perpendicular to dodge
          this.currentControls.turnLeft = true;
          this.currentControls.forward = true;
          break;
        }
      }
    }

    // 2. Aiming & Shooting (Direct line of sight or 1-bounce trick shot)
    let bestShootAngle: number | null = null;

    // Check direct line of sight to target
    const directAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
    if (this.hasLineOfSight(botPos, targetPos, segments)) {
      bestShootAngle = directAngle;
    } else {
      // Look for 1-bounce trick shot!
      bestShootAngle = this.findTrickShotAngle(botPos, targetPos, segments);
    }

    if (bestShootAngle !== null) {
      const angleDiff = this.normalizeAngle(bestShootAngle - bot.angle);

      if (Math.abs(angleDiff) < 0.15) {
        // Aim is aligned: Fire!
        this.currentControls.shoot = true;
      } else {
        // Turn towards shooting angle
        if (angleDiff > 0) {
          this.currentControls.turnRight = true;
        } else {
          this.currentControls.turnLeft = true;
        }
      }
    }

    if (threatClose) return;

    // 3. Navigation Goal
    let goalPos: Vec2 = targetPos;

    // Prioritize grabbing power-ups if available
    if (powerups.crates.length > 0 && bot.weapon === 'STANDARD') {
      goalPos = { x: powerups.crates[0].x, y: powerups.crates[0].y };
    }

    // If we have line of sight and are at good combat range (~200px), maneuver laterally
    const distToTarget = Math.hypot(target.x - bot.x, target.y - bot.y);
    const goalAngle = Math.atan2(goalPos.y - bot.y, goalPos.x - bot.x);
    const navAngleDiff = this.normalizeAngle(goalAngle - bot.angle);

    // Obstacle avoidance feelers (left & right whiskers)
    const feelerDist = 45;
    const leftFeeler = {
      x: bot.x + Math.cos(bot.angle - 0.5) * feelerDist,
      y: bot.y + Math.sin(bot.angle - 0.5) * feelerDist
    };
    const rightFeeler = {
      x: bot.x + Math.cos(bot.angle + 0.5) * feelerDist,
      y: bot.y + Math.sin(bot.angle + 0.5) * feelerDist
    };

    const leftBlocked = !this.hasLineOfSight(botPos, leftFeeler, segments);
    const rightBlocked = !this.hasLineOfSight(botPos, rightFeeler, segments);

    if (leftBlocked && !rightBlocked) {
      this.currentControls.turnRight = true;
      this.currentControls.forward = true;
    } else if (rightBlocked && !leftBlocked) {
      this.currentControls.turnLeft = true;
      this.currentControls.forward = true;
    } else if (leftBlocked && rightBlocked) {
      this.currentControls.reverse = true;
      this.currentControls.turnRight = true;
    } else {
      // Normal pathing towards goal
      if (distToTarget > 180 || goalPos !== targetPos) {
        if (Math.abs(navAngleDiff) > 0.4) {
          if (navAngleDiff > 0) this.currentControls.turnRight = true;
          else this.currentControls.turnLeft = true;
        }
        this.currentControls.forward = true;
      } else if (distToTarget < 110) {
        // Too close, back off slightly
        this.currentControls.reverse = true;
      }
    }
  }

  // Raycast to check unblocked line of sight between two points
  private hasLineOfSight(p1: Vec2, p2: Vec2, segments: Segment[]): boolean {
    const dir = Physics.sub(p2, p1);
    const dist = Physics.length(dir);
    if (dist === 0) return true;

    for (const seg of segments) {
      const hit = Physics.raySegmentIntersect(p1, dir, dist, seg);
      if (hit && hit.t > 0.05 && hit.t < 0.95) {
        return false;
      }
    }
    return true;
  }

  // Calculate 1-bounce trick shot angles towards target
  private findTrickShotAngle(botPos: Vec2, targetPos: Vec2, segments: Segment[]): number | null {
    const sampleCount = 18;
    for (let i = 0; i < sampleCount; i++) {
      const testAngle = (i / sampleCount) * Math.PI * 2;
      const dir: Vec2 = { x: Math.cos(testAngle), y: Math.sin(testAngle) };

      // Find first wall hit
      let firstHit: any = null;
      for (const seg of segments) {
        const hit = Physics.raySegmentIntersect(botPos, dir, 800, seg);
        if (hit && hit.t > 0.05) {
          if (!firstHit || hit.t < firstHit.t) {
            firstHit = hit;
          }
        }
      }

      if (firstHit) {
        // Calculate reflection
        const reflectedDir = Physics.reflect(dir, firstHit.normal);
        // Check if reflected ray has line of sight to target
        const bounceOrigin = firstHit.point;
        const toTarget = Physics.sub(targetPos, bounceOrigin);
        const distToTarget = Physics.length(toTarget);

        if (distToTarget > 0 && distToTarget < 500) {
          const normToTarget = Physics.normalize(toTarget);
          const dot = Physics.dot(reflectedDir, normToTarget);

          // If reflected ray points directly towards target
          if (dot > 0.96) {
            if (this.hasLineOfSight(bounceOrigin, targetPos, segments)) {
              return testAngle;
            }
          }
        }
      }
    }
    return null;
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }
}
