import type { Vec } from './math';
import type { Rule, RuleModule } from './rules/types';

export type ShapeKind = 'circle' | 'poly';
export type EntityKind = 'body' | 'particle';
export type MatterState = 'solid' | 'liquid' | 'gas' | 'plasma' | 'energy';

export interface Entity {
  id: number;
  kind: EntityKind;
  shape: ShapeKind;
  /** Circle radius, or bounding radius for polygons. */
  radius: number;
  /** Polygon vertices in local space (counter-clockwise). Empty for circles. */
  verts: Vec[];
  /** Outward normals for each polygon edge, local space. */
  normals: Vec[];
  /** Human readable shape label: circle, box, triangle, hexagon... */
  shapeLabel: string;

  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  av: number;

  // force accumulators, cleared every substep
  fx: number;
  fy: number;
  torque: number;

  mass: number;
  invMass: number;
  inertia: number;
  invInertia: number;
  restitution: number;
  friction: number;
  drag: number;
  gravityScale: number;
  charge: number;

  material: string;
  color: string;
  temperature: number;
  state: MatterState;
  tags: string[];
  vars: Record<string, number>;

  isStatic: boolean;
  /** If false, the entity does not take part in collision response. */
  collides: boolean;
  /** Remaining life in seconds; < 0 means immortal. */
  lifetime: number;
  /** Seconds this entity has existed (in its local time). */
  age: number;
  /** Time scale experienced in the last step (product of time zones). */
  localTime: number;

  // bookkeeping
  prevTemp: number;
  prevSpeed: number;
  portalCooldown: number;
  bornStep: number;
  dead: boolean;
  /** Who/what created this entity (for the inspector): 'user', 'rule:<id>', 'preset', ... */
  origin: string;
}

export interface Joint {
  id: number;
  a: number;
  b: number;
  length: number;
  /** 0..1, 1 = rigid rod */
  stiffness: number;
  damping: number;
  /** Impulse magnitude above which the joint breaks; 0 = unbreakable. */
  breakImpulse: number;
  color: string;
  /** last frame's applied impulse (for visualisation / breaking) */
  load: number;
}

export type FieldKind =
  | 'well' // radial attraction (>0) / repulsion (<0)
  | 'gravityZone' // override gravity vector inside the region
  | 'wind' // constant push inside region
  | 'vortex' // tangential swirl
  | 'heat' // heats (>0) / cools (<0) bodies inside
  | 'timeZone' // local time dilation
  | 'portal'; // teleports bodies to the linked portal

export interface Field {
  id: number;
  kind: FieldKind;
  name: string;
  x: number;
  y: number;
  shape: 'circle' | 'rect';
  radius: number;
  w: number;
  h: number;
  /** Meaning depends on kind: acceleration, deg/s, time scale... */
  strength: number;
  /** Direction in radians (gravity zone, wind, portal exit). */
  angle: number;
  enabled: boolean;
  /** Only affect entities carrying this tag ('' = everything). */
  tagFilter: string;
  /** For portals: id of the destination portal. */
  link: number;
  /** Falloff for wells: 0 = constant, 1 = linear, 2 = inverse-square-ish. */
  falloff: number;
  color: string;
}

export interface MaterialTransition {
  when: 'above' | 'below';
  temp: number;
  to: string;
}

export interface Material {
  id: string;
  name: string;
  color: string;
  density: number;
  restitution: number;
  friction: number;
  /** 0..1 thermal conductivity. */
  conductivity: number;
  drag: number;
  gravityScale: number;
  state: MatterState;
  /** Degrees per second the material adds to its own temperature (fire > 0). */
  selfHeat: number;
  /** Visual glow 0..1. */
  glow: number;
  /** Lifetime for entities made of this material, < 0 = forever. */
  lifetime: number;
  /** What a lifetime expiry turns into ('' = vanish). */
  decayTo: string;
  charge: number;
  transitions: MaterialTransition[];
  tags: string[];
  /** Initial temperature for newly spawned entities (NaN-free; use ambient if null). */
  spawnTemp: number | null;
  builtin?: boolean;
}

export type BoundaryMode = 'walls' | 'wrap' | 'open';

export interface WorldSettings {
  width: number;
  height: number;
  gravity: Vec;
  boundary: BoundaryMode;
  ambientTemp: number;
  /** Fraction per second that temperatures relax towards ambient. */
  ambientExchange: number;
  airDrag: number;
  wind: Vec;
  /** Rule-controllable world time multiplier (independent of the UI speed). */
  timeScale: number;
  /** Pairwise charge force constant; 0 disables charge interactions. */
  coulomb: number;
  chargeRange: number;
  particleCollisions: boolean;
  /** Degrees generated per unit of impact impulse per unit mass. */
  impactHeat: number;
  maxEntities: number;
  substeps: number;
  iterations: number;
  // rule engine safety
  instructionBudget: number;
  maxChainDepth: number;
  maxEventsPerStep: number;
}

export interface LogEntry {
  step: number;
  time: number;
  kind: 'rule' | 'signal' | 'create' | 'destroy' | 'state' | 'warn' | 'error' | 'info' | 'collision';
  text: string;
  ruleId?: string;
  entityId?: number;
  depth?: number;
}

export interface StepStats {
  stepMs: number;
  broadphaseMs: number;
  solveMs: number;
  rulesMs: number;
  pairs: number;
  contacts: number;
  collisionsBegun: number;
  ruleFires: number;
  instructions: number;
  budgetExceeded: boolean;
  chainDepthHits: number;
  cyclesBlocked: number;
  eventsDropped: number;
  spawnBlocked: number;
}

/** Plain JSON document describing a full world. */
export interface WorldDoc {
  format: 'reality-compiler/world';
  version: number;
  name: string;
  description: string;
  seed: number;
  rngState?: [number, number, number, number];
  time?: number;
  stepCount?: number;
  nextId?: number;
  settings: WorldSettings;
  materials: Material[];
  entities: EntityDoc[];
  joints: Joint[];
  fields: Field[];
  rules: Rule[];
  modules: RuleModule[];
  vars: Record<string, number>;
  /** Runtime state for exact continuation (optional; absent in hand-written files). */
  runtime?: {
    engine: import('./rules/engine').EngineStateDoc;
    contacts: number[];
    warm?: number[][];
    deferred: import('./rules/engine').EngineEvent[];
  };
}

export type EntityDoc = Omit<
  Entity,
  'normals' | 'invMass' | 'invInertia' | 'inertia' | 'fx' | 'fy' | 'torque' | 'prevTemp' | 'prevSpeed' | 'dead' | 'localTime'
> & { inertia?: number };
