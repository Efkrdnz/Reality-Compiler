import { ACTION_BY_TYPE, CONDITION_BY_FIELD, TRIGGER_BY_TYPE, defaultParams } from './catalog';
import type { Action, ActionTarget, ActionType, Condition, ConditionField, ConditionOp, ParamValue, Rule, RuleModule, Subject, TriggerType } from './types';

let seq = 0;
export function ruleId(prefix = 'r'): string {
  seq = (seq + 1) % 1e9;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export interface RuleOpts {
  id?: string;
  priority?: number;
  conditions?: Condition[];
  actions?: Action[];
  cooldown?: number;
  cooldownScope?: 'entity' | 'global';
  consume?: boolean;
  maxPerStep?: number;
  conditionMode?: 'all' | 'any';
  enabled?: boolean;
  notes?: string;
  module?: string;
}

export function rule(name: string, trigger: TriggerType, tparams: Record<string, ParamValue> = {}, o: RuleOpts = {}): Rule {
  const spec = TRIGGER_BY_TYPE[trigger];
  return {
    id: o.id ?? ruleId(),
    name,
    enabled: o.enabled ?? true,
    priority: o.priority ?? 0,
    trigger: { type: trigger, params: { ...defaultParams(spec.params), ...tparams } },
    conditionMode: o.conditionMode ?? 'all',
    conditions: o.conditions ?? [],
    actions: o.actions ?? [],
    cooldown: o.cooldown ?? 0,
    cooldownScope: o.cooldownScope ?? 'entity',
    consume: o.consume ?? false,
    maxPerStep: o.maxPerStep ?? 500,
    module: o.module,
    notes: o.notes,
  };
}

export function cond(subject: Subject, field: ConditionField, op: ConditionOp, value: string | number, key?: string): Condition {
  return { subject, field, op, value: String(value), ...(key ? { key } : {}) };
}

export function act(type: ActionType, target: ActionTarget = 'self', params: Record<string, ParamValue> = {}, tag?: string): Action {
  const spec = ACTION_BY_TYPE[type];
  return { type, target, params: { ...defaultParams(spec.params), ...params }, ...(tag ? { tag } : {}) };
}

export function defaultCondition(field: ConditionField = 'material'): Condition {
  const spec = CONDITION_BY_FIELD[field];
  const value =
    spec.value === 'material' ? 'stone' : spec.value === 'tag' ? 'marked' : spec.value === 'color' ? '#ff00aa' : spec.value === 'state' ? 'solid' : spec.value === 'kind' ? 'body' : spec.value === 'shape' ? 'circle' : field === 'chance' ? '0.5' : field === 'expr' ? 'self.speed > 100' : '0';
  return { subject: spec.subjects[0], field, op: spec.ops[0], value, ...(field === 'var' ? { key: 'counter' } : {}) };
}

/** Copies module rules with fresh ids, remapping internal "trigger rule" references. */
export function instantiateModule(mod: RuleModule): Rule[] {
  const map = new Map<string, string>();
  for (const r of mod.rules) map.set(r.id, ruleId('m'));
  return mod.rules.map((r) => {
    const copy: Rule = structuredClone(r);
    copy.id = map.get(r.id)!;
    copy.module = mod.name;
    for (const a of copy.actions) {
      if (a.type === 'triggerRule' && typeof a.params.rule === 'string' && map.has(a.params.rule)) a.params.rule = map.get(a.params.rule)!;
    }
    return copy;
  });
}

export function cloneRule(r: Rule): Rule {
  const c = structuredClone(r);
  c.id = ruleId();
  c.name = `${r.name} copy`;
  return c;
}
