import { useState } from 'react';
import { setMass } from '../../sim/entity';
import { FIELD_INFO } from '../../sim/fields';
import { setProperty } from '../../sim/rules/engine';
import type { Entity, Field } from '../../sim/types';
import { deleteSelection, duplicateSelection } from '../actions';
import { NumberInput, Row, Section, Slider, TextInput, Toggle } from '../components/controls';
import { heatColor } from '../../render/renderer';
import { sim, useSimVersion, useTick } from '../sim';
import { useUI } from '../store';

const f2 = (v: number, d = 1) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d));

function edit(label: string, fn: () => void) {
  sim.commit(label);
  fn();
  sim.touch();
}

function EntityInspector({ e }: { e: Entity }) {
  const w = sim.world;
  const [tag, setTag] = useState('');
  const [varName, setVarName] = useState('');
  const mat = w.materials.get(e.material);
  const speed = Math.hypot(e.vx, e.vy);
  const [hr, hg, hb] = heatColor(e.temperature);
  const joints = w.joints.filter((j) => j.a === e.id || j.b === e.id);
  const rulesTouching = w.log.filter((l) => l.entityId === e.id && l.kind === 'rule').slice(-6).reverse();
  return (
    <div data-testid="entity-inspector">
      <Section title={`Entity #${e.id}`} right={<span className="chip">{e.shapeLabel}{e.kind === 'particle' ? ' · particle' : ''}{e.isStatic ? ' · static' : ''}</span>}>
        <div className="flex" style={{ marginBottom: 10 }}>
          <span className="matbadge" style={{ color: e.color }}>
            <i style={{ background: e.color }} />
            <b style={{ color: 'var(--text)' }}>{mat?.name ?? e.material}</b>
          </span>
          <span className="muted small">· {e.state} · born step {e.bornStep} · {e.origin}</span>
        </div>
        <div className="readout">
          <div>
            <span>position</span>
            <b>
              {f2(e.x, 0)}, {f2(e.y, 0)}
            </b>
          </div>
          <div>
            <span>velocity</span>
            <b>
              {f2(e.vx, 0)}, {f2(e.vy, 0)}
            </b>
          </div>
          <div>
            <span>speed</span>
            <b>{f2(speed, 0)} px/s</b>
          </div>
          <div>
            <span>spin</span>
            <b>{f2(e.av, 2)} rad/s</b>
          </div>
          <div>
            <span>temperature</span>
            <b style={{ color: `rgb(${hr},${hg},${hb})` }}>{f2(e.temperature, 1)}°</b>
          </div>
          <div>
            <span>mass</span>
            <b>{f2(e.mass, 2)}</b>
          </div>
          <div>
            <span>age</span>
            <b>{f2(e.age, 1)} s</b>
          </div>
          <div>
            <span>local time</span>
            <b style={{ color: e.localTime !== 1 ? 'var(--amber)' : undefined }}>×{e.localTime.toFixed(2)}</b>
          </div>
        </div>
      </Section>

      <Section title="Matter">
        <Row label="material">
          <select
            className="input grow"
            value={e.material}
            onChange={(ev) => edit('change material', () => w.transform(e, ev.target.value, 0, 'user'))}
            data-testid="inspector-material"
          >
            {[...w.materials.values()].map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="colour">
          <input type="color" value={e.color} onChange={(ev) => edit('colour', () => (e.color = ev.target.value))} />
          <span className="mono muted">{e.color}</span>
        </Row>
        <Row label="temperature °">
          <NumberInput value={e.temperature} onChange={(v) => edit('temperature', () => setProperty(w, e, 'temperature', 'set', v, ''))} step={10} />
          <button className="btn sm" onClick={() => edit('heat', () => (e.temperature += 250))}>
            +250°
          </button>
          <button className="btn sm" onClick={() => edit('cool', () => (e.temperature -= 250))}>
            −250°
          </button>
        </Row>
        <Row label="mass">
          <NumberInput value={e.mass} onChange={(v) => edit('mass', () => setMass(e, v))} min={0.01} step={1} />
        </Row>
        <Row label="bounce">
          <Slider value={e.restitution} min={0} max={1.2} onChange={(v) => edit('restitution', () => (e.restitution = v))} />
        </Row>
        <Row label="friction">
          <Slider value={e.friction} min={0} max={2} onChange={(v) => edit('friction', () => (e.friction = v))} />
        </Row>
        <Row label="drag">
          <Slider value={e.drag} min={0} max={5} onChange={(v) => edit('drag', () => (e.drag = v))} />
        </Row>
        <Row label="gravity ×">
          <Slider value={e.gravityScale} min={-3} max={3} onChange={(v) => edit('gravity scale', () => (e.gravityScale = v))} />
        </Row>
        <Row label="charge">
          <Slider value={e.charge} min={-10} max={10} step={0.1} onChange={(v) => edit('charge', () => (e.charge = v))} />
        </Row>
        <Row label="size (radius)">
          <NumberInput value={e.radius} onChange={(v) => edit('size', () => setProperty(w, e, 'radius', 'set', v, ''))} min={1} max={400} />
        </Row>
        <Row label="lifetime (s)" title="-1 = immortal">
          <NumberInput value={e.lifetime} onChange={(v) => edit('lifetime', () => (e.lifetime = v))} step={1} />
        </Row>
        <Row label="static">
          <Toggle value={e.isStatic} onChange={(v) => edit('static', () => setProperty(w, e, 'static', 'set', v ? 1 : 0, ''))} />
          <span className="lbl" style={{ width: 'auto', marginLeft: 12 }}>
            collides
          </span>
          <Toggle value={e.collides} onChange={(v) => edit('collides', () => (e.collides = v))} />
        </Row>
      </Section>

      <Section title="Tags">
        <div className="tagchips" style={{ marginBottom: 8 }}>
          {e.tags.length === 0 && <span className="hint">no tags — rules can target entities by tag</span>}
          {e.tags.map((t) => (
            <span key={t} className="tagchip">
              #{t}
              <button onClick={() => edit('remove tag', () => (e.tags = e.tags.filter((x) => x !== t)))}>×</button>
            </span>
          ))}
        </div>
        <form
          className="flex"
          onSubmit={(ev) => {
            ev.preventDefault();
            const t = tag.trim();
            if (!/^[\w:.-]{1,40}$/.test(t)) {
              useUI.getState().toast({ kind: 'error', title: 'Tags may only contain letters, digits, _ - : .' });
              return;
            }
            if (!e.tags.includes(t)) edit('add tag', () => e.tags.push(t));
            setTag('');
          }}
        >
          <input className="input grow mono" placeholder="add tag…" value={tag} onChange={(ev) => setTag(ev.target.value)} list="dl-tags" />
          <button className="btn sm" type="submit">
            Add
          </button>
        </form>
      </Section>

      <Section title="Variables">
        {Object.entries(e.vars).map(([k, v]) => (
          <Row key={k} label={`$${k}`}>
            <NumberInput value={v} onChange={(nv) => edit('var', () => (e.vars[k] = nv))} />
            <button className="btn sm icon danger" onClick={() => edit('remove var', () => delete e.vars[k])}>
              ×
            </button>
          </Row>
        ))}
        <form
          className="flex"
          style={{ marginTop: 6 }}
          onSubmit={(ev) => {
            ev.preventDefault();
            const k = varName.trim();
            if (!/^[A-Za-z_]\w{0,30}$/.test(k)) {
              useUI.getState().toast({ kind: 'error', title: 'Variable names: letters, digits, _ (start with a letter)' });
              return;
            }
            edit('add var', () => (e.vars[k] = e.vars[k] ?? 0));
            setVarName('');
          }}
        >
          <input className="input grow mono" placeholder="new variable (self.$name)" value={varName} onChange={(ev) => setVarName(ev.target.value)} />
          <button className="btn sm" type="submit">
            Add
          </button>
        </form>
      </Section>

      {joints.length > 0 && (
        <Section title={`Joints (${joints.length})`}>
          {joints.map((j) => (
            <div key={j.id} className="row">
              <span className="mono small">
                → #{j.a === e.id ? j.b : j.a} · L {j.length.toFixed(0)} · {j.stiffness >= 0.95 ? 'rod' : `spring ${j.stiffness.toFixed(2)}`}
              </span>
              <div className="spacer" />
              <button className="btn sm danger" onClick={() => edit('remove joint', () => w.removeJoint(j.id))}>
                Unlink
              </button>
            </div>
          ))}
        </Section>
      )}

      {rulesTouching.length > 0 && (
        <Section title="Recent rule activity">
          {rulesTouching.map((l, i) => (
            <div key={i} className="listitem small mono" onClick={() => l.ruleId && useUI.getState().focusRule(l.ruleId)}>
              <span className="muted">{l.time.toFixed(2)}s</span> {l.text}
            </div>
          ))}
        </Section>
      )}

      <div className="flex wrap">
        <button className="btn sm" onClick={() => edit('freeze', () => ((e.vx = 0), (e.vy = 0), (e.av = 0)))}>
          Freeze motion
        </button>
        <button className="btn sm" onClick={() => edit('kick', () => (e.vy -= 600))}>
          Kick ↑
        </button>
        <button className="btn sm" onClick={duplicateSelection}>
          Duplicate <span className="kbd">Ctrl D</span>
        </button>
        <div className="spacer" />
        <button className="btn sm danger" onClick={deleteSelection} data-testid="btn-delete">
          Delete <span className="kbd">Del</span>
        </button>
      </div>
    </div>
  );
}

function FieldInspector({ f }: { f: Field }) {
  const w = sim.world;
  const info = FIELD_INFO[f.kind];
  const portals = w.fields.filter((x) => x.kind === 'portal' && x.id !== f.id);
  const ed = (label: string, fn: () => void) => {
    edit(label, fn);
    w.engine.invalidate();
  };
  return (
    <div data-testid="field-inspector">
      <Section title={info.label} right={<span className="chip" style={{ color: info.color }}>{f.kind}</span>}>
        <p className="hint" style={{ marginTop: 0 }}>
          {info.describe}
        </p>
        <Row label="name">
          <TextInput value={f.name} onChange={(v) => ed('rename field', () => (f.name = v.slice(0, 60) || f.name))} className="grow mono" />
        </Row>
        <Row label="enabled">
          <Toggle value={f.enabled} onChange={(v) => ed('toggle field', () => (f.enabled = v))} />
        </Row>
        {f.kind !== 'portal' && (
          <Row label={`strength ${info.unit}`}>
            {f.kind === 'timeZone' ? (
              <Slider value={f.strength} min={0} max={5} onChange={(v) => ed('field strength', () => (f.strength = v))} />
            ) : f.kind === 'heat' ? (
              <Slider value={f.strength} min={-800} max={800} step={1} digits={0} onChange={(v) => ed('field strength', () => (f.strength = v))} />
            ) : (
              <Slider value={f.strength} min={-3000} max={3000} step={10} digits={0} onChange={(v) => ed('field strength', () => (f.strength = v))} />
            )}
          </Row>
        )}
        {f.kind === 'well' && (
          <Row label="falloff">
            <select className="input grow" value={f.falloff} onChange={(ev) => ed('falloff', () => (f.falloff = Number(ev.target.value)))}>
              <option value={0}>constant</option>
              <option value={1}>linear</option>
              <option value={2}>inverse square (orbits)</option>
            </select>
          </Row>
        )}
        {(f.kind === 'gravityZone' || f.kind === 'wind' || f.kind === 'portal') && (
          <Row label="direction °">
            <Slider value={Math.round((f.angle * 180) / Math.PI)} min={-180} max={180} step={1} digits={0} onChange={(v) => ed('direction', () => (f.angle = (v * Math.PI) / 180))} />
          </Row>
        )}
        <Row label="shape">
          <select className="input grow" value={f.shape} onChange={(ev) => ed('field shape', () => (f.shape = ev.target.value as Field['shape']))} disabled={f.kind === 'portal'}>
            <option value="circle">circle</option>
            <option value="rect">rectangle</option>
          </select>
        </Row>
        {f.shape === 'circle' ? (
          <Row label="radius">
            <Slider value={f.radius} min={8} max={1200} step={1} digits={0} onChange={(v) => ed('radius', () => (f.radius = v))} />
          </Row>
        ) : (
          <div className="grid2">
            <Row label="width">
              <NumberInput value={f.w} onChange={(v) => ed('size', () => (f.w = Math.max(10, v)))} digits={0} />
            </Row>
            <Row label="height">
              <NumberInput value={f.h} onChange={(v) => ed('size', () => (f.h = Math.max(10, v)))} digits={0} />
            </Row>
          </div>
        )}
        <div className="grid2">
          <Row label="x">
            <NumberInput value={f.x} onChange={(v) => ed('move field', () => (f.x = v))} digits={0} />
          </Row>
          <Row label="y">
            <NumberInput value={f.y} onChange={(v) => ed('move field', () => (f.y = v))} digits={0} />
          </Row>
        </div>
        <Row label="only tag" title="Only affect entities with this tag (blank = all)">
          <TextInput value={f.tagFilter} onChange={(v) => ed('field filter', () => (f.tagFilter = v.trim()))} className="grow mono" placeholder="everything" list="dl-tags" />
        </Row>
        {f.kind === 'portal' && (
          <Row label="exit portal">
            <select className="input grow" value={f.link} onChange={(ev) => ed('link portal', () => (f.link = Number(ev.target.value)))}>
              <option value={0}>— none —</option>
              {portals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        <p className="hint">Drag the field to move it; drag the square handle to resize{f.kind === 'portal' || f.kind === 'gravityZone' || f.kind === 'wind' ? ', the pink handle to aim (Shift snaps)' : ''}. Rules can modify this field by name via “Modify field”.</p>
      </Section>
      <div className="flex">
        <button className="btn sm" onClick={duplicateSelection}>
          Duplicate
        </button>
        <div className="spacer" />
        <button className="btn sm danger" onClick={deleteSelection}>
          Delete field
        </button>
      </div>
    </div>
  );
}

export function Inspector() {
  useSimVersion();
  useTick(8);
  const { selectedId, selectedFieldId } = useUI();
  const w = sim.world;
  const e = w.get(selectedId);
  const f = w.fields.find((x) => x.id === selectedFieldId);
  if (e) return <EntityInspector e={e} key={e.id} />;
  if (f) return <FieldInspector f={f} key={f.id} />;
  const counts = new Map<string, number>();
  for (const x of w.entities) counts.set(x.material, (counts.get(x.material) ?? 0) + 1);
  return (
    <div>
      <div className="empty" style={{ marginBottom: 16 }}>
        <b>Nothing selected.</b>
        <br />
        Pick the <span className="kbd">1</span> select tool and click any body or field to inspect it.
        <br />
        Spawn with <span className="kbd">2</span>–<span className="kbd">6</span>, drag to slingshot.
      </div>
      <Section title="Census">
        {[...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([m, n]) => {
            const mat = w.materials.get(m);
            return (
              <div key={m} className="row">
                <span className="matbadge" style={{ color: mat?.color }}>
                  <i style={{ background: mat?.color }} />
                  <span style={{ color: 'var(--text-2)' }}>{mat?.name ?? m}</span>
                </span>
                <div className="spacer" />
                <span className="mono">{n}</span>
              </div>
            );
          })}
      </Section>
      <Section title={`Fields (${w.fields.length})`}>
        {w.fields.map((fl) => (
          <div key={fl.id} className="listitem" onClick={() => useUI.getState().selectField(fl.id)}>
            <span style={{ color: FIELD_INFO[fl.kind].color }}>●</span>
            <span>{fl.name}</span>
            <span className="muted small">{FIELD_INFO[fl.kind].label}</span>
          </div>
        ))}
        {w.fields.length === 0 && <div className="hint">No fields. Use the field tools in the left toolbar.</div>}
      </Section>
    </div>
  );
}
