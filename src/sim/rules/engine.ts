import { scaleShape, setMass, type ShapeSpec } from '../entity';
import { colorDistance, HEX_COLOR } from '../math';
import type { Entity } from '../types';
import type { World } from '../world';
import { ACTION_BY_TYPE } from './catalog';
import { BudgetExceeded, compile, evaluate, FORBIDDEN_NAMES, readVar, type ExprEnv } from './expr';
import type { Action, Condition, ParamValue, Rule, TriggerType } from './types';
import { validateRules, type RuleIssue } from './validate';

export interface ChainCtx {
  /** "<ruleId>:<entityId>" pairs that already fired in this chain. */
  visited: Set<string>;
  root: string;
}

export type EngineEvent =
  | { type: 'collision'; a: number; b: number; x: number; y: number; relSpeed: number; impulse: number; depth: number }
  | { type: 'creation'; id: number; depth: number }
  | { type: 'destruction'; id: number; depth: number; cause: string }
  | { type: 'stateChange'; id: number; fromMat: string; toMat: string; fromState: string; toState: string; depth: number; cause: string }
  | { type: 'signal'; name: string; source?: number; other?: number; depth: number; chain?: ChainCtx }
  | { type: 'manual'; ruleId: string; self?: number; other?: number; depth: number; chain?: ChainCtx };

export interface EngineStateDoc {
  rules: Record<
    string,
    { nextTimer: number; globalReady: number; entityReady: [number, number][]; proxPrev: number[]; proxCounter: number; totalFires: number }
  >;
}

interface RuleState {
  nextTimer: number;
  firesThisStep: number;
  globalReady: number;
  entityReady: Map<number, number>;
  proxPrev: Set<number>;
  proxCounter: number;
  totalFires: number;
}

interface FireCtx {
  self: Entity | null;
  other: Entity | null;
  event: ExprEnv['event'];
  depth: number;
  chain: ChainCtx;
}

/** Visual-only effects requested by rules (renderer consumes and clears). */
export interface FxEvent {
  kind: 'shockwave' | 'flash' | 'link' | 'signal';
  x: number;
  y: number;
  r: number;
  color: string;
  x2?: number;
  y2?: number;
}

const RULE_LOG_PER_STEP = 30;
const MAX_TAGGED_TARGETS = 400;
const MAX_SPAWN_PER_ACTION = 64;

export class RuleEngine {
  state = new Map<string, RuleState>();
  issues: RuleIssue[] = [];
  /** Rules with at least one error are skipped at runtime. */
  broken = new Set<string>();
  private validatedVersion = -1;
  private byTrigger = new Map<TriggerType, Rule[]>();
  private byId = new Map<string, Rule>();
  private world!: World;
  private budget = { left: 0 };
  private logsThisStep = 0;
  private suppressedLogs = 0;
  private warnedThisStep = new Set<string>();
  fx: FxEvent[] = [];
  /** Per rule firing counts for the last step (inspector heat map). */
  firedLastStep = new Map<string, number>();
  version = 0;

  /** Call whenever rules/materials/fields change so validation re-runs. */
  invalidate(): void {
    this.version++;
  }

  reset(): void {
    this.state.clear();
    this.fx.length = 0;
    this.firedLastStep.clear();
    this.invalidate();
  }

