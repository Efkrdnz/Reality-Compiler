import { describe, expect, it } from 'vitest';
import { instantiateModule } from '../src/sim/rules/build';
import { TEMPLATE_MODULES } from '../src/sim/rules/templates';
import { validateRules } from '../src/sim/rules/validate';
import { act, ball, cond, emptyWorld, fires, rule, run } from './helpers';

/** Two balls that collide head-on within a few steps. */
function collidingPair(matA = 'rubber', matB = 'metal') {
  const w = emptyWorld();
  const a = ball(w, 100, 100, { vx: 400, material: matA });
  const b = ball(w, 160, 100, { vx: -400, material: matB });
  return { w, a, b };
}

describe('triggers', () => {
  it('collision fires once per contact begin, for both bodies as self', () => {
    const { w } = collidingPair();
    const r = rule('hit', 'collision', {}, { id: 'hit', actions: [act('setVar', 'world', { name: 'hits', op: 'add', value: '1' })] });
    w.rules.push(r);
    run(w, 30);
    expect(w.vars.hits).toBe(2); // a→b and b→a
    expect(fires(w, 'hit')).toBe(2);
  });

  it('collision minSpeed filters gentle touches', () => {
    const { w } = collidingPair();
    w.rules.push(rule('hard', 'collision', { minSpeed: '5000' }, { id: 'hard', actions: [act('destroy', 'self')] }));
    run(w, 30);
    expect(w.liveCount).toBe(2);
  });

  it('collision conditions on self/other select the right body', () => {
    const { w, a, b } = collidingPair('rubber', 'metal');
    w.rules.push(
      rule('rubber destroys metal', 'collision', {}, {
        id: 'rm',
        conditions: [cond('self', 'material', '==', 'rubber'), cond('other', 'material', '==', 'metal')],
        actions: [act('destroy', 'other')],
      }),
    );
    run(w, 30);
    expect(w.get(a.id)).toBeDefined();
    expect(w.get(b.id)).toBeUndefined();
  });

  it('proximity "enter" fires once per approach, "while" fires continuously', () => {
    const w = emptyWorld();
    ball(w, 100, 100, { tags: ['seeker'] });
    ball(w, 150, 100);
    w.rules.push(
      rule('enter', 'proximity', { radius: '60', mode: 'enter', every: '1' }, { id: 'enter', conditions: [cond('self', 'tag', 'has', 'seeker')], actions: [act('setVar', 'world', { name: 'enter', op: 'add', value: '1' })] }),
      rule('while', 'proximity', { radius: '60', mode: 'while', every: '1' }, { id: 'while', conditions: [cond('self', 'tag', 'has', 'seeker')], actions: [act('setVar', 'world', { name: 'while', op: 'add', value: '1' })] }),
    );
    run(w, 10);
    expect(w.vars.enter).toBe(1);
    expect(w.vars.while).toBe(10);
  });

  it('timer fires at the configured interval for the world and for each entity', () => {
    const w = emptyWorld();
    ball(w, 0, 0);
    ball(w, 100, 0);
    w.rules.push(
      rule('world tick', 'timer', { interval: '0.5', target: 'world' }, { id: 'wt', actions: [act('setVar', 'world', { name: 't', op: 'add', value: '1' })] }),
      rule('each tick', 'timer', { interval: '1', target: 'each' }, { id: 'et', actions: [act('setVar', 'self', { name: 'n', op: 'add', value: '1' })] }),
    );
    run(w, 121); // ~2 s
    expect(w.vars.t).toBe(4);
    for (const e of w.entities) expect(e.vars.n).toBe(2);
  });

  it('creation fires on the step after spawning; destruction can still read the dying entity', () => {
    const w = emptyWorld();
    w.rules.push(
      rule('born', 'creation', {}, { id: 'born', actions: [act('addTag', 'self', { tag: 'born' })] }),
      rule('died', 'destruction', {}, { id: 'died', actions: [act('setVar', 'world', { name: 'lastMass', op: 'set', value: 'self.mass' })] }),
    );
    const e = ball(w, 0, 0);
    expect(e.tags).not.toContain('born');
    run(w, 1);
    expect(e.tags).toContain('born');
    w.destroy(e);
    run(w, 1);
    expect(w.vars.lastMass).toBeCloseTo(e.mass);
    expect(w.liveCount).toBe(0);
  });

  it('temperature trigger fires on threshold crossings only', () => {
    const w = emptyWorld();
    const e = ball(w, 0, 0, { material: 'metal', temperature: 20 });
    w.settings.ambientExchange = 0;
    w.rules.push(rule('hot', 'temperature', { threshold: '300', direction: 'above' }, { id: 'hot', actions: [act('setVar', 'world', { name: 'hot', op: 'add', value: '1' })] }));
    run(w, 3);
    expect(w.vars.hot).toBeUndefined();
    e.temperature = 500;
    run(w, 5);
    expect(w.vars.hot).toBe(1); // stays hot: no repeated firing
  });

  it('velocity trigger fires when speed crosses the threshold', () => {
    const w = emptyWorld();
    const e = ball(w, 0, 0);
    w.rules.push(rule('fast', 'velocity', { threshold: '500', direction: 'above' }, { id: 'fast', actions: [act('transform', 'self', { color: '#ff00ff' })] }));
    run(w, 2);
    expect(e.color).not.toBe('#ff00ff');
    e.vx = 800;
    run(w, 2);
    expect(e.color).toBe('#ff00ff');
  });

  it('stateChange fires for material phase transitions with from/to filters', () => {
    const w = emptyWorld();
    w.settings.ambientExchange = 0;
    const ice = ball(w, 0, 0, { material: 'ice' });
    w.rules.push(rule('melted', 'stateChange', { to: 'water', from: 'ice' }, { id: 'melt', actions: [act('setVar', 'world', { name: 'melted', op: 'add', value: '1' })] }));
    run(w, 2);
    expect(w.vars.melted).toBeUndefined();
    ice.temperature = 30;
    run(w, 2);
    expect(ice.material).toBe('water');
    expect(ice.state).toBe('liquid');
    expect(w.vars.melted).toBe(1);
  });

  it('signals propagate event chains between rules', () => {
    const w = emptyWorld();
    ball(w, 0, 0, { tags: ['emitter'] });
    w.rules.push(
      rule('ping', 'timer', { interval: '0', target: 'each' }, { id: 'ping', conditions: [cond('self', 'tag', 'has', 'emitter')], maxPerStep: 1, actions: [act('emitSignal', 'self', { name: 'ping' })] }),
      rule('pong', 'signal', { name: 'ping' }, { id: 'pong', actions: [act('setVar', 'world', { name: 'pongs', op: 'add', value: '1' })] }),
    );
    run(w, 5);
    expect(w.vars.pongs).toBe(5);
  });

  it('triggerRule calls another rule immediately with the same self', () => {
    const w = emptyWorld();
    const e = ball(w, 0, 0);
    w.rules.push(
      rule('caller', 'creation', {}, { id: 'caller', actions: [act('triggerRule', 'self', { rule: 'callee' })] }),
      rule('callee', 'manual', {}, { id: 'callee', actions: [act('setVar', 'self', { name: 'called', op: 'set', value: '1' })] }),
    );
    run(w, 1);
    expect(e.vars.called).toBe(1);
  });
});

