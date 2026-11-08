import { z } from 'zod';
import { computeNormals, updateInverseMass } from './entity';
import { BUILTIN_MATERIALS, cloneMaterial } from './materials';
import type { Rule, RuleModule } from './rules/types';
import type { Entity, EntityDoc, Material, WorldDoc } from './types';
import { DEFAULT_SETTINGS, World } from './world';

export const FORMAT_VERSION = 1;

const num = z.number().refine(Number.isFinite, 'must be a finite number');
const vecS = z.object({ x: num, y: num });
const hex = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'must be a hex colour');
const paramValue = z.union([z.string().max(400), num, z.boolean()]);
const name = z.string().max(80);

export const MaterialSchema = z.object({
  id: z.string().regex(/^[\w-]{1,32}$/, 'material id: letters, digits, _ or -'),
  name: name,
  color: hex,
  density: num.min(0.001).max(1000),
  restitution: num.min(0).max(1.5),
  friction: num.min(0).max(2),
  conductivity: num.min(0).max(1),
  drag: num.min(0).max(50),
  gravityScale: num.min(-20).max(20),
  state: z.enum(['solid', 'liquid', 'gas', 'plasma', 'energy']),
  selfHeat: num.min(-10000).max(10000),
  glow: num.min(0).max(1),
  lifetime: num,
  decayTo: z.string().max(32),
  charge: num.min(-100).max(100),
  transitions: z.array(z.object({ when: z.enum(['above', 'below']), temp: num, to: z.string().max(32) })).max(8),
  tags: z.array(z.string().max(40)).max(16),
  spawnTemp: num.nullable(),
  builtin: z.boolean().optional(),
});

export const RuleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  enabled: z.boolean(),
  priority: num,
  trigger: z.object({ type: z.string(), params: z.record(z.string(), paramValue) }),
  conditionMode: z.enum(['all', 'any']),
  conditions: z
    .array(
      z.object({
        subject: z.enum(['self', 'other', 'world']),
        field: z.string(),
        op: z.string(),
        value: z.string().max(400),
        key: z.string().max(40).optional(),
      }),
    )
    .max(32),
  actions: z
    .array(
      z.object({
        type: z.string(),
        target: z.enum(['self', 'other', 'tagged', 'world']),
        tag: z.string().max(40).optional(),
        params: z.record(z.string(), paramValue),
      }),
    )
    .max(32),
  cooldown: num.min(0),
  cooldownScope: z.enum(['entity', 'global']),
  consume: z.boolean(),
  maxPerStep: num.min(1),
  module: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
});

export const ModuleSchema = z.object({
  id: z.string().min(1).max(64),
  name: name,
  description: z.string().max(2000),
  rules: z.array(RuleSchema).max(200),
  materials: z.array(MaterialSchema).max(64).optional(),
  builtin: z.boolean().optional(),
});

const EntitySchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['body', 'particle']),
  shape: z.enum(['circle', 'poly']),
  radius: num.min(0.1).max(5000),
  verts: z.array(vecS).max(12),
  shapeLabel: z.string().max(32),
  x: num,
  y: num,
  vx: num,
  vy: num,
  angle: num,
  av: num,
  mass: num.min(0.001),
  inertia: num.optional(),
  restitution: num,
  friction: num,
  drag: num,
  gravityScale: num,
  charge: num,
  material: z.string().max(32),
  color: hex,
  temperature: num,
  state: z.enum(['solid', 'liquid', 'gas', 'plasma', 'energy']),
  tags: z.array(z.string().max(40)).max(32),
  vars: z.record(z.string(), num),
  isStatic: z.boolean(),
  collides: z.boolean(),
  lifetime: num,
  age: num,
  portalCooldown: num,
  bornStep: num,
  origin: z.string().max(80),
});

const FieldSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['well', 'gravityZone', 'wind', 'vortex', 'heat', 'timeZone', 'portal']),
  name: z.string().max(60),
  x: num,
  y: num,
  shape: z.enum(['circle', 'rect']),
  radius: num.min(1).max(10000),
  w: num.min(1).max(20000),
  h: num.min(1).max(20000),
  strength: num,
  angle: num,
  enabled: z.boolean(),
  tagFilter: z.string().max(40),
  link: z.number().int().min(0),
  falloff: num,
  color: z.string().max(16),
});

