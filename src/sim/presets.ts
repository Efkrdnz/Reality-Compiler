import { act, cond, instantiateModule, rule } from './rules/build';
import { TEMPLATE_MODULES } from './rules/templates';
import type { RuleModule } from './rules/types';
import { World } from './world';

export interface Preset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accent: string;
  build: (seed: number) => World;
}

const tpl = (id: string): RuleModule => {
  const m = TEMPLATE_MODULES.find((t) => t.id === id);
  if (!m) throw new Error(`missing template ${id}`);
  return m;
};

function install(w: World, id: string): void {
  w.rules.push(...instantiateModule(tpl(id)));
}

function floor(w: World, opts: { y?: number; material?: string } = {}): void {
  const W = w.settings.width;
  const y = opts.y ?? w.settings.height - 20;
  w.spawn({ shape: { type: 'box', w: W - 20, h: 24 }, x: W / 2, y, isStatic: true, material: opts.material ?? 'stone', origin: 'preset' });
}

function ramp(w: World, x: number, y: number, len: number, angle: number, material = 'metal'): void {
  w.spawn({ shape: { type: 'box', w: len, h: 16 }, x, y, angle, isStatic: true, material, origin: 'preset' });
}

function base(seed: number, name: string, description: string): World {
  const w = new World(seed);
  w.name = name;
  w.description = description;
  w.modules = TEMPLATE_MODULES.map((m) => structuredClone(m));
  return w;
}

function scatter(_w: World, n: number, f: (i: number) => void): void {
  for (let i = 0; i < n; i++) f(i);
}

