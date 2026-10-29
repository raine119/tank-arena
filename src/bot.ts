import { Tank, TankControls } from './tank.ts';
import { Vec2, Physics, Segment } from './physics.ts';
import { PowerUpManager } from './powerup.ts';
import { ProjectileManager } from './bullet.ts';
import { Maze, Cell } from './maze.ts';

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

    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.05; // 20 decisions/sec for razor-sharp reaction
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
    // 1. ADVANCED BULLET EVASION (Trajectory-based dodge)
    // ========================================================
    let imminentDanger = false;
    let dodgeVector: Vec2 = { x: 0, y: 0 };

    for (const b of projectiles.bullets) {
      if (!b.isAlive) continue;

      const toBot = { x: bot.x - b.x, y: bot.y - b.y };
      const dist = Math.hypot(toBot.x, toBot.y);

      // Check bullet moving towards bot
      const bSpeed = Math.hypot(b.vx, b.vy);
      if (bSpeed > 10 && dist < 180) {
        const bDir = { x: b.vx / bSpeed, y: b.vy / bSpeed };
        const dot = toBot.x * bDir.x + toBot.y * bDir.y;

        if (dot > 0 && dot < dist + 30) {
          // Perpendicular distance from bot center to bullet ray
          const perpDist = Math.abs(toBot.x * -bDir.y + toBot.y * bDir.x);

          if (perpDist < bot.radius + 18) {
            imminentDanger = true;
            // Push perpendicular to bullet trajectory
            const perpX = -bDir.y;
            const perpY = bDir.x;
            const sign = (toBot.x * perpX + toBot.y * perpY) >= 0 ? 1 : -1;
            dodgeVector = { x: perpX * sign, y: perpY * sign };
            break;
          }
        }
      }
    }

    // Execute urgent evasive maneuver
    if (imminentDanger) {
      if (bot.boostCooldown <= 0) {
        this.currentControls.boost = true;
      }

      // Steer toward dodge vector
      const dodgeAngle = Math.atan2(dodgeVector.y, dodgeVector.x);
      const angleDiff = this.normalizeAngle(dodgeAngle - bot.angle);

      if (Math.abs(angleDiff) > 1.8) {
        // Faster to reverse away
        this.currentControls.reverse = true;
      } else {
        if (angleDiff > 0.1) this.currentControls.turnRight = true;
        else if (angleDiff < -0.1) this.currentControls.turnLeft = true;
        this.currentControls.forward = true;
      }
    }

    // ========================================================
    // 2. TACTICAL AIMING & 2-BOUNCE TRICK SHOT ENGINE
    // ========================================================
    let bestShootAngle: number | null = null;
    const distToTarget = Math.hypot(target.x - bot.x, target.y - bot.y);

    // Direct line of sight check
    if (this.hasLineOfSight(botPos, targetPos, segments)) {
      bestShootAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
    } else {
      // Search for 1-bounce or 2-bounce trick bank shots
      bestShootAngle = this.findMultiBounceTrickShot(botPos, targetPos, segments);
    }

    // Self-preservation check: ensure firing will not immediately kill bot
    if (bestShootAngle !== null) {
      if (!this.willBulletHitSelf(botPos, bestShootAngle, segments, bot.radius)) {
        const aimDiff = this.normalizeAngle(bestShootAngle - bot.angle);

        if (Math.abs(aimDiff) < 0.12) {
          // Lock on and FIRE!
          this.currentControls.shoot = true;
        } else {
          // Align barrel
          if (aimDiff > 0) this.currentControls.turnRight = true;
          else this.currentControls.turnLeft = true;
        }
      }
    }

    if (imminentDanger) return;

    // ========================================================
    // 3. MAZE CELL BFS NAVIGATION (Never gets stuck on corners)
    // ========================================================
    let destination: Vec2 = targetPos;

    // Hunt power-up crate if available and standard ammo
    if (powerups.crates.length > 0 && bot.weapon === 'STANDARD') {
      destination = { x: powerups.crates[0].x, y: powerups.crates[0].y };
    }

    // Recalculate BFS path periodically
    if (this.pathRecalcTimer <= 0 || this.currentPath.length === 0) {
      this.pathRecalcTimer = 0.35;
      this.currentPath = this.findBfsPath(botPos, destination, maze);
    }

    // Follow BFS waypoints
    if (this.currentPath.length > 0) {
      const nextWaypoint = this.currentPath[0];
      const distToWaypoint = Math.hypot(nextWaypoint.x - bot.x, nextWaypoint.y - bot.y);

      if (distToWaypoint < 28) {
        this.currentPath.shift(); // Reached waypoint
      }

      if (this.currentPath.length > 0) {
        const wp = this.currentPath[0];
        const angleToWp = Math.atan2(wp.y - bot.y, wp.x - bot.x);
        const navDiff = this.normalizeAngle(angleToWp - bot.angle);

        // Combat distancing: keep sweet spot distance (~140-180px) unless using shotgun
        const isShotgun = bot.weapon === 'SHOTGUN';
        if (distToTarget < 100 && !isShotgun && destination === targetPos) {
          // Back up to open space
          this.currentControls.reverse = true;
        } else {
          if (Math.abs(navDiff) > 0.25) {
            if (navDiff > 0) this.currentControls.turnRight = true;
            else this.currentControls.turnLeft = true;
          }
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

      // Check 4 directions respecting maze cell walls
      const cellData = maze.grid[curr.c]?.[curr.r];
      if (!cellData || cellData.collapsed) continue;

      const neighbors: { c: number; r: number }[] = [];

      // North
      if (!cellData.walls.north && curr.r > 0) {
        neighbors.push({ c: curr.c, r: curr.r - 1 });
      }
      // South
      if (!cellData.walls.south && curr.r < maze.rows - 1) {
        neighbors.push({ c: curr.c, r: curr.r + 1 });
      }
      // West
      if (!cellData.walls.west && curr.c > 0) {
        neighbors.push({ c: curr.c - 1, r: curr.r });
      }
      // East
      if (!cellData.walls.east && curr.c < maze.cols - 1) {
        neighbors.push({ c: curr.c + 1, r: curr.r });
      }

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

    // Reconstruct path
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
  // 2-BOUNCE TRICK SHOT ENGINE (Laika 2.0 Bank Shots)
  // ========================================================
  private findMultiBounceTrickShot(botPos: Vec2, targetPos: Vec2, segments: Segment[]): number | null {
    // 48 evenly distributed angle samples around 360 degrees
    const sampleCount = 48;
    const maxRayDist = 750;

    for (let i = 0; i < sampleCount; i++) {
      const angle = (i / sampleCount) * Math.PI * 2;
      const dir1: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };

      // Bounce 1: Hit first wall
      const hit1 = this.castRay(botPos, dir1, maxRayDist, segments);
      if (!hit1 || hit1.t < 0.04) continue;

      const refl1 = Physics.reflect(dir1, hit1.normal);
      const origin2: Vec2 = {
        x: hit1.point.x + hit1.normal.x * 2.0,
        y: hit1.point.y + hit1.normal.y * 2.0
      };

      // Check if 1st bounce connects to target
      if (this.rayPassesNearTarget(origin2, refl1, targetPos, 20, segments)) {
        return angle;
      }

      // Bounce 2: Hit second wall
      const hit2 = this.castRay(origin2, refl1, maxRayDist * 0.7, segments);
      if (!hit2 || hit2.t < 0.04) continue;

      const refl2 = Physics.reflect(refl1, hit2.normal);
      const origin3: Vec2 = {
        x: hit2.point.x + hit2.normal.x * 2.0,
        y: hit2.point.y + hit2.normal.y * 2.0
      };

      // Check if 2nd bounce connects to target
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
      // Check clearance
      const projDist = Physics.dot(toTarget, normDir);
      const perpSq = dist * dist - projDist * projDist;

      if (perpSq <= tolerance * tolerance) {
        return this.hasLineOfSight(origin, target, segments);
      }
    }

    return false;
  }

  // Casts ray against all segments and returns earliest hit
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

  // Self-damage check: Prevents bot from shooting itself in tight corners
  private willBulletHitSelf(origin: Vec2, angle: number, segments: Segment[], botRadius: number): boolean {
    const dir: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
    const hit1 = this.castRay(origin, dir, 400, segments);
    if (!hit1) return false;

    // Distance to first wall
    const d1 = Math.hypot(hit1.point.x - origin.x, hit1.point.y - origin.y);
    if (d1 < botRadius + 8) {
      // Wall is right in front of barrel — suicide shot!
      return true;
    }

    // Check if reflected ray comes back toward bot
    const refl = Physics.reflect(dir, hit1.normal);
    const bouncePt = {
      x: hit1.point.x + hit1.normal.x * 2.0,
      y: hit1.point.y + hit1.normal.y * 2.0
    };
    const toBot = Physics.sub(origin, bouncePt);
    const toBotDist = Physics.length(toBot);

    if (toBotDist < 120) {
      const dot = Physics.dot(Physics.normalize(refl), Physics.normalize(toBot));
      if (dot > 0.94) {
        return true; // Bullet will bounce right back into bot!
      }
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
