import { CONTACT_MARGIN, ManifoldPool, circleCircle, polyCircle, polyPoly, type Manifold } from './collide';
import { makeEntity, newPolyCache, setMassFromDensity, transformPoly, type PolyCache, type ShapeSpec } from './entity';
import { accumulateField, fieldAffects, fieldContains, type FieldAccum } from './fields';
import { cloneMaterial, defaultMaterials } from './materials';
import { hashNumbers, type Vec } from './math';
import { Rng } from './rng';
import { RuleEngine, type EngineEvent } from './rules/engine';
import type { Rule, RuleModule } from './rules/types';
import { correctPositions, prepareContact, prepareJoint, solveContact, solveJoint, totalNormalImpulse, type JointRuntime } from './solver';
import { SpatialHash } from './spatial';
import type { Entity, EntityKind, Field, FieldKind, Joint, LogEntry, Material, StepStats, WorldSettings } from './types';

export const DEFAULT_SETTINGS: WorldSettings = {
  width: 1600,
  height: 1000,
  gravity: { x: 0, y: 600 },
  boundary: 'walls',
  ambientTemp: 20,
  ambientExchange: 0.05,
  airDrag: 0.02,
  wind: { x: 0, y: 0 },
  timeScale: 1,
  coulomb: 0,
  chargeRange: 260,
  particleCollisions: true,
  impactHeat: 0,
  maxEntities: 2500,
  substeps: 3,
  iterations: 8,
  instructionBudget: 60000,
  maxChainDepth: 16,
  maxEventsPerStep: 4000,
};

export const MAX_SPEED = 6000;
const ETHEREAL: Record<string, boolean> = { energy: true, plasma: true, gas: true };
const CONDUCTION_RATE = 3.5;
/** Scales the user-facing coulomb constant to px/s² for typical masses (≈30 px/s² at 60 px between ±2 charges). */
const CHARGE_SCALE = 3e5;
const LOG_LIMIT = 800;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface SpawnOptions {
  shape: ShapeSpec | { type: 'poly'; verts: Vec[]; label?: string };
  x: number;
  y: number;
  material?: string;
  kind?: EntityKind;
  vx?: number;
  vy?: number;
  angle?: number;
  av?: number;
  isStatic?: boolean;
  color?: string;
  tags?: string[];
  temperature?: number;
  origin?: string;
  mass?: number;
  lifetime?: number;
}

export interface CollisionRecord {
  a: number;
  b: number;
  x: number;
  y: number;
  relSpeed: number;
  impulse: number;
}

export const emptyStats = (): StepStats => ({
  stepMs: 0,
  broadphaseMs: 0,
  solveMs: 0,
  rulesMs: 0,
  pairs: 0,
  contacts: 0,
  collisionsBegun: 0,
  ruleFires: 0,
  instructions: 0,
  budgetExceeded: false,
  chainDepthHits: 0,
  cyclesBlocked: 0,
  eventsDropped: 0,
  spawnBlocked: 0,
});

/**
 * The simulation. Owns all state; has no knowledge of rendering or the DOM.
 * `step(dt)` advances one fixed tick (internally split into substeps).
 */
export class World {
  name = 'Untitled universe';
  description = '';
  seed = 1;
  settings: WorldSettings = structuredClone(DEFAULT_SETTINGS);
  materials = new Map<string, Material>();
  entities: Entity[] = [];
  byId = new Map<number, Entity>();
  joints: Joint[] = [];
  fields: Field[] = [];
  rules: Rule[] = [];
  modules: RuleModule[] = [];
  vars: Record<string, number> = {};
  rng: Rng;
  time = 0;
  stepCount = 0;
  nextId = 1;

  log: LogEntry[] = [];
  logSeq = 0;
  stats: StepStats = emptyStats();
  engine = new RuleEngine();

  /** Events produced by physics this step + carried over from the last step. */
  events: EngineEvent[] = [];
  /** Events generated during rule processing that belong to the next step (creation). */
  deferred: EngineEvent[] = [];
  collisionsThisStep: CollisionRecord[] = [];
  /** Contact points of the last substep for visualisation: x, y, nx, ny. */
  debugContacts: number[] = [];

  private hash = new SpatialHash(64);
  private pool = new ManifoldPool();
  private polyCaches: PolyCache[] = [];
  private contactsPrev = new Set<number>();
  private contactsNow = new Set<number>();
  private jointPairs = new Set<number>();
  private acc: FieldAccum = { ax: 0, ay: 0, gx: 0, gy: 0, timeScale: 1, heat: 0 };
  /** Manifold count of the most recent narrowphase (valid after a substep). */
  private manifoldCount = 0;
  private hashValid = false;

