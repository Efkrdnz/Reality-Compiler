import { HEX_COLOR } from '../math';
import { ACTION_BY_TYPE, CONDITION_BY_FIELD, TRIGGER_BY_TYPE, type ParamSpec } from './catalog';
import { compile, FORBIDDEN_NAMES } from './expr';
import type { Rule } from './types';

export interface RuleIssue {
  ruleId: string;
  level: 'error' | 'warning';
  /** e.g. "trigger.radius", "conditions[1]", "actions[0].fx" */
  path: string;
  message: string;
}

export interface ValidationContext {
  materials: Set<string>;
  ruleIds: Set<string>;
  fieldNames: Set<string>;
}

function checkParam(rule: Rule, path: string, spec: ParamSpec, value: unknown, ctx: ValidationContext, out: RuleIssue[], hasSelf: boolean, hasOther: boolean): void {
  const issue = (level: RuleIssue['level'], message: string) => out.push({ ruleId: rule.id, level, path, message });
  if (value === undefined || value === null || value === '') {
    if (!spec.optional && spec.kind !== 'bool' && spec.kind !== 'text') issue('error', `${spec.label} is required`);
    return;
  }
  switch (spec.kind) {
    case 'expr': {
      const c = compile(value as string | number);
      if (!c.ok) {
        issue('error', `${spec.label}: ${c.error} (at ${c.pos})`);
        return;
      }
      if (c.usesOther && !hasOther) issue('warning', `${spec.label} uses other.* but this trigger has no other body (it reads 0)`);
      if (c.usesSelf && !hasSelf) issue('warning', `${spec.label} uses self.* but this rule runs for the world (it reads 0)`);
      break;
    }
    case 'material':
      if (!ctx.materials.has(String(value))) issue('error', `unknown material “${value}”`);
      break;
    case 'color':
      if (!HEX_COLOR.test(String(value))) issue('error', `${spec.label} must be a hex colour like #ff00aa`);
      break;
    case 'select':
      if (spec.options && !spec.options.includes(String(value))) issue('error', `${spec.label} must be one of ${spec.options.join(', ')}`);
      break;
    case 'rule':
      if (!ctx.ruleIds.has(String(value))) issue('error', `references a rule that doesn't exist (${value})`);
      else if (value === rule.id) issue('warning', 'calls itself — recursion is depth-limited and cycle-protected, so it stops after one pass');
      break;
    case 'field':
      if (!ctx.fieldNames.has(String(value))) issue('warning', `no field named “${value}” exists right now`);
      break;
    case 'tag':
    case 'signal':
    case 'var':
      if (!/^[\w:.-]{1,40}$/.test(String(value))) issue('error', `${spec.label} may only use letters, digits, _ - : . (max 40)`);
      else if (FORBIDDEN_NAMES.has(String(value))) issue('error', `“${value}” is a reserved name`);
      break;
  }
}

