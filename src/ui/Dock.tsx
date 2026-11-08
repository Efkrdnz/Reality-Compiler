import { useEffect, useRef, useState } from 'react';
import { METRIC_INFO, METRIC_KEYS } from '../sim/metrics';
import type { LogEntry } from '../sim/types';
import { Sparkline } from './components/controls';
import { sim, useTick } from './sim';
import { useUI, type DockTab } from './store';
import { viewRef } from './Viewport';

const KINDS: LogEntry['kind'][] = ['rule', 'signal', 'state', 'info', 'warn', 'error'];

function Events() {
  useTick(5);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [follow, setFollow] = useState(true);
  const [frozen, setFrozen] = useState<LogEntry[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const log = frozen ?? sim.world.log;
  const items = log.filter((l) => !hidden.has(l.kind) && (!q || l.text.toLowerCase().includes(q.toLowerCase()))).slice(-300);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  const counts = new Map<string, number>();
  for (const l of sim.world.log) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div className="flex" style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)' }}>
        {KINDS.map((k) => (
          <button
            key={k}
            className={`btn sm ${hidden.has(k) ? '' : 'active'}`}
            onClick={() =>
              setHidden((s) => {
                const n = new Set(s);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })
            }
          >
            <span className={`kind ${k}`}>{k}</span> <span className="mono muted">{counts.get(k) ?? 0}</span>
          </button>
        ))}
        <input className="input" placeholder="search events…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
        <div className="spacer" />
        <button className={`btn sm ${frozen ? 'active' : ''}`} onClick={() => setFrozen(frozen ? null : [...sim.world.log])} title="Freeze the list to inspect it">
          {frozen ? 'Frozen' : 'Freeze'}
        </button>
        <button className={`btn sm ${follow ? 'active' : ''}`} onClick={() => setFollow(!follow)}>
          Follow
        </button>
        <button
          className="btn sm"
          onClick={() => {
            sim.world.log = [];
            setFrozen(null);
          }}
        >
          Clear
        </button>
      </div>
      <div className="events" ref={ref} onWheel={() => setFollow(false)} data-testid="event-list">
        {items.length === 0 && <div className="muted" style={{ padding: 14 }}>No events yet. Rule firings, signals, phase changes and safety warnings appear here.</div>}
        {items.map((l, i) => (
          <div
            key={i}
            className="event"
            onClick={() => {
              if (l.entityId !== undefined && sim.world.get(l.entityId)) useUI.getState().select(l.entityId);
              if (l.ruleId) useUI.getState().focusRule(l.ruleId);
            }}
            title={l.text}
          >
            <span className="t">{l.time.toFixed(2)}s</span>
            <span className={`kind ${l.kind}`}>{l.kind}</span>
            <span className="d">{l.depth ? `depth ${l.depth}` : `#${l.step}`}</span>
            <span className="txt">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metrics() {
  useTick(4);
  const m = sim.metrics;
  const vars = Object.entries(sim.world.vars);
  return (
    <div className="metrics-grid" data-testid="metrics">
      {METRIC_KEYS.map((k) => {
        const info = METRIC_INFO[k];
        return (
          <div key={k} className="metric">
            <div className="metric-head">
              <span>{info.label}</span>
              <b style={{ color: info.color }}>
                {info.format(m.latest(k))}
                <span className="muted small"> {info.unit}</span>
              </b>
            </div>
            <Sparkline data={m.series(k)} color={info.color} />
          </div>
        );
      })}
      {vars.length > 0 && (
        <div className="metric">
          <div className="metric-head">
            <span>Global variables</span>
          </div>
          {vars.map(([k, v]) => (
            <div key={k} className="kv">
              <span className="mono">${k}</span>
              <b>{Number.isInteger(v) ? v : v.toFixed(3)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Diagnostics() {
  useTick(4);
  const w = sim.world;
  const st = w.stats;
  const s = w.settings;
  const [hash, setHash] = useState<string>('');
  const budgetPct = Math.min(100, (st.instructions / s.instructionBudget) * 100);
  const capPct = Math.min(100, (w.liveCount / s.maxEntities) * 100);
  const frameBudget = 1000 / 60;
  return (
    <div className="diag" data-testid="diagnostics">
      <div className="diag-card">
        <h5>Frame</h5>
        <div className="kv"><span>fps</span><b>{viewRef.fps.toFixed(1)}</b></div>
        <div className="kv"><span>frame total</span><b>{viewRef.frameMs.toFixed(2)} ms</b></div>
        <div className="kv"><span>render</span><b>{(viewRef.renderer?.lastDrawMs ?? 0).toFixed(2)} ms</b></div>
        <div className="kv"><span>sim steps / frame</span><b>{sim.stepsLastFrame}</b></div>
        <div className="bar"><i style={{ width: `${Math.min(100, (viewRef.frameMs / frameBudget) * 100)}%`, background: viewRef.frameMs > frameBudget ? 'var(--red)' : undefined }} /></div>
        <div className="kv"><span>status</span><b style={{ color: sim.lagging ? 'var(--red)' : 'var(--lime)' }}>{sim.lagging ? 'lagging — dropping time' : 'real-time'}</b></div>
      </div>
      <div className="diag-card">
        <h5>Simulation step</h5>
        <div className="kv"><span>total</span><b>{st.stepMs.toFixed(3)} ms</b></div>
        <div className="kv"><span>broadphase + narrowphase</span><b>{st.broadphaseMs.toFixed(3)} ms</b></div>
        <div className="kv"><span>solver</span><b>{st.solveMs.toFixed(3)} ms</b></div>
        <div className="kv"><span>rules</span><b>{st.rulesMs.toFixed(3)} ms</b></div>
        <div className="kv"><span>candidate pairs</span><b>{st.pairs}</b></div>
        <div className="kv"><span>contacts</span><b>{st.contacts}</b></div>
        <div className="kv"><span>substeps × iterations</span><b>{s.substeps} × {s.iterations}</b></div>
      </div>
      <div className="diag-card">
        <h5>Rule engine safety</h5>
        <div className="kv"><span>instructions this step</span><b>{st.instructions.toLocaleString()} / {s.instructionBudget.toLocaleString()}</b></div>
        <div className="bar"><i style={{ width: `${budgetPct}%`, background: budgetPct > 90 ? 'var(--red)' : undefined }} /></div>
        <div className="kv"><span>rule firings</span><b>{st.ruleFires}</b></div>
        <div className="kv"><span>budget exhausted</span><b style={{ color: st.budgetExceeded ? 'var(--red)' : undefined }}>{st.budgetExceeded ? 'YES' : 'no'}</b></div>
        <div className="kv"><span>chain depth cut-offs</span><b>{st.chainDepthHits}</b></div>
        <div className="kv"><span>cycles blocked</span><b>{st.cyclesBlocked}</b></div>
        <div className="kv"><span>events dropped</span><b>{st.eventsDropped}</b></div>
      </div>
      <div className="diag-card">
        <h5>Population & determinism</h5>
        <div className="kv"><span>entities</span><b>{w.liveCount} / {s.maxEntities}</b></div>
        <div className="bar"><i style={{ width: `${capPct}%`, background: capPct > 90 ? 'var(--amber)' : undefined }} /></div>
        <div className="kv"><span>spawns blocked (cap)</span><b>{st.spawnBlocked}</b></div>
        <div className="kv"><span>joints / fields</span><b>{w.joints.length} / {w.fields.length}</b></div>
        <div className="kv"><span>seed</span><b>{w.seed}</b></div>
        <div className="kv">
          <span>state hash @ step {w.stepCount}</span>
          <b className="mono">{hash || '—'}</b>
        </div>
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setHash(w.stateHash())} title="Fingerprint of the full dynamic state: replaying from Reset with the same seed reproduces it">
          Compute state hash
        </button>
      </div>
    </div>
  );
}

const TABS: { id: DockTab; label: string }[] = [
  { id: 'events', label: 'Event inspector' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export function Dock() {
  const { dock, setDock, dockOpen, toggleDock } = useUI();
  return (
    <section className="dock">
      <div className="dock-head">
        {TABS.map((t) => (
          <button key={t.id} className={`dock-tab ${dock === t.id && dockOpen ? 'active' : ''}`} onClick={() => (dock === t.id && dockOpen ? toggleDock() : setDock(t.id))} data-testid={`dock-${t.id}`}>
            {t.label}
          </button>
        ))}
        <div className="spacer" />
        <span className="muted small">
          <span className="kbd">`</span> toggle
        </span>
        <button className="btn sm icon" onClick={toggleDock} title="Collapse / expand">
          {dockOpen ? '▾' : '▴'}
        </button>
      </div>
      {dockOpen && (
        <div className="dock-body">
          {dock === 'events' && <Events />}
          {dock === 'metrics' && <Metrics />}
          {dock === 'diagnostics' && <Diagnostics />}
        </div>
      )}
    </section>
  );
}