describe('conditions', () => {
  it('supports any/all modes, tags, colour proximity and variables', () => {
    const w = emptyWorld();
    const e = ball(w, 0, 0, { tags: ['a'], color: '#ff0000' });
    e.vars.level = 3;
    w.vars.gate = 1;
    const mk = (id: string, conds: ReturnType<typeof cond>[], mode: 'all' | 'any' = 'all') =>
      rule(id, 'timer', { interval: '0', target: 'each' }, { id, conditionMode: mode, conditions: conds, maxPerStep: 1, actions: [act('setVar', 'world', { name: id, op: 'add', value: '1' })] });
    w.rules.push(
      mk('allPass', [cond('self', 'tag', 'has', 'a'), cond('self', 'var', '>=', '3', 'level'), cond('world', 'var', '==', '1', 'gate')]),
      mk('allFail', [cond('self', 'tag', 'has', 'a'), cond('self', 'tag', 'has', 'b')]),
      mk('anyPass', [cond('self', 'tag', 'has', 'zzz'), cond('self', 'color', 'near', '#ee1111')], 'any'),
      mk('mass', [cond('self', 'mass', '<', 'self.mass + 1'), cond('self', 'shape', '==', 'circle'), cond('self', 'kind', '==', 'body')]),
      mk('expr', [cond('world', 'expr', '==', 'self.x == 0 && $gate == 1')]),
    );
    run(w, 1);
    expect(w.vars.allPass).toBe(1);
    expect(w.vars.allFail).toBeUndefined();
    expect(w.vars.anyPass).toBe(1);
    expect(w.vars.mass).toBe(1);
    expect(w.vars.expr).toBe(1);
  });

  it('chance conditions are reproducible for the same seed', () => {
    const count = (seed: number) => {
      const w = emptyWorld(seed);
      for (let i = 0; i < 50; i++) ball(w, i * 30, 0);
      w.rules.push(rule('coin', 'timer', { interval: '0', target: 'each' }, { id: 'coin', conditions: [cond('world', 'chance', '<', '0.5')], actions: [act('setVar', 'world', { name: 'heads', op: 'add', value: '1' })] }));
      run(w, 10);
      return w.vars.heads;
    };
    expect(count(7)).toBe(count(7));
    expect(count(7)).toBeGreaterThan(150);
    expect(count(7)).toBeLessThan(350);
  });
});

