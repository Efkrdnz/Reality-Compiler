import { useState } from 'react';
import { cloneMaterial, newCustomMaterial } from '../../sim/materials';
import { STATES } from '../../sim/rules/catalog';
import type { Material, MatterState } from '../../sim/types';
import { NumberInput, Row, Section, Slider, TextInput } from '../components/controls';
import { sim, useSimVersion } from '../sim';
import { useUI } from '../store';

function save(m: Material, label = 'edit material') {
  sim.commit(label);
  sim.world.setMaterial(m);
  sim.rulesChanged();
}

export function MaterialsPanel() {
  useSimVersion();
  const w = sim.world;
  const { material: spawnMat, setMaterial } = useUI();
  const [sel, setSel] = useState<string>(spawnMat);
  const m = w.materials.get(sel) ?? [...w.materials.values()][0];
  const used = w.entities.filter((e) => e.material === m.id).length;
  const set = <K extends keyof Material>(k: K, v: Material[K]) => save({ ...cloneMaterial(m), [k]: v });
  const applyToExisting = () => {
    sim.commit('apply material');
    for (const e of w.entities) {
      if (e.material !== m.id) continue;
      e.color = m.color;
      e.restitution = m.restitution;
      e.friction = m.friction;
      e.drag = m.drag;
      e.gravityScale = m.gravityScale;
      e.charge = m.charge;
      e.state = m.state;
    }
    sim.touch();
    useUI.getState().toast({ kind: 'ok', title: `Applied ${m.name} to ${used} existing bodies` });
  };
  return (
    <div>
      <Section title="Materials" right={<span className="muted small">{w.materials.size} defined</span>}>
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
          {[...w.materials.values()].map((x) => (
            <div key={x.id} className={`listitem ${x.id === m.id ? 'active' : ''}`} onClick={() => setSel(x.id)} data-testid={`matlist-${x.id}`}>
              <span className="matbadge" style={{ color: x.color }}>
                <i style={{ background: x.color }} />
              </span>
              <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {x.name}
              </span>
            </div>
          ))}
        </div>
        <div className="flex" style={{ marginTop: 8 }}>
          <button
            className="btn sm"
            onClick={() => {
              let i = 1;
              while (w.materials.has(`custom${i}`)) i++;
              const nm = newCustomMaterial(`custom${i}`);
              nm.name = `Custom ${i}`;
              save(nm, 'new material');
              setSel(nm.id);
            }}
            data-testid="btn-new-material"
          >
            + New material
          </button>
          <button
            className="btn sm"
            onClick={() => {
              let i = 2;
              while (w.materials.has(`${m.id}${i}`)) i++;
              const c = { ...cloneMaterial(m), id: `${m.id}${i}`.slice(0, 32), name: `${m.name} ${i}`, builtin: false };
              save(c, 'clone material');
              setSel(c.id);
            }}
          >
            Clone
          </button>
          <div className="spacer" />
          <button className={`btn sm ${spawnMat === m.id ? 'active' : ''}`} onClick={() => setMaterial(m.id)}>
            {spawnMat === m.id ? 'Spawning with this' : 'Use for spawning'}
          </button>
        </div>
      </Section>

      <Section title={m.name} right={<span className="mono muted small">id: {m.id}{m.builtin ? ' · built-in' : ''}</span>}>
        <Row label="name">
          <TextInput value={m.name} onChange={(v) => set('name', v.slice(0, 40) || m.name)} className="grow" />
        </Row>
        <Row label="colour">
          <input type="color" value={m.color} onChange={(e) => set('color', e.target.value)} />
          <span className="mono muted">{m.color}</span>
        </Row>
        <Row label="phase">
          <select className="input grow" value={m.state} onChange={(e) => set('state', e.target.value as MatterState)}>
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Row>
        <Row label="density">
          <Slider value={m.density} min={0.01} max={20} onChange={(v) => set('density', v)} />
        </Row>
        <Row label="bounce">
          <Slider value={m.restitution} min={0} max={1.2} onChange={(v) => set('restitution', v)} />
        </Row>
        <Row label="friction">
          <Slider value={m.friction} min={0} max={2} onChange={(v) => set('friction', v)} />
        </Row>
        <Row label="drag">
          <Slider value={m.drag} min={0} max={5} onChange={(v) => set('drag', v)} />
        </Row>
        <Row label="gravity ×">
          <Slider value={m.gravityScale} min={-3} max={3} onChange={(v) => set('gravityScale', v)} />
        </Row>
        <Row label="conductivity">
          <Slider value={m.conductivity} min={0} max={1} onChange={(v) => set('conductivity', v)} />
        </Row>
        <Row label="self-heat °/s">
          <Slider value={m.selfHeat} min={-200} max={200} step={1} digits={0} onChange={(v) => set('selfHeat', v)} />
        </Row>
        <Row label="charge">
          <Slider value={m.charge} min={-10} max={10} step={0.1} onChange={(v) => set('charge', v)} />
        </Row>
        <Row label="glow">
          <Slider value={m.glow} min={0} max={1} onChange={(v) => set('glow', v)} />
        </Row>
        <Row label="spawn temp °" title="blank = ambient">
          <NumberInput value={m.spawnTemp ?? w.settings.ambientTemp} onChange={(v) => set('spawnTemp', v)} />
          <button className="btn sm" onClick={() => set('spawnTemp', null)} title="Use ambient temperature">
            ambient
          </button>
        </Row>
        <Row label="lifetime s" title="-1 = forever">
          <NumberInput value={m.lifetime} onChange={(v) => set('lifetime', v < 0 ? -1 : v)} />
          <span className="muted small">then →</span>
          <select className="input grow" value={m.decayTo} onChange={(e) => set('decayTo', e.target.value)}>
            <option value="">vanish</option>
            {[...w.materials.values()].filter((x) => x.id !== m.id).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="tags">
          <TextInput
            value={m.tags.join(' ')}
            onChange={(v) => set('tags', v.split(/[\s,]+/).filter((t) => /^[\w:.-]{1,40}$/.test(t)).slice(0, 16))}
            className="grow mono"
            placeholder="space separated"
          />
        </Row>
      </Section>

      <Section title="Phase transitions" right={<span className="muted small">programmable matter</span>}>
        {m.transitions.length === 0 && <div className="hint" style={{ marginBottom: 6 }}>No transitions — this material never changes on its own.</div>}
        {m.transitions.map((t, i) => (
          <div key={i} className="line">
            <span className="word">when</span>
            <select
              className="input"
              value={t.when}
              onChange={(e) => {
                const c = cloneMaterial(m);
                c.transitions[i].when = e.target.value as 'above' | 'below';
                save(c);
              }}
            >
              <option value="above">above</option>
              <option value="below">below</option>
            </select>
            <NumberInput
              value={t.temp}
              className="w64"
              onChange={(v) => {
                const c = cloneMaterial(m);
                c.transitions[i].temp = v;
                save(c);
              }}
            />
            <span className="word">° become</span>
            <select
              className={`input grow ${w.materials.has(t.to) ? '' : 'error'}`}
              value={t.to}
              onChange={(e) => {
                const c = cloneMaterial(m);
                c.transitions[i].to = e.target.value;
                save(c);
              }}
            >
              {!w.materials.has(t.to) && <option value={t.to}>{t.to} (missing)</option>}
              {[...w.materials.values()].filter((x) => x.id !== m.id).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button
              className="btn sm icon danger"
              onClick={() => {
                const c = cloneMaterial(m);
                c.transitions.splice(i, 1);
                save(c);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="addbtn"
          disabled={m.transitions.length >= 8}
          onClick={() => {
            const c = cloneMaterial(m);
            c.transitions.push({ when: 'above', temp: 500, to: w.materials.has('fire') ? 'fire' : [...w.materials.keys()][0] });
            save(c);
          }}
        >
          + transition
        </button>
        <p className="hint">Hysteresis matters: water→steam above 100° and steam→water below 92° avoids flicker. Transitions fire “State change” rule triggers.</p>
      </Section>

      <div className="flex">
        <button className="btn sm" disabled={!used} onClick={applyToExisting} title="Material edits apply to new spawns and transformations; this pushes them to existing bodies">
          Apply to {used} existing
        </button>
        <div className="spacer" />
        <button
          className="btn sm danger"
          disabled={!!m.builtin}
          title={m.builtin ? 'Built-in materials can be edited but not deleted' : used ? `${used} bodies use it — they will become stone` : 'Delete material'}
          onClick={() => {
            sim.commit('delete material');
            for (const e of w.entities) if (e.material === m.id) w.transform(e, 'stone', 0, 'material deleted');
            w.materials.delete(m.id);
            setSel('stone');
            if (spawnMat === m.id) setMaterial('stone');
            sim.rulesChanged();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