const JointSchema = z.object({
  id: z.number().int().positive(),
  a: z.number().int(),
  b: z.number().int(),
  length: num.min(0),
  stiffness: num.min(0).max(1),
  damping: num.min(0),
  breakImpulse: num.min(0),
  color: z.string().max(16),
  load: num,
});

const SettingsSchema = z.object({
  width: num.min(200).max(20000),
  height: num.min(200).max(20000),
  gravity: vecS,
  boundary: z.enum(['walls', 'wrap', 'open']),
  ambientTemp: num,
  ambientExchange: num.min(0).max(10),
  airDrag: num.min(0).max(20),
  wind: vecS,
  timeScale: num.min(0).max(10),
  coulomb: num,
  chargeRange: num.min(1).max(5000),
  particleCollisions: z.boolean(),
  impactHeat: num.min(0),
  maxEntities: num.min(1).max(20000),
  substeps: num.min(1).max(8),
  iterations: num.min(1).max(30),
  instructionBudget: num.min(100).max(2_000_000),
  maxChainDepth: num.min(1).max(64),
  maxEventsPerStep: num.min(10).max(100000),
});

export const WorldDocSchema = z.object({
  format: z.literal('reality-compiler/world'),
  version: z.number().int().min(1).max(FORMAT_VERSION),
  name: z.string().max(80),
  description: z.string().max(4000),
  seed: z.number().int(),
  rngState: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  time: num.optional(),
  stepCount: num.optional(),
  nextId: z.number().int().optional(),
  settings: SettingsSchema.partial().transform((s) => ({ ...DEFAULT_SETTINGS, ...s })),
  materials: z.array(MaterialSchema).max(128),
  entities: z.array(EntitySchema).max(20000),
  joints: z.array(JointSchema).max(20000),
  fields: z.array(FieldSchema).max(256),
  rules: z.array(RuleSchema).max(500),
  modules: z.array(ModuleSchema).max(100),
  vars: z.record(z.string(), num),
});

export const RulesDocSchema = z.object({
  format: z.literal('reality-compiler/rules'),
  version: z.number().int().min(1).max(FORMAT_VERSION),
  rules: z.array(RuleSchema).max(500),
  modules: z.array(ModuleSchema).max(100).optional(),
  materials: z.array(MaterialSchema).max(128).optional(),
});

export interface RulesDoc {
  format: 'reality-compiler/rules';
  version: number;
  rules: Rule[];
  modules?: RuleModule[];
  materials?: Material[];
}

function entityToDoc(e: Entity): EntityDoc {
  return {
    id: e.id,
    kind: e.kind,
    shape: e.shape,
    radius: e.radius,
    verts: e.verts.map((v) => ({ x: v.x, y: v.y })),
    shapeLabel: e.shapeLabel,
    x: e.x,
    y: e.y,
    vx: e.vx,
    vy: e.vy,
    angle: e.angle,
    av: e.av,
    mass: e.mass,
    inertia: e.inertia,
    restitution: e.restitution,
    friction: e.friction,
    drag: e.drag,
    gravityScale: e.gravityScale,
    charge: e.charge,
    material: e.material,
    color: e.color,
    temperature: e.temperature,
    state: e.state,
    tags: [...e.tags],
    vars: { ...e.vars },
    isStatic: e.isStatic,
    collides: e.collides,
    lifetime: e.lifetime,
    age: e.age,
    portalCooldown: e.portalCooldown,
    bornStep: e.bornStep,
    origin: e.origin,
  };
}

export function docToEntity(d: EntityDoc): Entity {
  const e: Entity = {
    ...d,
    verts: d.verts.map((v) => ({ x: v.x, y: v.y })),
    normals: computeNormals(d.verts),
    tags: [...d.tags],
    vars: { ...d.vars },
    inertia: d.inertia ?? (d.shape === 'circle' ? 0.5 * d.mass * d.radius * d.radius : (d.mass * d.radius * d.radius) / 3),
    invMass: 0,
    invInertia: 0,
    fx: 0,
    fy: 0,
    torque: 0,
    prevTemp: d.temperature,
    prevSpeed: Math.hypot(d.vx, d.vy),
    dead: false,
    localTime: 1,
  };
  updateInverseMass(e);
  return e;
}