describe('priorities, cooldowns and limits', () => {
  it('runs higher priority rules first and "consume" stops lower ones', () => {
    const w = emptyWorld();
    ball(w, 0, 0);
    w.rules.push(
      rule('low', 'creation', {}, { id: 'low', priority: 1, actions: [act('setVar', 'world', { name: 'order', op: 'multiply', value: '10' }), act('setVar', 'world', { name: 'low', op: 'set', value: '1' })] }),
      rule('high', 'creation', {}, { id: 'high', priority: 5, actions: [act('setVar', 'world', { name: 'order', op: 'set', value: '7' })] }),
    );
    run(w, 1);
    expect(w.vars.order).toBe(70); // high (set 7) ran before low (×10)

    const w2 = emptyWorld();
    ball(w2, 0, 0);
    w2.rules.push(
      rule('low', 'creation', {}, { id: 'low', priority: 1, actions: [act('setVar', 'world', { name: 'low', op: 'set', value: '1' })] }),
      rule('high', 'creation', {}, { id: 'high', priority: 5, consume: true, actions: [act('setVar', 'world', { name: 'high', op: 'set', value: '1' })] }),
    );
    run(w2, 1);
    expect(w2.vars.high).toBe(1);
    expect(w2.vars.low).toBeUndefined();
  });

  it('honours per-entity cooldowns', () => {
    const w = emptyWorld();
    ball(w, 0, 0);
    w.rules.push(rule('cd', 'timer', { interval: '0', target: 'each' }, { id: 'cd', cooldown: 0.5, actions: [act('setVar', 'world', { name: 'n', op: 'add', value: '1' })] }));
    run(w, 60);
    expect(w.vars.n).toBe(2);
  });

  it('caps firings per step', () => {
    const w = emptyWorld();
    for (let i = 0; i < 20; i++) ball(w, i * 40, 0);
    w.rules.push(rule('cap', 'timer', { interval: '0', target: 'each' }, { id: 'cap', maxPerStep: 3, actions: [act('setVar', 'world', { name: 'n', op: 'add', value: '1' })] }));
    run(w, 2);
    expect(w.vars.n).toBe(6);
  });

  it('skips rules with validation errors and reports them', () => {
    const w = emptyWorld();
    ball(w, 0, 0);
    w.rules.push(rule('broken', 'creation', {}, { id: 'broken', actions: [act('transform', 'self', { material: 'unobtainium' })] }));
    w.rules.push(rule('bad expr', 'creation', {}, { id: 'badexpr', actions: [act('setVar', 'world', { name: 'x', op: 'set', value: 'self.mass +' })] }));
    run(w, 1);
    expect(w.engine.broken.has('broken')).toBe(true);
    expect(w.engine.broken.has('badexpr')).toBe(true);
    expect(w.engine.issues.some((i) => /unknown material/.test(i.message))).toBe(true);
    expect(fires(w, 'broken')).toBe(0);
  });
});

