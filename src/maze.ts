import { Segment, Vec2 } from './physics.ts';
import { ParticleSystem } from './particles.ts';
import { sound } from './audio.ts';

export interface Cell {
  x: number;
  y: number;
  walls: {
    north: boolean;
    south: boolean;
    east: boolean;
    west: boolean;
  };
  visited: boolean;
  collapsed: boolean;
  warningCollapse: boolean;
}

export class Maze {
  public cols: number = 10;
  public rows: number = 7;
  public cellSize: number = 100;
  public originX: number = 0;
  public originY: number = 0;
  public grid: Cell[][] = [];
  public segments: Segment[] = [];
  public collapseRing: number = 0;
  public maxRings: number = 3;

  constructor(cols = 10, rows = 7) {
    this.cols = cols;
    this.rows = rows;
  }

  // Generate a new layout with procedural labyrinth + extra loops + destructible walls
  public generate(canvasWidth: number, canvasHeight: number) {
    this.collapseRing = 0;

    // Calculate dimensions to neatly fit canvas with padding
    const padding = 30;
    const availWidth = canvasWidth - padding * 2;
    const availHeight = canvasHeight - padding * 2;

    this.cellSize = Math.floor(Math.min(availWidth / this.cols, availHeight / this.rows));
    const mazeWidth = this.cols * this.cellSize;
    const mazeHeight = this.rows * this.cellSize;

    this.originX = Math.floor((canvasWidth - mazeWidth) / 2);
    this.originY = Math.floor((canvasHeight - mazeHeight) / 2);

    // Initialize grid
    this.grid = [];
    for (let c = 0; c < this.cols; c++) {
      this.grid[c] = [];
      for (let r = 0; r < this.rows; r++) {
        this.grid[c][r] = {
          x: c,
          y: r,
          walls: { north: true, south: true, east: true, west: true },
          visited: false,
          collapsed: false,
          warningCollapse: false
        };
      }
    }

    // Depth-First Search with backtracking
    const stack: { c: number; r: number }[] = [];
    const startC = Math.floor(Math.random() * this.cols);
    const startR = Math.floor(Math.random() * this.rows);
    this.grid[startC][startR].visited = true;
    stack.push({ c: startC, r: startR });

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = this.getUnvisitedNeighbors(current.c, current.r);

      if (neighbors.length > 0) {
        const next = neighbors[Math.floor(Math.random() * neighbors.length)];
        this.removeWallBetween(current.c, current.r, next.c, next.r);
        this.grid[next.c][next.r].visited = true;
        stack.push({ c: next.c, r: next.r });
      } else {
        stack.pop();
      }
    }

    // Carve extra loops (remove 30% of interior walls to prevent dead-ends & camping)
    for (let c = 1; c < this.cols - 1; c++) {
      for (let r = 1; r < this.rows - 1; r++) {
        if (Math.random() < 0.32) {
          if (Math.random() < 0.5 && this.grid[c][r].walls.east) {
            this.removeWallBetween(c, r, c + 1, r);
          } else if (this.grid[c][r].walls.south) {
            this.removeWallBetween(c, r, c, r + 1);
          }
        }
      }
    }

