import type { Manifold } from './collide';
import type { Entity, Joint } from './types';

const RESTITUTION_THRESHOLD = 40; // px/s: below this, contacts don't bounce (kills jitter)
const SLOP = 0.15; // px of allowed penetration
const CORRECTION = 0.3;

export function prepareContact(m: Manifold, h = 1 / 180): void {
  const a = m.a;
  const b = m.b;
  const nx = m.nx;
  const ny = m.ny;
  const tx = -ny;
  const ty = nx;
  m.restitution = Math.max(a.restitution, b.restitution);
  m.friction = Math.sqrt(Math.max(0, a.friction) * Math.max(0, b.friction));
  let approach = 0;
  for (let i = 0; i < m.count; i++) {
    const p = m.p[i];
    p.rax = p.x - a.x;
    p.ray = p.y - a.y;
    p.rbx = p.x - b.x;
    p.rby = p.y - b.y;
    const rnA = p.rax * ny - p.ray * nx;
    const rnB = p.rbx * ny - p.rby * nx;
    const kN = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
    p.massN = kN > 0 ? 1 / kN : 0;
    const rtA = p.rax * ty - p.ray * tx;
    const rtB = p.rbx * ty - p.rby * tx;
    const kT = a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;
    p.massT = kT > 0 ? 1 / kT : 0;
    // relative velocity at contact
    const rvx = b.vx - b.av * p.rby - (a.vx - a.av * p.ray);
    const rvy = b.vy + b.av * p.rbx - (a.vy + a.av * p.rax);
    const vn = rvx * nx + rvy * ny;
    const bounce = vn < -RESTITUTION_THRESHOLD ? -m.restitution * vn : 0;
    if (p.depth < 0) {
      // speculative contact: allow closing the gap this substep, bounce if we'd reach the surface
      p.bias = bounce > 0 && -vn * h > -p.depth ? bounce : p.depth / h;
    } else {
      // Penetration is resolved by position projection (correctPositions), not by velocity bias:
      // biasing velocities would be stored in the warm-start cache and pump energy into stacks.
      p.bias = bounce;
    }
    if (-vn > approach) approach = -vn;
  }
  m.approach = approach;
  // Block solver setup for two-point manifolds: solving both normal impulses together converges
  // exactly for face contacts (stacks), where sequential impulses leave a residual spin.
  m.block = false;
  if (m.count === 2) {
    const p1 = m.p[0];
    const p2 = m.p[1];
    const rn1A = p1.rax * ny - p1.ray * nx;
    const rn1B = p1.rbx * ny - p1.rby * nx;
    const rn2A = p2.rax * ny - p2.ray * nx;
    const rn2B = p2.rbx * ny - p2.rby * nx;
    const mA = a.invMass;
    const mB = b.invMass;
    const iA = a.invInertia;
    const iB = b.invInertia;
    const k11 = mA + mB + iA * rn1A * rn1A + iB * rn1B * rn1B;
    const k22 = mA + mB + iA * rn2A * rn2A + iB * rn2B * rn2B;
    const k12 = mA + mB + iA * rn1A * rn2A + iB * rn1B * rn2B;
    const det = k11 * k22 - k12 * k12;
    if (k11 * k11 < 1000 * det) {
      m.block = true;
      m.k11 = k11;
      m.k12 = k12;
      m.k22 = k22;
      const inv = 1 / det;
      m.nm11 = k22 * inv;
      m.nm12 = -k12 * inv;
      m.nm21 = -k12 * inv;
      m.nm22 = k11 * inv;
    }
  }
}

function normalVel(m: Manifold, p: Manifold['p'][0]): number {
  const a = m.a;
  const b = m.b;
  const rvx = b.vx - b.av * p.rby - (a.vx - a.av * p.ray);
  const rvy = b.vy + b.av * p.rbx - (a.vy + a.av * p.rax);
  return rvx * m.nx + rvy * m.ny;
}

/** Exact solution of the 2-contact LCP (vn >= bias, jn >= 0, complementarity) — Box2D's block solver. */
function solveBlock(m: Manifold): void {
  const p1 = m.p[0];
  const p2 = m.p[1];
  const a1 = p1.jn;
  const a2 = p2.jn;
  // b = vn - bias - K a
  const b1 = normalVel(m, p1) - p1.bias - (m.k11 * a1 + m.k12 * a2);
  const b2 = normalVel(m, p2) - p2.bias - (m.k12 * a1 + m.k22 * a2);
  let x1: number;
  let x2: number;
  for (;;) {
    // case 1: both active
    x1 = -(m.nm11 * b1 + m.nm12 * b2);
    x2 = -(m.nm21 * b1 + m.nm22 * b2);
    if (x1 >= 0 && x2 >= 0) break;
    // case 2: only point 1 active
    x1 = -b1 / m.k11;
    x2 = 0;
    if (x1 >= 0 && m.k12 * x1 + b2 >= 0) break;
    // case 3: only point 2 active
    x1 = 0;
    x2 = -b2 / m.k22;
    if (x2 >= 0 && m.k12 * x2 + b1 >= 0) break;
    // case 4: none active
    x1 = 0;
    x2 = 0;
    if (b1 >= 0 && b2 >= 0) break;
    // degenerate: fall back to keeping the old impulses
    x1 = a1;
    x2 = a2;
    break;
  }
  const d1 = x1 - a1;
  const d2 = x2 - a2;
  p1.jn = x1;
  p2.jn = x2;
  applyImpulse(m.a, m.b, p1, m.nx * d1, m.ny * d1);
  applyImpulse(m.a, m.b, p2, m.nx * d2, m.ny * d2);
}

