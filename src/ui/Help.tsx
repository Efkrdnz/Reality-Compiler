import { useUI } from './store';

const SHORTCUTS: [string, string][] = [
  ['Play / pause', 'Space'],
  ['Step one tick', 'N  or  .'],
  ['Reset universe', 'R'],
  ['Slower / faster', '[  ]'],
  ['Normal speed', '\\'],
  ['Undo / redo', 'Ctrl Z  /  Ctrl Shift Z'],
  ['Delete selection', 'Del / Backspace'],
  ['Duplicate selection', 'Ctrl D'],
  ['Deselect / cancel', 'Esc'],
  ['Tools', '1 – 0'],
  ['Trails / Fields / Vectors', 'T  F  V'],
  ['Heat vision / Contacts', 'H  K'],
  ['Labels / Bloom / Grid', 'L  B  G'],
  ['Fit view', 'Home'],
  ['Pan', 'Right-drag · Space-drag · drag empty'],
  ['Zoom', 'Mouse wheel'],
  ['Quick save', 'Ctrl S'],
  ['Export / Import world', 'Ctrl E  /  Ctrl O'],
  ['Toggle dock', '`'],
  ['Panels', 'Alt 1 – 5'],
];

export function Help() {
  const { help, setHelp } = useUI();
  if (!help) return null;
  return (
    <div className="modal-back" onClick={() => setHelp(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Help">
        <div className="flex">
          <h2>Reality Compiler</h2>
          <div className="spacer" />
          <button className="btn sm" onClick={() => setHelp(false)}>
            Close <span className="kbd">Esc</span>
          </button>
        </div>
        <p>
          A laboratory where physics is data. Bodies obey a deterministic fixed-timestep impulse engine — gravity, collisions, friction, heat and
          charge — and you can rewrite everything: materials, fields, and the <b>rules</b> that run on top.
        </p>
        <h3>Reality programming</h3>
        <p>
          A rule reads <b style={{ color: 'var(--cyan)' }}>WHEN</b> trigger <b style={{ color: 'var(--violet)' }}>IF</b> conditions{' '}
          <b style={{ color: 'var(--lime)' }}>THEN</b> actions. Triggers: collision, proximity, timer, creation, destruction, temperature,
          velocity, state change, signals and calls from other rules. Numbers are safe expressions such as <code className="mono">self.mass * 2</code>,{' '}
          <code className="mono">rand(-100, 100)</code>, <code className="mono">$score + 1</code>, <code className="mono">count('replicator')</code>.
          Higher priority rules run first; “consume” stops lower ones. Rules can call each other (“Trigger rule”) or broadcast signals to build event chains.
        </p>
        <p>
          Every step has an instruction budget, chains have a depth limit, the same rule can’t re-fire for the same entity within one chain (cycle
          protection), and an entity cap stops runaway replication. Guard trips appear in the event inspector and diagnostics.
        </p>
        <h3>Shortcuts</h3>
        <div className="shortcuts">
          {SHORTCUTS.map(([a, b]) => (
            <div key={a}>
              <span>{a}</span>
              <span className="kbd">{b}</span>
            </div>
          ))}
        </div>
        <h3>Tips</h3>
        <p>
          Drag back from a spawn point to slingshot. Alt-click a field tool to place the inverse (repulsor, cooler). Place two portals in a row to link
          them. Click an event to jump to its rule and entity. Export a world to share an entire universe — rules, materials, fields and state — as JSON.
        </p>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useUI();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)} role="status">
          <b>{t.kind === 'error' ? '⛔ ' : t.kind === 'ok' ? '✓ ' : ''}</b>
          {t.title}
          {t.details && t.details.length > 0 && (
            <ul>
              {t.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