export const PRESETS: Preset[] = [
  {
    id: 'genesis',
    name: 'Genesis Lab',
    tagline: 'A bit of everything',
    accent: '#00f0ff',
    description: 'Ramps, mixed materials, a gravity well, a portal pair, a heater melting ice, and sparks on hard impacts. Start here.',
    build: (seed) => {
      const w = base(seed, 'Genesis Lab', 'A tour of the laboratory: materials, fields, portals and rules.');
      const r = w.rng;
      floor(w);
      ramp(w, 420, 420, 520, 0.28);
      ramp(w, 1160, 600, 520, -0.25);
      w.spawn({ shape: { type: 'box', w: 30, h: 220 }, x: 820, y: 860, isStatic: true, material: 'glass', origin: 'preset' });
      const mats = ['rubber', 'stone', 'metal', 'wood', 'glass'];
      scatter(w, 34, (i) => {
        const m = mats[i % mats.length];
        const x = r.range(140, 760);
        const y = r.range(60, 300);
        const kind = i % 3;
        if (kind === 0) w.spawn({ shape: { type: 'circle', radius: r.range(10, 22) }, x, y, material: m, origin: 'preset' });
        else if (kind === 1) w.spawn({ shape: { type: 'box', w: r.range(20, 44), h: r.range(20, 44) }, x, y, angle: r.range(0, 3), material: m, origin: 'preset' });
        else w.spawn({ shape: { type: 'ngon', sides: r.int(3, 6), radius: r.range(12, 22) }, x, y, material: m, origin: 'preset' });
      });
      // ice cubes on a heater
      w.addField('heat', 1280, 900, { name: 'heater', shape: 'rect', w: 360, h: 140, strength: 45 });
      scatter(w, 8, (i) => w.spawn({ shape: { type: 'box', w: 30, h: 30 }, x: 1150 + (i % 4) * 70, y: 800 - Math.floor(i / 4) * 40, material: 'ice', origin: 'preset' }));
      w.addField('well', 1300, 230, { name: 'well', radius: 220, strength: 1100, falloff: 2 });
      const a = w.addField('portal', 980, 940, { name: 'portal-a', radius: 40, angle: 0 });
      const b = w.addField('portal', 760, 80, { name: 'portal-b', radius: 40, angle: 0 });
      a.link = b.id;
      install(w, 'tpl_impact_sparks');
      return w;
    },
  },
  {
    id: 'inverted',
    name: 'Inverted Heaven',
    tagline: 'Gravity points up',
    accent: '#fff27a',
    description: 'Gravity is reversed. A pocket of normal gravity sits in the middle, and a gravity clock flips the universe every 6 seconds.',
    build: (seed) => {
      const w = base(seed, 'Inverted Heaven', 'Reversed gravity with a pocket of normality.');
      w.settings.gravity = { x: 0, y: -520 };
      const r = w.rng;
      w.spawn({ shape: { type: 'box', w: w.settings.width - 20, h: 24 }, x: w.settings.width / 2, y: 20, isStatic: true, material: 'glass', origin: 'preset' });
      floor(w, { material: 'glass' });
      w.addField('gravityZone', 800, 520, { name: 'pocket', shape: 'rect', w: 420, h: 300, strength: 600, angle: Math.PI / 2 });
      scatter(w, 60, (i) => {
        const m = i % 4 === 0 ? 'aether' : i % 3 === 0 ? 'rubber' : 'glass';
        w.spawn({ shape: i % 2 ? { type: 'circle', radius: r.range(9, 20) } : { type: 'ngon', sides: 3 + (i % 4), radius: r.range(12, 20) }, x: r.range(80, 1520), y: r.range(500, 940), material: m, origin: 'preset' });
      });
      w.rules.push(
        rule('Flip the sky', 'timer', { interval: '6', target: 'world' }, {
          actions: [act('setGravity', 'world', { gx: '0', gy: '-world.gy' }), act('log', 'world', { message: 'the sky flipped (gy = {world.gy})' })],
        }),
      );
      return w;
    },
  },
  {
    id: 'goo',
    name: 'Grey Goo',
    tagline: 'Self-replicating matter',
    accent: '#00ffa3',
    description: 'Replicators eat nutrients, divide when fed and decay into food when old. Watch boom-and-bust population cycles emerge. A rain of nutrients keeps the ecosystem alive.',
    build: (seed) => {
      const w = base(seed, 'Grey Goo', 'An ecosystem of self-replicating matter.');
      w.settings.gravity = { x: 0, y: 120 };
      w.settings.airDrag = 0.4;
      w.settings.maxEntities = 900;
      const r = w.rng;
      floor(w);
      scatter(w, 4, () => w.spawn({ shape: { type: 'circle', radius: 9 }, x: r.range(600, 1000), y: r.range(300, 600), material: 'replicator', origin: 'preset' }));
      scatter(w, 140, () => w.spawn({ shape: { type: 'circle', radius: r.range(4, 6) }, x: r.range(40, 1560), y: r.range(80, 940), vx: r.range(-60, 60), vy: r.range(-60, 60), material: 'nutrient', origin: 'preset' }));
      w.addField('vortex', 800, 520, { name: 'stir', radius: 520, strength: 120 });
      install(w, 'tpl_replicator');
      w.rules.push(
        rule('Nutrient drizzle', 'timer', { interval: '0.2', target: 'world' }, {
          conditions: [cond('world', 'expr', '==', "count('food') < 160")],
          actions: [act('spawn', 'world', { material: 'nutrient', shape: 'circle', size: 'rand(4,6)', x: 'rand(40, world.width-40)', y: '40', vx: 'rand(-40,40)', vy: '40' })],
        }),
        rule('Census', 'timer', { interval: '0.5', target: 'world' }, {
          actions: [act('setVar', 'world', { name: 'replicators', op: 'set', value: "count('replicator')" }), act('setVar', 'world', { name: 'food', op: 'set', value: "count('food')" })],
        }),
      );
      return w;
    },
  },
  {
    id: 'fission',
    name: 'Chain Reaction',
    tagline: 'One neutron is enough',
    accent: '#7dff4f',
    description: 'A lattice of fissile matter in zero gravity. A single neutron starts a cascade of splitting, shockwaves and heat. Click “Reset” to run it again — it is deterministic.',
    build: (seed) => {
      const w = base(seed, 'Chain Reaction', 'Fissile lattice awaiting a neutron.');
      w.settings.gravity = { x: 0, y: 0 };
      w.settings.airDrag = 0.6;
      w.settings.boundary = 'walls';
      const cols = 16;
      const rows = 10;
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const x = 420 + i * 52 + (j % 2) * 26;
          const y = 260 + j * 50;
          w.spawn({ shape: { type: 'circle', radius: 13 }, x, y, material: 'uranium', origin: 'preset' });
        }
      w.spawn({ shape: { type: 'circle', radius: 3 }, kind: 'particle', x: 120, y: 500, vx: 700, vy: 12, material: 'neutron', origin: 'preset', lifetime: 8 });
      install(w, 'tpl_chain_reaction');
      w.rules.push(
        rule('Neutrons fade', 'creation', {}, {
          conditions: [cond('self', 'tag', 'has', 'neutron')],
          actions: [act('setProperty', 'self', { property: 'lifetime', op: 'set', value: 'rand(1.2, 2.4)' })],
        }),
      );
      return w;
    },
  },
  {
    id: 'orbits',
    name: 'Orbital Garden',
    tagline: 'Zero-g, one sun',
    accent: '#8a7bff',
    description: 'No global gravity: a central well holds dozens of bodies in orbit. Collisions and a gentle vortex make the system evolve. Turn on trails.',
    build: (seed) => {
      const w = base(seed, 'Orbital Garden', 'A miniature solar system around a gravity well.');
      w.settings.gravity = { x: 0, y: 0 };
      w.settings.airDrag = 0;
      w.settings.boundary = 'wrap';
      const r = w.rng;
      const cx = 800;
      const cy = 500;
      const sun = w.spawn({ shape: { type: 'circle', radius: 34 }, x: cx, y: cy, isStatic: true, material: 'plasma', origin: 'preset' });
      if (sun) sun.lifetime = -1;
      const strength = 1400;
      w.addField('well', cx, cy, { name: 'sun', radius: 900, strength, falloff: 2 });
      scatter(w, 70, (i) => {
        const d = r.range(90, 440);
        const ang = r.range(0, Math.PI * 2);
        const r0 = 900 * 0.3;
        const a = Math.min(strength * 6, (strength * r0 * r0) / Math.max(d * d, 256));
        const v = Math.sqrt(a * d) * r.range(0.95, 1.05);
        const mats = ['glass', 'rubber', 'magnet', 'antimagnet', 'aether', 'metal'];
        const m = mats[i % mats.length];
        const e = w.spawn({
          shape: i % 5 === 0 ? { type: 'ngon', sides: 5, radius: r.range(6, 10) } : { type: 'circle', radius: r.range(4, 10) },
          x: cx + Math.cos(ang) * d,
          y: cy + Math.sin(ang) * d,
          vx: -Math.sin(ang) * v,
          vy: Math.cos(ang) * v,
          material: m,
          origin: 'preset',
        });
        if (e) e.gravityScale = 0;
      });
      return w;
    },
  },
  {
    id: 'portals',
    name: 'Portal Cascade',
    tagline: 'Fall forever',
    accent: '#00f0ff',
    description: 'A portal in the floor leads to one in the sky, a sideways portal rotates momentum by 90°, and a slow time zone sits in the fall path. A rule counts every portal trip.',
    build: (seed) => {
      const w = base(seed, 'Portal Cascade', 'Endless falling through linked portals.');
      const r = w.rng;
      floor(w);
      const a = w.addField('portal', 800, 920, { name: 'floor', radius: 70, angle: 0 });
      const b = w.addField('portal', 800, 90, { name: 'sky', radius: 70, angle: 0 });
      a.link = b.id;
      const c = w.addField('portal', 140, 800, { name: 'west', radius: 55, angle: 0 });
      const d = w.addField('portal', 1460, 220, { name: 'east', radius: 55, angle: Math.PI / 2 });
      c.link = d.id;
      d.link = c.id;
      ramp(w, 360, 720, 420, 0.45, 'glass');
      ramp(w, 1240, 720, 420, -0.45, 'glass');
      w.addField('timeZone', 800, 480, { name: 'slowfall', radius: 150, strength: 0.25 });
      scatter(w, 40, (i) =>
        w.spawn({ shape: i % 3 ? { type: 'circle', radius: r.range(8, 16) } : { type: 'box', w: 22, h: 22 }, x: r.range(300, 1300), y: r.range(150, 600), material: i % 2 ? 'rubber' : 'glass', origin: 'preset' }),
      );
      w.rules.push(
        rule('Count floor trips', 'signal', { name: 'portal:floor' }, { actions: [act('setVar', 'world', { name: 'trips', op: 'add', value: '1' })] }),
        rule('Count west trips', 'signal', { name: 'portal:west' }, {
          actions: [act('setVar', 'world', { name: 'sidewaysTrips', op: 'add', value: '1' }), act('transform', 'self', { color: '#ffe066' })],
        }),
      );
      return w;
    },
  },
  {
    id: 'chrono',
    name: 'Chrono Garden',
    tagline: 'Time is local',
    accent: '#ffe066',
    description: 'Rain falls through three time zones: stasis (0×), slow (0.25×) and fast (3×). Droplets freeze mid-air, crawl, or rush — while sharing one world.',
    build: (seed) => {
      const w = base(seed, 'Chrono Garden', 'Rain through local time zones.');
      floor(w);
      w.addField('timeZone', 330, 520, { name: 'stasis', radius: 150, strength: 0 });
      w.addField('timeZone', 800, 520, { name: 'slow', radius: 170, strength: 0.25 });
      w.addField('timeZone', 1270, 520, { name: 'fast', radius: 150, strength: 3 });
      w.settings.ambientTemp = 30;
      install(w, 'tpl_rain');
      w.rules.push(
        rule('Evaporate puddles', 'timer', { interval: '1', target: 'each' }, {
          conditions: [cond('self', 'material', '==', 'water'), cond('self', 'age', '>', '9')],
          actions: [act('destroy', 'self')],
        }),
      );
      return w;
    },
  },
  {
    id: 'phase',
    name: 'Water Cycle',
    tagline: 'Emergent weather',
    accent: '#2f8cff',
    description: 'A heater at the bottom and a cold zone at the top. Ice melts, water boils into steam, steam rises, condenses in the cold and rains back down — a cycle emerging purely from material rules.',
    build: (seed) => {
      const w = base(seed, 'Water Cycle', 'Phase transitions create an endless weather cycle.');
      w.settings.ambientExchange = 0.02;
      floor(w, { material: 'metal' });
      w.addField('heat', 800, 930, { name: 'stove', shape: 'rect', w: 900, h: 120, strength: 420 });
      w.addField('heat', 800, 75, { name: 'cloud deck', shape: 'rect', w: 1600, h: 150, strength: -120 });
      const r = w.rng;
      scatter(w, 70, (i) => w.spawn({ shape: { type: 'box', w: 18, h: 18 }, x: 420 + (i % 14) * 54, y: 400 + Math.floor(i / 14) * 40, angle: r.range(0, 1), material: 'ice', origin: 'preset' }));
      // steam doesn't time out in this world
      const steam = w.materials.get('steam');
      if (steam) w.setMaterial({ ...steam, lifetime: -1 });
      return w;
    },
  },
  {
    id: 'forest',
    name: 'Firestorm',
    tagline: 'Heat spreads',
    accent: '#ff7a1a',
    description: 'Towers of wood, a steady breeze and one falling drop of lava. Wood ignites into embers that shed rising flames; heat conducts block to block and the wind carries flames to the next tower until the forest burns down to ash.',
    build: (seed) => {
      const w = base(seed, 'Firestorm', 'Wood, fire and conduction.');
      w.settings.impactHeat = 3;
      w.settings.wind = { x: 70, y: 0 };
      floor(w);
      const r = w.rng;
      let firstTop = 900;
      for (let t = 0; t < 9; t++) {
        const x = 230 + t * 145;
        const h = r.int(5, 9);
        for (let k = 0; k < h; k++) w.spawn({ shape: { type: 'box', w: 60, h: 24 }, x: x + r.range(-2, 2), y: 965 - k * 25, material: 'wood', origin: 'preset' });
        if (t === 0) firstTop = 965 - (h - 1) * 25 - 12;
      }
      // a drop of lava lands on the first tower and starts it all
      w.spawn({ shape: { type: 'circle', radius: 12 }, x: 230, y: firstTop - 40, material: 'lava', origin: 'preset' });
      w.rules.push(
        rule('Embers shed flames', 'timer', { interval: '0.12', target: 'each' }, {
          conditions: [cond('self', 'tag', 'has', 'burning')],
          maxPerStep: 200,
          actions: [act('emitParticles', 'self', { count: '1', material: 'fire', speed: 'rand(20, 90)', life: 'rand(0.4, 0.9)', size: 'rand(2, 4)' })],
        }),
        rule('Sparks fly', 'timer', { interval: '0.5', target: 'each' }, {
          conditions: [cond('self', 'tag', 'has', 'burning'), cond('world', 'chance', '<', '0.3')],
          actions: [act('emitParticles', 'self', { count: '2', material: 'spark', speed: 'rand(120, 320)', life: 'rand(0.8, 1.6)' })],
        }),
        rule('Radiant heat', 'proximity', { radius: '26', mode: 'while', every: '3' }, {
          conditions: [cond('self', 'tag', 'has', 'burning'), cond('other', 'material', '==', 'wood')],
          actions: [act('setProperty', 'other', { property: 'temperature', op: 'add', value: '9' })],
        }),
        rule('Sparks ignite wood', 'collision', {}, {
          conditions: [cond('self', 'material', '==', 'spark'), cond('other', 'material', '==', 'wood')],
          actions: [act('setProperty', 'other', { property: 'temperature', op: 'add', value: '140' }), act('destroy', 'self')],
        }),
        rule('Census', 'timer', { interval: '0.5', target: 'world' }, {
          actions: [act('setVar', 'world', { name: 'burning', op: 'set', value: "count('burning')" }), act('setVar', 'world', { name: 'ash', op: 'set', value: "countMat('ash')" })],
        }),
      );
      return w;
    },
  },
  {
    id: 'electro',
    name: 'Electro Swarm',
    tagline: 'Charges & bonds',
    accent: '#ff3df2',
    description: 'Charged particles (magnetite +, antimagnetite −) attract and repel, and atoms bond with springs when they touch gently — crystals and molecules self-assemble.',
    build: (seed) => {
      const w = base(seed, 'Electro Swarm', 'Charge forces and bonding rules.');
      w.settings.gravity = { x: 0, y: 0 };
      w.settings.coulomb = 1.2;
      w.settings.airDrag = 0.5;
      const r = w.rng;
      scatter(w, 90, (i) => {
        const e = w.spawn({ shape: { type: 'circle', radius: 9 }, x: r.range(100, 1500), y: r.range(100, 900), vx: r.range(-80, 80), vy: r.range(-80, 80), material: i % 2 ? 'magnet' : 'antimagnet', origin: 'preset', tags: ['atom'] });
        if (e) e.charge = i % 2 ? 2 : -2;
      });
      install(w, 'tpl_bonds');
      return w;
    },
  },
  {
    id: 'fireworks',
    name: 'Fireworks Foundry',
    tagline: 'Heat → launch → boom',
    accent: '#ff4f9a',
    description: 'Rockets roll onto a heater. Past 420° they launch; past 700° they detonate into sparks. New rockets are delivered every few seconds.',
    build: (seed) => {
      const w = base(seed, 'Fireworks Foundry', 'Temperature-triggered rockets.');
      floor(w);
      w.addField('heat', 800, 930, { name: 'launchpad', shape: 'rect', w: 500, h: 90, strength: 260 });
      ramp(w, 300, 760, 560, 0.3, 'metal');
      ramp(w, 1300, 760, 560, -0.3, 'metal');
      install(w, 'tpl_fireworks');
      w.rules.push(
        rule('Deliver rockets', 'timer', { interval: '1.4', target: 'world' }, {
          conditions: [cond('world', 'expr', '==', "count('rocket') < 14")],
          actions: [
            act('spawn', 'world', { material: 'rubber', shape: 'circle', size: '11', x: 'rand(0,1) < 0.5 ? 120 : world.width - 120', y: '520', vx: '0', vy: '0', count: '1', tag: 'rocket' }),
          ],
        }),
        rule('Paint rockets', 'creation', {}, {
          conditions: [cond('self', 'tag', 'has', 'rocket')],
          actions: [act('setProperty', 'self', { property: 'color', color: '#ff4f9a' })],
        }),
      );
      return w;
    },
  },
  {
    id: 'blank',
    name: 'Empty Lab',
    tagline: 'Start from nothing',
    accent: '#8fa3bf',
    description: 'A floor and nothing else. Build your own universe.',
    build: (seed) => {
      const w = base(seed, 'Empty Lab', 'A blank universe.');
      floor(w);
      return w;
    },
  },
];

export function buildPreset(id: string, seed = 1): World {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  const w = p.build(seed);
  w.engine.invalidate();
  return w;
}