export function solveContact(m: Manifold): void {
  const a = m.a;
  const b = m.b;
  const nx = m.nx;
  const ny = m.ny;
  const tx = -ny;
  const ty = nx;
  // friction first (uses the normal impulse of the previous iteration), then non-penetration
  for (let i = 0; i < m.count; i++) {
    const p = m.p[i];
    const rvx = b.vx - b.av * p.rby - (a.vx - a.av * p.ray);
    const rvy = b.vy + b.av * p.rbx - (a.vy + a.av * p.rax);
    const vt = rvx * tx + rvy * ty;
    let djt = -p.massT * vt;
    const maxF = m.friction * p.jn;
    const oldT = p.jt;
    p.jt = Math.max(-maxF, Math.min(oldT + djt, maxF));
    djt = p.jt - oldT;
    applyImpulse(a, b, p, tx * djt, ty * djt);
  }
  if (m.block) {
    solveBlock(m);
    return;
  }
  for (let i = 0; i < m.count; i++) {
    const p = m.p[i];
    const rvx = b.vx - b.av * p.rby - (a.vx - a.av * p.ray);
    const rvy = b.vy + b.av * p.rbx - (a.vy + a.av * p.rax);
    const vn = rvx * nx + rvy * ny;
    let dj = p.massN * (-vn + p.bias);
    const old = p.jn;
    p.jn = Math.max(old + dj, 0);
    dj = p.jn - old;
    applyImpulse(a, b, p, nx * dj, ny * dj);
  }
}

function applyImpulse(a: Entity, b: Entity, p: Manifold['p'][0], px: number, py: number): void {
  a.vx -= px * a.invMass;
  a.vy -= py * a.invMass;
  a.av -= a.invInertia * (p.rax * py - p.ray * px);
  b.vx += px * b.invMass;
  b.vy += py * b.invMass;
  b.av += b.invInertia * (p.rbx * py - p.rby * px);
}

/**
 * Positional correction applied per contact point (linear AND angular), Box2D-style.
 * Correcting only linearly by the deepest point leaves bodies resting tilted, and those
 * tilts compound in stacks until towers topple.
 */
export function correctPositions(m: Manifold): void {
  const a = m.a;
  const b = m.b;
  if (a.invMass + b.invMass <= 0) return;
  const nx = m.nx;
  const ny = m.ny;
  const share = 1 / m.count;
  for (let i = 0; i < m.count; i++) {
    const p = m.p[i];
    const C = Math.max(p.depth - SLOP, 0) * CORRECTION;
    if (C <= 0) continue;
    const rnA = p.rax * ny - p.ray * nx;
    const rnB = p.rbx * ny - p.rby * nx;
    const K = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
    if (K <= 0) continue;
    const imp = (C / K) * (m.count > 1 ? 1 : share);
    const px = nx * imp;
    const py = ny * imp;
    a.x -= px * a.invMass;
    a.y -= py * a.invMass;
    a.angle -= a.invInertia * (p.rax * py - p.ray * px);
    b.x += px * b.invMass;
    b.y += py * b.invMass;
    b.angle += b.invInertia * (p.rbx * py - p.rby * px);
  }
}

export function totalNormalImpulse(m: Manifold): number {
  let j = 0;
  for (let i = 0; i < m.count; i++) j += m.p[i].jn;
  return j;
}

// ---------------------------------------------------------------- joints

export interface JointRuntime {
  joint: Joint;
  a: Entity;
  b: Entity;
  nx: number;
  ny: number;
  mass: number;
  bias: number;
  impulse: number;
  soft: number;
}

export function prepareJoint(jr: JointRuntime, h: number): void {
  const { a, b, joint } = jr;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  jr.nx = dx / d;
  jr.ny = dy / d;
  const k = a.invMass + b.invMass;
  const stiffness = Math.max(0.001, Math.min(1, joint.stiffness));
  // Soft constraint: lower stiffness behaves like a spring, damping bleeds energy.
  jr.soft = (1 - stiffness) * 4;
  jr.mass = k > 0 ? 1 / (k * (1 + jr.soft)) : 0;
  const C = d - joint.length;
  const beta = 0.08 + 0.3 * stiffness;
  jr.bias = h > 0 ? (-beta * C) / h : 0;
  jr.impulse = 0;
  // velocity damping along the joint axis (springs settle instead of ringing forever)
  if (joint.damping > 0 && k > 0) {
    const vn = (b.vx - a.vx) * jr.nx + (b.vy - a.vy) * jr.ny;
    const f = Math.min(1, joint.damping * h * 8);
    const j = (-vn * f) / k;
    a.vx -= jr.nx * j * a.invMass;
    a.vy -= jr.ny * j * a.invMass;
    b.vx += jr.nx * j * b.invMass;
    b.vy += jr.ny * j * b.invMass;
  }
}

export function solveJoint(jr: JointRuntime): void {
  const { a, b } = jr;
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * jr.nx + rvy * jr.ny;
  const j = jr.mass * (jr.bias - vn);
  jr.impulse += j;
  a.vx -= jr.nx * j * a.invMass;
  a.vy -= jr.ny * j * a.invMass;
  b.vx += jr.nx * j * b.invMass;
  b.vy += jr.ny * j * b.invMass;
}
