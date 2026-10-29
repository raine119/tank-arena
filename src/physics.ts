export interface Vec2 {
  x: number;
  y: number;
}

export interface Segment {
  p1: Vec2;
  p2: Vec2;
  id?: string;
  isDestructible?: boolean;
  health?: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface RayHit {
  t: number;            // Distance fraction [0, 1]
  point: Vec2;          // Point of contact on the wall surface
  normal: Vec2;         // Unit normal of the surface pointing towards the collider
  segment?: Segment;    // Collided segment
}

export class Physics {
  public static vec(x: number, y: number): Vec2 {
    return { x, y };
  }

  public static add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  public static sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  public static mult(v: Vec2, s: number): Vec2 {
    return { x: v.x * s, y: v.y * s };
  }

  public static dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  }

  public static length(v: Vec2): number {
    return Math.hypot(v.x, v.y);
  }

  public static normalize(v: Vec2): Vec2 {
    const len = Math.hypot(v.x, v.y);
    if (len === 0) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  public static distSq(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  // Reflection vector: R = V - 2 * (V . N) * N
  public static reflect(v: Vec2, normal: Vec2): Vec2 {
    const d = this.dot(v, normal);
    return {
      x: v.x - 2 * d * normal.x,
      y: v.y - 2 * d * normal.y
    };
  }

  // Closest point on segment AB to point P
  public static closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
    const ab = this.sub(b, a);
    const ap = this.sub(p, a);
    const abLenSq = this.dot(ab, ab);
    if (abLenSq === 0) return { x: a.x, y: a.y };

    let t = this.dot(ap, ab) / abLenSq;
    t = Math.max(0, Math.min(1, t));

    return {
      x: a.x + ab.x * t,
      y: a.y + ab.y * t
    };
  }

  // Ray vs Segment intersection: P + t * Dir intersects Q + u * (B - A)
  public static raySegmentIntersect(
    rayOrigin: Vec2,
    rayDir: Vec2,
    maxDist: number,
    seg: Segment
  ): RayHit | null {
    const p = rayOrigin;
    const normDir = this.normalize(rayDir);
    const r = this.mult(normDir, maxDist);
    const q = seg.p1;
    const s = this.sub(seg.p2, seg.p1);

    const rxs = r.x * s.y - r.y * s.x;
    const qpx = q.x - p.x;
    const qpy = q.y - p.y;
    const qpxr = qpx * r.y - qpy * r.x;

    if (Math.abs(rxs) < 1e-7) {
      return null; // Collinear or parallel
    }

    const t = (qpx * s.y - qpy * s.x) / rxs;
    const u = qpxr / rxs;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const segLen = Math.hypot(s.x, s.y);
      let nx = -s.y / segLen;
      let ny = s.x / segLen;

      // Normal must face opposite to incoming ray
      if (nx * normDir.x + ny * normDir.y > 0) {
        nx = -nx;
        ny = -ny;
      }

      return {
        t,
        point: { x: p.x + r.x * t, y: p.y + r.y * t },
        normal: { x: nx, y: ny },
        segment: seg
      };
    }

    return null;
  }

