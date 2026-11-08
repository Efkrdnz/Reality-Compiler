import { describe, expect, it } from 'vitest';
import { PRESETS, buildPreset } from '../src/sim/presets';
import { run } from './helpers';

describe('presets', () => {
  it.each(PRESETS.map((p) => p.id))('%s runs 10 simulated seconds cleanly', (id) => {
    const w = buildPreset(id, 1);
    w.engine.prepare(w);
    expect(w.engine.issues.filter((i) => i.level === 'error')).toEqual([]);
    run(w, 600);
    expect(w.entities.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y))).toBe(true);
    expect(w.liveCount).toBeLessThanOrEqual(w.settings.maxEntities);
    expect(w.log.filter((l) => l.kind === 'error')).toEqual([]);
  });

  it('demonstrates its mechanic', () => {
    const goo = buildPreset('goo', 1);
    run(goo, 900);
    expect(goo.vars.replicators).toBeGreaterThan(4); // replicated

    const fission = buildPreset('fission', 1);
    run(fission, 300);
    expect(fission.vars.fissions).toBeGreaterThan(20); // chain reaction spread

    const portals = buildPreset('portals', 1);
    run(portals, 600);
    expect(portals.vars.trips).toBeGreaterThan(5);

    const inverted = buildPreset('inverted', 1);
    const gy0 = inverted.settings.gravity.y;
    run(inverted, 400);
    expect(inverted.settings.gravity.y).toBe(-gy0); // flipped by the timer rule

    const phase = buildPreset('phase', 1);
    run(phase, 900);
    const mats = new Set(phase.entities.map((e) => e.material));
    expect(mats.has('steam') || mats.has('water')).toBe(true);

    const forest = buildPreset('forest', 1);
    run(forest, 1200);
    const burned = forest.entities.filter((e) => e.material === 'ember' || e.material === 'ash').length;
    expect(burned).toBeGreaterThan(8); // fire spread through the towers

    const fw = buildPreset('fireworks', 1);
    run(fw, 1200);
    expect(fw.engine.totalFires(fw.rules.find((r) => r.name === 'Detonate')!.id)).toBeGreaterThan(0);
  });
});