export function serializeWorld(w: World): WorldDoc {
  return {
    format: 'reality-compiler/world',
    version: FORMAT_VERSION,
    name: w.name,
    description: w.description,
    seed: w.seed,
    rngState: w.rng.getState(),
    time: w.time,
    stepCount: w.stepCount,
    nextId: w.nextId,
    settings: structuredClone(w.settings),
    materials: [...w.materials.values()].map(cloneMaterial),
    entities: w.entities.filter((e) => !e.dead).map(entityToDoc),
    joints: w.joints.map((j) => ({ ...j })),
    fields: w.fields.map((f) => ({ ...f })),
    rules: structuredClone(w.rules),
    modules: structuredClone(w.modules),
    vars: { ...w.vars },
  };
}

export class ImportError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
  ) {
    super(message);
  }
}

function formatZodIssues(err: z.ZodError, max = 8): string[] {
  return err.issues.slice(0, max).map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
}

/** Validates and builds a world from JSON (string or parsed). Throws ImportError with readable details. */
export function deserializeWorld(input: unknown): World {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new ImportError(`Not valid JSON: ${(e as Error).message}`);
    }
  }
  if (data && typeof data === 'object' && (data as { format?: string }).format === 'reality-compiler/rules') {
    throw new ImportError('This file contains rules only — use “Import rules” instead of “Import world”.');
  }
  const parsed = WorldDocSchema.safeParse(data);
  if (!parsed.success) throw new ImportError('World file failed validation', formatZodIssues(parsed.error));
  const doc = parsed.data as unknown as WorldDoc;

  const w = new World(doc.seed);
  w.name = doc.name;
  w.description = doc.description;
  w.settings = { ...DEFAULT_SETTINGS, ...doc.settings };
  // built-ins are always present; the file may override them
  w.materials.clear();
  for (const m of BUILTIN_MATERIALS) w.materials.set(m.id, cloneMaterial(m));
  for (const m of doc.materials) w.materials.set(m.id, cloneMaterial(m));
  const ids = new Set<number>();
  for (const d of doc.entities) {
    if (ids.has(d.id)) throw new ImportError(`Duplicate entity id ${d.id}`);
    ids.add(d.id);
    if (!w.materials.has(d.material)) throw new ImportError(`Entity ${d.id} uses unknown material “${d.material}”`);
    if (d.shape === 'poly' && d.verts.length < 3) throw new ImportError(`Entity ${d.id} is a polygon with fewer than 3 vertices`);
    w.insertEntity(docToEntity(d));
  }
  w.entities.sort((a, b) => a.id - b.id);
  w.joints = doc.joints.filter((j) => ids.has(j.a) && ids.has(j.b)).map((j) => ({ ...j }));
  w.fields = doc.fields.map((f) => ({ ...f }));
  w.rules = doc.rules as Rule[];
  w.modules = doc.modules as RuleModule[];
  w.vars = { ...doc.vars };
  w.time = doc.time ?? 0;
  w.stepCount = doc.stepCount ?? 0;
  const maxId = Math.max(0, ...w.entities.map((e) => e.id), ...w.fields.map((f) => f.id), ...w.joints.map((j) => j.id));
  w.nextId = Math.max(doc.nextId ?? 1, maxId + 1);
  if (doc.rngState) w.rng.setState(doc.rngState);
  w.engine.invalidate();
  return w;
}

export function serializeRules(rules: Rule[], modules: RuleModule[] = [], materials: Material[] = []): RulesDoc {
  return {
    format: 'reality-compiler/rules',
    version: FORMAT_VERSION,
    rules: structuredClone(rules),
    modules: structuredClone(modules),
    materials: materials.map(cloneMaterial),
  };
}

export function parseRulesDoc(input: unknown): RulesDoc {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new ImportError(`Not valid JSON: ${(e as Error).message}`);
    }
  }
  if (data && typeof data === 'object' && (data as { format?: string }).format === 'reality-compiler/world') {
    throw new ImportError('This is a world file — use “Import world” to load it.');
  }
  const parsed = RulesDocSchema.safeParse(data);
  if (!parsed.success) throw new ImportError('Rules file failed validation', formatZodIssues(parsed.error));
  return parsed.data as unknown as RulesDoc;
}

export function cloneWorld(w: World): World {
  return deserializeWorld(serializeWorld(w));
}
