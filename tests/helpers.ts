import { act, cond, rule } from '../src/sim/rules/build';
import { World } from '../src/sim/world';

export { act, cond, rule };

/** Zero-gravity, wall-less world for isolated rule tests. */
export function emptyWorld(seed = 1): World {
  const w = new World(seed);
  w.settings.gravity = { x: 0, y: 0 };
  w.settings.airDrag = 0;
  w.settings.boundary = 'open';
  return w;
}

export function ball(w: World, x: number, y: number, opts: Partial<Parameters<World['spawn']>[0]> = {}) {
  const e = w.spawn({ shape: { type: 'circle', radius: 10 }, x, y, material: 'rubber', ...opts });
  if (!e) throw new Error('spawn failed');
  return e;
}

export function run(w: World, steps: number): void {
  for (let i = 0; i < steps; i++) w.step(1 / 60);
}

export function fires(w: World, ruleId: string): number {
  return w.engine.totalFires(ruleId);
}
