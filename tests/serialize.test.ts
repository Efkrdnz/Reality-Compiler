import { describe, expect, it } from 'vitest';
import { buildPreset } from '../src/sim/presets';
import { ImportError, deserializeWorld, parseRulesDoc, serializeRules, serializeWorld } from '../src/sim/serialize';

function expectImportError(fn: () => unknown, re: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    const err = e as ImportError;
    expect(`${err.message} ${err.details.join(' ')}`).toMatch(re);
    return;
  }
  throw new Error('expected ImportError');
}

describe('world JSON', () => {
  it('round-trips a world (entities, fields, joints, rules, materials, vars)', () => {
    const w = buildPreset('genesis', 3);
    const a = w.entities[5];
    const b = w.entities[6];
    w.addJoint(a, b, { stiffness: 0.5 });
    w.vars.answer = 42;
    const doc = serializeWorld(w);
    const json = JSON.stringify(doc);
    const w2 = deserializeWorld(json);
    expect(serializeWorld(w2)).toEqual(JSON.parse(json));
    expect(w2.joints.length).toBe(1);
    expect(w2.vars.answer).toBe(42);
    expect(w2.rules.length).toBe(w.rules.length);
  });

  it('rejects invalid JSON with a readable error', () => {
    expectImportError(() => deserializeWorld('{ nope'), /Not valid JSON/);
  });

  it('reports schema problems with paths', () => {
    const doc = serializeWorld(buildPreset('blank', 1)) as unknown as Record<string, unknown>;
    (doc.entities as Record<string, unknown>[])[0].color = 'red';
    expectImportError(() => deserializeWorld(doc), /entities\.0\.color: must be a hex colour/);
    const doc2 = serializeWorld(buildPreset('blank', 1)) as unknown as Record<string, unknown>;
    (doc2.settings as Record<string, unknown>).gravity = { x: 'down', y: 1 };
    expectImportError(() => deserializeWorld(doc2), /settings\.gravity\.x/);
  });

  it('rejects unknown materials, duplicate ids and reserved variable names', () => {
    const doc = serializeWorld(buildPreset('genesis', 1));
    doc.entities[0].material = 'mystery';
    expectImportError(() => deserializeWorld(doc), /unknown material “mystery”/);
    const doc2 = serializeWorld(buildPreset('genesis', 1));
    doc2.entities[1].id = doc2.entities[0].id;
    expectImportError(() => deserializeWorld(doc2), /Duplicate entity id/);
    const raw = JSON.stringify(serializeWorld(buildPreset('blank', 1))).replace('"vars":{}', '"vars":{"constructor":1}');
    expectImportError(() => deserializeWorld(raw), /vars\.constructor/);
  });

  it('explains when a rules file is loaded as a world (and vice versa)', () => {
    const rules = serializeRules(buildPreset('goo', 1).rules);
    expectImportError(() => deserializeWorld(rules), /rules only/);
    expectImportError(() => parseRulesDoc(serializeWorld(buildPreset('blank', 1))), /world file/);
  });

  it('round-trips rules documents', () => {
    const w = buildPreset('goo', 1);
    const doc = parseRulesDoc(JSON.stringify(serializeRules(w.rules)));
    expect(doc.rules).toEqual(w.rules);
  });

  it('accepts minimal hand-written worlds and fills default settings', () => {
    const w = deserializeWorld({
      format: 'reality-compiler/world',
      version: 1,
      name: 'tiny',
      description: '',
      seed: 5,
      settings: { gravity: { x: 0, y: -100 } },
      materials: [],
      entities: [],
      joints: [],
      fields: [],
      rules: [],
      modules: [],
      vars: {},
    });
    expect(w.settings.gravity.y).toBe(-100);
    expect(w.settings.maxEntities).toBeGreaterThan(0);
    expect(w.materials.has('stone')).toBe(true);
  });
});