  constructor(seed = 1) {
    this.seed = seed;
    this.rng = new Rng(seed);
    for (const m of defaultMaterials()) this.materials.set(m.id, m);
  }

  // ------------------------------------------------------------- logging

  addLog(kind: LogEntry['kind'], text: string, extra: Partial<LogEntry> = {}): void {
    this.logSeq++;
    this.log.push({ step: this.stepCount, time: this.time, kind, text, ...extra });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  // ------------------------------------------------------------- materials

  material(id: string): Material {
    return this.materials.get(id) ?? this.materials.get('stone') ?? defaultMaterials()[0];
  }

  setMaterial(m: Material): void {
    this.materials.set(m.id, cloneMaterial(m));
  }

  // ------------------------------------------------------------- entities

  get liveCount(): number {
    let n = 0;
    for (const e of this.entities) if (!e.dead) n++;
    return n;
  }

  /** Spawns an entity. Returns null when the entity cap is reached. */
  spawn(o: SpawnOptions): Entity | null {
    if (this.liveCountFast() >= this.settings.maxEntities) {
      this.stats.spawnBlocked++;
      return null;
    }
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
    const mat = this.material(o.material ?? 'stone');
    const e = makeEntity({
      id: this.nextId++,
      kind: o.kind,
      shape: o.shape,
      x: o.x,
      y: o.y,
      vx: o.vx,
      vy: o.vy,
      angle: o.angle,
      av: o.av,
      material: mat,
      temperature: o.temperature ?? mat.spawnTemp ?? this.settings.ambientTemp,
      isStatic: o.isStatic,
      color: o.color,
      tags: o.tags,
      origin: o.origin,
      bornStep: this.stepCount,
      mass: o.mass,
    });
    if (o.lifetime !== undefined) e.lifetime = o.lifetime;
    e.prevTemp = e.temperature;
    this.entities.push(e);
    this.byId.set(e.id, e);
    this.liveCounter++;
    this.deferred.push({ type: 'creation', id: e.id, depth: 0 });
    return e;
  }

  private liveCounter = 0;
  private liveCountFast(): number {
    return this.liveCounter;
  }

  /** Inserts an already-built entity (used by deserialisation). */
  insertEntity(e: Entity): void {
    this.entities.push(e);
    this.byId.set(e.id, e);
    if (!e.dead) this.liveCounter++;
    if (e.id >= this.nextId) this.nextId = e.id + 1;
  }

  destroy(e: Entity, cause = 'destroyed', depth = 0): void {
    if (e.dead) return;
    e.dead = true;
    this.liveCounter--;
    this.events.push({ type: 'destruction', id: e.id, depth, cause });
  }

  get(id: number | undefined | null): Entity | undefined {
    if (id === undefined || id === null) return undefined;
    const e = this.byId.get(id);
    return e && !e.dead ? e : undefined;
  }

  /** Changes an entity's material, applying all of its properties. */
  transform(e: Entity, materialId: string, depth = 0, cause = 'transform'): boolean {
    const to = this.materials.get(materialId);
    if (!to || e.material === materialId) return false;
    const from = this.material(e.material);
    const fromState = e.state;
    e.tags = e.tags.filter((t) => !from.tags.includes(t));
    for (const t of to.tags) if (!e.tags.includes(t)) e.tags.push(t);
    e.material = to.id;
    e.color = to.color;
    e.restitution = to.restitution;
    e.friction = to.friction;
    e.drag = to.drag;
    e.gravityScale = to.gravityScale;
    e.charge = to.charge;
    e.state = to.state;
    e.lifetime = to.lifetime;
    if (!e.isStatic) setMassFromDensity(e, to.density);
    this.events.push({
      type: 'stateChange',
      id: e.id,
      fromMat: from.id,
      toMat: to.id,
      fromState,
      toState: to.state,
      depth,
      cause,
    });
    return true;
  }

  // ------------------------------------------------------------- joints

  addJoint(a: Entity, b: Entity, opts: Partial<Joint> = {}): Joint | null {
    if (a.id === b.id) return null;
    if (this.joints.some((j) => (j.a === a.id && j.b === b.id) || (j.a === b.id && j.b === a.id))) return null;
    const j: Joint = {
      id: this.nextId++,
      a: a.id,
      b: b.id,
      length: Math.hypot(b.x - a.x, b.y - a.y),
      stiffness: 1,
      damping: 0.2,
      breakImpulse: 0,
      color: '#7af7ff',
      load: 0,
      ...opts,
    };
    this.joints.push(j);
    return j;
  }

  removeJoint(id: number): void {
    this.joints = this.joints.filter((j) => j.id !== id);
  }

  // ------------------------------------------------------------- fields

  addField(kind: FieldKind, x: number, y: number, patch: Partial<Field> = {}): Field {
    const f: Field = {
      id: this.nextId++,
      kind,
      name: '',
      x,
      y,
      shape: kind === 'gravityZone' || kind === 'wind' ? 'rect' : 'circle',
      radius: kind === 'portal' ? 46 : 180,
      w: 360,
      h: 260,
      strength: 1,
      angle: kind === 'gravityZone' ? -Math.PI / 2 : 0,
      enabled: true,
      tagFilter: '',
      link: 0,
      falloff: kind === 'well' ? 2 : 0,
      color: '',
      ...patch,
    };
    if (!f.name) f.name = `${kind}-${f.id}`;
    this.fields.push(f);
    return f;
  }

  removeField(id: number): void {
    this.fields = this.fields.filter((f) => f.id !== id);
    for (const f of this.fields) if (f.link === id) f.link = 0;
  }

  // ------------------------------------------------------------- queries

  /** Entities whose bounding circle overlaps the given circle (uses the broadphase when valid). */
  queryCircle(x: number, y: number, r: number, cb: (e: Entity) => void): void {
    if (!this.hashValid) {
      for (const e of this.entities) {
        if (e.dead) continue;
        const rr = r + e.radius;
        if ((e.x - x) ** 2 + (e.y - y) ** 2 <= rr * rr) cb(e);
      }
      return;
    }
    const ents = this.entities;
    this.hash.query(x - r, y - r, x + r, y + r, (i) => {
      const e = ents[i];
      if (!e || e.dead) return;
      const rr = r + e.radius;
      if ((e.x - x) ** 2 + (e.y - y) ** 2 <= rr * rr) cb(e);
    });
  }

  /** Topmost entity containing the point (UI picking). */
  pick(x: number, y: number, slack = 2): Entity | undefined {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.dead) continue;
      const dx = x - e.x;
      const dy = y - e.y;
      const r = e.radius + slack + (e.kind === 'particle' ? 4 : 0);
      if (dx * dx + dy * dy > r * r) continue;
      if (e.shape === 'circle') return e;
      // point in polygon (local space)
      const c = Math.cos(-e.angle);
      const s = Math.sin(-e.angle);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      let inside = true;
      for (let k = 0; k < e.verts.length; k++) {
        const v = e.verts[k];
        const n = e.normals[k];
        if ((lx - v.x) * n.x + (ly - v.y) * n.y > slack) {
          inside = false;
          break;
        }
      }
      if (inside) return e;
    }
    return undefined;
  }

  pickField(x: number, y: number): Field | undefined {
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      if (fieldContains(f, x, y, f.kind === 'portal' ? 6 : 0)) return f;
    }
    return undefined;
  }

  // ------------------------------------------------------------- stepping

  step(dt = 1 / 60): void {
    const t0 = now();
    const stats = this.stats;
    Object.assign(stats, emptyStats());
    this.collisionsThisStep.length = 0;
    // events deferred from the previous step (creations) are processed now, followed by
    // anything queued between steps (user deletions, manual rule firings, external transforms)
    this.events = this.deferred.concat(this.events);
    this.deferred = [];

    const ts = Math.max(0, Math.min(10, this.settings.timeScale));
    const dtw = dt * ts;
    this.contactsNow.clear();
    if (dtw > 0) {
      const n = Math.max(1, Math.min(8, Math.round(this.settings.substeps)));
      const h = dtw / n;
      for (let s = 0; s < n; s++) this.substep(h);
    } else {
      this.buildHash();
    }
    const tmp = this.contactsPrev;
    this.contactsPrev = this.contactsNow;
    this.contactsNow = tmp;

    this.postPhysics(dtw);

    const tr = now();
    this.engine.run(this, dtw);
    stats.rulesMs = now() - tr;

    this.cleanup();
    // remember end-of-step values: temperature / velocity triggers detect crossings against these,
    // so changes made between steps (inspector edits, rules) are crossings too
    for (const e of this.entities) {
      e.prevTemp = e.temperature;
      e.prevSpeed = Math.hypot(e.vx, e.vy);
    }
    this.time += dtw;
    this.stepCount++;
    stats.stepMs = now() - t0;
  }

  private buildHash(): void {
    const ents = this.entities;
    this.hash.clear(ents.length + 16);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.dead) continue;
      const r = e.radius + 1;
      this.hash.insert(i, e.x - r, e.y - r, e.x + r, e.y + r);
    }
    this.hashValid = true;
  }

  private substep(h: number): void {
    const s = this.settings;
    const ents = this.entities;
    const stats = this.stats;
    const tb = now();
    this.buildHash();

    // ---- charge interactions (pairwise, within range)
    if (s.coulomb !== 0) this.applyCharges();

    // ---- forces, fields, time dilation, velocity integration
    const acc = this.acc;
    const fields = this.fields;
    const drag = s.airDrag;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.dead) continue;
      acc.ax = s.wind.x;
      acc.ay = s.wind.y;
      acc.gx = s.gravity.x;
      acc.gy = s.gravity.y;
      acc.timeScale = 1;
      acc.heat = 0;
      for (let k = 0; k < fields.length; k++) {
        const f = fields[k];
        if (f.kind === 'portal' || !fieldAffects(f, e) || !fieldContains(f, e.x, e.y)) continue;
        accumulateField(f, e, acc);
      }
      e.localTime = acc.timeScale;
      const hl = h * acc.timeScale;
      if (e.isStatic) {
        // static geometry (floors, walls) is a fixture: fields don't push or heat it.
        // It still exchanges heat by conduction with whatever touches it.
        e.fx = e.fy = e.torque = 0;
        continue;
      }
      if (acc.heat !== 0) e.temperature += acc.heat * hl;
      e.vx += (acc.gx * e.gravityScale + acc.ax + e.fx * e.invMass) * hl;
      e.vy += (acc.gy * e.gravityScale + acc.ay + e.fy * e.invMass) * hl;
      e.av += e.torque * e.invInertia * hl;
      const d = 1 / (1 + (drag + e.drag) * hl);
      e.vx *= d;
      e.vy *= d;
      e.av *= 1 / (1 + 0.15 * hl);
      e.fx = e.fy = e.torque = 0;
    }

    // ---- narrowphase
    const pool = this.pool;
    pool.reset();
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.shape === 'poly' && !e.dead) {
        let c = this.polyCaches[i];
        if (!c || c.wx.length < e.verts.length) c = this.polyCaches[i] = newPolyCache();
        transformPoly(e, c);
      }
    }
    let pairs = 0;
    const pc = this.polyCaches;
    const jointPairs = this.jointPairs;
    jointPairs.clear();
    for (const j of this.joints) jointPairs.add(pairKey(j.a, j.b));
    // Ethereal particles (sparks, flames, vapour) never collide with each other, so they don't need
    // to query the broadphase themselves: bodies find them. This keeps dense spark clouds cheap.
    const passive = (e: Entity) => e.kind === 'particle' && ETHEREAL[e.state] === true;
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i];
      if (a.dead || !a.collides || passive(a)) continue;
      const r = a.radius + CONTACT_MARGIN;
      this.hash.query(a.x - r, a.y - r, a.x + r, a.y + r, (j) => {
        const b = ents[j];
        if (j <= i && !passive(b)) return;
        if (j === i) return;
        if (b.dead || !b.collides) return;
        if (a.isStatic && b.isStatic) return;
        // particles only collide with each other if enabled, and never when they are energy-like
        // (sparks, flames, vapour): those are visual matter and would otherwise form costly piles
        if (a.kind === 'particle' && b.kind === 'particle' && (!s.particleCollisions || ETHEREAL[a.state] || ETHEREAL[b.state])) return;
        const rr = a.radius + b.radius + CONTACT_MARGIN;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy > rr * rr) return;
        if (jointPairs.size && jointPairs.has(pairKey(a.id, b.id))) return;
        pairs++;
        const m = pool.take(a, b);
        let hit: boolean;
        if (a.shape === 'circle' && b.shape === 'circle') hit = circleCircle(m);
        else if (a.shape === 'poly' && b.shape === 'circle') hit = polyCircle(m, pc[i], false);
        else if (a.shape === 'circle' && b.shape === 'poly') hit = polyCircle(m, pc[j], true);
        else hit = polyPoly(m, pc[i], pc[j]);
        if (!hit) pool.release();
      });
    }
    stats.pairs += pairs;
    this.manifoldCount = pool.used;
    stats.broadphaseMs += now() - tb;

    // ---- solve (warm-started from the previous substep's accumulated impulses)
    const ts0 = now();
    const count = pool.used;
    const cache = this.warmCache;
    // all biases / approach speeds must be computed from the same pre-solve velocities,
    // BEFORE any warm-start impulse is applied (otherwise resting stacks look like impacts)
    for (let k = 0; k < count; k++) prepareContact(pool.get(k), h);
    for (let k = 0; k < count; k++) {
      const m = pool.get(k);
      const c = cache.get(pairKey(m.a.id, m.b.id));
      if (c && c.aId === m.a.id && c.nx * m.nx + c.ny * m.ny > 0.95) warmStart(m, c);
    }
    const jrs = this.prepareJoints(h);
    const iters = Math.max(1, Math.min(30, Math.round(s.iterations)));
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < jrs.length; k++) solveJoint(jrs[k]);
      for (let k = 0; k < count; k++) solveContact(pool.get(k));
    }
    stats.contacts = count;
    // remember impulses for warm starting the next substep
    cache.clear();
    for (let k = 0; k < count; k++) {
      const m = pool.get(k);
      const e: WarmEntry = { aId: m.a.id, nx: m.nx, ny: m.ny, n: m.count, x0: m.p[0].x, y0: m.p[0].y, jn0: m.p[0].jn, jt0: m.p[0].jt, x1: 0, y1: 0, jn1: 0, jt1: 0 };
      if (m.count > 1) {
        e.x1 = m.p[1].x;
        e.y1 = m.p[1].y;
        e.jn1 = m.p[1].jn;
        e.jt1 = m.p[1].jt;
      }
      cache.set(pairKey(m.a.id, m.b.id), e);
    }
    stats.solveMs += now() - ts0;

    // ---- integrate positions (in local time)
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.dead || e.isStatic) continue;
      let sp2 = e.vx * e.vx + e.vy * e.vy;
      if (sp2 > MAX_SPEED * MAX_SPEED) {
        const k = MAX_SPEED / Math.sqrt(sp2);
        e.vx *= k;
        e.vy *= k;
        sp2 = MAX_SPEED * MAX_SPEED;
      }
      if (e.av > 60) e.av = 60;
      else if (e.av < -60) e.av = -60;
      const hl = h * e.localTime;
      e.x += e.vx * hl;
      e.y += e.vy * hl;
      e.angle += e.av * hl;
    }
    for (let k = 0; k < count; k++) correctPositions(pool.get(k));
    this.projectJoints(jrs);

    // ---- contact bookkeeping: begin events, conduction, impact heat
    const dbg = this.debugContacts;
    dbg.length = 0;
    for (let k = 0; k < count; k++) {
      const m = pool.get(k);
      const a = m.a;
      const b = m.b;
      let deepest = -Infinity;
      for (let i = 0; i < m.count; i++) if (m.p[i].depth > deepest) deepest = m.p[i].depth;
      if (deepest < -TOUCH_TOLERANCE && totalNormalImpulse(m) <= 0) continue; // speculative only, not touching
      const key = pairKey(a.id, b.id);
      if (!this.contactsNow.has(key)) {
        this.contactsNow.add(key);
        if (!this.contactsPrev.has(key)) {
          const p = m.p[0];
          const rec: CollisionRecord = { a: a.id, b: b.id, x: p.x, y: p.y, relSpeed: m.approach, impulse: totalNormalImpulse(m) };
          this.collisionsThisStep.push(rec);
          stats.collisionsBegun++;
          if (s.impactHeat > 0 && m.approach > 60) {
            const heat = (s.impactHeat * m.approach) / 100;
            if (!a.isStatic) a.temperature += heat;
            if (!b.isStatic) b.temperature += heat;
          }
        }
      }
      // conduction
      const ca = this.material(a.material).conductivity;
      const cb = this.material(b.material).conductivity;
      const kc = Math.sqrt(ca * cb);
      if (kc > 0 && a.temperature !== b.temperature) {
        // heat capacity grows sub-linearly with mass so small flames can still ignite big logs
        const ma = Math.sqrt(a.isStatic ? a.mass * 4 : a.mass);
        const mb = Math.sqrt(b.isStatic ? b.mass * 4 : b.mass);
        const q = (a.temperature - b.temperature) * Math.min(0.5, kc * CONDUCTION_RATE * h * Math.min(a.localTime, b.localTime));
        a.temperature -= (q * mb) / (ma + mb);
        b.temperature += (q * ma) / (ma + mb);
      }
      if (dbg.length < 2048) for (let i = 0; i < m.count; i++) dbg.push(m.p[i].x, m.p[i].y, m.nx, m.ny);
    }

    // ---- joints breaking + load for display
    for (const jr of jrs) {
      jr.joint.load = Math.abs(jr.impulse) / Math.max(h, 1e-6);
      if (jr.joint.breakImpulse > 0 && Math.abs(jr.impulse) > jr.joint.breakImpulse) {
        this.joints = this.joints.filter((j) => j !== jr.joint);
        this.addLog('info', `joint ${jr.joint.id} snapped`);
      }
    }

    this.applyBoundaries();
    this.applyPortals(h);
  }

  private warmCache = new Map<number, WarmEntry>();
  private jrPool: JointRuntime[] = [];
  private prepareJoints(h: number): JointRuntime[] {
    const out: JointRuntime[] = [];
    let alive = true;
    for (const j of this.joints) {
      const a = this.byId.get(j.a);
      const b = this.byId.get(j.b);
      if (!a || !b || a.dead || b.dead) {
        alive = false;
        continue;
      }
      let jr = this.jrPool[out.length];
      if (!jr) jr = this.jrPool[out.length] = { joint: j, a, b, nx: 0, ny: 0, mass: 0, bias: 0, impulse: 0, soft: 0 };
      jr.joint = j;
      jr.a = a;
      jr.b = b;
      prepareJoint(jr, h * Math.min(a.localTime, b.localTime) || h);
      out.push(jr);
    }
    if (!alive) this.joints = this.joints.filter((j) => this.get(j.a) && this.get(j.b));
    return out;
  }

  private projectJoints(jrs: JointRuntime[]): void {
    for (const jr of jrs) {
      const { a, b, joint } = jr;
      if (joint.stiffness < 0.95) continue;
      const inv = a.invMass + b.invMass;
      if (inv <= 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const c = ((d - joint.length) / inv) * 0.5;
      const nx = dx / d;
      const ny = dy / d;
      a.x += nx * c * a.invMass;
      a.y += ny * c * a.invMass;
      b.x -= nx * c * b.invMass;
      b.y -= ny * c * b.invMass;
    }
  }

  private applyCharges(): void {
    const s = this.settings;
    const ents = this.entities;
    const R = Math.max(10, s.chargeRange);
    const minD2 = 18 * 18;
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i];
      if (a.dead || a.charge === 0) continue;
      this.hash.query(a.x - R, a.y - R, a.x + R, a.y + R, (j) => {
        if (j <= i) return;
        const b = ents[j];
        if (b.dead || b.charge === 0) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) return;
        const d = Math.sqrt(d2) || 1e-6;
        // fade out near the range edge so there's no force discontinuity
        const fade = 1 - d / R;
        const f = ((s.coulomb * a.charge * b.charge) / Math.max(d2, minD2)) * CHARGE_SCALE * fade;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.fx -= fx;
        a.fy -= fy;
        b.fx += fx;
        b.fy += fy;
      });
    }
  }

  private applyBoundaries(): void {
    const s = this.settings;
    const W = s.width;
    const H = s.height;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.dead || e.isStatic) continue;
      if (s.boundary === 'wrap') {
        if (e.x < 0) e.x += W;
        else if (e.x > W) e.x -= W;
        if (e.y < 0) e.y += H;
        else if (e.y > H) e.y -= H;
        continue;
      }
      if (s.boundary === 'open') {
        const m = 600;
        if (e.x < -m || e.x > W + m || e.y < -m || e.y > H + m) this.destroy(e, 'left the world');
        continue;
      }
      let minX = e.x - e.radius;
      let maxX = e.x + e.radius;
      let minY = e.y - e.radius;
      let maxY = e.y + e.radius;
      if (e.shape === 'poly') {
        const c = this.polyCaches[i];
        if (c && c.n === e.verts.length) {
          transformPoly(e, c);
          minX = minY = Infinity;
          maxX = maxY = -Infinity;
          for (let k = 0; k < c.n; k++) {
            if (c.wx[k] < minX) minX = c.wx[k];
            if (c.wx[k] > maxX) maxX = c.wx[k];
            if (c.wy[k] < minY) minY = c.wy[k];
            if (c.wy[k] > maxY) maxY = c.wy[k];
          }
        }
      }
      const rest = Math.max(0.05, e.restitution * 0.8);
      if (minX < 0) {
        e.x -= minX;
        if (e.vx < 0) e.vx = -e.vx * rest;
      } else if (maxX > W) {
        e.x -= maxX - W;
        if (e.vx > 0) e.vx = -e.vx * rest;
      }
      if (minY < 0) {
        e.y -= minY;
        if (e.vy < 0) e.vy = -e.vy * rest;
      } else if (maxY > H) {
        e.y -= maxY - H;
        if (e.vy > 0) {
          e.vy = -e.vy * rest;
          if (Math.abs(e.vy) < 30) e.vy = 0;
        }
        e.vx *= 0.995;
        e.av *= 0.98;
      }
    }
  }

  private applyPortals(h: number): void {
    const portals = this.fields.filter((f) => f.kind === 'portal' && f.enabled && f.link);
    if (!portals.length) {
      for (const e of this.entities) if (e.portalCooldown > 0) e.portalCooldown = Math.max(0, e.portalCooldown - h);
      return;
    }
    const byId = new Map(this.fields.map((f) => [f.id, f]));
    for (const e of this.entities) {
      if (e.dead || e.isStatic) continue;
      let inside: Field | undefined;
      for (const p of portals) {
        if (fieldContains(p, e.x, e.y) && fieldAffects(p, e)) {
          inside = p;
          break;
        }
      }
      if (e.portalCooldown > 0) {
        e.portalCooldown -= h;
        if (inside) e.portalCooldown = Math.max(e.portalCooldown, 0.02);
        continue;
      }
      if (!inside) continue;
      const dest = byId.get(inside.link);
      if (!dest || !dest.enabled || dest.kind !== 'portal') continue;
      const rot = dest.angle - inside.angle;
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const ox = e.x - inside.x;
      const oy = e.y - inside.y;
      const scale = dest.radius / Math.max(1, inside.radius);
      e.x = dest.x + (ox * c - oy * sn) * scale;
      e.y = dest.y + (ox * sn + oy * c) * scale;
      const vx = e.vx;
      const vy = e.vy;
      e.vx = vx * c - vy * sn;
      e.vy = vx * sn + vy * c;
      e.angle += rot;
      e.portalCooldown = 0.25;
      this.events.push({ type: 'signal', name: `portal:${inside.name}`, source: e.id, depth: 0 });
    }
  }

  private postPhysics(dtw: number): void {
    const s = this.settings;
    const amb = s.ambientTemp;
    for (const e of this.entities) {
      if (e.dead) continue;
      const hl = dtw * e.localTime;
      const mat = this.material(e.material);
      if (hl > 0) {
        if (mat.selfHeat) e.temperature += mat.selfHeat * hl;
        const k = Math.min(1, s.ambientExchange * (0.2 + mat.conductivity) * hl);
        e.temperature += (amb - e.temperature) * k;
        e.age += hl;
        if (e.lifetime >= 0) {
          e.lifetime -= hl;
          if (e.lifetime <= 0) {
            if (mat.decayTo && this.materials.has(mat.decayTo) && e.kind !== 'particle') {
              this.transform(e, mat.decayTo, 0, 'decay');
              if (e.lifetime >= 0 && e.lifetime < 0.05) e.lifetime = -1;
            } else {
              this.destroy(e, 'lifetime expired');
            }
            continue;
          }
        }
      }
      if (!Number.isFinite(e.temperature)) e.temperature = amb;
      e.temperature = Math.max(-273, Math.min(100000, e.temperature));
      // phase transitions (at most one per step, so chains of transitions stay visible)
      for (const t of mat.transitions) {
        if ((t.when === 'above' && e.temperature > t.temp) || (t.when === 'below' && e.temperature < t.temp)) {
          if (this.transform(e, t.to, 0, `${t.when} ${t.temp}°`)) break;
        }
      }
      // numerical safety net
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.vx) || !Number.isFinite(e.vy)) {
        this.addLog('warn', `entity ${e.id} became numerically unstable and was removed`, { entityId: e.id });
        this.destroy(e, 'numerical instability');
      } else if (!Number.isFinite(e.angle) || !Number.isFinite(e.av)) {
        e.angle = 0;
        e.av = 0;
      }
    }
    for (const c of this.collisionsThisStep) this.events.push({ type: 'collision', ...c, depth: 0 });
  }

  private cleanup(): void {
    let anyDead = false;
    for (const e of this.entities) if (e.dead) anyDead = true;
    if (!anyDead) return;
    const alive: Entity[] = [];
    for (const e of this.entities) {
      if (e.dead) this.byId.delete(e.id);
      else alive.push(e);
    }
    this.entities = alive;
    this.liveCounter = alive.length;
    this.joints = this.joints.filter((j) => this.byId.has(j.a) && this.byId.has(j.b));
    this.polyCaches.length = 0;
    this.hashValid = false;
  }

  // ------------------------------------------------------------- diagnostics

  kineticEnergy(): number {
    let k = 0;
    for (const e of this.entities) {
      if (e.dead || e.isStatic) continue;
      k += 0.5 * e.mass * (e.vx * e.vx + e.vy * e.vy) + 0.5 * e.inertia * e.av * e.av;
    }
    return k;
  }

  averageTemperature(): number {
    let t = 0;
    let n = 0;
    for (const e of this.entities) {
      if (e.dead || e.isStatic) continue;
      t += e.temperature;
      n++;
    }
    return n ? t / n : this.settings.ambientTemp;
  }

  /** Stable fingerprint of the dynamic state (determinism tests, replay checks). */
  stateHash(): string {
    const self = this;
    function* nums(): Generator<number> {
      yield self.entities.length;
      for (const e of self.entities) {
        yield e.id;
        yield e.x;
        yield e.y;
        yield e.vx;
        yield e.vy;
        yield e.angle;
        yield e.temperature;
        yield e.dead ? 1 : 0;
      }
      for (const k of Object.keys(self.vars).sort()) yield self.vars[k];
      yield self.settings.gravity.x;
      yield self.settings.gravity.y;
      for (const v of self.rng.getState()) yield v;
    }
    return hashNumbers(nums());
  }

  /** Contact pairs touching at the end of the last step (needed to replay collision-begin events exactly). */
  exportContacts(): number[] {
    return [...this.contactsPrev];
  }

  importContacts(keys: number[]): void {
    this.contactsPrev = new Set(keys);
  }

  /** Warm-start impulse cache, flattened (needed so a loaded world continues bit-for-bit). */
  exportWarm(): number[][] {
    const out: number[][] = [];
    for (const [k, e] of this.warmCache) out.push([k, e.aId, e.nx, e.ny, e.n, e.x0, e.y0, e.jn0, e.jt0, e.x1, e.y1, e.jn1, e.jt1]);
    return out;
  }

  importWarm(rows: number[][]): void {
    this.warmCache.clear();
    for (const r of rows) {
      if (r.length !== 13 || !r.every(Number.isFinite)) continue;
      this.warmCache.set(r[0], { aId: r[1], nx: r[2], ny: r[3], n: r[4], x0: r[5], y0: r[6], jn0: r[7], jt0: r[8], x1: r[9], y1: r[10], jn1: r[11], jt1: r[12] });
    }
  }

  get manifolds(): number {
    return this.manifoldCount;
  }
}

