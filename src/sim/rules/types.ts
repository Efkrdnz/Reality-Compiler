/**
 * Rule data model. Rules are pure data (JSON-serialisable); they are
 * interpreted by the rule engine with an instruction budget. User supplied
 * numbers are written in a small safe expression language (see expr.ts).
 */

export type TriggerType =
  | 'collision'
  | 'proximity'
  | 'timer'
  | 'creation'
  | 'destruction'
  | 'temperature'
  | 'velocity'
  | 'stateChange'
  | 'signal'
  | 'manual';

export type ConditionField =
  | 'material'
  | 'mass'
  | 'color'
  | 'x'
  | 'y'
  | 'speed'
  | 'tag'
  | 'temperature'
  | 'state'
  | 'radius'
  | 'age'
  | 'kind'
  | 'shape'
  | 'charge'
  | 'var'
  | 'chance'
  | 'expr';

export type ConditionOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'has' | 'lacks' | 'near';

export type Subject = 'self' | 'other' | 'world';

export interface Condition {
  subject: Subject;
  field: ConditionField;
  op: ConditionOp;
  /** Literal string (material/tag/colour/state) or expression source (numbers). */
  value: string;
  /** Variable name for field === 'var'. */
  key?: string;
}

export type ActionType =
  | 'force'
  | 'push'
  | 'teleport'
  | 'transform'
  | 'duplicate'
  | 'destroy'
  | 'setGravity'
  | 'setProperty'
  | 'addTag'
  | 'removeTag'
  | 'emitParticles'
  | 'spawn'
  | 'explode'
  | 'connect'
  | 'triggerRule'
  | 'emitSignal'
  | 'setVar'
  | 'setEnvironment'
  | 'setField'
  | 'log';

export type ActionTarget = 'self' | 'other' | 'tagged' | 'world';

export type ParamValue = string | number | boolean;

export interface Action {
  type: ActionType;
  target: ActionTarget;
  /** Tag used when target === 'tagged'. */
  tag?: string;
  params: Record<string, ParamValue>;
}

export interface Trigger {
  type: TriggerType;
  params: Record<string, ParamValue>;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** Higher runs first. */
  priority: number;
  trigger: Trigger;
  conditionMode: 'all' | 'any';
  conditions: Condition[];
  actions: Action[];
  /** Seconds between firings (0 = no cooldown). */
  cooldown: number;
  cooldownScope: 'entity' | 'global';
  /** When this rule fires, lower priority rules for the same event are skipped. */
  consume: boolean;
  /** Hard cap on firings per step, protects against floods. */
  maxPerStep: number;
  /** Optional module label (rules installed from a module share it). */
  module?: string;
  notes?: string;
}

export interface RuleModule {
  id: string;
  name: string;
  description: string;
  rules: Rule[];
  /** Materials the module depends on (installed alongside). */
  materials?: import('../types').Material[];
  builtin?: boolean;
}
