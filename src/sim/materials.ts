import type { Material } from './types';

const base = (m: Partial<Material> & Pick<Material, 'id' | 'name' | 'color'>): Material => ({
  density: 1,
  restitution: 0.3,
  friction: 0.5,
  conductivity: 0.3,
  drag: 0,
  gravityScale: 1,
  state: 'solid',
  selfHeat: 0,
  glow: 0.25,
  lifetime: -1,
  decayTo: '',
  charge: 0,
  transitions: [],
  tags: [],
  spawnTemp: null,
  builtin: true,
  ...m,
});

/**
 * Built-in materials. Every field is editable at runtime from the Materials
 * panel, and rules can switch an entity's material ("transform"), so these
 * act as programmable matter: phase changes, ignition, decay and charge are
 * all data.
 */
export const BUILTIN_MATERIALS: Material[] = [
  base({ id: 'stone', name: 'Stone', color: '#8fa3bf', density: 2.4, restitution: 0.15, friction: 0.7, conductivity: 0.2, glow: 0.1,
    transitions: [{ when: 'above', temp: 1200, to: 'lava' }] }),
  base({ id: 'metal', name: 'Metal', color: '#c3d4e6', density: 7.8, restitution: 0.25, friction: 0.4, conductivity: 0.95, glow: 0.15,
    transitions: [{ when: 'above', temp: 1500, to: 'plasma' }] }),
  base({ id: 'rubber', name: 'Rubber', color: '#ff4f9a', density: 1.1, restitution: 0.88, friction: 0.9, conductivity: 0.05, glow: 0.35 }),
  base({ id: 'wood', name: 'Wood', color: '#d49a5a', density: 0.7, restitution: 0.25, friction: 0.65, conductivity: 0.1, glow: 0.1,
    transitions: [{ when: 'above', temp: 260, to: 'ember' }] }),
  base({ id: 'ember', name: 'Ember', color: '#ff5a1f', density: 0.6, restitution: 0.15, friction: 0.7, conductivity: 0.5, glow: 0.9,
    selfHeat: 70, spawnTemp: 700, lifetime: 10, decayTo: 'ash', tags: ['burning'] }),
  base({ id: 'ice', name: 'Ice', color: '#9eefff', density: 0.92, restitution: 0.1, friction: 0.03, conductivity: 0.5, glow: 0.4,
    spawnTemp: -25, transitions: [{ when: 'above', temp: 0, to: 'water' }] }),
  base({ id: 'water', name: 'Water', color: '#2f8cff', density: 1, restitution: 0.05, friction: 0.02, conductivity: 0.6, drag: 0.15,
    state: 'liquid', glow: 0.45,
    transitions: [
      { when: 'below', temp: -2, to: 'ice' },
      { when: 'above', temp: 100, to: 'steam' },
    ] }),
  base({ id: 'steam', name: 'Steam', color: '#d6e6ff', density: 0.05, restitution: 0.4, friction: 0, conductivity: 0.2, drag: 1.2,
    gravityScale: -0.35, state: 'gas', glow: 0.3, spawnTemp: 140, lifetime: 14, decayTo: '',
    transitions: [{ when: 'below', temp: 92, to: 'water' }] }),
  base({ id: 'fire', name: 'Fire', color: '#ff7a1a', density: 0.02, restitution: 0.1, friction: 0, conductivity: 0.9, drag: 1.5,
    gravityScale: -0.6, state: 'plasma', selfHeat: 40, glow: 1, spawnTemp: 900, lifetime: 2.4, decayTo: 'ash',
    transitions: [{ when: 'below', temp: 180, to: 'ash' }] }),
  base({ id: 'ash', name: 'Ash', color: '#5d5a66', density: 0.4, restitution: 0.05, friction: 0.8, conductivity: 0.05, drag: 0.6,
    glow: 0.05, lifetime: 12, decayTo: '' }),
  base({ id: 'lava', name: 'Lava', color: '#ff3d1f', density: 2.6, restitution: 0.02, friction: 0.3, conductivity: 0.7, drag: 0.4,
    state: 'liquid', glow: 0.9, spawnTemp: 1400, selfHeat: 0,
    transitions: [{ when: 'below', temp: 900, to: 'stone' }] }),
  base({ id: 'plasma', name: 'Plasma', color: '#c76bff', density: 0.05, restitution: 0.9, friction: 0, conductivity: 1, drag: 0.2,
    gravityScale: 0, state: 'plasma', glow: 1, spawnTemp: 3000, lifetime: 6, decayTo: '', charge: 1 }),
  base({ id: 'glass', name: 'Glass', color: '#7ff7d4', density: 2.5, restitution: 0.35, friction: 0.25, conductivity: 0.15, glow: 0.55 }),
  base({ id: 'magnet', name: 'Magnetite', color: '#ff3df2', density: 5, restitution: 0.3, friction: 0.6, conductivity: 0.6, glow: 0.7,
    charge: 4 }),
  base({ id: 'antimagnet', name: 'Antimagnetite', color: '#34fff1', density: 5, restitution: 0.3, friction: 0.6, conductivity: 0.6,
    glow: 0.7, charge: -4 }),
  base({ id: 'aether', name: 'Aether', color: '#fff27a', density: 0.3, restitution: 1, friction: 0, conductivity: 0, drag: 0,
    gravityScale: -1, state: 'energy', glow: 1 }),
  base({ id: 'uranium', name: 'Fissile', color: '#7dff4f', density: 9, restitution: 0.2, friction: 0.5, conductivity: 0.4, glow: 0.8,
    tags: ['fissile'] }),
  base({ id: 'neutron', name: 'Neutron', color: '#eaffd9', density: 0.5, restitution: 0.95, friction: 0, conductivity: 0, drag: 0,
    gravityScale: 0, state: 'energy', glow: 1, lifetime: 3.5, tags: ['neutron'] }),
  base({ id: 'replicator', name: 'Replicator', color: '#00ffa3', density: 1.2, restitution: 0.5, friction: 0.4, conductivity: 0.3,
    glow: 0.9, tags: ['replicator'] }),
  base({ id: 'nutrient', name: 'Nutrient', color: '#ffd23f', density: 0.8, restitution: 0.4, friction: 0.3, conductivity: 0.3,
    glow: 0.5, tags: ['food'] }),
  base({ id: 'spark', name: 'Spark', color: '#ffe9a8', density: 0.1, restitution: 0.6, friction: 0, conductivity: 0, drag: 0.8,
    gravityScale: 0.4, state: 'energy', glow: 1, lifetime: 0.9, spawnTemp: 600, selfHeat: 0 }),
  base({ id: 'void', name: 'Void', color: '#3a2a6b', density: 50, restitution: 0, friction: 1, conductivity: 0, glow: 0.6,
    gravityScale: 0 }),
];

export function cloneMaterial(m: Material): Material {
  return { ...m, transitions: m.transitions.map((t) => ({ ...t })), tags: [...m.tags] };
}

export function defaultMaterials(): Material[] {
  return BUILTIN_MATERIALS.map(cloneMaterial);
}

export function newCustomMaterial(id: string): Material {
  return base({ id, name: id, color: '#9d7bff', builtin: false });
}