interface WarmEntry {
  aId: number;
  nx: number;
  ny: number;
  n: number;
  x0: number;
  y0: number;
  jn0: number;
  jt0: number;
  x1: number;
  y1: number;
  jn1: number;
  jt1: number;
}

const WARM_DIST2 = 4 * 4;
const TOUCH_TOLERANCE = 0.75;

/** Seeds contact impulses from matching points of the previous substep and applies them. */
function warmStart(m: Manifold, c: WarmEntry): void {
  const tx = -m.ny;
  const ty = m.nx;
  for (let i = 0; i < m.count; i++) {
    const p = m.p[i];
    let jn = 0;
    let jt = 0;
    const d0 = (p.x - c.x0) ** 2 + (p.y - c.y0) ** 2;
    const d1 = c.n > 1 ? (p.x - c.x1) ** 2 + (p.y - c.y1) ** 2 : Infinity;
    if (d0 <= d1 && d0 < WARM_DIST2) {
      jn = c.jn0;
      jt = c.jt0;
    } else if (d1 < WARM_DIST2) {
      jn = c.jn1;
      jt = c.jt1;
    } else continue;
    p.jn = jn;
    p.jt = jt;
    const px = m.nx * jn + tx * jt;
    const py = m.ny * jn + ty * jt;
    const a = m.a;
    const b = m.b;
    a.vx -= px * a.invMass;
    a.vy -= py * a.invMass;
    a.av -= a.invInertia * (p.rax * py - p.ray * px);
    b.vx += px * b.invMass;
    b.vy += py * b.invMass;
    b.av += b.invInertia * (p.rbx * py - p.rby * px);
  }
}

export function pairKey(a: number, b: number): number {
  return a < b ? a * 67108864 + b : b * 67108864 + a;
}

export function isManifold(m: unknown): m is Manifold {
  return !!m && typeof m === 'object' && 'nx' in m;
}
