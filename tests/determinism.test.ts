import { describe, expect, it } from 'vitest';
import { PRESETS, buildPreset } from '../src/sim/presets';
import { deserializeWorld, serializeWorld } from '../src/sim/serialize';
import { run } from './helpers';

describe('determinism', () => {
  it.each(PRESETS.map((p) => p.id))('preset %s replays identically from the same seed', (id) => {
    const a = buildPreset(id, 42);
    const b = buildPreset(id, 42);
    run(a, 240);
    run(b, 240);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('different seeds give different universes', () => {
    const a = buildPreset('genesis', 1);
    const b = buildPreset('genesis', 2);
    run(a, 60);
    run(b, 60);
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it.each(['goo', 'fission', 'genesis', 'fireworks', 'portals'])('save → load mid-run continues exactly (%s)', (id) => {
    const original = buildPreset(id, 9);
    run(original, 150);
    const copy = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(original))));
    run(original, 200);
    run(copy, 200);
    expect(copy.stateHash()).toBe(original.stateHash());
    expect(copy.vars).toEqual(original.vars);
  });
});