    // Convert cell walls into physical line segments
    this.rebuildSegments();
  }

  private getUnvisitedNeighbors(c: number, r: number) {
    const neighbors: { c: number; r: number }[] = [];
    if (r > 0 && !this.grid[c][r - 1].visited) neighbors.push({ c, r: r - 1 });
    if (r < this.rows - 1 && !this.grid[c][r + 1].visited) neighbors.push({ c, r: r + 1 });
    if (c > 0 && !this.grid[c - 1][r].visited) neighbors.push({ c: c - 1, r });
    if (c < this.cols - 1 && !this.grid[c + 1][r].visited) neighbors.push({ c: c + 1, r });
    return neighbors;
  }

  private removeWallBetween(c1: number, r1: number, c2: number, r2: number) {
    if (c1 === c2) {
      if (r1 < r2) {
        this.grid[c1][r1].walls.south = false;
        this.grid[c2][r2].walls.north = false;
      } else {
        this.grid[c1][r1].walls.north = false;
        this.grid[c2][r2].walls.south = false;
      }
    } else {
      if (c1 < c2) {
        this.grid[c1][r1].walls.east = false;
        this.grid[c2][r2].walls.west = false;
      } else {
        this.grid[c1][r1].walls.west = false;
        this.grid[c2][r2].walls.east = false;
      }
    }
  }

  // Reconstruct physical segments from cell grid
  public rebuildSegments() {
    this.segments = [];
    let segId = 0;

    // Horizontal segments
    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const isBorder = r === 0 || r === this.rows;
        let hasWall = false;

        if (r === 0) {
          hasWall = true;
        } else if (r === this.rows) {
          hasWall = true;
        } else {
          hasWall = this.grid[c][r].walls.north;
        }

        if (hasWall) {
          const p1: Vec2 = { x: this.originX + c * this.cellSize, y: this.originY + r * this.cellSize };
          const p2: Vec2 = { x: this.originX + (c + 1) * this.cellSize, y: this.originY + r * this.cellSize };
          const isDestructible = !isBorder && Math.random() < 0.22;
          this.segments.push({
            id: `h_${segId++}`,
            p1,
            p2,
            isDestructible,
            health: isDestructible ? 2 : undefined
          });
        }
      }
    }

    // Vertical segments
    for (let c = 0; c <= this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const isBorder = c === 0 || c === this.cols;
        let hasWall = false;

        if (c === 0) {
          hasWall = true;
        } else if (c === this.cols) {
          hasWall = true;
        } else {
          hasWall = this.grid[c][r].walls.west;
        }

        if (hasWall) {
          const p1: Vec2 = { x: this.originX + c * this.cellSize, y: this.originY + r * this.cellSize };
          const p2: Vec2 = { x: this.originX + c * this.cellSize, y: this.originY + (r + 1) * this.cellSize };
          const isDestructible = !isBorder && Math.random() < 0.22;
          this.segments.push({
            id: `v_${segId++}`,
            p1,
            p2,
            isDestructible,
            health: isDestructible ? 2 : undefined
          });
        }
      }
    }
  }

  // Destructible wall damage
  public damageSegment(segmentId: string, particles: ParticleSystem): boolean {
    const idx = this.segments.findIndex(s => s.id === segmentId);
    if (idx === -1) return false;

    const seg = this.segments[idx];
    if (!seg.isDestructible || seg.health === undefined) return false;

    seg.health -= 1;
    // Spawn brick dust particles
    const midX = (seg.p1.x + seg.p2.x) / 2;
    const midY = (seg.p1.y + seg.p2.y) / 2;
    particles.createSparks({ x: midX, y: midY }, { x: 0, y: -1 }, 12, '#cc8855');

    if (seg.health <= 0) {
      sound.playExplosion();
      this.segments.splice(idx, 1);
      return true; // Wall destroyed
    }
    return false;
  }

  // Trigger sudden death collapse of next outer ring
  public warnCollapse(ringIndex: number) {
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const ring = Math.min(c, this.cols - 1 - c, r, this.rows - 1 - r);
        if (ring === ringIndex && !this.grid[c][r].collapsed) {
          this.grid[c][r].warningCollapse = true;
        }
      }
    }
  }

  public executeCollapse(ringIndex: number, particles: ParticleSystem) {
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const ring = Math.min(c, this.cols - 1 - c, r, this.rows - 1 - r);
        if (ring === ringIndex && !this.grid[c][r].collapsed) {
          this.grid[c][r].collapsed = true;
          this.grid[c][r].warningCollapse = false;
          // Spawn collapse fire particles
          const cx = this.originX + (c + 0.5) * this.cellSize;
          const cy = this.originY + (r + 0.5) * this.cellSize;
          particles.createExplosion({ x: cx, y: cy }, '#ff2200');
        }
      }
    }
  }

  // Check if position is inside a collapsed hazard tile
  public isPointInHazard(pos: Vec2): boolean {
    const col = Math.floor((pos.x - this.originX) / this.cellSize);
    const row = Math.floor((pos.y - this.originY) / this.cellSize);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return true;
    return this.grid[col][row].collapsed;
  }

  // Get random open cell center (for spawning tanks or power-up crates)
  public getRandomOpenCellPos(margin = 0): Vec2 {
    const validCells: Vec2[] = [];
    for (let c = margin; c < this.cols - margin; c++) {
      for (let r = margin; r < this.rows - margin; r++) {
        if (!this.grid[c][r].collapsed && !this.grid[c][r].warningCollapse) {
          validCells.push({
            x: this.originX + (c + 0.5) * this.cellSize,
            y: this.originY + (r + 0.5) * this.cellSize
          });
        }
      }
    }
    if (validCells.length === 0) {
      return {
        x: this.originX + (this.cols / 2) * this.cellSize,
        y: this.originY + (this.rows / 2) * this.cellSize
      };
    }
    return validCells[Math.floor(Math.random() * validCells.length)];
  }

  // Draw maze, grid floors, destructible walls, and sudden-death hazard tiles
  public draw(ctx: CanvasRenderingContext2D, time: number) {
    const width = this.cols * this.cellSize;
    const height = this.rows * this.cellSize;

    // Arena Floor
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(this.originX, this.originY, width, height);

    // Subtle floor grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= this.cols; c++) {
      const x = this.originX + c * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(x, this.originY);
      ctx.lineTo(x, this.originY + height);
      ctx.stroke();
    }
    for (let r = 0; r <= this.rows; r++) {
      const y = this.originY + r * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(this.originX, y);
      ctx.lineTo(this.originX + width, y);
      ctx.stroke();
    }

    // Render Sudden Death Warning / Collapsed Tiles
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) {
        const cell = this.grid[c][r];
        const cx = this.originX + c * this.cellSize;
        const cy = this.originY + r * this.cellSize;

        if (cell.collapsed) {
          // Fully collapsed into electric void / fiery lava
          ctx.fillStyle = '#1c0406';
          ctx.fillRect(cx, cy, this.cellSize, this.cellSize);

          // Danger crosshatch pattern
          ctx.strokeStyle = 'rgba(255, 34, 0, 0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + this.cellSize, cy + this.cellSize);
          ctx.moveTo(cx + this.cellSize, cy);
          ctx.lineTo(cx, cy + this.cellSize);
          ctx.stroke();
        } else if (cell.warningCollapse) {
          // Warning pulsation before collapse
          const pulse = (Math.sin(time * 10) + 1) / 2;
          ctx.fillStyle = `rgba(255, 50, 0, ${0.15 + pulse * 0.25})`;
          ctx.fillRect(cx, cy, this.cellSize, this.cellSize);

          ctx.strokeStyle = `rgba(255, 170, 0, ${0.4 + pulse * 0.4})`;
          ctx.lineWidth = 2;
          ctx.strokeRect(cx + 2, cy + 2, this.cellSize - 4, this.cellSize - 4);
        }
      }
    }

    // Render Walls
    for (const seg of this.segments) {
      ctx.save();
      if (seg.isDestructible) {
        // Destructible brick wall (amber / cracked)
        ctx.strokeStyle = seg.health === 1 ? '#aa6633' : '#e68a00';
        ctx.lineWidth = 5;
        ctx.lineCap = 'square';
        ctx.beginPath();
        ctx.moveTo(seg.p1.x, seg.p1.y);
        ctx.lineTo(seg.p2.x, seg.p2.y);
        ctx.stroke();

        // Cracks texture
        if (seg.health === 1) {
          ctx.strokeStyle = '#221100';
          ctx.lineWidth = 1.5;
          const mx = (seg.p1.x + seg.p2.x) / 2;
          const my = (seg.p1.y + seg.p2.y) / 2;
          ctx.beginPath();
          ctx.moveTo(mx - 4, my - 4);
          ctx.lineTo(mx + 4, my + 4);
          ctx.stroke();
        }
      } else {
        // Standard high-tech neon blue/steel wall
        ctx.strokeStyle = '#2b3952';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(seg.p1.x, seg.p1.y);
        ctx.lineTo(seg.p2.x, seg.p2.y);
        ctx.stroke();

        // High-tech inner core light
        ctx.strokeStyle = '#6882a8';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
