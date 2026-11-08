import { act, cond, rule } from './build';
import type { RuleModule } from './types';

/**
 * Built-in rule modules. Each is a reusable bundle of rules that can be
 * installed into any world (ids are remapped on install) and edited freely.
 */
export const TEMPLATE_MODULES: RuleModule[] = [
  {
    id: 'tpl_impact_sparks',
    name: 'Impact Sparks',
    description: 'Hard impacts throw sparks. A simple, satisfying collision rule.',
    builtin: true,
    rules: [
      rule('Sparks on hard impact', 'collision', { minSpeed: '380' }, {
        id: 'sparks',
        conditions: [cond('self', 'kind', '==', 'body'), cond('other', 'kind', '==', 'body')],
        actions: [act('emitParticles', 'self', { count: 'clamp(event.relSpeed / 90, 2, 10)', speed: 'rand(80, 260)', material: 'spark' })],
        cooldown: 0.15,
      }),
    ],
  },
  {
    id: 'tpl_replicator',
    name: 'Self-Replicating Matter',
    description: 'Replicators convert food they touch, divide when well fed, and die of old age. Population is bounded by the entity cap and food supply.',
    builtin: true,
    rules: [
      rule('Eat food', 'collision', {}, {
        id: 'eat', priority: 10,
        conditions: [cond('self', 'tag', 'has', 'replicator'), cond('other', 'tag', 'has', 'food')],
        actions: [
          act('destroy', 'other'),
          act('setVar', 'self', { name: 'energy', op: 'add', value: '1' }),
          act('emitParticles', 'self', { count: '4', material: 'spark', color: '#00ffa3', speed: 'rand(40,140)' }),
        ],
      }),
      rule('Divide when fed', 'timer', { interval: '0.5', target: 'each' }, {
        id: 'divide',
        conditions: [cond('self', 'tag', 'has', 'replicator'), cond('self', 'var', '>=', '2', 'energy')],
        actions: [
          act('setVar', 'self', { name: 'energy', op: 'set', value: '0' }),
          act('duplicate', 'self', { count: '1', kick: '160' }),
        ],
      }),
      rule('Die of old age', 'timer', { interval: '1', target: 'each' }, {
        id: 'age',
        conditions: [cond('self', 'tag', 'has', 'replicator'), cond('self', 'age', '>', '28'), cond('world', 'chance', '<', '0.25')],
        actions: [act('transform', 'self', { material: 'nutrient' })],
      }),
    ],
  },
  {
    id: 'tpl_chain_reaction',
    name: 'Fission Chain Reaction',
    description: 'Neutrons split fissile matter, which releases more neutrons and a shockwave.',
    builtin: true,
    rules: [
      rule('Fission', 'collision', {}, {
        id: 'fission', priority: 20,
        conditions: [cond('self', 'tag', 'has', 'fissile'), cond('other', 'tag', 'has', 'neutron')],
        actions: [
          act('destroy', 'other'),
          act('spawn', 'self', { material: 'neutron', shape: 'particle', size: '3', x: 'self.x', y: 'self.y', vx: 'rand(-520, 520)', vy: 'rand(-520, 520)', count: '3' }),
          act('explode', 'self', { radius: '110', strength: '260', heat: '400' }),
          act('emitParticles', 'self', { count: '10', material: 'fire', speed: 'rand(60, 240)', size: '3' }),
          act('destroy', 'self'),
          act('setVar', 'world', { name: 'fissions', op: 'add', value: '1' }),
        ],
      }),
    ],
  },
  {
    id: 'tpl_gravity_flip',
    name: 'Gravity Clock',
    description: 'Every few seconds gravity reverses direction.',
    builtin: true,
    rules: [
      rule('Flip gravity', 'timer', { interval: '4', target: 'world' }, {
        id: 'flip',
        actions: [
          act('setGravity', 'world', { gx: 'world.gx', gy: '-world.gy' }),
          act('setVar', 'world', { name: 'flips', op: 'add', value: '1' }),
          act('log', 'world', { message: 'gravity flipped → gy = {world.gy}' }),
        ],
      }),
    ],
  },
  {
    id: 'tpl_fireworks',
    name: 'Thermal Fireworks',
    description: 'Anything heated past 420° launches upward, then detonates at 700°.',
    builtin: true,
    rules: [
      rule('Ignite & launch', 'temperature', { threshold: '420', direction: 'above' }, {
        id: 'launch',
        conditions: [cond('self', 'tag', 'has', 'rocket')],
        actions: [act('force', 'self', { fx: 'rand(-120, 120)', fy: '-900', mode: 'velocity' }), act('setProperty', 'self', { property: 'gravityScale', op: 'set', value: '0.2' })],
      }),
      rule('Detonate', 'temperature', { threshold: '700', direction: 'above' }, {
        id: 'boom', priority: 5,
        conditions: [cond('self', 'tag', 'has', 'rocket')],
        actions: [
          act('emitParticles', 'self', { count: '28', speed: 'rand(150, 420)', material: 'spark', life: 'rand(0.6, 1.6)', size: '3', color: '' }),
          act('explode', 'self', { radius: '140', strength: '420', heat: '0' }),
          act('destroy', 'self'),
        ],
      }),
      rule('Rocket self-heating', 'timer', { interval: '0', target: 'each' }, {
        id: 'burn',
        conditions: [cond('self', 'tag', 'has', 'rocket'), cond('self', 'temperature', '>', '420')],
        actions: [act('setProperty', 'self', { property: 'temperature', op: 'add', value: '6' })],
      }),
    ],
  },
  {
    id: 'tpl_magnetism',
    name: 'Tag Magnetism',
    description: '“north” bodies pull “south” bodies; same tags push apart. Built only from proximity rules.',
    builtin: true,
    rules: [
      rule('Opposites attract', 'proximity', { radius: '160', mode: 'while', every: '1' }, {
        id: 'attract',
        conditions: [cond('self', 'tag', 'has', 'north'), cond('other', 'tag', 'has', 'south')],
        actions: [act('push', 'other', { strength: '14', direction: 'toward' }), act('push', 'self', { strength: '14', direction: 'toward' })],
      }),
      rule('Likes repel', 'proximity', { radius: '90', mode: 'while', every: '1' }, {
        id: 'repel',
        conditionMode: 'all',
        conditions: [cond('self', 'tag', 'has', 'north'), cond('other', 'tag', 'has', 'north')],
        actions: [act('push', 'self', { strength: '10', direction: 'away' })],
      }),
    ],
  },
  {
    id: 'tpl_bonds',
    name: 'Molecular Bonds',
    description: 'Atoms that collide gently bond with springs (max 3 bonds each); hard hits break bonds.',
    builtin: true,
    rules: [
      rule('Bond on contact', 'collision', { minSpeed: '0' }, {
        id: 'bond',
        conditions: [cond('self', 'tag', 'has', 'atom'), cond('other', 'tag', 'has', 'atom'), cond('world', 'expr', '==', 'event.relSpeed < 420')],
        actions: [act('connect', 'self', { stiffness: '0.5', length: 'self.radius + other.radius + 6', breakImpulse: '2200', maxLinks: '3' })],
      }),
    ],
  },
  {
    id: 'tpl_speed_paint',
    name: 'Speed Paint',
    description: 'Bodies glow hot pink when fast and return to cyan when slow (velocity triggers).',
    builtin: true,
    rules: [
      rule('Fast → pink', 'velocity', { threshold: '650', direction: 'above' }, {
        id: 'fast',
        actions: [act('transform', 'self', { color: '#ff3df2' })],
      }),
      rule('Slow → cyan', 'velocity', { threshold: '200', direction: 'below' }, {
        id: 'slow',
        actions: [act('transform', 'self', { color: '#3df2ff' })],
      }),
    ],
  },
  {
    id: 'tpl_rain',
    name: 'Rain Machine',
    description: 'Spawns water droplets along the top edge.',
    builtin: true,
    rules: [
      rule('Rain', 'timer', { interval: '0.12', target: 'world' }, {
        id: 'rain',
        conditions: [cond('world', 'expr', '==', "countMat('water') < 220")],
        actions: [act('spawn', 'world', { material: 'water', shape: 'circle', size: 'rand(5, 8)', x: 'rand(40, world.width - 40)', y: '30', vx: 'rand(-30,30)', vy: '80', count: '1' })],
      }),
    ],
  },
  {
    id: 'tpl_signal_chain',
    name: 'Signal Relay',
    description: 'Clicking a “relay” body (or any collision) passes a signal along a chain of relays — an event chain with depth and cycle protection.',
    builtin: true,
    rules: [
      rule('Relay hit', 'collision', { minSpeed: '120' }, {
        id: 'hit',
        conditions: [cond('self', 'tag', 'has', 'relay')],
        cooldown: 1,
        actions: [act('emitSignal', 'self', { name: 'relay' })],
      }),
      rule('Relay pulse', 'signal', { name: 'relay' }, {
        id: 'pulse',
        actions: [
          act('emitParticles', 'self', { count: '6', material: 'spark', color: '#7af7ff' }),
          act('setVar', 'world', { name: 'relays', op: 'add', value: '1' }),
          act('push', 'tagged', { strength: '160', direction: 'up' }, 'relay'),
        ],
      }),
    ],
  },
  {
    id: 'tpl_climate',
    name: 'Climate Oscillator',
    description: 'Ambient temperature swings between freezing and boiling on a sine wave — a rule-controlled environment.',
    builtin: true,
    rules: [
      rule('Seasons', 'timer', { interval: '0.25', target: 'world' }, {
        id: 'seasons',
        actions: [act('setEnvironment', 'world', { param: 'ambientTemp', op: 'set', value: '50 + 90 * sin(world.time * 0.35)' })],
      }),
    ],
  },
  {
    id: 'tpl_entropy',
    name: 'Entropy',
    description: 'Anything older than 30 s has a chance to crumble into ash each second.',
    builtin: true,
    rules: [
      rule('Crumble', 'timer', { interval: '1', target: 'each' }, {
        id: 'crumble',
        conditions: [cond('self', 'age', '>', '30'), cond('world', 'chance', '<', '0.08')],
        actions: [act('transform', 'self', { material: 'ash' })],
      }),
    ],
  },
];
