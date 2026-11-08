import { useState } from 'react';
import { FIELD_INFO } from '../sim/fields';
import type { FieldKind } from '../sim/types';
import { Icons } from './icons';
import { sim, useSimVersion } from './sim';
import { useUI, type Tool } from './store';

export const TOOLS: { id: Tool; icon: keyof typeof Icons; label: string; key: string; hint: string }[] = [
  { id: 'select', icon: 'select', label: 'Select & drag', key: '1', hint: 'Click to inspect, drag to throw. Drag empty space to pan.' },
  { id: 'circle', icon: 'circle', label: 'Spawn circle', key: '2', hint: 'Click to spawn. Drag back and release to slingshot.' },
  { id: 'box', icon: 'box', label: 'Spawn box', key: '3', hint: 'Click to spawn. Drag to slingshot.' },
  { id: 'triangle', icon: 'triangle', label: 'Spawn triangle', key: '4', hint: 'Click to spawn. Drag to slingshot.' },
  { id: 'hexagon', icon: 'hexagon', label: 'Spawn hexagon', key: '5', hint: 'Click to spawn. Drag to slingshot.' },
  { id: 'particle', icon: 'particle', label: 'Particle spray', key: '6', hint: 'Hold to spray particles of the current material.' },
  { id: 'wall', icon: 'wall', label: 'Draw wall', key: '7', hint: 'Drag to draw a static wall.' },
  { id: 'connect', icon: 'connect', label: 'Connect', key: '8', hint: 'Click two bodies to link them. Shift = spring, Alt = fan out.' },
  { id: 'erase', icon: 'erase', label: 'Erase', key: '9', hint: 'Click or drag to delete bodies (or a field).' },
  { id: 'blast', icon: 'blast', label: 'Blast', key: '0', hint: 'Click to push everything away.' },
];

const FIELDS: FieldKind[] = ['well', 'gravityZone', 'wind', 'vortex', 'heat', 'timeZone', 'portal'];
const PALETTE = ['rubber', 'stone', 'metal', 'wood', 'glass', 'ice', 'water', 'fire', 'magnet', 'antimagnet', 'aether', 'replicator', 'nutrient', 'uranium', 'plasma'];

export function Toolbar() {
  useSimVersion();
  const { tool, setTool, fieldKind, setFieldKind, material, setMaterial } = useUI();
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const show = (e: React.MouseEvent, title: string, sub: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: r.right + 10, y: r.top + r.height / 2 - 16, title, sub });
  };
  const mats = PALETTE.filter((m) => sim.world.materials.has(m));
  const custom = [...sim.world.materials.values()].filter((m) => !m.builtin).map((m) => m.id);
  return (
    <nav className="toolbar" onMouseLeave={() => setTip(null)}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool ${tool === t.id ? 'active' : ''}`}
          onClick={() => setTool(t.id)}
          onMouseEnter={(e) => show(e, `${t.label}`, t.hint)}
          onMouseLeave={() => setTip(null)}
          data-testid={`tool-${t.id}`}
          aria-label={t.label}
        >
          {Icons[t.icon]}
          <span className="key">{t.key}</span>
        </button>
      ))}
      <div className="tool-sep" />
      {FIELDS.map((k) => (
        <button
          key={k}
          className={`tool ${tool === 'field' && fieldKind === k ? 'active' : ''}`}
          style={{ color: tool === 'field' && fieldKind === k ? FIELD_INFO[k].color : undefined }}
          onClick={() => setFieldKind(k)}
          onMouseEnter={(e) => show(e, FIELD_INFO[k].label, `${FIELD_INFO[k].describe}${k !== 'portal' && k !== 'timeZone' ? ' Alt-click places the inverse.' : ''}`)}
          onMouseLeave={() => setTip(null)}
          data-testid={`field-${k}`}
          aria-label={FIELD_INFO[k].label}
        >
          {Icons[k]}
        </button>
      ))}
      <div className="tool-sep" />
      <div className="swatches">
        {[...mats, ...custom].map((id) => {
          const m = sim.world.materials.get(id)!;
          return (
            <button
              key={id}
              className={`swatch ${material === id ? 'active' : ''}`}
              style={{ background: `radial-gradient(circle at 35% 30%, #fff8, ${m.color} 45%, ${m.color}66)`, boxShadow: material === id ? `0 0 12px ${m.color}` : undefined }}
              onClick={() => setMaterial(id)}
              onMouseEnter={(e) => show(e, m.name, `${m.state} · density ${m.density} · bounce ${m.restitution}`)}
              onMouseLeave={() => setTip(null)}
              aria-label={`Material ${m.name}`}
              data-testid={`mat-${id}`}
            />
          );
        })}
      </div>
      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.title}
          <small>{tip.sub}</small>
        </div>
      )}
    </nav>
  );
}
