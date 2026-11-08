import type { ActionTarget, ActionType, ConditionField, ConditionOp, ParamValue, TriggerType } from './types';

export type ParamKind = 'expr' | 'text' | 'material' | 'select' | 'color' | 'bool' | 'rule' | 'tag' | 'signal' | 'var' | 'field';

export interface ParamSpec {
  key: string;
  label: string;
  kind: ParamKind;
  default: ParamValue;
  options?: string[];
  hint?: string;
  /** Allow empty (e.g. "keep current"). */
  optional?: boolean;
}

export interface TriggerSpec {
  type: TriggerType;
  label: string;
  icon: string;
  describe: string;
  /** Whether `other` is meaningful for this trigger. */
  hasOther: boolean;
  /** Whether `self` is an entity (false for world timers). */
  hasSelf: boolean | 'param';
  params: ParamSpec[];
}

export const TRIGGERS: TriggerSpec[] = [
  {
    type: 'collision', label: 'Collision', icon: '✸', hasOther: true, hasSelf: true,
    describe: 'Two bodies start touching. Runs once with each body as self.',
    params: [{ key: 'minSpeed', label: 'min impact speed', kind: 'expr', default: '0', hint: 'px/s of approach' }],
  },
  {
    type: 'proximity', label: 'Proximity', icon: '◎', hasOther: true, hasSelf: true,
    describe: 'Another body comes within a distance of self (surface to surface).',
    params: [
      { key: 'radius', label: 'radius', kind: 'expr', default: '60' },
      { key: 'mode', label: 'mode', kind: 'select', default: 'enter', options: ['enter', 'while'], hint: 'enter = once per approach, while = every check' },
      { key: 'every', label: 'check every N steps', kind: 'expr', default: '2' },
    ],
  },
  {
    type: 'timer', label: 'Timer', icon: '◷', hasOther: false, hasSelf: 'param',
    describe: 'Fires on an interval, once for the world or once for every matching entity.',
    params: [
      { key: 'interval', label: 'interval (s)', kind: 'expr', default: '1', hint: '0 = every step' },
      { key: 'target', label: 'run for', kind: 'select', default: 'world', options: ['world', 'each'] },
    ],
  },
  { type: 'creation', label: 'Creation', icon: '✚', hasOther: false, hasSelf: true, describe: 'An entity comes into existence.', params: [] },
  {
    type: 'destruction', label: 'Destruction', icon: '✖', hasOther: false, hasSelf: true,
    describe: 'An entity is destroyed (self is still readable).', params: [],
  },
  {
    type: 'temperature', label: 'Temperature', icon: '♨', hasOther: false, hasSelf: true,
    describe: 'An entity’s temperature crosses a threshold.',
    params: [
      { key: 'threshold', label: 'threshold °', kind: 'expr', default: '300' },
      { key: 'direction', label: 'crossing', kind: 'select', default: 'above', options: ['above', 'below'] },
    ],
  },
  {
    type: 'velocity', label: 'Velocity', icon: '➶', hasOther: false, hasSelf: true,
    describe: 'An entity’s speed crosses a threshold.',
    params: [
      { key: 'threshold', label: 'speed px/s', kind: 'expr', default: '600' },
      { key: 'direction', label: 'crossing', kind: 'select', default: 'above', options: ['above', 'below'] },
    ],
  },
  {
    type: 'stateChange', label: 'State change', icon: '⇄', hasOther: false, hasSelf: true,
    describe: 'Material or phase changes (melting, igniting, transform action...).',
    params: [
      { key: 'to', label: 'to (material/state)', kind: 'text', default: '', optional: true, hint: 'blank = any' },
      { key: 'from', label: 'from (material/state)', kind: 'text', default: '', optional: true, hint: 'blank = any' },
    ],
  },
  {
    type: 'signal', label: 'Signal', icon: '⌁', hasOther: true, hasSelf: true,
    describe: 'Another rule emitted a named signal (event chains). Portals emit "portal:<name>".',
    params: [{ key: 'name', label: 'signal name', kind: 'signal', default: 'pulse' }],
  },
  {
    type: 'manual', label: 'Called', icon: '↳', hasOther: true, hasSelf: true,
    describe: 'Only runs when another rule calls it with “Trigger rule”, or from the editor.',
    params: [],
  },
];

export const TRIGGER_BY_TYPE = Object.fromEntries(TRIGGERS.map((t) => [t.type, t])) as Record<TriggerType, TriggerSpec>;