describe('safety: recursion, cycles, budgets', () => {
  it('blocks a rule that triggers itself (cycle protection)', () => {
    const w = emptyWorld();
    ball(w, 0, 0);
    w.rules.push(rule('selfish', 'creation', {}, { id: 'selfish', actions: [act('setVar', 'world', { name: 'n', op: 'add', value: '1' }), act('triggerRule', 'self', { rule: 'selfish' })] }));
    run(w, 1);
    expect(w.vars.n).toBe(1);
    expect(w.stats.cyclesBlocked).toBe(1);
    expect(w.log.some((l) => l.kind === 'warn' && /cycle blocked/.test(l.text))).toBe(true);
  });

  it('cuts mutual recursion between two rules', () => {
    const w = emptyWorld();
    ball(w, 0, 0);
    w.rules.push(
      rule('A', 'creation', {}, { id: 'A', actions: [act('triggerRule', 'self', { rule: 'B' })] }),
      rule('B', 'manual', {}, { id: 'B', actions: [act('setVar', 'world', { name: 'b', op: 'add', value: '1' }), act('triggerRule', 'self', { rule: 'A' })] }),
    );
    run(w, 1);
    expect(w.vars.b).toBe(1);
    const issues = validateRules(w.rules, { materials: new Set(w.materials.keys()), fieldNames: new Set() });
    expect(issues.some((i) => i.path === 'chain' && /event loop/.test(i.message))).toBe(true);
  });

  it('cuts signal storms (broadcast re-emitting the same signal) via cycle protection', () => {
    const w = emptyWorld();
    for (let i = 0; i < 40; i++) ball(w, i * 50, 0, { tags: ['relay'] });
    w.rules.push(
      rule('kick', 'timer', { interval: '0', target: 'world' }, { id: 'kick', actions: [act('emitSignal', 'world', { name: 'wave' })] }),
      rule('relay', 'signal', { name: 'wave' }, { id: 'relay', actions: [act('emitSignal', 'world', { name: 'wave' })] }),
    );
    run(w, 1);
    expect(w.stats.cyclesBlocked + w.stats.chainDepthHits).toBeGreaterThan(0);
    expect(fires(w, 'relay')).toBe(1);
  });

  it('limits the depth of long rule → rule chains', () => {
    const w = emptyWorld();
    w.settings.maxChainDepth = 8;
    ball(w, 0, 0);
    const N = 20;
    for (let i = 0; i < N; i++) {
      w.rules.push(
        rule(`link ${i}`, i === 0 ? 'creation' : 'manual', {}, {
          id: `L${i}`,
          actions: [act('setVar', 'world', { name: 'reached', op: 'max', value: String(i) }), ...(i < N - 1 ? [act('triggerRule', 'self', { rule: `L${i + 1}` })] : [])],
        }),
      );
    }
    run(w, 1);
    expect(w.vars.reached).toBe(8);
    expect(w.stats.chainDepthHits).toBe(1);
    expect(w.log.some((l) => /max depth 8/.test(l.text))).toBe(true);
  });

  it('stops runaway work with the instruction budget', () => {
    const w = emptyWorld();
    w.settings.instructionBudget = 2000;
    for (let i = 0; i < 200; i++) ball(w, (i % 20) * 30, Math.floor(i / 20) * 30);
    w.rules.push(rule('heavy', 'timer', { interval: '0', target: 'each' }, { id: 'heavy', actions: [act('setVar', 'self', { name: 'x', op: 'set', value: 'sin(1)+sin(2)+sin(3)+sin(4)+sin(5)+sin(6)+sin(7)+sin(8)' })] }));
    const t0 = performance.now();
    run(w, 1);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(w.stats.budgetExceeded).toBe(true);
    expect(fires(w, 'heavy')).toBeLessThan(200);
  });

  it('bounds self-replicating matter with the entity cap', () => {
    const w = emptyWorld();
    w.settings.maxEntities = 300;
    ball(w, 500, 500);
    w.rules.push(rule('replicate', 'creation', {}, { id: 'rep', actions: [act('duplicate', 'self', { count: '2', spread: '25', kick: '50' })] }));
    run(w, 30);
    expect(w.liveCount).toBe(300);
    expect(w.log.some((l) => /entity cap/.test(l.text))).toBe(true);
    // keeps running without errors after hitting the cap
    run(w, 30);
    expect(w.liveCount).toBeLessThanOrEqual(300);
  });

  it('a transform ping-pong between two state-change rules is depth-limited', () => {
    const w = emptyWorld();
    w.settings.maxChainDepth = 10;
    const e = ball(w, 0, 0, { material: 'stone' });
    w.rules.push(
      rule('to metal', 'stateChange', { to: 'stone' }, { id: 'tm', actions: [act('transform', 'self', { material: 'metal' })] }),
      rule('to stone', 'stateChange', { to: 'metal' }, { id: 'ts', actions: [act('transform', 'self', { material: 'stone' })] }),
    );
    w.transform(e, 'metal');
    run(w, 1);
    expect(w.stats.chainDepthHits).toBeGreaterThan(0);
    run(w, 3);
    expect(Number.isFinite(e.x)).toBe(true);
  });
});

