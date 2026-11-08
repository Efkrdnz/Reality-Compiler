import type { Entity, Field, FieldKind } from './types';

export function fieldContains(f: Field, x: number, y: number, pad = 0): boolean {
  if (f.shape === 'rect') return Math.abs(x - f.x) <= f.w / 2 + pad && Math.abs(y - f.y) <= f.h / 2 + pad;
  const dx = x - f.x;
  const dy = y - f.y;
  const r = f.radius + pad;
  return dx * dx + dy * dy <= r * r;
}

export function fieldAffects(f: Field, e: Entity): boolean {
  return f.enabled && (!f.tagFilter || e.tags.includes(f.tagFilter));
}

export interface FieldAccum {
  ax: number;
  ay: number;
  gx: number;
  gy: number;
  timeScale: number;
  heat: number;
}

/**
 * Accumulates the influence of one field on an entity inside it.
 * Accelerations are mass independent (like gravity).
 */
export function accumulateField(f: Field, e: Entity, acc: FieldAccum): void {
  const dx = f.x - e.x;
  const dy = f.y - e.y;
  switch (f.kind) {
    case 'well': {
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2) || 1e-6;
      const R = Math.max(1, f.radius);
      let mag: number;
      if (f.falloff <= 0) mag = f.strength;
      else if (f.falloff === 1) mag = f.strength * Math.max(0, 1 - d / R);
      else {
        // softened inverse square, normalised so that magnitude == strength at 30% of the radius
        const r0 = R * 0.3;
        mag = Math.min(f.strength * 6, (f.strength * r0 * r0) / Math.max(d2, 16 * 16));
        if (f.strength < 0) mag = Math.max(f.strength * 6, (f.strength * r0 * r0) / Math.max(d2, 16 * 16));
      }
      acc.ax += (dx / d) * mag;
      acc.ay += (dy / d) * mag;
      break;
    }
    case 'gravityZone':
      acc.gx = Math.cos(f.angle) * f.strength;
      acc.gy = Math.sin(f.angle) * f.strength;
      break;
    case 'wind':
      acc.ax += Math.cos(f.angle) * f.strength;
      acc.ay += Math.sin(f.angle) * f.strength;
      break;
    case 'vortex': {
      const d = Math.hypot(dx, dy) || 1e-6;
      const fall = Math.max(0, 1 - d / Math.max(1, f.radius));
      // tangential (counter-clockwise on screen for positive strength) + gentle inward pull
      acc.ax += (-dy / d) * f.strength * fall + (dx / d) * Math.abs(f.strength) * 0.25 * fall;
      acc.ay += (dx / d) * f.strength * fall + (dy / d) * Math.abs(f.strength) * 0.25 * fall;
      break;
    }
    case 'heat':
      acc.heat += f.strength;
      break;
    case 'timeZone':
      acc.timeScale *= Math.max(0, Math.min(8, f.strength));
      break;
    case 'portal':
      break;
  }
}

export const FIELD_INFO: Record<FieldKind, { label: string; unit: string; color: string; describe: string; defaultStrength: number }> = {
  well: { label: 'Gravity Well', unit: 'px/s²', color: '#8a7bff', describe: 'Attracts (+) or repels (−) everything inside its radius.', defaultStrength: 900 },
  gravityZone: { label: 'Gravity Zone', unit: 'px/s²', color: '#3df2ff', describe: 'Overrides world gravity inside the region with its own direction.', defaultStrength: 600 },
  wind: { label: 'Wind', unit: 'px/s²', color: '#9effc6', describe: 'Constant push in a direction.', defaultStrength: 500 },
  vortex: { label: 'Vortex', unit: 'px/s²', color: '#ff7ae0', describe: 'Swirls bodies around its centre.', defaultStrength: 900 },
  heat: { label: 'Heat Zone', unit: '°/s', color: '#ff6a2b', describe: 'Heats (+) or cools (−) whatever is inside.', defaultStrength: 220 },
  timeZone: { label: 'Time Zone', unit: '× time', color: '#ffe066', describe: 'Local time dilation: 0 = stasis, 0.2 = slow, 3 = fast.', defaultStrength: 0.2 },
  portal: { label: 'Portal', unit: '', color: '#00f0ff', describe: 'Teleports bodies to its linked portal, rotating velocity by the angle difference.', defaultStrength: 1 },
};
