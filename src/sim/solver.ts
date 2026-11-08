import type { Manifold } from './collide';
import type { Entity, Joint } from './types';

const RESTITUTION_THRESHOLD = 40; // px/s: below this, contacts don't bounce (kills jitter)
const SLOP = 0.4; // px of allowed penetration
const CORRECTION = 0.45;

export function prepareContact(m: Manifold): void {
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
    p.bias = vn < -RESTITUTION_THRESHOLD ? -m.restitution * vn : 0;
    if (-vn > approach) approach = -vn;
  }
  m.approach = approach;
}

export function solveContact(m: Manifold): void {
  const a = m.a;
  const b = m.b;
  const nx = m.nx;
  const ny = m.ny;
  const tx = -ny;
  const ty = nx;
  for (let i = 0; i < m.count; i++) {
    const p = m.p[i];
    // normal
    let rvx = b.vx - b.av * p.rby - (a.vx - a.av * p.ray);
    let rvy = b.vy + b.av * p.rbx - (a.vy + a.av * p.rax);
    const vn = rvx * nx + rvy * ny;
    let dj = p.massN * (-vn + p.bias);
    const old = p.jn;
    p.jn = Math.max(old + dj, 0);
    dj = p.jn - old;
    applyImpulse(a, b, p, nx * dj, ny * dj);

    // friction
    rvx = b.vx - b.av * p.rby - (a.vx - a.av * p.ray);
    rvy = b.vy + b.av * p.rbx - (a.vy + a.av * p.rax);
    const vt = rvx * tx + rvy * ty;
    let djt = -p.massT * vt;
    const maxF = m.friction * p.jn;
    const oldT = p.jt;
    p.jt = Math.max(-maxF, Math.min(oldT + djt, maxF));
    djt = p.jt - oldT;
    applyImpulse(a, b, p, tx * djt, ty * djt);
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

export function correctPositions(m: Manifold): void {
  const a = m.a;
  const b = m.b;
  const inv = a.invMass + b.invMass;
  if (inv <= 0) return;
  let depth = 0;
  for (let i = 0; i < m.count; i++) depth = Math.max(depth, m.p[i].depth);
  const c = (Math.max(depth - SLOP, 0) / inv) * CORRECTION;
  if (c <= 0) return;
  a.x -= m.nx * c * a.invMass;
  a.y -= m.ny * c * a.invMass;
  b.x += m.nx * c * b.invMass;
  b.y += m.ny * c * b.invMass;
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
