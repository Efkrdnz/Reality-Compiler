import type { RefObject } from 'react';
import type { ViewOptions } from '../render/renderer';
import { Icons } from './icons';
import { SpawnBar } from './SpawnBar';
import { sim, useTick } from './sim';
import { useUI } from './store';
import { viewRef } from './Viewport';

const TOGGLES: { key: keyof ViewOptions; icon: keyof typeof Icons; label: string; kbd: string }[] = [
  { key: 'trails', icon: 'trails', label: 'Glowing trails', kbd: 'T' },
  { key: 'fields', icon: 'fields', label: 'Field overlays', kbd: 'F' },
  { key: 'vectors', icon: 'vectors', label: 'Velocity vectors', kbd: 'V' },
  { key: 'heat', icon: 'thermo', label: 'Heat vision', kbd: 'H' },
  { key: 'contacts', icon: 'contacts', label: 'Contact points', kbd: 'K' },
  { key: 'labels', icon: 'labels', label: 'Labels', kbd: 'L' },
  { key: 'glow', icon: 'glow', label: 'Bloom', kbd: 'B' },
  { key: 'grid', icon: 'grid', label: 'Grid', kbd: 'G' },
];

export function Hud({ cursor }: { cursor: RefObject<{ wx: number; wy: number; inside: boolean }> }) {
  useTick(6);
  const view = useUI((s) => s.view);
  const toggleView = useUI((s) => s.toggleView);
  const w = sim.world;
  const st = w.stats;
  const c = cursor.current;
  const zoom = viewRef.renderer?.camera.zoom ?? 1;
  const g = w.settings.gravity;
  const vars = Object.entries(w.vars).slice(0, 6);
  return (
    <>
      <div className="hud tl">
        <div className="hud-title">{w.name}</div>
        <div className="hud-row">
          <span>
            t <b>{w.time.toFixed(2)}s</b>
          </span>
          <span>
            step <b>{w.stepCount}</b>
          </span>
          <span>
            bodies <b>{w.liveCount}</b>
          </span>
          <span>
            g <b>{`${Math.round(g.x)}, ${Math.round(g.y)}`}</b>
          </span>
        </div>
        <div className="hud-row" style={{ marginTop: 8, flexWrap: 'wrap', maxWidth: 520 }}>
          {!sim.running && (
            <span className="chip paused">
              <span className="dot" /> PAUSED
            </span>
          )}
          {sim.running && sim.speed !== 1 && <span className="chip">{sim.speed < 1 ? 'SLOW-MO' : 'FAST'} ×{sim.speed.toFixed(2)}</span>}
          {w.settings.timeScale !== 1 && <span className="chip">world time ×{w.settings.timeScale.toFixed(2)}</span>}
          {st.budgetExceeded && <span className="chip warn">instruction budget hit</span>}
          {st.chainDepthHits > 0 && <span className="chip warn">chain depth cut ×{st.chainDepthHits}</span>}
          {st.cyclesBlocked > 0 && <span className="chip warn">cycles blocked ×{st.cyclesBlocked}</span>}
          {st.spawnBlocked > 0 && <span className="chip warn">entity cap</span>}
          {sim.lagging && <span className="chip warn">sim can't keep up — dropping time</span>}
        </div>
        {vars.length > 0 && (
          <div className="hud-row" style={{ marginTop: 6 }}>
            {vars.map(([k, v]) => (
              <span key={k}>
                ${k} <b>{Number.isInteger(v) ? v : v.toFixed(2)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="hud tr">
        <div>
          {viewRef.fps.toFixed(0)} fps · sim {st.stepMs.toFixed(2)}ms · draw {(viewRef.renderer?.lastDrawMs ?? 0).toFixed(1)}ms
        </div>
        <div style={{ marginTop: 3, color: 'var(--dim)' }}>
          seed {w.seed} · {w.rules.length} rules · {w.fields.length} fields · {w.joints.length} joints
        </div>
      </div>
      <SpawnBar />
      <div className="hud" style={{ right: 14, bottom: 52 }}>
        {c?.inside && (
          <span>
            x {c.wx.toFixed(0)} y {c.wy.toFixed(0)} · zoom {(zoom * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="view-toggles" style={{ pointerEvents: 'auto' }}>
        {TOGGLES.map((t) => (
          <button
            key={t.key}
            className={`btn sm icon ${view[t.key] ? 'active' : ''}`}
            title={`${t.label} (${t.kbd})`}
            onClick={() => toggleView(t.key)}
            style={{ width: 28, height: 28 }}
          >
            <span style={{ width: 16, height: 16, display: 'grid' }}>{Icons[t.icon]}</span>
          </button>
        ))}
        <button className="btn sm icon" title="Fit world to view (Home)" onClick={() => window.dispatchEvent(new Event('rc:fit'))} style={{ width: 28, height: 28 }}>
          <span style={{ width: 16, height: 16, display: 'grid' }}>{Icons.fit}</span>
        </button>
      </div>
    </>
  );
}