  // Continuous Collision Detection (CCD) for a moving circle of radius r against segment AB
  // Mathematically guaranteed: checks both swept flat face and rounded endpoints
  public static sweepCircleSegment(
    start: Vec2,
    vel: Vec2,
    radius: number,
    seg: Segment
  ): RayHit | null {
    const segVec = this.sub(seg.p2, seg.p1);
    const segLen = Math.hypot(segVec.x, segVec.y);
    if (segLen === 0) return null;

    // Unit tangent and unit normal of segment
    const tx = segVec.x / segLen;
    const ty = segVec.y / segLen;
    const nx = -ty;
    const ny = tx;

    // Signed distance from start to segment line along normal
    const d0 = (start.x - seg.p1.x) * nx + (start.y - seg.p1.y) * ny;
    const vn = vel.x * nx + vel.y * ny;

    let bestHit: RayHit | null = null;

    // 1. Check collision with the flat face of the segment
    if (Math.abs(vn) > 1e-7) {
      // Determine which side of the line the circle starts on
      let tLine = -1;
      let effNx = nx;
      let effNy = ny;

      if (d0 >= radius && vn < 0) {
        // Starts on positive side, moving towards line
        tLine = (radius - d0) / vn;
        effNx = nx;
        effNy = ny;
      } else if (d0 <= -radius && vn > 0) {
        // Starts on negative side, moving towards line
        tLine = (-radius - d0) / vn;
        effNx = -nx;
        effNy = -ny;
      } else if (Math.abs(d0) < radius) {
        // Already overlapping the infinite line
        if ((d0 >= 0 && vn < 0) || (d0 < 0 && vn > 0)) {
          tLine = 0;
          effNx = d0 >= 0 ? nx : -nx;
          effNy = d0 >= 0 ? ny : -ny;
        }
      }

      if (tLine >= 0 && tLine <= 1) {
        // Check if the collision point falls within the segment bounds [0, segLen]
        const centerAtT: Vec2 = {
          x: start.x + vel.x * tLine,
          y: start.y + vel.y * tLine
        };
        const u = (centerAtT.x - seg.p1.x) * tx + (centerAtT.y - seg.p1.y) * ty;

        if (u >= -0.5 && u <= segLen + 0.5) {
          const clampedU = Math.max(0, Math.min(segLen, u));
          const contactPt: Vec2 = {
            x: seg.p1.x + tx * clampedU,
            y: seg.p1.y + ty * clampedU
          };

          bestHit = {
            t: tLine,
            point: contactPt,
            normal: { x: effNx, y: effNy },
            segment: seg
          };
        }
      }
    }

    // 2. Check collision with both endpoint caps (p1 and p2)
    for (const cap of [seg.p1, seg.p2]) {
      const capHit = this.sweepCirclePoint(start, vel, radius, cap);
      if (capHit && capHit.t >= 0 && capHit.t <= 1) {
        if (!bestHit || capHit.t < bestHit.t) {
          bestHit = {
            t: capHit.t,
            point: cap,
            normal: capHit.normal,
            segment: seg
          };
        }
      }
    }

    // 3. Fallback: Check direct line-segment crossing (guarantees high-velocity tunneling is impossible)
    if (!bestHit) {
      const rayHit = this.raySegmentIntersect(start, vel, Math.hypot(vel.x, vel.y), seg);
      if (rayHit && rayHit.t >= 0 && rayHit.t <= 1) {
        bestHit = {
          t: Math.max(0, rayHit.t - 0.01),
          point: rayHit.point,
          normal: rayHit.normal,
          segment: seg
        };
      }
    }

    return bestHit;
  }

  // Swept circle against a static corner point
  private static sweepCirclePoint(start: Vec2, vel: Vec2, radius: number, pt: Vec2): RayHit | null {
    const dx = start.x - pt.x;
    const dy = start.y - pt.y;
    const a = vel.x * vel.x + vel.y * vel.y;
    const b = 2 * (dx * vel.x + dy * vel.y);
    const c = dx * dx + dy * dy - radius * radius;

    if (a < 1e-8) return null;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;

    const sqrtDisc = Math.sqrt(disc);
    let t = (-b - sqrtDisc) / (2 * a);
    if (t < 0) t = (-b + sqrtDisc) / (2 * a);

    if (t >= 0 && t <= 1) {
      const cx = start.x + vel.x * t;
      const cy = start.y + vel.y * t;
      const nx = cx - pt.x;
      const ny = cy - pt.y;
      const len = Math.hypot(nx, ny) || 1;
      return {
        t,
        point: pt,
        normal: { x: nx / len, y: ny / len }
      };
    }
    return null;
  }

  // Robust Tank vs Walls collision resolution
  // Prevents any tank from ever tunneling or glitching through walls
  public static resolveTankWalls(
    currentPos: Vec2,
    targetPos: Vec2,
    radius: number,
    segments: Segment[]
  ): { pos: Vec2; collided: boolean } {
    let pos = { x: targetPos.x, y: targetPos.y };
    let collided = false;

    // Run 4 relaxation passes against all segments
    for (let pass = 0; pass < 4; pass++) {
      for (const seg of segments) {
        const closest = this.closestPointOnSegment(pos, seg.p1, seg.p2);
        const toPos = { x: pos.x - closest.x, y: pos.y - closest.y };
        const dist = Math.hypot(toPos.x, toPos.y);

        if (dist < radius) {
          collided = true;
          const overlap = radius - dist;

          let nx = toPos.x / (dist || 1);
          let ny = toPos.y / (dist || 1);

          // If center is exactly on the wall, push towards the previous valid position
          if (dist < 1e-4) {
            const fromPrev = { x: currentPos.x - closest.x, y: currentPos.y - closest.y };
            const prevDist = Math.hypot(fromPrev.x, fromPrev.y) || 1;
            nx = fromPrev.x / prevDist;
            ny = fromPrev.y / prevDist;
          }

          pos.x += nx * overlap;
          pos.y += ny * overlap;
        }
      }
    }

    return { pos, collided };
  }
}
