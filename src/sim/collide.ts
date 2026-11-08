import type { PolyCache } from './entity';
import type { Entity } from './types';

export interface ContactPoint {
  x: number;
  y: number;
  depth: number;
  // solver data
  rax: number;
  ray: number;
  rbx: number;
  rby: number;
  massN: number;
  massT: number;
  bias: number;
  jn: number;
  jt: number;
}

export interface Manifold {
  a: Entity;
  b: Entity;
  /** Normal pointing from a to b. */
  nx: number;
  ny: number;
  count: number;
  p: [ContactPoint, ContactPoint];
  restitution: number;
  friction: number;
  /** Relative normal speed at the moment of detection (positive = approaching). */
  approach: number;
  // 2-point block solver data (Box2D style)
  block: boolean;
  k11: number;
  k12: number;
  k22: number;
  nm11: number;
  nm12: number;
  nm21: number;
  nm22: number;
}

/** Contacts are generated slightly before touching (speculative contacts) for stable stacking. */
export const CONTACT_MARGIN = 2;

const mkPoint = (): ContactPoint => ({ x: 0, y: 0, depth: 0, rax: 0, ray: 0, rbx: 0, rby: 0, massN: 0, massT: 0, bias: 0, jn: 0, jt: 0 });

/** Manifold pool so the hot loop allocates nothing in steady state. */
export class ManifoldPool {
  private items: Manifold[] = [];
  used = 0;
  reset(): void {
    this.used = 0;
  }
  take(a: Entity, b: Entity): Manifold {
    let m = this.items[this.used];
    if (!m) {
      m = { a, b, nx: 0, ny: 0, count: 0, p: [mkPoint(), mkPoint()], restitution: 0, friction: 0, approach: 0, block: false, k11: 0, k12: 0, k22: 0, nm11: 0, nm12: 0, nm21: 0, nm22: 0 };
      this.items.push(m);
    }
    this.used++;
    m.a = a;
    m.b = b;
    m.count = 0;
    for (const p of m.p) {
      p.jn = 0;
      p.jt = 0;
    }
    return m;
  }
  release(): void {
    this.used--;
  }
  get(i: number): Manifold {
    return this.items[i];
  }
}

function setPoint(m: Manifold, i: number, x: number, y: number, depth: number): void {
  const p = m.p[i];
  p.x = x;
  p.y = y;
  p.depth = depth;
}

export function circleCircle(m: Manifold): boolean {
  const a = m.a;
  const b = m.b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  const rm = r + CONTACT_MARGIN;
  if (d2 >= rm * rm) return false;
  const d = Math.sqrt(d2);
  let nx = 1;
  let ny = 0;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else if (a.id > b.id) {
    nx = -1;
  }
  m.nx = nx;
  m.ny = ny;
  m.count = 1;
  setPoint(m, 0, a.x + nx * a.radius, a.y + ny * a.radius, r - d);
  return true;
}

/** a is a polygon, b is a circle. Normal points from a to b. */
export function polyCircle(m: Manifold, pa: PolyCache, flip: boolean): boolean {
  const circ = flip ? m.a : m.b;
  const cx = circ.x;
  const cy = circ.y;
  const r = circ.radius;
  let sep = -Infinity;
  let face = 0;
  for (let i = 0; i < pa.n; i++) {
    const s = pa.nx[i] * (cx - pa.wx[i]) + pa.ny[i] * (cy - pa.wy[i]);
    if (s > r + CONTACT_MARGIN) return false;
    if (s > sep) {
      sep = s;
      face = i;
    }
  }
  const i2 = (face + 1) % pa.n;
  const v1x = pa.wx[face];
  const v1y = pa.wy[face];
  const v2x = pa.wx[i2];
  const v2y = pa.wy[i2];
  let nx: number;
  let ny: number;
  let depth: number;
  if (sep < 1e-9) {
    nx = pa.nx[face];
    ny = pa.ny[face];
    depth = r - sep;
  } else {
    const u1 = (cx - v1x) * (v2x - v1x) + (cy - v1y) * (v2y - v1y);
    const u2 = (cx - v2x) * (v1x - v2x) + (cy - v2y) * (v1y - v2y);
    if (u1 <= 0) {
      const dx = cx - v1x;
      const dy = cy - v1y;
      const d2 = dx * dx + dy * dy;
      if (d2 > (r + CONTACT_MARGIN) ** 2) return false;
      const d = Math.sqrt(d2) || 1;
      nx = dx / d;
      ny = dy / d;
      depth = r - d;
    } else if (u2 <= 0) {
      const dx = cx - v2x;
      const dy = cy - v2y;
      const d2 = dx * dx + dy * dy;
      if (d2 > (r + CONTACT_MARGIN) ** 2) return false;
      const d = Math.sqrt(d2) || 1;
      nx = dx / d;
      ny = dy / d;
      depth = r - d;
    } else {
      nx = pa.nx[face];
      ny = pa.ny[face];
      depth = r - sep;
    }
  }
  const px = cx - nx * r;
  const py = cy - ny * r;
  if (flip) {
    nx = -nx;
    ny = -ny;
  }
  m.nx = nx;
  m.ny = ny;
  m.count = 1;
  setPoint(m, 0, px, py, depth);
  return true;
}