export function validateRule(rule: Rule, ctx: ValidationContext): RuleIssue[] {
  const out: RuleIssue[] = [];
  const t = TRIGGER_BY_TYPE[rule.trigger?.type];
  if (!t) {
    out.push({ ruleId: rule.id, level: 'error', path: 'trigger', message: `unknown trigger “${rule.trigger?.type}”` });
    return out;
  }
  const isWorldTimer = rule.trigger.type === 'timer' && rule.trigger.params.target !== 'each';
  const hasSelf = t.hasSelf === true || (t.hasSelf === 'param' && !isWorldTimer);
  const hasOther = t.hasOther;
  for (const p of t.params) checkParam(rule, `trigger.${p.key}`, p, rule.trigger.params[p.key] ?? p.default, ctx, out, hasSelf, hasOther);

  rule.conditions.forEach((c, i) => {
    const path = `conditions[${i}]`;
    const spec = CONDITION_BY_FIELD[c.field];
    if (!spec) {
      out.push({ ruleId: rule.id, level: 'error', path, message: `unknown condition field “${c.field}”` });
      return;
    }
    if (!spec.ops.includes(c.op)) out.push({ ruleId: rule.id, level: 'error', path, message: `operator ${c.op} doesn't apply to ${spec.label}` });
    if (c.subject === 'other' && !hasOther)
      out.push({ ruleId: rule.id, level: 'warning', path, message: `checks “other”, but ${t.label} triggers have no other body — never true` });
    if (c.subject === 'self' && !hasSelf)
      out.push({ ruleId: rule.id, level: 'warning', path, message: 'checks “self”, but this rule runs for the world — never true' });
    if (spec.value === 'expr') {
      const cmp = compile(c.value);
      if (!cmp.ok) out.push({ ruleId: rule.id, level: 'error', path, message: `${spec.label}: ${cmp.error}` });
    } else if (spec.value === 'material' && !ctx.materials.has(c.value)) {
      out.push({ ruleId: rule.id, level: 'error', path, message: `unknown material “${c.value}”` });
    } else if (spec.value === 'color' && !HEX_COLOR.test(c.value)) {
      out.push({ ruleId: rule.id, level: 'error', path, message: 'colour must be a hex value like #33ffaa' });
    } else if (spec.value === 'tag' && !c.value) {
      out.push({ ruleId: rule.id, level: 'error', path, message: 'tag is required' });
    }
    if (c.field === 'var' && !c.key) out.push({ ruleId: rule.id, level: 'error', path, message: 'variable name is required' });
    if (c.field === 'var' && c.key && FORBIDDEN_NAMES.has(c.key)) out.push({ ruleId: rule.id, level: 'error', path, message: `“${c.key}” is a reserved name` });
  });

  if (!rule.actions.length) out.push({ ruleId: rule.id, level: 'warning', path: 'actions', message: 'rule has no actions' });
  rule.actions.forEach((a, i) => {
    const spec = ACTION_BY_TYPE[a.type];
    const path = `actions[${i}]`;
    if (!spec) {
      out.push({ ruleId: rule.id, level: 'error', path, message: `unknown action “${a.type}”` });
      return;
    }
    if (!spec.targets.includes(a.target) && !(spec.targets.length === 1 && spec.targets[0] === 'world')) {
      out.push({ ruleId: rule.id, level: 'error', path, message: `${spec.label} can't target “${a.target}”` });
    }
    if (a.target === 'other' && !hasOther) out.push({ ruleId: rule.id, level: 'warning', path, message: `targets “other”, but ${t.label} triggers have no other body` });
    if (a.target === 'self' && !hasSelf && spec.targets[0] !== 'world')
      out.push({ ruleId: rule.id, level: 'warning', path, message: 'targets “self”, but this rule runs for the world' });
    if (a.target === 'tagged' && !a.tag) out.push({ ruleId: rule.id, level: 'error', path, message: 'choose a tag for “tagged” targets' });
    if (a.type === 'connect' && !hasOther) out.push({ ruleId: rule.id, level: 'error', path, message: 'Connect needs a trigger with another body (collision, proximity, signal)' });
    for (const p of spec.params) {
      checkParam(rule, `${path}.${p.key}`, p, a.params[p.key] ?? p.default, ctx, out, hasSelf, hasOther);
    }
  });

  if (!(rule.priority >= -1000 && rule.priority <= 1000)) out.push({ ruleId: rule.id, level: 'error', path: 'priority', message: 'priority must be between -1000 and 1000' });
  if (!(rule.cooldown >= 0)) out.push({ ruleId: rule.id, level: 'error', path: 'cooldown', message: 'cooldown must be ≥ 0' });
  if (!(rule.maxPerStep >= 1)) out.push({ ruleId: rule.id, level: 'error', path: 'maxPerStep', message: 'max fires per step must be ≥ 1' });
  return out;
}

export function validateRules(rules: Rule[], ctx: Omit<ValidationContext, 'ruleIds'>): RuleIssue[] {
  const ruleIds = new Set(rules.map((r) => r.id));
  const out: RuleIssue[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.id)) out.push({ ruleId: r.id, level: 'error', path: 'id', message: `duplicate rule id ${r.id}` });
    seen.add(r.id);
    out.push(...validateRule(r, { ...ctx, ruleIds }));
  }
  out.push(...detectStaticCycles(rules));
  return out;
}

/**
 * Static call-graph analysis: rules that call each other through
 * "Trigger rule" or signals form loops. They are allowed (the runtime cuts
 * them off) but users should know.
 */
export function detectStaticCycles(rules: Rule[]): RuleIssue[] {
  const edges = buildRuleGraph(rules);
  const out: RuleIssue[] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const reported = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const to of edges.get(id) ?? []) {
      const st = state.get(to) ?? 0;
      if (st === 0) visit(to);
      else if (st === 1) {
        const cycle = stack.slice(stack.indexOf(to));
        const key = [...cycle].sort().join('>');
        if (!reported.has(key)) {
          reported.add(key);
          const names = cycle.map((c) => rules.find((r) => r.id === c)?.name ?? c);
          out.push({
            ruleId: to,
            level: 'warning',
            path: 'chain',
            message: `event loop: ${[...names, names[0]].join(' → ')} (runtime cycle protection will cut it)`,
          });
        }
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const r of rules) if ((state.get(r.id) ?? 0) === 0) visit(r.id);
  return out;
}

/** rule id -> rule ids it can directly cause (trigger rule / signals). */
export function buildRuleGraph(rules: Rule[]): Map<string, string[]> {
  const bySignal = new Map<string, string[]>();
  for (const r of rules) {
    if (r.enabled && r.trigger.type === 'signal') {
      const n = String(r.trigger.params.name ?? '');
      bySignal.set(n, [...(bySignal.get(n) ?? []), r.id]);
    }
  }
  const edges = new Map<string, string[]>();
  for (const r of rules) {
    if (!r.enabled) continue;
    const to: string[] = [];
    for (const a of r.actions) {
      if (a.type === 'triggerRule' && a.params.rule) to.push(String(a.params.rule));
      if (a.type === 'emitSignal') to.push(...(bySignal.get(String(a.params.name ?? '')) ?? []));
    }
    edges.set(r.id, Array.from(new Set(to)));
  }
  return edges;
}
