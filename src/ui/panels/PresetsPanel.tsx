import { useState } from 'react';
import { SimController } from '../../engine/controller';
import { PRESETS } from '../../sim/presets';
import { loadSave, quickSave } from '../actions';
import { Section } from '../components/controls';
import { sim, useSimVersion } from '../sim';
import { useUI } from '../store';

export function PresetsPanel() {
  useSimVersion();
  const [name, setName] = useState('');
  const [, force] = useState(0);
  const slots = SimController.listSlots();
  return (
    <div>
      <Section title="Universes">
        {PRESETS.map((p) => (
          <div
            key={p.id}
            className={`preset ${sim.presetId === p.id ? 'current' : ''}`}
            style={{ ['--accent' as string]: p.accent }}
            onClick={() => {
              sim.loadPreset(p.id);
              useUI.getState().select(undefined);
              useUI.getState().toast({ kind: 'ok', title: `Loaded ${p.name}` });
            }}
            data-testid={`preset-${p.id}`}
          >
            <h4>
              {p.name} <small>{p.tagline}</small>
            </h4>
            <p>{p.description}</p>
          </div>
        ))}
      </Section>
      <Section title="Saved in this browser">
        <form
          className="flex"
          style={{ marginBottom: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim().slice(0, 40);
            if (!n) return;
            quickSave(n);
            setName('');
            force((x) => x + 1);
          }}
        >
          <input className="input grow" placeholder="save name" value={name} onChange={(e) => setName(e.target.value)} data-testid="save-name" />
          <button className="btn sm primary" type="submit" disabled={!name.trim()}>
            Save
          </button>
        </form>
        {slots.length === 0 && <div className="hint">No saves yet. Ctrl+S quick-saves; saves live in localStorage. Use Export for files.</div>}
        {slots.map((s) => (
          <div key={s.name} className="listitem">
            <div style={{ flex: 1 }} onClick={() => loadSave(s.name)}>
              <div>{s.name}</div>
              <div className="muted small mono">
                {new Date(s.savedAt).toLocaleString()} · {s.entities} bodies · {s.rules} rules
              </div>
            </div>
            <button className="btn sm" onClick={() => loadSave(s.name)}>
              Load
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                SimController.deleteSlot(s.name);
                force((x) => x + 1);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </Section>
    </div>
  );
}
