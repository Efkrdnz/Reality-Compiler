import { useState } from 'react';
import type { BoundaryMode, WorldSettings } from '../../sim/types';
import { NumberInput, Row, Section, Slider, TextInput, Toggle } from '../components/controls';
import { sim, useSimVersion, useTick } from '../sim';
import { useUI } from '../store';

function setS<K extends keyof WorldSettings>(k: K, v: WorldSettings[K]) {
  sim.commit(`world ${k}`);
  sim.world.settings = { ...sim.world.settings, [k]: v };
  sim.touch();
}

const GRAVITY_PRESETS: [string, number, number][] = [
  ['Earth-ish', 0, 600],
  ['Moon', 0, 120],
  ['Zero-g', 0, 0],
  ['Reversed', 0, -600],
  ['Sideways', 600, 0],
  ['Crushing', 0, 2200],
];

export function WorldPanel() {
  useSimVersion();
  useTick(4);
  const w = sim.world;
  const s = w.settings;
  const [seed, setSeed] = useState(String(w.seed));
  const [varName, setVarName] = useState('');
  return (
    <div>
      <Section title="Universe">
        <Row label="name">
          <TextInput value={w.name} onChange={(v) => { sim.commit('rename'); w.name = v.slice(0, 80) || w.name; sim.touch(); }} className="grow" />
        </Row>
        <textarea
          className="input"
          style={{ width: '100%', minHeight: 48, marginTop: 4 }}
          defaultValue={w.description}
          key={w.name + w.seed}
          placeholder="Description"
          onBlur={(e) => {
            if (e.target.value !== w.description) {
              sim.commit('describe');
              w.description = e.target.value.slice(0, 4000);
              sim.touch();
            }
          }}
        />
        <Row label="seed" title="Deterministic: same seed + same world = same outcome">
          <input className="input mono w80" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9-]/g, ''))} />
          <button className="btn sm" onClick={() => sim.reseed(Number(seed) | 0)} title="Rebuild with this seed">
            Apply
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const n = Math.floor(Math.random() * 1e6);
              setSeed(String(n));
              sim.reseed(n);
            }}
          >
            🎲 Random
          </button>
        </Row>
        <Row label="reset point">
          <button className="btn sm" onClick={() => { sim.setResetPoint(); useUI.getState().toast({ kind: 'ok', title: 'Reset (R) now returns to this moment' }); }}>
            Make current state the reset point
          </button>
        </Row>
      </Section>

      <Section title="Gravity">
        <div className="flex wrap" style={{ marginBottom: 8 }}>
          {GRAVITY_PRESETS.map(([n, x, y]) => (
            <button key={n} className={`btn sm ${s.gravity.x === x && s.gravity.y === y ? 'active' : ''}`} onClick={() => setS('gravity', { x, y })}>
              {n}
            </button>
          ))}
        </div>
        <Row label="gravity x">
          <Slider value={s.gravity.x} min={-2500} max={2500} step={10} digits={0} onChange={(v) => setS('gravity', { ...s.gravity, x: v })} />
        </Row>
        <Row label="gravity y">
          <Slider value={s.gravity.y} min={-2500} max={2500} step={10} digits={0} onChange={(v) => setS('gravity', { ...s.gravity, y: v })} />
        </Row>
      </Section>

      <Section title="Environment">
        <Row label="ambient °">
          <Slider value={s.ambientTemp} min={-200} max={1500} step={1} digits={0} onChange={(v) => setS('ambientTemp', v)} />
        </Row>
        <Row label="heat exchange" title="How fast things relax to ambient temperature">
          <Slider value={s.ambientExchange} min={0} max={1} step={0.005} digits={3} onChange={(v) => setS('ambientExchange', v)} />
        </Row>
        <Row label="impact heat" title="Collisions generate heat">
          <Slider value={s.impactHeat} min={0} max={30} step={0.5} digits={1} onChange={(v) => setS('impactHeat', v)} />
        </Row>
        <Row label="air drag">
          <Slider value={s.airDrag} min={0} max={4} step={0.01} onChange={(v) => setS('airDrag', v)} />
        </Row>
        <Row label="wind x">
          <Slider value={s.wind.x} min={-1500} max={1500} step={10} digits={0} onChange={(v) => setS('wind', { ...s.wind, x: v })} />
        </Row>
        <Row label="wind y">
          <Slider value={s.wind.y} min={-1500} max={1500} step={10} digits={0} onChange={(v) => setS('wind', { ...s.wind, y: v })} />
        </Row>
        <Row label="charge force" title="Coulomb constant: like charges repel, opposites attract">
          <Slider value={s.coulomb} min={-5} max={5} step={0.05} onChange={(v) => setS('coulomb', v)} />
        </Row>
        <Row label="charge range">
          <Slider value={s.chargeRange} min={20} max={800} step={5} digits={0} onChange={(v) => setS('chargeRange', v)} />
        </Row>
        <Row label="world time ×" title="Rule-controllable time scale of the universe itself">
          <Slider value={s.timeScale} min={0} max={4} step={0.05} onChange={(v) => setS('timeScale', v)} />
        </Row>
        <Row label="boundary">
          <select className="input grow" value={s.boundary} onChange={(e) => setS('boundary', e.target.value as BoundaryMode)}>
            <option value="walls">walls (bounce)</option>
            <option value="wrap">wrap-around (torus)</option>
            <option value="open">open (lost when leaving)</option>
          </select>
        </Row>
        <Row label="particles collide">
          <Toggle value={s.particleCollisions} onChange={(v) => setS('particleCollisions', v)} />
        </Row>
      </Section>

      <Section title={`Global variables (${Object.keys(w.vars).length})`}>
        {Object.entries(w.vars).map(([k, v]) => (
          <Row key={k} label={`$${k}`}>
            <NumberInput value={v} onChange={(nv) => { sim.commit('set var'); w.vars[k] = nv; sim.touch(); }} />
            <button className="btn sm icon danger" onClick={() => { sim.commit('delete var'); delete w.vars[k]; sim.touch(); }}>
              ×
            </button>
          </Row>
        ))}
        <form
          className="flex"
          style={{ marginTop: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            const k = varName.trim();
            if (!/^[A-Za-z_]\w{0,30}$/.test(k)) {
              useUI.getState().toast({ kind: 'error', title: 'Variable names: letters, digits, _ (start with a letter)' });
              return;
            }
            sim.commit('add var');
            w.vars[k] = w.vars[k] ?? 0;
            setVarName('');
            sim.touch();
          }}
        >
          <input className="input grow mono" placeholder="new variable ($name in expressions)" value={varName} onChange={(e) => setVarName(e.target.value)} />
          <button className="btn sm" type="submit">
            Add
          </button>
        </form>
      </Section>

      <Section title="Solver & limits">
        <Row label="substeps" title="Physics substeps per tick (stability vs speed)">
          <Slider value={s.substeps} min={1} max={8} step={1} digits={0} onChange={(v) => setS('substeps', Math.round(v))} />
        </Row>
        <Row label="iterations" title="Contact solver iterations">
          <Slider value={s.iterations} min={1} max={30} step={1} digits={0} onChange={(v) => setS('iterations', Math.round(v))} />
        </Row>
        <Row label="entity cap" title="Hard limit — protects against runaway replication">
          <NumberInput value={s.maxEntities} onChange={(v) => setS('maxEntities', Math.round(v))} min={1} max={20000} digits={0} />
        </Row>
        <Row label="instr. budget" title="Rule-engine instructions per step">
          <NumberInput value={s.instructionBudget} onChange={(v) => setS('instructionBudget', Math.round(v))} min={100} max={2000000} digits={0} />
        </Row>
        <Row label="chain depth" title="Max depth of rule → rule event chains (recursion guard)">
          <NumberInput value={s.maxChainDepth} onChange={(v) => setS('maxChainDepth', Math.round(v))} min={1} max={64} digits={0} />
        </Row>
        <Row label="events / step">
          <NumberInput value={s.maxEventsPerStep} onChange={(v) => setS('maxEventsPerStep', Math.round(v))} min={10} max={100000} digits={0} />
        </Row>
        <Row label="world size">
          <NumberInput value={s.width} onChange={(v) => setS('width', Math.round(v))} min={200} max={20000} digits={0} />
          <span className="muted">×</span>
          <NumberInput value={s.height} onChange={(v) => setS('height', Math.round(v))} min={200} max={20000} digits={0} />
        </Row>
      </Section>
    </div>
  );
}
