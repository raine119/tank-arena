import { Tank, TankControls } from './tank.ts';
import { Vec2, Physics, Segment } from './physics.ts';
import { PowerUpManager } from './powerup.ts';
import { ProjectileManager } from './bullet.ts';
import { Maze } from './maze.ts';

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

  private currentPath: Vec2[] = [];
  private pathRecalcTimer = 0;
  private dodgeTimer = 0;
  private dodgeDir: Vec2 = { x: 0, y: 0 };

  public update(
    dt: number,
    bot: Tank,
    target: Tank,
    maze: Maze,
    powerups: PowerUpManager,
    projectiles: ProjectileManager
  ): TankControls {
    this.thinkTimer -= dt;
    this.pathRecalcTimer -= dt;
    if (this.dodgeTimer > 0) this.dodgeTimer -= dt;

    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.05; // 20 evaluations per second
      this.think(bot, target, maze, powerups, projectiles);
    }

    return this.currentControls;
  }

  private think(
    bot: Tank,
    target: Tank,
    maze: Maze,
    powerups: PowerUpManager,
    projectiles: ProjectileManager
  ) {
    this.currentControls.forward = false;
    this.currentControls.reverse = false;
    this.currentControls.turnLeft = false;
    this.currentControls.turnRight = false;
    this.currentControls.shoot = false;
    this.currentControls.boost = false;

    if (!bot.isAlive || !target.isAlive) return;

    const botPos: Vec2 = { x: bot.x, y: bot.y };
    const targetPos: Vec2 = { x: target.x, y: target.y };
    const segments = maze.segments;

    // ========================================================
    // 1. BULLET EVASION (Predictive trajectory dodging)
    // ========================================================
    let threatFound = false;

    for (const b of projectiles.bullets) {
      if (!b.isAlive) continue;

      const toBot = { x: bot.x - b.x, y: bot.y - b.y };
      const dist = Math.hypot(toBot.x, toBot.y);
      const bSpeed = Math.hypot(b.vx, b.vy);

      if (bSpeed > 20 && dist < 170) {
        const bDir = { x: b.vx / bSpeed, y: b.vy / bSpeed };
        const forwardProj = toBot.x * bDir.x + toBot.y * bDir.y;

        // Is bullet moving towards the bot?
        if (forwardProj > 0 && forwardProj < dist + 25) {
          const perpDist = Math.abs(toBot.x * -bDir.y + toBot.y * bDir.x);

          if (perpDist < bot.radius + 16) {
            threatFound = true;
            this.dodgeTimer = 0.28; // Keep dodging smoothly to avoid jitter

            // Dodge perpendicular to incoming fire
            const perpX = -bDir.y;
            const perpY = bDir.x;
            const sign = (toBot.x * perpX + toBot.y * perpY) >= 0 ? 1 : -1;
            this.dodgeDir = { x: perpX * sign, y: perpY * sign };

            // Emergency boost dash
            if (bot.boostCooldown <= 0) {
              this.currentControls.boost = true;
            }
            break;
          }
        }
      }
    }

    // Apply active dodge steering
    if (this.dodgeTimer > 0) {
      const dodgeAngle = Math.atan2(this.dodgeDir.y, this.dodgeDir.x);
      const angleDiff = this.normalizeAngle(dodgeAngle - bot.angle);

      if (Math.abs(angleDiff) > 1.7) {
        this.currentControls.reverse = true;
      } else {
        if (angleDiff > 0.1) this.currentControls.turnRight = true;
        else if (angleDiff < -0.1) this.currentControls.turnLeft = true;
        this.currentControls.forward = true;
      }
    }

    // ========================================================
    // 2. TACTICAL SHOOTING & BULLET SAFETY (Never shoots itself)
    // ========================================================
    let bestShootAngle: number | null = null;
    const hasDirectLOS = this.hasLineOfSight(botPos, targetPos, segments);

    if (hasDirectLOS) {
      bestShootAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
    } else {
      bestShootAngle = this.findMultiBounceTrickShot(botPos, targetPos, segments);
    }

    // Check if room is already congested with bouncing bullets
    const nearbyBulletsCount = projectiles.bullets.filter(b =>
      b.isAlive && Math.hypot(b.x - bot.x, b.y - bot.y) < 130
    ).length;

    if (bestShootAngle !== null && nearbyBulletsCount < 2) {
      // RIGOROUS SELF-DAMAGE CHECK: Simulate 3 bullet segments
      if (!this.willBulletHitSelf(botPos, bestShootAngle, segments, bot.radius)) {
        const aimDiff = this.normalizeAngle(bestShootAngle - bot.angle);

        if (Math.abs(aimDiff) < 0.12) {
          this.currentControls.shoot = true;
        } else {
          // Align barrel
          if (aimDiff > 0) this.currentControls.turnRight = true;
          else this.currentControls.turnLeft = true;
        }
      }
    }

    // If actively dodging, let evasion handle treads
    if (this.dodgeTimer > 0) return;

    // ========================================================
    // 3. MAZE CELL BFS NAVIGATION (Smooth & No Wall-Glitching)
    // ========================================================
    let destination: Vec2 = targetPos;

    // Collect power-up crate if available
    if (powerups.crates.length > 0 && bot.weapon === 'STANDARD') {
      destination = { x: powerups.crates[0].x, y: powerups.crates[0].y };
    }

    // Recalculate path periodically
    if (this.pathRecalcTimer <= 0 || this.currentPath.length === 0) {
      this.pathRecalcTimer = 0.3;
      this.currentPath = this.findBfsPath(botPos, destination, maze);
    }

    if (this.currentPath.length > 0) {
      const nextWaypoint = this.currentPath[0];
      const distToWaypoint = Math.hypot(nextWaypoint.x - bot.x, nextWaypoint.y - bot.y);

      // Reached waypoint: pop it unless it's the final target
      if (distToWaypoint < 26 && this.currentPath.length > 1) {
        this.currentPath.shift();
      }

      const wp = this.currentPath[0];
      const angleToWp = Math.atan2(wp.y - bot.y, wp.x - bot.x);
      const navDiff = this.normalizeAngle(angleToWp - bot.angle);
      const directDistToTarget = Math.hypot(target.x - bot.x, target.y - bot.y);

      // FIX FOR WALL-OSCILLATION GLITCH:
      // ONLY back up if bot and player are in the SAME hallway (direct LOS) and too close (< 100px)
      // NEVER reverse when separated by a wall!
      const isShotgun = bot.weapon === 'SHOTGUN';
      if (hasDirectLOS && directDistToTarget < 100 && !isShotgun) {
        this.currentControls.reverse = true;
      } else {
        // TANK STEERING: Rotate in place when misaligned to avoid grinding into walls
        if (Math.abs(navDiff) > 0.65) {
          // Turn to face the hallway opening first
          if (navDiff > 0) this.currentControls.turnRight = true;
          else this.currentControls.turnLeft = true;
        } else {
          // Pointed down hallway: drive forward smoothly
          if (navDiff > 0.12) this.currentControls.turnRight = true;
          else if (navDiff < -0.12) this.currentControls.turnLeft = true;
          this.currentControls.forward = true;
        }
      }
    }
  }

  // ========================================================
  // BFS MAZE PATHFINDING
  // ========================================================
  private findBfsPath(startPos: Vec2, endPos: Vec2, maze: Maze): Vec2[] {
    const startCell = this.posToCell(startPos, maze);
    const endCell = this.posToCell(endPos, maze);

    if (startCell.c === endCell.c && startCell.r === endCell.r) {
      return [endPos];
    }

    const key = (c: number, r: number) => `${c},${r}`;
    const queue: { c: number; r: number }[] = [startCell];
    const visited = new Set<string>([key(startCell.c, startCell.r)]);
    const parent = new Map<string, { c: number; r: number }>();

    let found = false;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr.c === endCell.c && curr.r === endCell.r) {
        found = true;
        break;
      }

      const cellData = maze.grid[curr.c]?.[curr.r];
      if (!cellData || cellData.collapsed) continue;

      const neighbors: { c: number; r: number }[] = [];

      // North
      if (!cellData.walls.north && curr.r > 0) neighbors.push({ c: curr.c, r: curr.r - 1 });
      // South
      if (!cellData.walls.south && curr.r < maze.rows - 1) neighbors.push({ c: curr.c, r: curr.r + 1 });
      // West
      if (!cellData.walls.west && curr.c > 0) neighbors.push({ c: curr.c - 1, r: curr.r });
      // East
      if (!cellData.walls.east && curr.c < maze.cols - 1) neighbors.push({ c: curr.c + 1, r: curr.r });

      for (const n of neighbors) {
        const nKey = key(n.c, n.r);
        if (!visited.has(nKey) && !maze.grid[n.c][n.r].collapsed) {
          visited.add(nKey);
          parent.set(nKey, curr);
          queue.push(n);
        }
      }
    }

    if (!found) return [endPos];

    // Build path backwards from end
    const waypoints: Vec2[] = [];
    let curr = endCell;

    while (!(curr.c === startCell.c && curr.r === startCell.r)) {
      waypoints.unshift({
        x: maze.originX + (curr.c + 0.5) * maze.cellSize,
        y: maze.originY + (curr.r + 0.5) * maze.cellSize
      });
      const p = parent.get(key(curr.c, curr.r));
      if (!p) break;
      curr = p;
    }

    waypoints.push(endPos);
    return waypoints;
  }

  private posToCell(pos: Vec2, maze: Maze): { c: number; r: number } {
    const c = Math.max(0, Math.min(maze.cols - 1, Math.floor((pos.x - maze.originX) / maze.cellSize)));
    const r = Math.max(0, Math.min(maze.rows - 1, Math.floor((pos.y - maze.originY) / maze.cellSize)));
    return { c, r };
  }

  // ========================================================
  // 2-BOUNCE TRICK SHOT ENGINE
  // ========================================================
  private findMultiBounceTrickShot(botPos: Vec2, targetPos: Vec2, segments: Segment[]): number | null {
    const sampleCount = 48;
    const maxRayDist = 700;

    for (let i = 0; i < sampleCount; i++) {
      const angle = (i / sampleCount) * Math.PI * 2;
      const dir1: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };

      // Bounce 1
      const hit1 = this.castRay(botPos, dir1, maxRayDist, segments);
      if (!hit1 || hit1.t < 0.05) continue;

      const refl1 = Physics.reflect(dir1, hit1.normal);
      const origin2: Vec2 = {
        x: hit1.point.x + hit1.normal.x * 2.0,
        y: hit1.point.y + hit1.normal.y * 2.0
      };

      if (this.rayPassesNearTarget(origin2, refl1, targetPos, 20, segments)) {
        return angle;
      }

      // Bounce 2
      const hit2 = this.castRay(origin2, refl1, maxRayDist * 0.7, segments);
      if (!hit2 || hit2.t < 0.05) continue;

      const refl2 = Physics.reflect(refl1, hit2.normal);
      const origin3: Vec2 = {
        x: hit2.point.x + hit2.normal.x * 2.0,
        y: hit2.point.y + hit2.normal.y * 2.0
      };

      if (this.rayPassesNearTarget(origin3, refl2, targetPos, 22, segments)) {
        return angle;
      }
    }

    return null;
  }

  private rayPassesNearTarget(origin: Vec2, dir: Vec2, target: Vec2, tolerance: number, segments: Segment[]): boolean {
    const toTarget = Physics.sub(target, origin);
    const dist = Physics.length(toTarget);
    if (dist < 10 || dist > 600) return false;

    const normDir = Physics.normalize(dir);
    const dot = Physics.dot(normDir, Physics.normalize(toTarget));

    if (dot > 0.96) {
      const projDist = Physics.dot(toTarget, normDir);
      const perpSq = dist * dist - projDist * projDist;

      if (perpSq <= tolerance * tolerance) {
        return this.hasLineOfSight(origin, target, segments);
      }
    }

    return false;
  }

  private castRay(origin: Vec2, dir: Vec2, maxDist: number, segments: Segment[]) {
    let closest: any = null;
    for (const seg of segments) {
      const hit = Physics.raySegmentIntersect(origin, dir, maxDist, seg);
      if (hit && hit.t > 0.01) {
        if (!closest || hit.t < closest.t) {
          closest = hit;
        }
      }
    }
    return closest;
  }

  // ========================================================
  // COMPREHENSIVE SELF-DAMAGE SIMULATOR (Solves bot shooting itself)
  // ========================================================
  private willBulletHitSelf(origin: Vec2, angle: number, segments: Segment[], botRadius: number): boolean {
    const dir1: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };

    // 1. Ray 1: Muzzle to First Wall
    const hit1 = this.castRay(origin, dir1, 600, segments);
    if (!hit1) return false;

    const d1 = Math.hypot(hit1.point.x - origin.x, hit1.point.y - origin.y);
    // If wall is within 26px of center (barrel touching wall): SUICIDE SHOT!
    if (d1 < botRadius + 13) {
      return true;
    }

    // 2. Ray 2: 1st Reflection
    const refl1 = Physics.reflect(dir1, hit1.normal);
    const p2Start: Vec2 = {
      x: hit1.point.x + hit1.normal.x * 2.0,
      y: hit1.point.y + hit1.normal.y * 2.0
    };

    const hit2 = this.castRay(p2Start, refl1, 600, segments);
    const p2End = hit2 ? hit2.point : { x: p2Start.x + refl1.x * 600, y: p2Start.y + refl1.y * 600 };

    // Test if 1st bounce segment passes through bot's circle
    const closest1 = Physics.closestPointOnSegment(origin, p2Start, p2End);
    const distToBounce1 = Math.hypot(origin.x - closest1.x, origin.y - closest1.y);
    if (distToBounce1 < botRadius + 18) {
      return true; // 1st reflection will strike the bot!
    }

    if (!hit2) return false;

    // 3. Ray 3: 2nd Reflection
    const refl2 = Physics.reflect(refl1, hit2.normal);
    const p3Start: Vec2 = {
      x: hit2.point.x + hit2.normal.x * 2.0,
      y: hit2.point.y + hit2.normal.y * 2.0
    };

    const hit3 = this.castRay(p3Start, refl2, 600, segments);
    const p3End = hit3 ? hit3.point : { x: p3Start.x + refl2.x * 600, y: p3Start.y + refl2.y * 600 };

    // Test if 2nd bounce segment passes through bot's circle
    const closest2 = Physics.closestPointOnSegment(origin, p3Start, p3End);
    const distToBounce2 = Math.hypot(origin.x - closest2.x, origin.y - closest2.y);
    if (distToBounce2 < botRadius + 18) {
      return true; // 2nd reflection will strike the bot!
    }

    return false;
  }

  private hasLineOfSight(p1: Vec2, p2: Vec2, segments: Segment[]): boolean {
    const dir = Physics.sub(p2, p1);
    const dist = Physics.length(dir);
    if (dist === 0) return true;

    for (const seg of segments) {
      const hit = Physics.raySegmentIntersect(p1, dir, dist, seg);
      if (hit && hit.t > 0.03 && hit.t < 0.97) {
        return false;
      }
    }
    return true;
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }
}
