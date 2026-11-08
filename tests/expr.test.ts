import { describe, expect, it } from 'vitest';
import { BudgetExceeded, compile, evaluate, type ExprEnv } from '../src/sim/rules/expr';

const ent = (o: Partial<ExprEnv['self'] & object> = {}) => ({
  id: 1, x: 10, y: 20, vx: 3, vy: 4, mass: 2, temperature: 50, radius: 5, age: 1, angle: 0, av: 0, charge: 0,
  restitution: 0.5, friction: 0.5, lifetime: -1, gravityScale: 1, drag: 0, vars: { hp: 7 }, ...o,
});

function env(over: Partial<ExprEnv> = {}): ExprEnv {
  let seed = 0.25;
  return {
    self: ent(),
    other: ent({ id: 2, mass: 10 }),
    event: { impulse: 42, relSpeed: 300 },
    world: (p) => (p === 'time' ? 12.5 : p === 'gy' ? 600 : 0),
    global: (n) => (n === 'score' ? 3 : 0),
    count: (tag) => (tag === 'food' ? 9 : 100),
    countMat: () => 4,
    random: () => (seed = (seed + 0.37) % 1),
    budget: { left: 1000 },
    ...over,
  };
}

const ev = (src: string, e = env()) => {
  const c = compile(src);
  if (!c.ok) throw new Error(c.error);
  return evaluate(c.ast, e);
};

describe('expression language', () => {
  it('evaluates arithmetic with correct precedence and associativity', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('10 - 4 - 3')).toBe(3);
    expect(ev('2 ^ 3 ^ 2')).toBe(512);
    expect(ev('-2 ^ 2')).toBe(-4);
    expect(ev('7 % 4')).toBe(3);
    expect(ev('1 / 0')).toBe(0); // division by zero is defined as 0, never Infinity
  });

  it('supports comparisons, logic and ternaries', () => {
    expect(ev('3 > 2 && 1 < 2')).toBe(1);
    expect(ev('3 > 2 && 1 > 2')).toBe(0);
    expect(ev('0 || 5')).toBe(1);
    expect(ev('!0')).toBe(1);
    expect(ev('self.mass > 1 ? 100 : 200')).toBe(100);
  });

  it('reads entity, world, event, global and per-entity variables', () => {
    expect(ev('self.speed')).toBe(5);
    expect(ev('other.mass')).toBe(10);
    expect(ev('self.temp')).toBe(50);
    expect(ev('self.$hp')).toBe(7);
    expect(ev('self.$missing')).toBe(0);
    expect(ev('$score + 1')).toBe(4);
    expect(ev('world.time')).toBe(12.5);
    expect(ev('event.impulse')).toBe(42);
    expect(ev("count('food')")).toBe(9);
    expect(ev('pi')).toBeCloseTo(Math.PI);
  });

  it('provides whitelisted math functions', () => {
    expect(ev('clamp(15, 0, 10)')).toBe(10);
    expect(ev('max(1, 9, 3)')).toBe(9);
    expect(ev('hypot(3, 4)')).toBe(5);
    expect(ev('lerp(0, 10, 0.5)')).toBe(5);
    const r = ev('rand(10, 20)');
    expect(r).toBeGreaterThanOrEqual(10);
    expect(r).toBeLessThan(20);
  });

  it('rejects unknown identifiers, functions and properties with helpful errors', () => {
    const bad = ['foo', 'self.secret', 'world.window', 'alert(1)', 'constructor', 'self.constructor', "this", 'globalThis', '__proto__', 'eval("1")', 'Function'];
    for (const src of bad) {
      const c = compile(src);
      expect(c.ok, src).toBe(false);
    }
    const c = compile('self.speeed');
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toMatch(/unknown property 'speeed'/);
  });

  it('validates function arity and argument kinds', () => {
    expect(compile('clamp(1, 2)').ok).toBe(false);
    expect(compile('count(5)').ok).toBe(false);
    expect(compile("sin('x')").ok).toBe(false);
    expect(compile('1 +').ok).toBe(false);
    expect(compile('(1 + 2').ok).toBe(false);
    expect(compile('').ok).toBe(false);
    expect(compile('x'.repeat(500)).ok).toBe(false);
  });

  it('enforces an instruction budget', () => {
    const e = env({ budget: { left: 5 } });
    const c = compile('1+1+1+1+1+1+1+1+1+1');
    expect(c.ok).toBe(true);
    if (c.ok) expect(() => evaluate(c.ast, e)).toThrow(BudgetExceeded);
  });

  it('caches compilation and flags constants and subject usage', () => {
    const a = compile('42');
    expect(a.ok && a.constant).toBe(true);
    const b = compile('other.mass + 1');
    expect(b.ok && b.usesOther && !b.usesSelf).toBe(true);
    expect(compile('other.mass + 1')).toBe(b);
  });
});