function leastPenetration(pa: PolyCache, pb: PolyCache): { sep: number; face: number } {
  let best = -Infinity;
  let face = 0;
  for (let i = 0; i < pa.n; i++) {
    const nx = pa.nx[i];
    const ny = pa.ny[i];
    // support point of b in direction -n
    let minProj = Infinity;
    for (let j = 0; j < pb.n; j++) {
      const proj = nx * pb.wx[j] + ny * pb.wy[j];
      if (proj < minProj) minProj = proj;
    }
    const d = minProj - (nx * pa.wx[i] + ny * pa.wy[i]);
    if (d > best) {
      best = d;
      face = i;
    }
  }
  return { sep: best, face };
}

const clipX = new Float64Array(2);
const clipY = new Float64Array(2);

/** Clip segment (clipX/clipY) against the half-plane n.p <= c. Returns number of points kept. */
function clip(nx: number, ny: number, c: number): number {
  let sp = 0;
  const outX: number[] = [];
  const outY: number[] = [];
  const d1 = nx * clipX[0] + ny * clipY[0] - c;
  const d2 = nx * clipX[1] + ny * clipY[1] - c;
  if (d1 <= 0) {
    outX.push(clipX[0]);
    outY.push(clipY[0]);
    sp++;
  }
  if (d2 <= 0) {
    outX.push(clipX[1]);
    outY.push(clipY[1]);
    sp++;
  }
  if (d1 * d2 < 0) {
    const t = d1 / (d1 - d2);
    outX.push(clipX[0] + t * (clipX[1] - clipX[0]));
    outY.push(clipY[0] + t * (clipY[1] - clipY[0]));
    sp++;
  }
  for (let i = 0; i < Math.min(2, sp); i++) {
    clipX[i] = outX[i];
    clipY[i] = outY[i];
  }
  return sp;
}

export function polyPoly(m: Manifold, pa: PolyCache, pb: PolyCache): boolean {
  const A = leastPenetration(pa, pb);
  if (A.sep >= CONTACT_MARGIN) return false;
  const B = leastPenetration(pb, pa);
  if (B.sep >= CONTACT_MARGIN) return false;

  let ref: PolyCache;
  let inc: PolyCache;
  let refFace: number;
  let flip: boolean;
  if (A.sep >= B.sep * 0.95 + A.sep * 0.01) {
    ref = pa;
    inc = pb;
    refFace = A.face;
    flip = false;
  } else {
    ref = pb;
    inc = pa;
    refFace = B.face;
    flip = true;
  }
  const rnx = ref.nx[refFace];
  const rny = ref.ny[refFace];
  // incident face: most anti-parallel normal
  let incFace = 0;
  let minDot = Infinity;
  for (let i = 0; i < inc.n; i++) {
    const d = inc.nx[i] * rnx + inc.ny[i] * rny;
    if (d < minDot) {
      minDot = d;
      incFace = i;
    }
  }
  clipX[0] = inc.wx[incFace];
  clipY[0] = inc.wy[incFace];
  clipX[1] = inc.wx[(incFace + 1) % inc.n];
  clipY[1] = inc.wy[(incFace + 1) % inc.n];

  const r1x = ref.wx[refFace];
  const r1y = ref.wy[refFace];
  const r2x = ref.wx[(refFace + 1) % ref.n];
  const r2y = ref.wy[(refFace + 1) % ref.n];
  let tx = r2x - r1x;
  let ty = r2y - r1y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  // side planes
  if (clip(-tx, -ty, -(tx * r1x + ty * r1y)) < 2) return false;
  if (clip(tx, ty, tx * r2x + ty * r2y) < 2) return false;

  const refC = rnx * r1x + rny * r1y;
  let count = 0;
  for (let i = 0; i < 2; i++) {
    const sep = rnx * clipX[i] + rny * clipY[i] - refC;
    if (sep <= CONTACT_MARGIN) {
      setPoint(m, count, clipX[i], clipY[i], -sep);
      count++;
    }
  }
  if (count === 0) return false;
  m.count = count;
  m.nx = flip ? -rnx : rnx;
  m.ny = flip ? -rny : rny;
  return true;
}
