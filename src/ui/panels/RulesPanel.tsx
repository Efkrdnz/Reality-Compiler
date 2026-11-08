import { useEffect, useMemo, useRef, useState } from 'react';
import { act, cloneRule, defaultCondition, instantiateModule, rule as makeRule, ruleId } from '../../sim/rules/build';
import {
  ACTION_BY_TYPE,
  ACTIONS,
  CONDITION_BY_FIELD,
  CONDITION_FIELDS,
  KINDS,
  SHAPES,
  STATES,
  TRIGGER_BY_TYPE,
  TRIGGERS,
  defaultParams,
  type ParamSpec,
} from '../../sim/rules/catalog';
import { TEMPLATE_MODULES } from '../../sim/rules/templates';
import type { Action, ActionTarget, ActionType, Condition, ConditionField, ParamValue, Rule, RuleModule, TriggerType } from '../../sim/rules/types';
import { buildRuleGraph, type RuleIssue } from '../../sim/rules/validate';
import { exportRules, importRules } from '../actions';
import { ExprInput, NumberInput, Section, TextInput, Toggle } from '../components/controls';
import { Icons } from '../icons';
import { sim, useSimVersion, useTick } from '../sim';
import { useUI } from '../store';

const NAME_RE = /^[\w:.-]{1,40}$/;

function mutateRule(id: string, fn: (r: Rule) => void, label = 'edit rule'): void {
  sim.commit(label);
  const w = sim.world;
  w.rules = w.rules.map((r) => {
    if (r.id !== id) return r;
    const c = structuredClone(r);
    fn(c);
    return c;
  });
  sim.rulesChanged();
}

