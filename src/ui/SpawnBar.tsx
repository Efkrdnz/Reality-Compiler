import { FIELD_INFO } from '../sim/fields';
import { sim, useSimVersion } from './sim';
import { useUI } from './store';
import { TOOLS } from './Toolbar';

const ORDER = ['rubber', 'stone', 'metal', 'wood', 'glass', 'ice', 'water', 'lava', 'fire', 'steam', 'magnet', 'antimagnet', 'aether', 'plasma', 'replicator', 'nutrient', 'uranium', 'neutron', 'spark', 'ash', 'void'];

/** Floating palette in the viewport: material, size and static toggle for spawning tools. */
export function SpawnBar() {
  useSimVersion();
  const { tool, fieldKind, material, setMaterial, size, setSize, staticSpawn, setStaticSpawn } = useUI();
  const w = sim.world;
  const mats = [...ORDER.filter((id) => w.materials.has(id)), ...[...w.materials.keys()].filter((id) => !ORDER.includes(id))];
  const spawning = ['circle', 'box', 'triangle', 'hexagon', 'particle', 'wall', 'erase'].includes(tool);
  const t = TOOLS.find((x) => x.id === tool);
  const title = tool === 'field' ? FIELD_INFO[fieldKind].label : t?.label;
  const hint = tool === 'field' ? `${FIELD_INFO[fieldKind].describe} ${fieldKind === 'portal' ? 'Click twice to place a linked pair.' : 'Alt-click for the inverse.'}` : t?.hint;
  const m = w.materials.get(material);
  return (
    <div className="spawnbar" data-testid="spawnbar">
      <div className="spawnbar-head">
        <b>{title}</b>
        <span>{hint}</span>
      </div>
      {spawning && tool !== 'erase' && (
        <div className="spawnbar-mats">
          {mats.map((id) => {
            const mm = w.materials.get(id)!;
            return (
              <button
                key={id}
                className={`swatch ${material === id ? 'active' : ''}`}
                style={{ background: `radial-gradient(circle at 35% 30%, #fff8, ${mm.color} 45%, ${mm.color}66)`, boxShadow: material === id ? `0 0 12px ${mm.color}` : undefined }}
                onClick={() => setMaterial(id)}
                title={`${mm.name} — ${mm.state}, density ${mm.density}, bounce ${mm.restitution}`}
                aria-label={`Material ${mm.name}`}
                data-testid={`mat-${id}`}
              />
            );
          })}
        </div>
      )}
      {spawning && (
        <div className="spawnbar-row">
          {tool !== 'erase' && m && (
            <span className="matbadge" style={{ color: m.color, minWidth: 90 }}>
              <i style={{ background: m.color }} />
              <span style={{ color: 'var(--text)' }}>{m.name}</span>
            </span>
          )}
          <span className="muted small">{tool === 'erase' ? 'brush' : 'size'}</span>
          <input
            type="range"
            min={2}
            max={80}
            step={1}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            style={{ ['--p' as string]: `${((size - 2) / 78) * 100}%`, width: 110 }}
            aria-label="Spawn size"
          />
          <span className="mono small" style={{ width: 26 }}>{size}</span>
          {['circle', 'box', 'triangle', 'hexagon'].includes(tool) && (
            <label className="flex small muted" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={staticSpawn} onChange={(e) => setStaticSpawn(e.target.checked)} /> static
            </label>
          )}
        </div>
      )}
    </div>
  );
}