export interface ConditionFieldSpec {
  field: ConditionField;
  label: string;
  value: 'expr' | 'material' | 'tag' | 'color' | 'state' | 'kind' | 'shape' | 'none';
  ops: ConditionOp[];
  subjects: ('self' | 'other' | 'world')[];
}

const NUM_OPS: ConditionOp[] = ['>', '>=', '<', '<=', '==', '!='];

export const CONDITION_FIELDS: ConditionFieldSpec[] = [
  { field: 'material', label: 'material', value: 'material', ops: ['==', '!='], subjects: ['self', 'other'] },
  { field: 'tag', label: 'tag', value: 'tag', ops: ['has', 'lacks'], subjects: ['self', 'other'] },
  { field: 'mass', label: 'mass', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other'] },
  { field: 'speed', label: 'speed', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other'] },
  { field: 'temperature', label: 'temperature', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other'] },
  { field: 'color', label: 'colour', value: 'color', ops: ['==', '!=', 'near'], subjects: ['self', 'other'] },
  { field: 'x', label: 'x position', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other'] },
  { field: 'y', label: 'y position', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other'] },
  { field: 'radius', label: 'size (radius)', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other'] },
  { field: 'age', label: 'age (s)', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other'] },
  { field: 'charge', label: 'charge', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other'] },
  { field: 'state', label: 'phase', value: 'state', ops: ['==', '!='], subjects: ['self', 'other'] },
  { field: 'kind', label: 'kind', value: 'kind', ops: ['==', '!='], subjects: ['self', 'other'] },
  { field: 'shape', label: 'shape', value: 'shape', ops: ['==', '!='], subjects: ['self', 'other'] },
  { field: 'var', label: 'variable', value: 'expr', ops: NUM_OPS, subjects: ['self', 'other', 'world'] },
  { field: 'chance', label: 'random chance', value: 'expr', ops: ['<'], subjects: ['world'] },
  { field: 'expr', label: 'expression is true', value: 'expr', ops: ['=='], subjects: ['world'] },
];

export const CONDITION_BY_FIELD = Object.fromEntries(CONDITION_FIELDS.map((c) => [c.field, c])) as Record<ConditionField, ConditionFieldSpec>;

export const STATES = ['solid', 'liquid', 'gas', 'plasma', 'energy'];
export const KINDS = ['body', 'particle'];
export const SHAPES = ['circle', 'box', 'triangle', 'pentagon', 'hexagon', 'octagon', 'diamond', 'polygon'];

export interface ActionSpec {
  type: ActionType;
  label: string;
  icon: string;
  describe: string;
  /** Which targets make sense. 'world' actions ignore the target. */
  targets: ActionTarget[];
  params: ParamSpec[];
  /** Relative instruction cost (expression evaluation is added on top). */
  cost: number;
}

const ENTITY_TARGETS: ActionTarget[] = ['self', 'other', 'tagged'];

export const SET_PROPERTIES = [
  'temperature', 'mass', 'color', 'restitution', 'friction', 'vx', 'vy', 'av', 'charge', 'gravityScale', 'drag', 'lifetime', 'radius', 'static', 'collides',
];
export const ENV_PARAMS = ['gravityX', 'gravityY', 'ambientTemp', 'timeScale', 'windX', 'windY', 'airDrag', 'coulomb', 'impactHeat'];
export const FIELD_PROPS = ['strength', 'radius', 'angle', 'enabled', 'x', 'y'];
export const SPAWN_SHAPES = ['circle', 'box', 'triangle', 'hexagon', 'particle'];

export const ACTIONS: ActionSpec[] = [
  {
    type: 'force', label: 'Apply force', icon: '→', cost: 4, targets: ENTITY_TARGETS,
    describe: 'Adds an impulse (mass aware) or a direct velocity change.',
    params: [
      { key: 'fx', label: 'x', kind: 'expr', default: '0' },
      { key: 'fy', label: 'y', kind: 'expr', default: '-400' },
      { key: 'mode', label: 'mode', kind: 'select', default: 'velocity', options: ['velocity', 'impulse'], hint: 'velocity ignores mass' },
    ],
  },
  {
    type: 'push', label: 'Push', icon: '⇉', cost: 4, targets: ENTITY_TARGETS,
    describe: 'Pushes towards/away from the other party, along velocity, or at an angle.',
    params: [
      { key: 'strength', label: 'Δv px/s', kind: 'expr', default: '300' },
      { key: 'direction', label: 'direction', kind: 'select', default: 'away', options: ['away', 'toward', 'forward', 'backward', 'up', 'down', 'random', 'angle'] },
      { key: 'angle', label: 'angle (rad)', kind: 'expr', default: '0', hint: 'used when direction = angle' },
    ],
  },
  {
    type: 'teleport', label: 'Teleport', icon: '⌖', cost: 4, targets: ENTITY_TARGETS,
    describe: 'Moves the target to a position (absolute or relative).',
    params: [
      { key: 'x', label: 'x', kind: 'expr', default: 'rand(100, world.width - 100)' },
      { key: 'y', label: 'y', kind: 'expr', default: '80' },
      { key: 'relative', label: 'relative offset', kind: 'bool', default: false },
      { key: 'keepVelocity', label: 'keep velocity', kind: 'bool', default: true },
    ],
  },
  {
    type: 'transform', label: 'Transform', icon: '◈', cost: 6, targets: ENTITY_TARGETS,
    describe: 'Changes material, size and/or colour.',
    params: [
      { key: 'material', label: 'material', kind: 'material', default: '', optional: true },
      { key: 'scale', label: 'size ×', kind: 'expr', default: '1' },
      { key: 'color', label: 'colour', kind: 'color', default: '', optional: true },
    ],
  },
  {
    type: 'duplicate', label: 'Duplicate', icon: '⧉', cost: 20, targets: ENTITY_TARGETS,
    describe: 'Creates copies of the target (tags, vars and material included).',
    params: [
      { key: 'count', label: 'copies', kind: 'expr', default: '1' },
      { key: 'spread', label: 'offset px', kind: 'expr', default: 'self.radius * 2.2' },
      { key: 'kick', label: 'kick px/s', kind: 'expr', default: '120' },
      { key: 'scale', label: 'size ×', kind: 'expr', default: '1' },
    ],
  },
  { type: 'destroy', label: 'Destroy', icon: '✖', cost: 3, targets: ENTITY_TARGETS, describe: 'Removes the target.', params: [] },
  {
    type: 'setGravity', label: 'Change gravity', icon: '⇵', cost: 3, targets: ['world'],
    describe: 'Sets the world gravity vector.',
    params: [
      { key: 'gx', label: 'gx', kind: 'expr', default: 'world.gx' },
      { key: 'gy', label: 'gy', kind: 'expr', default: '-world.gy' },
    ],
  },
  {
    type: 'setProperty', label: 'Change property', icon: '✎', cost: 3, targets: ENTITY_TARGETS,
    describe: 'Sets, adds to or multiplies a property of the target.',
    params: [
      { key: 'property', label: 'property', kind: 'select', default: 'temperature', options: SET_PROPERTIES },
      { key: 'op', label: 'op', kind: 'select', default: 'set', options: ['set', 'add', 'multiply'] },
      { key: 'value', label: 'value', kind: 'expr', default: '500', hint: 'colour: use a #hex in the colour box' },
      { key: 'color', label: 'colour', kind: 'color', default: '', optional: true },
    ],
  },
  { type: 'addTag', label: 'Add tag', icon: '#', cost: 2, targets: ENTITY_TARGETS, describe: 'Adds a tag.', params: [{ key: 'tag', label: 'tag', kind: 'tag', default: 'marked' }] },
  { type: 'removeTag', label: 'Remove tag', icon: '⌫', cost: 2, targets: ENTITY_TARGETS, describe: 'Removes a tag.', params: [{ key: 'tag', label: 'tag', kind: 'tag', default: 'marked' }] },
  {
    type: 'emitParticles', label: 'Emit particles', icon: '⁂', cost: 12, targets: ENTITY_TARGETS,
    describe: 'Sprays short-lived particles from the target.',
    params: [
      { key: 'count', label: 'count', kind: 'expr', default: '8' },
      { key: 'speed', label: 'speed', kind: 'expr', default: 'rand(120, 320)' },
      { key: 'material', label: 'material', kind: 'material', default: 'spark' },
      { key: 'life', label: 'life (s)', kind: 'expr', default: 'rand(0.4, 1.2)' },
      { key: 'size', label: 'size', kind: 'expr', default: '2.5' },
      { key: 'color', label: 'colour', kind: 'color', default: '', optional: true },
    ],
  },
  {
    type: 'spawn', label: 'Spawn object', icon: '✦', cost: 20, targets: ['self', 'world'],
    describe: 'Creates new bodies (position expressions default to the self position).',
    params: [
      { key: 'material', label: 'material', kind: 'material', default: 'rubber' },
      { key: 'shape', label: 'shape', kind: 'select', default: 'circle', options: SPAWN_SHAPES },
      { key: 'size', label: 'size', kind: 'expr', default: '12' },
      { key: 'x', label: 'x', kind: 'expr', default: 'self.x' },
      { key: 'y', label: 'y', kind: 'expr', default: 'self.y - 40' },
      { key: 'vx', label: 'vx', kind: 'expr', default: 'rand(-100, 100)' },
      { key: 'vy', label: 'vy', kind: 'expr', default: '0' },
      { key: 'count', label: 'count', kind: 'expr', default: '1' },
      { key: 'tag', label: 'tag', kind: 'tag', default: '', optional: true },
    ],
  },
  {
    type: 'explode', label: 'Explode', icon: '✺', cost: 15, targets: ENTITY_TARGETS,
    describe: 'Radial impulse + heat around the target (chain reactions).',
    params: [
      { key: 'radius', label: 'radius', kind: 'expr', default: '160' },
      { key: 'strength', label: 'Δv at centre', kind: 'expr', default: '900' },
      { key: 'heat', label: 'heat °', kind: 'expr', default: '0' },
    ],
  },
  {
    type: 'connect', label: 'Connect', icon: '⟷', cost: 6, targets: ['self'],
    describe: 'Links self and other with a joint (bonds, molecules, chains).',
    params: [
      { key: 'stiffness', label: 'stiffness 0-1', kind: 'expr', default: '0.6' },
      { key: 'length', label: 'length', kind: 'expr', default: 'self.radius + other.radius + 4' },
      { key: 'breakImpulse', label: 'break impulse', kind: 'expr', default: '0', hint: '0 = unbreakable' },
      { key: 'maxLinks', label: 'max links each', kind: 'expr', default: '3' },
    ],
  },
  {
    type: 'triggerRule', label: 'Trigger rule', icon: '↳', cost: 4, targets: ['self', 'other', 'world'],
    describe: 'Immediately runs another rule (event chain, depth limited).',
    params: [{ key: 'rule', label: 'rule', kind: 'rule', default: '' }],
  },
  {
    type: 'emitSignal', label: 'Emit signal', icon: '⌁', cost: 3, targets: ['self', 'other', 'world'],
    describe: 'Broadcasts a named signal; Signal-triggered rules react to it.',
    params: [{ key: 'name', label: 'signal', kind: 'signal', default: 'pulse' }],
  },
  {
    type: 'setVar', label: 'Set variable', icon: '𝑥', cost: 2, targets: ['world', 'self', 'other'],
    describe: 'World target = global variable ($name), entity target = per-entity variable (self.$name).',
    params: [
      { key: 'name', label: 'name', kind: 'var', default: 'counter' },
      { key: 'op', label: 'op', kind: 'select', default: 'add', options: ['set', 'add', 'multiply', 'min', 'max'] },
      { key: 'value', label: 'value', kind: 'expr', default: '1' },
    ],
  },
  {
    type: 'setEnvironment', label: 'Environment', icon: '☁', cost: 3, targets: ['world'],
    describe: 'Changes world-wide physics: ambient temperature, wind, time scale, drag...',
    params: [
      { key: 'param', label: 'parameter', kind: 'select', default: 'ambientTemp', options: ENV_PARAMS },
      { key: 'op', label: 'op', kind: 'select', default: 'set', options: ['set', 'add', 'multiply'] },
      { key: 'value', label: 'value', kind: 'expr', default: '20' },
    ],
  },
  {
    type: 'setField', label: 'Modify field', icon: '◉', cost: 3, targets: ['world'],
    describe: 'Changes a named field (well, portal, zone...).',
    params: [
      { key: 'field', label: 'field name', kind: 'field', default: '' },
      { key: 'property', label: 'property', kind: 'select', default: 'strength', options: FIELD_PROPS },
      { key: 'op', label: 'op', kind: 'select', default: 'multiply', options: ['set', 'add', 'multiply'] },
      { key: 'value', label: 'value', kind: 'expr', default: '-1' },
    ],
  },
  {
    type: 'log', label: 'Log message', icon: '✉', cost: 2, targets: ['world'],
    describe: 'Writes to the event inspector. {expr} is interpolated, e.g. {self.temp}.',
    params: [{ key: 'message', label: 'message', kind: 'text', default: 'hello from {self.id}' }],
  },
];

export const ACTION_BY_TYPE = Object.fromEntries(ACTIONS.map((a) => [a.type, a])) as Record<ActionType, ActionSpec>;

export function defaultParams(specs: ParamSpec[]): Record<string, ParamValue> {
  return Object.fromEntries(specs.map((p) => [p.key, p.default]));
}