  /** Validates and indexes rules if anything changed since the last call. */
  prepare(world: World): void {
    if (this.validatedVersion === this.version) return;
    this.validatedVersion = this.version;
    this.issues = validateRules(world.rules, {
      materials: new Set(world.materials.keys()),
      fieldNames: new Set(world.fields.map((f) => f.name)),
    });
    this.broken = new Set(this.issues.filter((i) => i.level === 'error').map((i) => i.ruleId));
    this.byTrigger.clear();
    this.byId.clear();
    const sorted = world.rules
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.priority - a.r.priority || a.i - b.i)
      .map((x) => x.r);
    for (const r of sorted) {
      this.byId.set(r.id, r);
      if (!r.enabled || this.broken.has(r.id)) continue;
      const list = this.byTrigger.get(r.trigger.type) ?? [];
      list.push(r);
      this.byTrigger.set(r.trigger.type, list);
    }
    for (const id of [...this.state.keys()]) if (!this.byId.has(id)) this.state.delete(id);
  }

  private st(rule: Rule): RuleState {
    let s = this.state.get(rule.id);
    if (!s) {
      s = { nextTimer: -1, firesThisStep: 0, globalReady: 0, entityReady: new Map(), proxPrev: new Set(), proxCounter: 0, totalFires: 0 };
      this.state.set(rule.id, s);
    }
    return s;
  }

  // -------------------------------------------------------------- env

  private env(ctx: FireCtx): ExprEnv {
    const w = this.world;
    return {
      self: ctx.self,
      other: ctx.other,
      event: ctx.event,
      world: (p) => {
        switch (p) {
          case 'time': return w.time;
          case 'step': return w.stepCount;
          case 'count': return w.liveCount;
          case 'gx': return w.settings.gravity.x;
          case 'gy': return w.settings.gravity.y;
          case 'ambient': return w.settings.ambientTemp;
          case 'timeScale': return w.settings.timeScale;
          case 'width': return w.settings.width;
          case 'height': return w.settings.height;
          case 'windX': return w.settings.wind.x;
          case 'windY': return w.settings.wind.y;
          case 'dt': return 1 / 60;
        }
        return 0;
      },
      global: (n) => readVar(w.vars, n),
      count: (tag) => {
        this.budget.left -= 10;
        let n = 0;
        for (const e of w.entities) if (!e.dead && (!tag || e.tags.includes(tag))) n++;
        return n;
      },
      countMat: (mat) => {
        this.budget.left -= 10;
        let n = 0;
        for (const e of w.entities) if (!e.dead && e.material === mat) n++;
        return n;
      },
      random: () => w.rng.next(),
      budget: this.budget,
    };
  }

  private num(src: ParamValue | undefined, ctx: FireCtx, fallback = 0): number {
    if (src === undefined || src === '') return fallback;
    if (typeof src === 'number') return src;
    if (typeof src === 'boolean') return src ? 1 : 0;
    const c = compile(src);
    if (!c.ok) return fallback;
    if (c.constant) return (c.ast as { v: number }).v;
    const v = evaluate(c.ast, this.env(ctx));
    return Number.isFinite(v) ? v : fallback;
  }

  private param(action: Action, key: string): ParamValue | undefined {
    const v = action.params[key];
    if (v !== undefined) return v;
    return ACTION_BY_TYPE[action.type]?.params.find((p) => p.key === key)?.default;
  }

  // -------------------------------------------------------------- main loop

  run(world: World, dt: number): void {
    this.world = world;
    this.prepare(world);
    const s = world.settings;
    this.budget.left = Math.max(100, s.instructionBudget);
    this.logsThisStep = 0;
    this.suppressedLogs = 0;
    this.warnedThisStep.clear();
    this.firedLastStep.clear();
    for (const st of this.state.values()) st.firesThisStep = 0;
    const stats = world.stats;

    try {
      this.runTimers(dt);
      this.runPolled();
      const queue = world.events;
      let processed = 0;
      for (let qi = 0; qi < queue.length; qi++) {
        if (processed++ >= s.maxEventsPerStep) {
          stats.eventsDropped += queue.length - qi;
          this.warn('events', `event queue overflow: ${queue.length - qi} events dropped this step (max ${s.maxEventsPerStep})`);
          break;
        }
        if (this.budget.left <= 0) throw new BudgetExceeded();
        this.dispatch(queue[qi]);
      }
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        stats.budgetExceeded = true;
        this.warn('budget', `instruction budget (${s.instructionBudget}) exhausted — remaining rule work skipped this step`);
      } else {
        world.addLog('error', `rule engine error: ${(e as Error).message}`);
      }
    }
    world.events = [];
    stats.instructions = Math.max(0, s.instructionBudget - this.budget.left);
    if (this.suppressedLogs > 0) world.addLog('rule', `… ${this.suppressedLogs} more rule firings this step (log throttled)`);
  }

  private warn(key: string, text: string): void {
    if (this.warnedThisStep.has(key)) return;
    this.warnedThisStep.add(key);
    // do not flood the log with the same warning every step
    const last = this.world.log[this.world.log.length - 1];
    if (last && last.text === text && this.world.stepCount - last.step < 120) return;
    this.world.addLog('warn', text);
  }

  private newChain(root: string): ChainCtx {
    return { visited: new Set(), root };
  }

  private runTimers(dt: number): void {
    const list = this.byTrigger.get('timer');
    if (!list) return;
    const w = this.world;
    for (const rule of list) {
      const st = this.st(rule);
      const base: FireCtx = { self: null, other: null, event: {}, depth: 0, chain: this.newChain(rule.id) };
      const interval = Math.max(0, this.num(rule.trigger.params.interval, base, 1));
      if (st.nextTimer < 0) st.nextTimer = w.time + interval;
      if (w.time + dt * 0.5 < st.nextTimer && interval > 0) continue;
      if (dt <= 0 && interval > 0) continue;
      st.nextTimer = interval > 0 ? Math.max(st.nextTimer + interval, w.time) : w.time;
      if (rule.trigger.params.target === 'each') {
        const snapshot = w.entities.slice();
        for (const e of snapshot) {
          if (e.dead) continue;
          this.fire(rule, { self: e, other: null, event: {}, depth: 0, chain: this.newChain(rule.id) });
        }
      } else {
        this.fire(rule, base);
      }
    }
  }

  private runPolled(): void {
    const w = this.world;
    const temp = this.byTrigger.get('temperature');
    const vel = this.byTrigger.get('velocity');
    if (temp || vel) {
      const snapshot = w.entities.slice();
      for (const e of snapshot) {
        if (e.dead) continue;
        const speed = Math.hypot(e.vx, e.vy);
        if (temp)
          for (const rule of temp) {
            const ctx: FireCtx = { self: e, other: null, event: {}, depth: 0, chain: this.newChain(rule.id) };
            const thr = this.num(rule.trigger.params.threshold, ctx, 300);
            const up = rule.trigger.params.direction !== 'below';
            if (up ? e.prevTemp < thr && e.temperature >= thr : e.prevTemp > thr && e.temperature <= thr) this.fire(rule, ctx);
          }
        if (vel)
          for (const rule of vel) {
            const ctx: FireCtx = { self: e, other: null, event: {}, depth: 0, chain: this.newChain(rule.id) };
            const thr = this.num(rule.trigger.params.threshold, ctx, 600);
            const up = rule.trigger.params.direction !== 'below';
            if (up ? e.prevSpeed < thr && speed >= thr : e.prevSpeed > thr && speed <= thr) this.fire(rule, ctx);
          }
      }
    }
    const prox = this.byTrigger.get('proximity');
    if (prox) for (const rule of prox) this.runProximity(rule);
  }

  private runProximity(rule: Rule): void {
    const w = this.world;
    const st = this.st(rule);
    const base: FireCtx = { self: null, other: null, event: {}, depth: 0, chain: this.newChain(rule.id) };
    const every = Math.max(1, Math.round(this.num(rule.trigger.params.every, base, 2)));
    if (st.proxCounter++ % every !== 0) return;
    const radius = Math.max(0, this.num(rule.trigger.params.radius, base, 60));
    const enter = rule.trigger.params.mode !== 'while';
    const selfConds = rule.conditionMode === 'all' ? rule.conditions.filter((c) => c.subject !== 'other') : [];
    const otherConds = rule.conditionMode === 'all' ? rule.conditions.filter((c) => c.subject === 'other') : [];
    const now = new Set<number>();
    const snapshot = w.entities.slice();
    for (const e of snapshot) {
      if (e.dead) continue;
      const pre: FireCtx = { self: e, other: null, event: {}, depth: 0, chain: base.chain };
      if (selfConds.length && !selfConds.every((c) => this.condition(c, pre))) continue;
      const near: Entity[] = [];
      w.queryCircle(e.x, e.y, e.radius + radius, (o) => {
        if (o === e || o.dead) return;
        const d = Math.hypot(o.x - e.x, o.y - e.y) - e.radius - o.radius;
        if (d <= radius) near.push(o);
      });
      near.sort((a, b) => a.id - b.id);
      for (const o of near) {
        if (e.dead) break;
        if (o.dead) continue;
        if (otherConds.length && !otherConds.every((c) => this.condition(c, { ...pre, other: o }))) continue;
        const key = e.id * 67108864 + o.id;
        now.add(key);
        if (enter && st.proxPrev.has(key)) continue;
        const dist = Math.hypot(o.x - e.x, o.y - e.y);
        this.fire(rule, { self: e, other: o, event: { distance: dist, x: o.x, y: o.y }, depth: 0, chain: this.newChain(rule.id) });
      }
    }
    st.proxPrev = now;
  }

  private dispatch(ev: EngineEvent): void {
    const w = this.world;
    const s = w.settings;
    if (ev.depth > s.maxChainDepth) {
      w.stats.chainDepthHits++;
      this.warn('depth', `event chain exceeded max depth ${s.maxChainDepth} — further reactions cut off (recursion guard)`);
      return;
    }
    switch (ev.type) {
      case 'collision': {
        const list = this.byTrigger.get('collision');
        if (!list) return;
        const a = w.get(ev.a);
        const b = w.get(ev.b);
        if (!a || !b) return;
        const event = { impulse: ev.impulse, relSpeed: ev.relSpeed, x: ev.x, y: ev.y, depth: ev.depth };
        for (const [self, other] of [[a, b], [b, a]] as const) {
          for (const rule of list) {
            if (self.dead || other.dead) break;
            const ctx: FireCtx = { self, other, event, depth: ev.depth, chain: this.newChain(rule.id) };
            const min = this.num(rule.trigger.params.minSpeed, ctx, 0);
            if (ev.relSpeed < min) continue;
            if (this.fire(rule, ctx) && rule.consume) break;
          }
        }
        return;
      }
      case 'creation':
      case 'destruction': {
        const list = this.byTrigger.get(ev.type);
        if (!list) return;
        const e = w.byId.get(ev.id);
        if (!e) return;
        if (ev.type === 'creation' && e.dead) return;
        for (const rule of list) {
          const ctx: FireCtx = { self: e, other: null, event: { depth: ev.depth }, depth: ev.depth, chain: this.newChain(rule.id) };
          if (this.fire(rule, ctx) && rule.consume) break;
        }
        return;
      }
      case 'stateChange': {
        const list = this.byTrigger.get('stateChange');
        if (!list) return;
        const e = w.get(ev.id);
        if (!e) return;
        for (const rule of list) {
          const to = String(rule.trigger.params.to ?? '');
          const from = String(rule.trigger.params.from ?? '');
          if (to && to !== ev.toMat && to !== ev.toState) continue;
          if (from && from !== ev.fromMat && from !== ev.fromState) continue;
          const ctx: FireCtx = { self: e, other: null, event: { depth: ev.depth }, depth: ev.depth, chain: this.newChain(rule.id) };
          if (this.fire(rule, ctx) && rule.consume) break;
        }
        return;
      }
      case 'signal': {
        const list = this.byTrigger.get('signal');
        if (!list) return;
        const self = w.get(ev.source) ?? null;
        const other = w.get(ev.other) ?? null;
        for (const rule of list) {
          if (String(rule.trigger.params.name ?? '') !== ev.name) continue;
          const ctx: FireCtx = { self, other, event: { depth: ev.depth }, depth: ev.depth, chain: ev.chain ?? this.newChain(rule.id) };
          if (this.fire(rule, ctx) && rule.consume) break;
        }
        return;
      }
      case 'manual': {
        const rule = this.byId.get(ev.ruleId);
        if (!rule || !rule.enabled || this.broken.has(rule.id)) return;
        this.fire(rule, { self: w.get(ev.self) ?? null, other: w.get(ev.other) ?? null, event: { depth: ev.depth }, depth: ev.depth, chain: ev.chain ?? this.newChain(rule.id) });
        return;
      }
    }
  }

  /** Runs a rule from outside (editor "fire now" button). */
  fireManually(world: World, ruleId: string, selfId?: number): void {
    world.events.push({ type: 'manual', ruleId, self: selfId, depth: 0 });
  }

  // -------------------------------------------------------------- firing

  private fire(rule: Rule, ctx: FireCtx): boolean {
    const w = this.world;
    const st = this.st(rule);
    if (st.firesThisStep >= rule.maxPerStep) return false;
    this.budget.left -= 2;
    if (this.budget.left <= 0) throw new BudgetExceeded();

    // cooldowns
    if (rule.cooldown > 0) {
      if (rule.cooldownScope === 'global' || !ctx.self) {
        if (w.time < st.globalReady) return false;
      } else if (w.time < (st.entityReady.get(ctx.self.id) ?? -1)) return false;
    }

    if (!this.conditionsPass(rule, ctx)) return false;

    // cycle protection: the same rule may not fire twice for the same entity within one chain
    const key = `${rule.id}:${ctx.self?.id ?? 'w'}`;
    if (ctx.chain.visited.has(key)) {
      w.stats.cyclesBlocked++;
      this.warn(`cycle:${rule.id}`, `cycle blocked: “${rule.name}” would re-trigger itself for the same entity in one chain`);
      return false;
    }
    ctx.chain.visited.add(key);

    st.firesThisStep++;
    st.totalFires++;
    w.stats.ruleFires++;
    this.firedLastStep.set(rule.id, (this.firedLastStep.get(rule.id) ?? 0) + 1);
    if (rule.cooldown > 0) {
      if (rule.cooldownScope === 'global' || !ctx.self) st.globalReady = w.time + rule.cooldown;
      else {
        st.entityReady.set(ctx.self.id, w.time + rule.cooldown);
        if (st.entityReady.size > 5000) {
          for (const [id, t] of st.entityReady) if (t < w.time || !w.byId.has(id)) st.entityReady.delete(id);
        }
      }
    }
    if (this.logsThisStep < RULE_LOG_PER_STEP) {
      this.logsThisStep++;
      const who = ctx.self ? `#${ctx.self.id}${ctx.other ? ` ↔ #${ctx.other.id}` : ''}` : 'world';
      w.addLog('rule', `${rule.name} ⟶ ${who}`, { ruleId: rule.id, entityId: ctx.self?.id, depth: ctx.depth });
    } else this.suppressedLogs++;

    for (const action of rule.actions) {
      this.budget.left -= ACTION_BY_TYPE[action.type]?.cost ?? 4;
      if (this.budget.left <= 0) throw new BudgetExceeded();
      this.action(rule, action, ctx);
    }
    return true;
  }

  private conditionsPass(rule: Rule, ctx: FireCtx): boolean {
    if (!rule.conditions.length) return true;
    if (rule.conditionMode === 'any') return rule.conditions.some((c) => this.condition(c, ctx));
    return rule.conditions.every((c) => this.condition(c, ctx));
  }

  condition(c: Condition, ctx: FireCtx): boolean {
    this.budget.left -= 1;
    const w = this.world;
    if (c.field === 'chance') return w.rng.next() < this.num(c.value, ctx, 0);
    if (c.field === 'expr') return this.num(c.value, ctx, 0) !== 0;
    if (c.field === 'var' && c.subject === 'world') return cmpNum(readVar(w.vars, c.key ?? ''), c.op, this.num(c.value, ctx, 0));
    const e = c.subject === 'other' ? ctx.other : ctx.self;
    if (!e) return false;
    switch (c.field) {
      case 'material':
        return cmpStr(e.material, c.op, c.value);
      case 'state':
        return cmpStr(e.state, c.op, c.value);
      case 'kind':
        return cmpStr(e.kind, c.op, c.value);
      case 'shape':
        return cmpStr(c.value === 'polygon' ? (e.shape === 'poly' ? 'polygon' : 'circle') : e.shapeLabel, c.op, c.value);
      case 'tag': {
        const has = e.tags.includes(c.value);
        return c.op === 'lacks' || c.op === '!=' ? !has : has;
      }
      case 'color': {
        if (c.op === 'near') return colorDistance(e.color, c.value) < 90;
        const eq = e.color.toLowerCase() === c.value.toLowerCase();
        return c.op === '!=' ? !eq : eq;
      }
      case 'var':
        return cmpNum(readVar(e.vars, c.key ?? ''), c.op, this.num(c.value, ctx, 0));
      default: {
        const v =
          c.field === 'speed' ? Math.hypot(e.vx, e.vy) : c.field === 'temperature' ? e.temperature : (e as unknown as Record<string, number>)[c.field];
        return cmpNum(v ?? 0, c.op, this.num(c.value, ctx, 0));
      }
    }
  }

  private targets(action: Action, ctx: FireCtx): Entity[] {
    switch (action.target) {
      case 'self':
        return ctx.self && !ctx.self.dead ? [ctx.self] : [];
      case 'other':
        return ctx.other && !ctx.other.dead ? [ctx.other] : [];
      case 'tagged': {
        const out: Entity[] = [];
        const tag = action.tag ?? '';
        for (const e of this.world.entities) {
          if (!e.dead && e.tags.includes(tag)) {
            out.push(e);
            if (out.length >= MAX_TAGGED_TARGETS) break;
          }
        }
        this.budget.left -= out.length;
        return out;
      }
      default:
        return [];
    }
  }

  private action(rule: Rule, a: Action, ctx: FireCtx): void {
    const w = this.world;
    const P = (k: string) => this.param(a, k);
    const N = (k: string, fb = 0) => this.num(P(k), ctx, fb);
    const origin = `rule:${rule.id}`;
    switch (a.type) {
      case 'force': {
        const fx = N('fx');
        const fy = N('fy');
        const impulse = P('mode') === 'impulse';
        for (const t of this.targets(a, ctx)) {
          if (t.isStatic) continue;
          const k = impulse ? t.invMass : 1;
          t.vx += fx * k;
          t.vy += fy * k;
        }
        return;
      }
      case 'push': {
        const strength = N('strength', 300);
        const dir = String(P('direction'));
        for (const t of this.targets(a, ctx)) {
          if (t.isStatic) continue;
          let dx = 0;
          let dy = 0;
          const ref = t === ctx.self ? ctx.other : ctx.self;
          switch (dir) {
            case 'away':
            case 'toward': {
              if (!ref) continue;
              const ddx = t.x - ref.x;
              const ddy = t.y - ref.y;
              const d = Math.hypot(ddx, ddy) || 1;
              dx = ddx / d;
              dy = ddy / d;
              if (dir === 'toward') {
                dx = -dx;
                dy = -dy;
              }
              break;
            }
            case 'forward':
            case 'backward': {
              const sp = Math.hypot(t.vx, t.vy) || 1;
              dx = (t.vx / sp) * (dir === 'forward' ? 1 : -1);
              dy = (t.vy / sp) * (dir === 'forward' ? 1 : -1);
              break;
            }
            case 'up':
              dy = -1;
              break;
            case 'down':
              dy = 1;
              break;
            case 'random': {
              const ang = w.rng.next() * Math.PI * 2;
              dx = Math.cos(ang);
              dy = Math.sin(ang);
              break;
            }
            default: {
              const ang = N('angle');
              dx = Math.cos(ang);
              dy = Math.sin(ang);
            }
          }
          t.vx += dx * strength;
          t.vy += dy * strength;
        }
        return;
      }
      case 'teleport': {
        const x = N('x');
        const y = N('y');
        const rel = !!P('relative');
        const keep = P('keepVelocity') !== false;
        for (const t of this.targets(a, ctx)) {
          if (t.isStatic) continue;
          t.x = rel ? t.x + x : x;
          t.y = rel ? t.y + y : y;
          if (!keep) {
            t.vx = 0;
            t.vy = 0;
            t.av = 0;
          }
          t.portalCooldown = 0.1;
        }
        return;
      }
      case 'transform': {
        const mat = String(P('material') ?? '');
        const scale = N('scale', 1);
        const color = String(P('color') ?? '');
        for (const t of this.targets(a, ctx)) {
          if (mat) w.transform(t, mat, ctx.depth + 1, origin);
          if (scale !== 1 && scale > 0) scaleShape(t, scale, w.material(t.material).density);
          if (color && HEX_COLOR.test(color)) t.color = color;
        }
        return;
      }
      case 'duplicate': {
        const count = Math.min(MAX_SPAWN_PER_ACTION, Math.max(0, Math.round(N('count', 1))));
        const spread = N('spread', 20);
        const kick = N('kick', 100);
        const scale = N('scale', 1);
        for (const t of this.targets(a, ctx)) {
          for (let i = 0; i < count; i++) {
            this.budget.left -= 15;
            if (this.budget.left <= 0) throw new BudgetExceeded();
            const ang = w.rng.next() * Math.PI * 2;
            const shape: ShapeSpec | { type: 'poly'; verts: { x: number; y: number }[]; label: string } =
              t.shape === 'circle' ? { type: 'circle', radius: t.radius } : { type: 'poly', verts: t.verts, label: t.shapeLabel };
            const c = w.spawn({
              shape,
              kind: t.kind,
              x: t.x + Math.cos(ang) * spread,
              y: t.y + Math.sin(ang) * spread,
              vx: t.vx + Math.cos(ang) * kick,
              vy: t.vy + Math.sin(ang) * kick,
              angle: t.angle,
              material: t.material,
              color: t.color,
              tags: t.tags,
              temperature: t.temperature,
              origin,
            });
            if (!c) {
              this.warn('cap', `entity cap (${w.settings.maxEntities}) reached — spawning blocked`);
              return;
            }
            c.vars = { ...t.vars };
            c.charge = t.charge;
            c.gravityScale = t.gravityScale;
            if (t.lifetime >= 0) c.lifetime = t.lifetime;
            if (scale !== 1 && scale > 0) scaleShape(c, scale, w.material(c.material).density);
          }
        }
        return;
      }
      case 'destroy':
        for (const t of this.targets(a, ctx)) w.destroy(t, origin, ctx.depth + 1);
        return;
      case 'setGravity':
        w.settings.gravity = { x: N('gx', w.settings.gravity.x), y: N('gy', w.settings.gravity.y) };
        return;
      case 'setProperty': {
        const prop = String(P('property'));
        const op = String(P('op'));
        const val = N('value');
        const color = String(P('color') ?? '');
        for (const t of this.targets(a, ctx)) setProperty(w, t, prop, op, val, color);
        return;
      }
      case 'addTag':
      case 'removeTag': {
        const tag = String(P('tag') ?? '');
        if (!tag) return;
        for (const t of this.targets(a, ctx)) {
          const has = t.tags.includes(tag);
          if (a.type === 'addTag' && !has) t.tags.push(tag);
          if (a.type === 'removeTag' && has) t.tags = t.tags.filter((x) => x !== tag);
        }
        return;
      }
      case 'emitParticles': {
        const count = Math.min(MAX_SPAWN_PER_ACTION, Math.max(0, Math.round(N('count', 8))));
        const mat = String(P('material') || 'spark');
        const color = String(P('color') ?? '');
        for (const t of this.targets(a, ctx)) {
          for (let i = 0; i < count; i++) {
            this.budget.left -= 6;
            if (this.budget.left <= 0) throw new BudgetExceeded();
            const speed = N('speed', 200);
            const life = N('life', 0.8);
            const size = Math.max(0.8, Math.min(12, N('size', 2.5)));
            const ang = w.rng.next() * Math.PI * 2;
            const r = t.radius * 0.9;
            const p = w.spawn({
              shape: { type: 'circle', radius: size },
              kind: 'particle',
              x: t.x + Math.cos(ang) * r,
              y: t.y + Math.sin(ang) * r,
              vx: t.vx * 0.3 + Math.cos(ang) * speed,
              vy: t.vy * 0.3 + Math.sin(ang) * speed,
              material: mat,
              color: color && HEX_COLOR.test(color) ? color : undefined,
              origin,
              lifetime: life,
            });
            if (!p) {
              this.warn('cap', `entity cap (${w.settings.maxEntities}) reached — spawning blocked`);
              return;
            }
          }
        }
        return;
      }
      case 'spawn': {
        const count = Math.min(MAX_SPAWN_PER_ACTION, Math.max(0, Math.round(N('count', 1))));
        const mat = String(P('material') || 'rubber');
        const shapeName = String(P('shape') || 'circle');
        const tag = String(P('tag') ?? '');
        for (let i = 0; i < count; i++) {
          this.budget.left -= 15;
          if (this.budget.left <= 0) throw new BudgetExceeded();
          const size = Math.max(1, Math.min(400, N('size', 12)));
          const shape = shapeSpecFor(shapeName, size);
          const e = w.spawn({
            shape,
            kind: shapeName === 'particle' ? 'particle' : 'body',
            x: N('x', ctx.self?.x ?? w.settings.width / 2),
            y: N('y', ctx.self?.y ?? w.settings.height / 2),
            vx: N('vx'),
            vy: N('vy'),
            material: mat,
            tags: tag ? [tag] : [],
            origin,
          });
          if (!e) {
            this.warn('cap', `entity cap (${w.settings.maxEntities}) reached — spawning blocked`);
            return;
          }
        }
        return;
      }
      case 'explode': {
        const R = Math.max(1, N('radius', 160));
        const strength = N('strength', 900);
        const heat = N('heat', 0);
        for (const t of this.targets(a, ctx)) {
          const cx = t.x;
          const cy = t.y;
          this.fx.push({ kind: 'shockwave', x: cx, y: cy, r: R, color: t.color });
          w.queryCircle(cx, cy, R, (o) => {
            this.budget.left -= 1;
            if (o === t || o.isStatic) return;
            const dx = o.x - cx;
            const dy = o.y - cy;
            const d = Math.hypot(dx, dy) || 1;
            const f = Math.max(0, 1 - d / R);
            o.vx += (dx / d) * strength * f;
            o.vy += (dy / d) * strength * f;
            o.temperature += heat * f;
          });
        }
        return;
      }
      case 'connect': {
        const s = ctx.self;
        const o = ctx.other;
        if (!s || !o || s.dead || o.dead) return;
        const maxLinks = Math.round(N('maxLinks', 3));
        const links = (id: number) => w.joints.reduce((n, j) => n + (j.a === id || j.b === id ? 1 : 0), 0);
        if (maxLinks > 0 && (links(s.id) >= maxLinks || links(o.id) >= maxLinks)) return;
        const j = w.addJoint(s, o, {
          stiffness: Math.max(0, Math.min(1, N('stiffness', 0.6))),
          length: Math.max(1, N('length', Math.hypot(o.x - s.x, o.y - s.y))),
          breakImpulse: Math.max(0, N('breakImpulse', 0)),
          color: s.color,
        });
        if (j) this.fx.push({ kind: 'link', x: s.x, y: s.y, x2: o.x, y2: o.y, r: 0, color: s.color });
        return;
      }
      case 'triggerRule': {
        const target = this.byId.get(String(P('rule') ?? ''));
        if (!target || !target.enabled || this.broken.has(target.id)) return;
        if (ctx.depth + 1 > w.settings.maxChainDepth) {
          w.stats.chainDepthHits++;
          this.warn('depth', `event chain exceeded max depth ${w.settings.maxChainDepth} — further reactions cut off (recursion guard)`);
          return;
        }
        const self = a.target === 'other' ? ctx.other : a.target === 'world' ? null : ctx.self;
        const other = a.target === 'other' ? ctx.self : ctx.other;
        this.fire(target, { self, other, event: { ...ctx.event, depth: ctx.depth + 1 }, depth: ctx.depth + 1, chain: ctx.chain });
        return;
      }
      case 'emitSignal': {
        const name = String(P('name') ?? '');
        const self = a.target === 'other' ? ctx.other : a.target === 'world' ? null : ctx.self;
        const other = a.target === 'other' ? ctx.self : ctx.other;
        w.events.push({ type: 'signal', name, source: self?.id, other: other?.id, depth: ctx.depth + 1, chain: ctx.chain });
        if (self) this.fx.push({ kind: 'signal', x: self.x, y: self.y, r: self.radius * 3, color: '#7af7ff' });
        return;
      }
      case 'setVar': {
        const name = String(P('name') ?? '');
        if (!name || FORBIDDEN_NAMES.has(name)) return;
        const op = String(P('op'));
        const v = N('value');
        if (a.target === 'world') w.vars[name] = applyOp(readVar(w.vars, name), op, v);
        else for (const t of this.targets(a, ctx)) t.vars[name] = applyOp(readVar(t.vars, name), op, v);
        return;
      }
      case 'setEnvironment': {
        const param = String(P('param'));
        const op = String(P('op'));
        const v = N('value');
        const s = w.settings;
        switch (param) {
          case 'gravityX': s.gravity = { ...s.gravity, x: clampN(applyOp(s.gravity.x, op, v), 5000) }; break;
          case 'gravityY': s.gravity = { ...s.gravity, y: clampN(applyOp(s.gravity.y, op, v), 5000) }; break;
          case 'ambientTemp': s.ambientTemp = Math.max(-273, Math.min(10000, applyOp(s.ambientTemp, op, v))); break;
          case 'timeScale': s.timeScale = Math.max(0, Math.min(10, applyOp(s.timeScale, op, v))); break;
          case 'windX': s.wind = { ...s.wind, x: clampN(applyOp(s.wind.x, op, v), 5000) }; break;
          case 'windY': s.wind = { ...s.wind, y: clampN(applyOp(s.wind.y, op, v), 5000) }; break;
          case 'airDrag': s.airDrag = Math.max(0, Math.min(20, applyOp(s.airDrag, op, v))); break;
          case 'coulomb': s.coulomb = clampN(applyOp(s.coulomb, op, v), 1000); break;
          case 'impactHeat': s.impactHeat = Math.max(0, Math.min(1000, applyOp(s.impactHeat, op, v))); break;
        }
        return;
      }
      case 'setField': {
        const name = String(P('field') ?? '');
        const prop = String(P('property'));
        const op = String(P('op'));
        const v = N('value');
        for (const f of w.fields) {
          if (f.name !== name) continue;
          switch (prop) {
            case 'strength': f.strength = clampN(applyOp(f.strength, op, v), 100000); break;
            case 'radius': f.radius = Math.max(4, Math.min(5000, applyOp(f.radius, op, v))); break;
            case 'angle': f.angle = applyOp(f.angle, op, v); break;
            case 'x': f.x = applyOp(f.x, op, v); break;
            case 'y': f.y = applyOp(f.y, op, v); break;
            case 'enabled': f.enabled = op === 'set' ? v !== 0 : op === 'multiply' ? f.enabled && v !== 0 : !f.enabled; break;
          }
        }
        return;
      }
      case 'log': {
        const msg = String(P('message') ?? '').replace(/\{([^}]{1,80})\}/g, (_, src: string) => {
          const c = compile(src);
          if (!c.ok) return `{${c.error}}`;
          const v = this.num(src, ctx, 0);
          return Number.isInteger(v) ? String(v) : v.toFixed(2);
        });
        w.addLog('info', msg.slice(0, 200), { ruleId: rule.id, entityId: ctx.self?.id });
        return;
      }
    }
  }

  /** Serializable runtime state (timers, cooldowns, proximity memory) for exact save/load. */
  exportState(): EngineStateDoc {
    const rules: EngineStateDoc['rules'] = {};
    for (const [id, st] of this.state) {
      rules[id] = {
        nextTimer: st.nextTimer,
        globalReady: st.globalReady,
        entityReady: [...st.entityReady.entries()],
        proxPrev: [...st.proxPrev],
        proxCounter: st.proxCounter,
        totalFires: st.totalFires,
      };
    }
    return { rules };
  }

  importState(doc: EngineStateDoc | undefined): void {
    this.state.clear();
    if (!doc) return;
    for (const [id, r] of Object.entries(doc.rules)) {
      this.state.set(id, {
        nextTimer: r.nextTimer,
        firesThisStep: 0,
        globalReady: r.globalReady,
        entityReady: new Map(r.entityReady),
        proxPrev: new Set(r.proxPrev),
        proxCounter: r.proxCounter,
        totalFires: r.totalFires,
      });
    }
  }

  totalFires(ruleId: string): number {
    return this.state.get(ruleId)?.totalFires ?? 0;
  }
}