/** Autocomplete lists for tags, signals and variables (rendered once at app level). */
export function Datalists() {
  const w = sim.world;
  const tags = new Set<string>();
  for (const e of w.entities) for (const t of e.tags) tags.add(t);
  for (const m of w.materials.values()) for (const t of m.tags) tags.add(t);
  const signals = new Set<string>();
  const vars = new Set<string>(Object.keys(w.vars));
  for (const r of w.rules) {
    if (r.trigger.type === 'signal') signals.add(String(r.trigger.params.name));
    for (const a of r.actions) {
      if (a.type === 'emitSignal') signals.add(String(a.params.name));
      if (a.type === 'setVar') vars.add(String(a.params.name));
      if ((a.type === 'addTag' || a.type === 'removeTag') && a.params.tag) tags.add(String(a.params.tag));
      if (a.tag) tags.add(a.tag);
    }
    for (const c of r.conditions) if (c.field === 'tag') tags.add(c.value);
  }
  for (const f of w.fields) if (f.kind === 'portal') signals.add(`portal:${f.name}`);
  return (
    <>
      <datalist id="dl-tags">{[...tags].sort().map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="dl-signals">{[...signals].sort().map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="dl-vars">{[...vars].sort().map((t) => <option key={t} value={t} />)}</datalist>
    </>
  );
}

// ------------------------------------------------------------------- param inputs

function ParamInput({ spec, value, onChange, rule }: { spec: ParamSpec; value: ParamValue | undefined; onChange: (v: ParamValue) => void; rule: Rule }) {
  const w = sim.world;
  const v = value ?? spec.default;
  switch (spec.kind) {
    case 'expr':
      return <ExprInput value={String(v)} onChange={onChange} />;
    case 'bool':
      return (
        <div style={{ height: 24, display: 'flex', alignItems: 'center' }}>
          <Toggle value={!!v} onChange={onChange} />
        </div>
      );
    case 'select':
      return (
        <select className="input" value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {spec.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'material':
      return (
        <select className="input" value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {spec.optional && <option value="">— keep —</option>}
          {[...w.materials.values()].map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      );
    case 'color':
      return (
        <div className="flex">
          <input type="color" value={String(v) || '#ffffff'} onChange={(e) => onChange(e.target.value)} />
          <TextInput value={String(v)} onChange={onChange} placeholder={spec.optional ? 'keep' : '#hex'} className="mono grow" pattern={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i} />
        </div>
      );
    case 'rule':
      return (
        <select className={`input ${!w.rules.some((r) => r.id === v) ? 'error' : ''}`} value={String(v)} onChange={(e) => onChange(e.target.value)}>
          <option value="">— choose rule —</option>
          {w.rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id === rule.id ? '↻ ' : ''}
              {r.name}
            </option>
          ))}
        </select>
      );
    case 'field':
      return (
        <select className="input" value={String(v)} onChange={(e) => onChange(e.target.value)}>
          <option value="">— choose field —</option>
          {w.fields.map((f) => (
            <option key={f.id} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      );
    case 'tag':
      return <TextInput value={String(v)} onChange={onChange} list="dl-tags" className="mono" pattern={NAME_RE} placeholder={spec.optional ? 'none' : 'tag'} />;
    case 'signal':
      return <TextInput value={String(v)} onChange={onChange} list="dl-signals" className="mono" pattern={NAME_RE} />;
    case 'var':
      return <TextInput value={String(v)} onChange={onChange} list="dl-vars" className="mono" pattern={NAME_RE} />;
    default:
      return <TextInput value={String(v)} onChange={onChange} placeholder={spec.hint} />;
  }
}

// ------------------------------------------------------------------- condition row

function ConditionRow({ c, rule, idx }: { c: Condition; rule: Rule; idx: number }) {
  const spec = CONDITION_BY_FIELD[c.field];
  const set = (fn: (c: Condition) => void) => mutateRule(rule.id, (r) => fn(r.conditions[idx]));
  const valueInput = () => {
    switch (spec?.value) {
      case 'material':
        return (
          <select className="input" value={c.value} onChange={(e) => set((x) => (x.value = e.target.value))}>
            {[...sim.world.materials.values()].map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        );
      case 'state':
      case 'kind':
      case 'shape': {
        const opts = spec.value === 'state' ? STATES : spec.value === 'kind' ? KINDS : SHAPES;
        return (
          <select className="input" value={c.value} onChange={(e) => set((x) => (x.value = e.target.value))}>
            {opts.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        );
      }
      case 'tag':
        return <TextInput value={c.value} onChange={(v) => set((x) => (x.value = v))} list="dl-tags" className="mono" pattern={NAME_RE} />;
      case 'color':
        return (
          <div className="flex">
            <input type="color" value={c.value} onChange={(e) => set((x) => (x.value = e.target.value))} />
          </div>
        );
      default:
        return <ExprInput value={c.value} onChange={(v) => set((x) => (x.value = v))} className="grow" />;
    }
  };
  return (
    <div className="line" data-testid="condition-row">
      {c.field !== 'chance' && c.field !== 'expr' && (
        <select className="input" value={c.subject} onChange={(e) => set((x) => (x.subject = e.target.value as Condition['subject']))}>
          {(spec?.subjects ?? ['self']).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      <select
        className="input"
        value={c.field}
        onChange={(e) =>
          set((x) => {
            const d = defaultCondition(e.target.value as ConditionField);
            const ns = CONDITION_BY_FIELD[d.field];
            Object.assign(x, d, { subject: ns.subjects.includes(x.subject) ? x.subject : d.subject });
          })
        }
      >
        {CONDITION_FIELDS.map((f) => (
          <option key={f.field} value={f.field}>
            {f.label}
          </option>
        ))}
      </select>
      {c.field === 'var' && <TextInput value={c.key ?? ''} onChange={(v) => set((x) => (x.key = v))} list="dl-vars" className="mono w80" pattern={NAME_RE} placeholder="name" />}
      {c.field !== 'expr' && (
        <select className="input" value={c.op} onChange={(e) => set((x) => (x.op = e.target.value as Condition['op']))} style={{ width: 'auto' }}>
          {(spec?.ops ?? ['==']).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
      <div className="grow" style={{ minWidth: 90, display: 'flex' }}>
        {valueInput()}
      </div>
      <button className="btn sm icon danger" title="Remove condition" onClick={() => mutateRule(rule.id, (r) => r.conditions.splice(idx, 1))}>
        ×
      </button>
    </div>
  );
}

// ------------------------------------------------------------------- action block

function ActionBlock({ a, rule, idx }: { a: Action; rule: Rule; idx: number }) {
  const spec = ACTION_BY_TYPE[a.type];
  const set = (fn: (a: Action) => void, label?: string) => mutateRule(rule.id, (r) => fn(r.actions[idx]), label);
  const targets: ActionTarget[] = spec?.targets ?? ['self'];
  return (
    <div className="action-block" data-testid="action-block">
      <div className="action-head">
        <span className="ico">{spec?.icon}</span>
        <select
          className="input"
          value={a.type}
          onChange={(e) =>
            set((x) => {
              const ns = ACTION_BY_TYPE[e.target.value as ActionType];
              x.type = ns.type;
              x.params = defaultParams(ns.params);
              if (!ns.targets.includes(x.target)) x.target = ns.targets[0];
            })
          }
          style={{ flex: 1 }}
        >
          {ACTIONS.map((s) => (
            <option key={s.type} value={s.type}>
              {s.label}
            </option>
          ))}
        </select>
        {!(targets.length === 1 && targets[0] === 'world') && (
          <>
            <span className="word">on</span>
            <select className="input" value={a.target} onChange={(e) => set((x) => (x.target = e.target.value as ActionTarget))}>
              {targets.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </>
        )}
        {a.target === 'tagged' && <TextInput value={a.tag ?? ''} onChange={(v) => set((x) => (x.tag = v))} list="dl-tags" className="mono w80" pattern={NAME_RE} placeholder="tag" />}
        <button className="btn sm icon" title="Move up" disabled={idx === 0} onClick={() => mutateRule(rule.id, (r) => r.actions.splice(idx - 1, 0, r.actions.splice(idx, 1)[0]))}>
          ↑
        </button>
        <button className="btn sm icon danger" title="Remove action" onClick={() => mutateRule(rule.id, (r) => r.actions.splice(idx, 1))}>
          ×
        </button>
      </div>
      {spec && spec.params.length > 0 && (
        <div className="params">
          {spec.params.map((p) => (
            <label key={p.key} className="param" title={p.hint}>
              <span>
                {p.label}
                {p.hint ? ' ·' : ''} {p.hint && <i style={{ opacity: 0.6 }}>{p.hint}</i>}
              </span>
              <ParamInput spec={p} value={a.params[p.key]} rule={rule} onChange={(v) => set((x) => (x.params[p.key] = v))} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- rule card

function RuleCard({ rule, issues, open, onToggle, firing, focused }: { rule: Rule; issues: RuleIssue[]; open: boolean; onToggle: () => void; firing: number; focused: boolean }) {
  const t = TRIGGER_BY_TYPE[rule.trigger.type];
  const hasErr = issues.some((i) => i.level === 'error');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);
  const total = sim.world.engine.totalFires(rule.id);
  const summary = `${t?.label ?? rule.trigger.type}${rule.conditions.length ? ` · ${rule.conditions.length} condition${rule.conditions.length > 1 ? 's' : ''}` : ''} → ${rule.actions.map((a) => ACTION_BY_TYPE[a.type]?.label ?? a.type).join(', ') || 'nothing'}`;
  return (
    <div ref={ref} className={`rule ${rule.enabled ? '' : 'disabled'} ${hasErr ? 'has-error' : ''} ${firing ? 'firing' : ''} ${focused ? 'focused' : ''}`} data-testid="rule-card">
      <div className="rule-head" onClick={onToggle}>
        <span className="trig-chip" title={t?.describe}>
          {t?.icon ?? '?'}
        </span>
        <div className="rule-name">
          {rule.name || 'Unnamed rule'}
          <small>
            {rule.module ? `[${rule.module}] ` : ''}
            {summary}
          </small>
        </div>
        {hasErr && <span className="chip warn" title="This rule has errors and is skipped">error</span>}
        <span className="prio" title="Priority (higher runs first)">
          P{rule.priority}
        </span>
        <span className={`fire-led ${firing ? 'on' : ''}`} title="Fired this step" />
        <span className="count" title="Total firings">
          {total}
        </span>
        <span onClick={(e) => e.stopPropagation()}>
          <Toggle value={rule.enabled} onChange={(v) => mutateRule(rule.id, (r) => (r.enabled = v), 'toggle rule')} title="Enable / disable" />
        </span>
      </div>
      {open && (
        <div className="rule-body">
          <div className="row" style={{ marginBottom: 10 }}>
            <TextInput value={rule.name} onChange={(v) => mutateRule(rule.id, (r) => (r.name = v.slice(0, 80)))} className="grow" placeholder="Rule name" />
          </div>

          <div className="clause">
            <div className="clause-label">
              <span className="k when">WHEN</span>
              <select
                className="input"
                value={rule.trigger.type}
                data-testid="trigger-select"
                onChange={(e) =>
                  mutateRule(rule.id, (r) => {
                    const ns = TRIGGER_BY_TYPE[e.target.value as TriggerType];
                    r.trigger = { type: ns.type, params: defaultParams(ns.params) };
                  })
                }
                style={{ letterSpacing: 0, fontFamily: 'var(--ui)', fontWeight: 400 }}
              >
                {TRIGGERS.map((tt) => (
                  <option key={tt.type} value={tt.type}>
                    {tt.icon} {tt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="hint" style={{ marginBottom: 6 }}>
              {t?.describe}
            </div>
            {t && t.params.length > 0 && (
              <div className="params">
                {t.params.map((p) => (
                  <label key={p.key} className="param" title={p.hint}>
                    <span>{p.label}</span>
                    <ParamInput spec={p} value={rule.trigger.params[p.key]} rule={rule} onChange={(v) => mutateRule(rule.id, (r) => (r.trigger.params[p.key] = v))} />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="clause">
            <div className="clause-label">
              <span className="k if">IF</span>
              {rule.conditions.length > 1 && (
                <select className="input" value={rule.conditionMode} onChange={(e) => mutateRule(rule.id, (r) => (r.conditionMode = e.target.value as 'all' | 'any'))} style={{ letterSpacing: 0, fontFamily: 'var(--ui)', fontWeight: 400 }}>
                  <option value="all">all of these hold</option>
                  <option value="any">any of these holds</option>
                </select>
              )}
              {rule.conditions.length === 0 && <span className="muted" style={{ letterSpacing: 0, fontWeight: 400, fontFamily: 'var(--ui)' }}>always</span>}
            </div>
            {rule.conditions.map((c, i) => (
              <ConditionRow key={i} c={c} rule={rule} idx={i} />
            ))}
            <button className="addbtn" onClick={() => mutateRule(rule.id, (r) => r.conditions.push(defaultCondition(t?.hasOther ? 'material' : 'tag')))} data-testid="add-condition">
              + condition
            </button>
          </div>

          <div className="clause">
            <div className="clause-label">
              <span className="k then">THEN</span>
            </div>
            {rule.actions.map((a, i) => (
              <ActionBlock key={i} a={a} rule={rule} idx={i} />
            ))}
            <select
              className="addbtn"
              value=""
              data-testid="add-action"
              onChange={(e) => {
                const type = e.target.value as ActionType;
                if (!type) return;
                const s = ACTION_BY_TYPE[type];
                mutateRule(rule.id, (r) => r.actions.push(act(type, s.targets[0])));
              }}
            >
              <option value="">+ action…</option>
              {ACTIONS.map((s) => (
                <option key={s.type} value={s.type}>
                  {s.icon} {s.label} — {s.describe}
                </option>
              ))}
            </select>
          </div>

          <div className="clause">
            <div className="clause-label">
              <span className="k opts">OPTIONS</span>
            </div>
            <div className="params">
              <label className="param" title="Higher priority rules run first for the same event">
                <span>priority</span>
                <NumberInput value={rule.priority} onChange={(v) => mutateRule(rule.id, (r) => (r.priority = Math.round(v)))} min={-1000} max={1000} digits={0} />
              </label>
              <label className="param" title="Minimum seconds between firings">
                <span>cooldown (s)</span>
                <NumberInput value={rule.cooldown} onChange={(v) => mutateRule(rule.id, (r) => (r.cooldown = v))} min={0} max={3600} step={0.1} />
              </label>
              <label className="param">
                <span>cooldown per</span>
                <select className="input" value={rule.cooldownScope} onChange={(e) => mutateRule(rule.id, (r) => (r.cooldownScope = e.target.value as 'entity' | 'global'))}>
                  <option value="entity">entity</option>
                  <option value="global">whole rule</option>
                </select>
              </label>
              <label className="param" title="Safety cap on firings per step">
                <span>max fires / step</span>
                <NumberInput value={rule.maxPerStep} onChange={(v) => mutateRule(rule.id, (r) => (r.maxPerStep = Math.max(1, Math.round(v))))} min={1} max={100000} digits={0} />
              </label>
              <label className="param" title="If this rule fires, lower-priority rules don't see the same event">
                <span>consume event</span>
                <div style={{ height: 24, display: 'flex', alignItems: 'center' }}>
                  <Toggle value={rule.consume} onChange={(v) => mutateRule(rule.id, (r) => (r.consume = v))} />
                </div>
              </label>
              <label className="param">
                <span>module label</span>
                <TextInput value={rule.module ?? ''} onChange={(v) => mutateRule(rule.id, (r) => (r.module = v || undefined))} placeholder="none" />
              </label>
            </div>
            <textarea
              className="input"
              style={{ width: '100%', marginTop: 6, minHeight: 32 }}
              placeholder="Notes…"
              defaultValue={rule.notes ?? ''}
              onBlur={(e) => e.target.value !== (rule.notes ?? '') && mutateRule(rule.id, (r) => (r.notes = e.target.value.slice(0, 2000)))}
            />
          </div>

          {issues.length > 0 && (
            <div className="issues">
              {issues.map((i, k) => (
                <div key={k} className={`issue ${i.level}`}>
                  <span>{i.level === 'error' ? '⛔' : '⚠'}</span>
                  <span>
                    <code>{i.path}</code> {i.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex wrap" style={{ marginTop: 10 }}>
            <button
              className="btn sm"
              title="Run this rule now (self = selected entity)"
              onClick={() => {
                sim.world.engine.fireManually(sim.world, rule.id, useUI.getState().selectedId);
                if (!sim.running) sim.step(1);
              }}
            >
              ⚡ Fire now
            </button>
            <button
              className="btn sm"
              onClick={() => {
                sim.commit('duplicate rule');
                const w = sim.world;
                const i = w.rules.findIndex((r) => r.id === rule.id);
                const c = cloneRule(rule);
                w.rules = [...w.rules.slice(0, i + 1), c, ...w.rules.slice(i + 1)];
                sim.rulesChanged();
              }}
            >
              Duplicate
            </button>
            <button
              className="btn sm"
              disabled={sim.world.rules[0]?.id === rule.id}
              onClick={() => {
                sim.commit('reorder rules');
                const w = sim.world;
                const i = w.rules.findIndex((r) => r.id === rule.id);
                const arr = [...w.rules];
                arr.splice(i - 1, 0, arr.splice(i, 1)[0]);
                w.rules = arr;
                sim.rulesChanged();
              }}
            >
              ↑ Move up
            </button>
            <div className="spacer" />
            <button
              className="btn sm danger"
              onClick={() => {
                sim.commit('delete rule');
                sim.world.rules = sim.world.rules.filter((r) => r.id !== rule.id);
                sim.rulesChanged();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- chain graph

const TRIG_COLORS: Partial<Record<TriggerType, string>> = {
  collision: '#00f0ff',
  proximity: '#8a7bff',
  timer: '#ffe066',
  creation: '#7dff4f',
  destruction: '#ff4f6a',
  temperature: '#ff7a1a',
  velocity: '#ff3df2',
  stateChange: '#ffb020',
  signal: '#34fff1',
  manual: '#a9b8d8',
};

function ChainGraph({ rules, fired, onPick }: { rules: Rule[]; fired: Map<string, number>; onPick: (id: string) => void }) {
  const edges = useMemo(() => buildRuleGraph(rules), [rules]);
  const W = 360;
  const H = 190;
  const n = rules.length;
  const pos = new Map<string, { x: number; y: number }>();
  rules.forEach((r, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    const R = n <= 1 ? 0 : Math.min(W, H) * 0.36;
    pos.set(r.id, { x: W / 2 + Math.cos(a) * R * 1.45, y: H / 2 + Math.sin(a) * R });
  });
  return (
    <svg className="graph" viewBox={`0 0 ${W} ${H}`} height={H}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#7af7ff" />
        </marker>
      </defs>
      {[...edges].flatMap(([from, tos]) =>
        tos.map((to) => {
          const a = pos.get(from);
          const b = pos.get(to);
          if (!a || !b) return null;
          if (from === to)
            return <circle key={`${from}-${to}`} cx={a.x} cy={a.y - 12} r={8} fill="none" stroke="#ff4f6a" strokeDasharray="2 2" />;
          return <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(122,247,255,0.45)" strokeWidth={1.2} markerEnd="url(#arr)" />;
        }),
      )}
      {rules.map((r) => {
        const p = pos.get(r.id)!;
        const c = TRIG_COLORS[r.trigger.type] ?? '#fff';
        const f = fired.get(r.id) ?? 0;
        return (
          <g key={r.id} onClick={() => onPick(r.id)} style={{ cursor: 'pointer' }} opacity={r.enabled ? 1 : 0.35}>
            {f > 0 && <circle cx={p.x} cy={p.y} r={13} fill={c} opacity={0.25} />}
            <circle cx={p.x} cy={p.y} r={7} fill="#05070d" stroke={c} strokeWidth={f > 0 ? 2.5 : 1.5} />
            <text x={p.x} y={p.y + 19} textAnchor="middle" fontSize={8.5} fill="#a9b8d8" fontFamily="Space Grotesk">
              {r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name}
            </text>
          </g>
        );
      })}
      {n === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="#46557a" fontSize={11}>
          no rules yet
        </text>
      )}
    </svg>
  );
}

// ------------------------------------------------------------------- module library

function ModuleLibrary() {
  const w = sim.world;
  const [name, setName] = useState('');
  const userModules = w.modules.filter((m) => !m.builtin);
  const install = (m: RuleModule) => {
    sim.commit('install module');
    for (const mat of m.materials ?? []) if (!w.materials.has(mat.id)) w.setMaterial(mat);
    w.rules = [...w.rules, ...instantiateModule(m)];
    sim.rulesChanged();
    useUI.getState().toast({ kind: 'ok', title: `Installed “${m.name}” (${m.rules.length} rules)` });
  };
  return (
    <>
      <Section title="Templates">
        {TEMPLATE_MODULES.map((m) => (
          <div key={m.id} className="module-card">
            <div style={{ flex: 1 }}>
              <h4>{m.name}</h4>
              <p>{m.description}</p>
              <p className="mono" style={{ marginTop: 4, color: 'var(--dim)' }}>
                {m.rules.map((r) => TRIGGER_BY_TYPE[r.trigger.type]?.icon + ' ' + r.name).join('  ·  ')}
              </p>
            </div>
            <button className="btn sm primary" onClick={() => install(m)} data-testid={`install-${m.id}`}>
              Install
            </button>
          </div>
        ))}
      </Section>
      <Section title="Your modules">
        <div className="flex" style={{ marginBottom: 8 }}>
          <input className="input grow" placeholder="Module name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <button
            className="btn sm"
            disabled={!name.trim() || !w.rules.length}
            title="Package all current rules into a reusable module"
            onClick={() => {
              sim.commit('save module');
              w.modules = [...w.modules, { id: ruleId('mod'), name: name.trim(), description: `${w.rules.length} rules saved from “${w.name}”`, rules: structuredClone(w.rules) }];
              setName('');
              sim.touch();
              useUI.getState().toast({ kind: 'ok', title: `Saved module “${name.trim()}”` });
            }}
          >
            Save current rules
          </button>
        </div>
        {userModules.length === 0 && <div className="hint">Modules are reusable bundles of rules. Save the current rule set to reuse it in other universes (modules are stored in world & rules exports).</div>}
        {userModules.map((m) => (
          <div key={m.id} className="module-card">
            <div style={{ flex: 1 }}>
              <h4>{m.name}</h4>
              <p>{m.description}</p>
            </div>
            <div className="col">
              <button className="btn sm primary" onClick={() => install(m)}>
                Install
              </button>
              <button
                className="btn sm danger"
                onClick={() => {
                  sim.commit('delete module');
                  w.modules = w.modules.filter((x) => x.id !== m.id);
                  sim.touch();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- panel

export function RulesPanel() {
  useSimVersion();
  useTick(5);
  const w = sim.world;
  const { focusRuleId, focusRule, wideSide, setWide } = useUI();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'rules' | 'library'>('rules');
  const [showGraph, setShowGraph] = useState(true);
  const [filter, setFilter] = useState('');
  const engine = w.engine;
  // validation runs lazily in the engine; make sure issues reflect the latest edit even while paused
  engine.prepare(w);
  const issues = engine.issues;
  useEffect(() => {
    if (focusRuleId) setOpen((s) => new Set(s).add(focusRuleId));
  }, [focusRuleId]);
  const byRule = new Map<string, RuleIssue[]>();
  for (const i of issues) byRule.set(i.ruleId, [...(byRule.get(i.ruleId) ?? []), i]);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warning').length;
  const chainIssues = issues.filter((i) => i.path === 'chain');
  const fired = engine.firedLastStep;
  const shown = w.rules.filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()) || r.trigger.type.includes(filter.toLowerCase()));

  const addRule = (type: TriggerType) => {
    sim.commit('add rule');
    const t = TRIGGER_BY_TYPE[type];
    const r = makeRule(`New ${t.label.toLowerCase()} rule`, type, {}, {
      actions: [type === 'timer' ? act('log', 'world', { message: 'tick at t={world.time}' }) : act('emitParticles', 'self')],
    });
    w.rules = [...w.rules, r];
    sim.rulesChanged();
    setOpen((s) => new Set(s).add(r.id));
    focusRule(r.id);
  };

  return (
    <div>
      <div className="flex wrap" style={{ marginBottom: 12 }}>
        <button className={`btn sm ${view === 'rules' ? 'active' : ''}`} onClick={() => setView('rules')}>
          Program ({w.rules.length})
        </button>
        <button className={`btn sm ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')} data-testid="btn-library">
          Templates & modules
        </button>
        <div className="spacer" />
        <button className="btn sm icon" title={wideSide ? 'Narrow panel' : 'Widen panel'} onClick={() => setWide(!wideSide)}>
          <span style={{ width: 13, height: 13, display: 'grid' }}>{wideSide ? Icons.shrink : Icons.expand}</span>
        </button>
        <button className="btn sm" title="Export rules as JSON" onClick={exportRules}>
          Export
        </button>
        <button className="btn sm" title="Import rules from JSON (appends)" onClick={() => importRules('append')}>
          Import
        </button>
      </div>

      {view === 'library' ? (
        <ModuleLibrary />
      ) : (
        <>
          <Section
            title="Event chains"
            right={
              <button className="btn sm" onClick={() => setShowGraph(!showGraph)}>
                {showGraph ? 'hide' : 'show'}
              </button>
            }
          >
            {showGraph && <ChainGraph rules={w.rules} fired={fired} onPick={(id) => focusRule(id)} />}
            <div className="hint" style={{ marginTop: 6 }}>
              Arrows show “Trigger rule” calls and signals. Loops are allowed — depth limit ({w.settings.maxChainDepth}), per-chain cycle detection and the instruction budget ({w.settings.instructionBudget.toLocaleString()}/step) keep them safe.
            </div>
            {chainIssues.map((i, k) => (
              <div key={k} className="issue warning" style={{ marginTop: 6 }}>
                ↻ {i.message}
              </div>
            ))}
          </Section>

          <Section
            title="Rules"
            right={
              <span className="flex">
                {errors > 0 && <span className="chip warn">{errors} errors</span>}
                {warns > 0 && <span className="chip" style={{ color: 'var(--amber)' }}>{warns} warnings</span>}
                {errors === 0 && warns === 0 && w.rules.length > 0 && <span className="chip ok">valid</span>}
              </span>
            }
          >
            <div className="flex" style={{ marginBottom: 8 }}>
              <select
                className="input grow"
                value=""
                onChange={(e) => e.target.value && addRule(e.target.value as TriggerType)}
                data-testid="new-rule"
                style={{ borderColor: 'rgba(0,240,255,0.4)', color: 'var(--cyan)' }}
              >
                <option value="">＋ New rule — choose a trigger…</option>
                {TRIGGERS.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.icon} When: {t.label} — {t.describe}
                  </option>
                ))}
              </select>
              <input className="input" placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 90 }} />
            </div>
            {w.rules.length === 0 && (
              <div className="empty">
                <b>No laws of nature beyond physics.</b>
                <br />
                Create a rule above, or install one from <a style={{ color: 'var(--cyan)', cursor: 'pointer' }} onClick={() => setView('library')}>Templates</a>.
              </div>
            )}
            {shown.map((r) => (
              <RuleCard
                key={r.id}
                rule={r}
                issues={(byRule.get(r.id) ?? []).filter((i) => i.path !== 'chain')}
                open={open.has(r.id)}
                firing={fired.get(r.id) ?? 0}
                focused={focusRuleId === r.id}
                onToggle={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    return n;
                  })
                }
              />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