describe('actions', () => {
  it('apply force / push / teleport / setProperty / tags', () => {
    const w = emptyWorld();
    const e = ball(w, 100, 100);
    w.rules.push(
      rule('all', 'creation', {}, {
        id: 'all',
        actions: [
          act('force', 'self', { fx: '100', fy: '0', mode: 'velocity' }),
          act('push', 'self', { strength: '50', direction: 'up' }),
          act('teleport', 'self', { x: '500', y: '250', relative: false, keepVelocity: true }),
          act('setProperty', 'self', { property: 'temperature', op: 'set', value: '123' }),
          act('setProperty', 'self', { property: 'mass', op: 'multiply', value: '2' }),
          act('addTag', 'self', { tag: 'marked' }),
        ],
      }),
    );
    const m0 = e.mass;
    run(w, 1);
    expect(e.vx).toBeCloseTo(100, 0);
    expect(e.vy).toBeCloseTo(-50, 0);
    expect(e.x).toBeCloseTo(500, 0);
    expect(e.temperature).toBeCloseTo(123, 0);
    expect(e.mass).toBeCloseTo(m0 * 2);
    expect(e.tags).toContain('marked');
  });

  it('spawn, duplicate, emit particles, explode, connect, gravity and environment', () => {
    const w = emptyWorld();
    const a = ball(w, 100, 100, { vx: 300 });
    const b = ball(w, 140, 100, { vx: -300 });
    const far = ball(w, 160, 200);
    w.rules.push(
      rule('boom', 'collision', {}, {
        id: 'boom',
        maxPerStep: 1,
        cooldown: 100,
        cooldownScope: 'global',
        actions: [
          act('connect', 'self', { stiffness: '1', length: '30', breakImpulse: '0', maxLinks: '3' }),
          act('emitParticles', 'self', { count: '5' }),
          act('spawn', 'world', { material: 'stone', shape: 'box', size: '8', x: '700', y: '700', vx: '0', vy: '0', count: '2' }),
          act('explode', 'self', { radius: '300', strength: '500', heat: '50' }),
          act('setGravity', 'world', { gx: '0', gy: '-300' }),
          act('setEnvironment', 'world', { param: 'ambientTemp', op: 'set', value: '99' }),
          act('duplicate', 'other', { count: '1' }),
        ],
      }),
    );
    run(w, 20);
    expect(w.joints.length).toBe(1);
    expect(w.entities.filter((e) => e.kind === 'particle').length).toBeGreaterThan(0);
    expect(w.entities.filter((e) => e.material === 'stone').length).toBe(2);
    expect(w.settings.gravity.y).toBe(-300);
    expect(w.settings.ambientTemp).toBe(99);
    expect(Math.hypot(far.vx, far.vy)).toBeGreaterThan(10);
    expect(w.entities.filter((e) => e.material === 'rubber').length).toBe(4);
    void a;
    void b;
  });

  it('modify field and log interpolation', () => {
    const w = emptyWorld();
    const f = w.addField('well', 0, 0, { name: 'core', strength: 100 });
    w.rules.push(
      rule('flip', 'timer', { interval: '0', target: 'world' }, {
        id: 'flip',
        maxPerStep: 1,
        actions: [act('setField', 'world', { field: 'core', property: 'strength', op: 'multiply', value: '-1' }), act('log', 'world', { message: 'strength is {world.time * 0 + 5}' })],
      }),
    );
    run(w, 1);
    expect(f.strength).toBe(-100);
    expect(w.log.some((l) => l.text === 'strength is 5')).toBe(true);
  });
});

describe('modules & templates', () => {
  it('every built-in template validates cleanly and installs with remapped ids', () => {
    const w = emptyWorld();
    for (const m of TEMPLATE_MODULES) {
      const rules = instantiateModule(m);
      expect(rules.length).toBe(m.rules.length);
      expect(rules.every((r) => r.module === m.name)).toBe(true);
      const issues = validateRules(rules, { materials: new Set(w.materials.keys()), fieldNames: new Set() }).filter((i) => i.level === 'error');
      expect(issues, m.name).toEqual([]);
    }
    const a = instantiateModule(TEMPLATE_MODULES[0]);
    const b = instantiateModule(TEMPLATE_MODULES[0]);
    expect(a[0].id).not.toBe(b[0].id);
  });
});