function clampN(v: number, m: number): number {
  return Math.max(-m, Math.min(m, v));
}

export function applyOp(cur: number, op: string, v: number): number {
  switch (op) {
    case 'add':
      return cur + v;
    case 'multiply':
      return cur * v;
    case 'min':
      return Math.min(cur, v);
    case 'max':
      return Math.max(cur, v);
    default:
      return v;
  }
}

function cmpNum(a: number, op: string, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '==': return Math.abs(a - b) < 1e-9;
    case '!=': return Math.abs(a - b) >= 1e-9;
  }
  return false;
}

function cmpStr(a: string, op: string, b: string): boolean {
  return op === '!=' ? a !== b : a === b;
}

export function shapeSpecFor(name: string, size: number): ShapeSpec {
  switch (name) {
    case 'box':
      return { type: 'box', w: size * 2, h: size * 2 };
    case 'triangle':
      return { type: 'ngon', sides: 3, radius: size * 1.2 };
    case 'hexagon':
      return { type: 'ngon', sides: 6, radius: size };
    case 'particle':
      return { type: 'circle', radius: Math.min(size, 5) };
    default:
      return { type: 'circle', radius: size };
  }
}

export function setProperty(w: World, t: Entity, prop: string, op: string, val: number, color: string): void {
  const s = (cur: number) => applyOp(cur, op, val);
  switch (prop) {
    case 'temperature': t.temperature = Math.max(-273, Math.min(100000, s(t.temperature))); break;
    case 'mass': if (!t.isStatic) setMass(t, Math.max(0.01, Math.min(1e6, s(t.mass)))); break;
    case 'color': if (HEX_COLOR.test(color)) t.color = color; break;
    case 'restitution': t.restitution = Math.max(0, Math.min(1.2, s(t.restitution))); break;
    case 'friction': t.friction = Math.max(0, Math.min(2, s(t.friction))); break;
    case 'vx': t.vx = clampN(s(t.vx), 6000); break;
    case 'vy': t.vy = clampN(s(t.vy), 6000); break;
    case 'av': t.av = clampN(s(t.av), 60); break;
    case 'charge': t.charge = clampN(s(t.charge), 100); break;
    case 'gravityScale': t.gravityScale = clampN(s(t.gravityScale), 20); break;
    case 'drag': t.drag = Math.max(0, Math.min(50, s(t.drag))); break;
    case 'lifetime': t.lifetime = s(t.lifetime); break;
    case 'radius': {
      const target = Math.max(1, Math.min(400, s(t.radius)));
      if (t.radius > 0) scaleShape(t, target / t.radius, w.material(t.material).density);
      break;
    }
    case 'static': t.isStatic = val !== 0; t.vx = t.vy = t.av = 0; setMass(t, t.mass); break;
    case 'collides': t.collides = val !== 0; break;
  }
}

