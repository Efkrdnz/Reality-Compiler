import type { Vec } from './math';
import type { Entity, EntityKind, Material } from './types';

/** Mass units: density * area / MASS_SCALE keeps typical masses in the 1-100 range. */
export const MASS_SCALE = 100;

export type ShapeSpec =
  | { type: 'circle'; radius: number }
  | { type: 'box'; w: number; h: number }
  | { type: 'ngon'; sides: number; radius: number };

export function polygonFor(spec: ShapeSpec): { verts: Vec[]; label: string } {
  if (spec.type === 'box') {
    const hw = spec.w / 2;
    const hh = spec.h / 2;
    return {
      verts: [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ],
      label: 'box',
    };
  }
  if (spec.type === 'ngon') {
    const n = Math.max(3, Math.min(12, Math.round(spec.sides)));
    const verts: Vec[] = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
      verts.push({ x: Math.cos(a) * spec.radius, y: Math.sin(a) * spec.radius });
    }
    const names: Record<number, string> = { 3: 'triangle', 4: 'diamond', 5: 'pentagon', 6: 'hexagon', 8: 'octagon' };
    return { verts, label: names[n] ?? `${n}-gon` };
  }
  return { verts: [], label: 'circle' };
}

export function computeNormals(verts: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l = Math.hypot(ex, ey) || 1;
    // vertices are clockwise-on-screen (y down) == counter-clockwise in math coords; outward normal:
    out.push({ x: ey / l, y: -ex / l });
  }
  return out;
}

/** Ensures the polygon winding gives outward normals (positive signed area in screen space). */
export function normaliseWinding(verts: Vec[]): Vec[] {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0 ? [...verts].reverse() : verts;
}

export function polyArea(verts: Vec[]): number {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** Second moment of area about the centroid (assumed at origin) per unit density. */
export function polyInertiaPerDensity(verts: Vec[]): number {
  let num = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const c = Math.abs(a.x * b.y - b.x * a.y);
    num += c * (a.x * a.x + a.x * b.x + b.x * b.x + a.y * a.y + a.y * b.y + b.y * b.y);
  }
  return num / 12;
}

/** Recomputes mass/inertia from the entity's geometry and a density. */
export function setMassFromDensity(e: Entity, density: number): void {
  if (e.shape === 'circle') {
    const area = Math.PI * e.radius * e.radius;
    e.mass = Math.max(0.01, (density * area) / MASS_SCALE);
    e.inertia = 0.5 * e.mass * e.radius * e.radius;
  } else {
    const area = polyArea(e.verts);
    e.mass = Math.max(0.01, (density * area) / MASS_SCALE);
    e.inertia = (polyInertiaPerDensity(e.verts) * density) / MASS_SCALE;
  }
  updateInverseMass(e);
}

/** Sets an explicit mass, scaling the inertia so the shape's distribution is kept. */
export function setMass(e: Entity, mass: number): void {
  const m = Math.max(0.01, mass);
  const ratio = e.mass > 0 ? m / e.mass : 1;
  e.mass = m;
  e.inertia = Math.max(1e-4, e.inertia * ratio);
  updateInverseMass(e);
}

export function updateInverseMass(e: Entity): void {
  if (e.isStatic) {
    e.invMass = 0;
    e.invInertia = 0;
  } else {
    e.invMass = 1 / e.mass;
    e.invInertia = e.kind === 'particle' || e.inertia <= 0 ? 0 : 1 / e.inertia;
  }
}

export function scaleShape(e: Entity, factor: number, density: number): void {
  const f = Math.max(0.05, Math.min(20, factor));
  e.radius *= f;
  e.verts = e.verts.map((v) => ({ x: v.x * f, y: v.y * f }));
  e.normals = computeNormals(e.verts);
  setMassFromDensity(e, density);
}

export interface EntityInit {
  id: number;
  kind?: EntityKind;
  shape: ShapeSpec | { type: 'poly'; verts: Vec[]; label?: string };
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  angle?: number;
  av?: number;
  material: Material;
  temperature: number;
  isStatic?: boolean;
  color?: string;
  tags?: string[];
  origin?: string;
  bornStep?: number;
  mass?: number;
}

export function makeEntity(init: EntityInit): Entity {
  const m = init.material;
  let verts: Vec[] = [];
  let label = 'circle';
  let radius = 0;
  if (init.shape.type === 'circle') {
    radius = Math.max(0.5, init.shape.radius);
  } else if (init.shape.type === 'poly') {
    verts = normaliseWinding(init.shape.verts.map((v) => ({ x: v.x, y: v.y })));
    label = init.shape.label ?? 'polygon';
  } else {
    const p = polygonFor(init.shape);
    verts = normaliseWinding(p.verts);
    label = p.label;
  }
  if (verts.length) radius = Math.max(...verts.map((v) => Math.hypot(v.x, v.y)));
  const e: Entity = {
    id: init.id,
    kind: init.kind ?? 'body',
    shape: verts.length ? 'poly' : 'circle',
    radius,
    verts,
    normals: computeNormals(verts),
    shapeLabel: label,
    x: init.x,
    y: init.y,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    angle: init.angle ?? 0,
    av: init.av ?? 0,
    fx: 0,
    fy: 0,
    torque: 0,
    mass: 1,
    invMass: 1,
    inertia: 1,
    invInertia: 1,
    restitution: m.restitution,
    friction: m.friction,
    drag: m.drag,
    gravityScale: m.gravityScale,
    charge: m.charge,
    material: m.id,
    color: init.color ?? m.color,
    temperature: init.temperature,
    state: m.state,
    tags: Array.from(new Set([...(m.tags ?? []), ...(init.tags ?? [])])),
    vars: {},
    isStatic: !!init.isStatic,
    collides: true,
    lifetime: m.lifetime,
    age: 0,
    localTime: 1,
    prevTemp: init.temperature,
    prevSpeed: 0,
    portalCooldown: 0,
    bornStep: init.bornStep ?? 0,
    dead: false,
    origin: init.origin ?? 'user',
  };
  setMassFromDensity(e, m.density);
  if (init.mass !== undefined) setMass(e, init.mass);
  e.prevSpeed = Math.hypot(e.vx, e.vy);
  return e;
}

/** World-space vertex cache for polygons, refreshed once per substep. */
export interface PolyCache {
  wx: Float64Array;
  wy: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  n: number;
}

export function transformPoly(e: Entity, cache: PolyCache): void {
  const c = Math.cos(e.angle);
  const s = Math.sin(e.angle);
  const n = e.verts.length;
  cache.n = n;
  for (let i = 0; i < n; i++) {
    const v = e.verts[i];
    cache.wx[i] = e.x + v.x * c - v.y * s;
    cache.wy[i] = e.y + v.x * s + v.y * c;
    const nn = e.normals[i];
    cache.nx[i] = nn.x * c - nn.y * s;
    cache.ny[i] = nn.x * s + nn.y * c;
  }
}

export function newPolyCache(): PolyCache {
  return { wx: new Float64Array(12), wy: new Float64Array(12), nx: new Float64Array(12), ny: new Float64Array(12), n: 0 };
}
