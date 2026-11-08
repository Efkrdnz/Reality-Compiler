import { useEffect, useRef, useState } from 'react';
import { SimController } from '../engine/controller';
import { exportRules, exportWorld, importRules, importWorld, loadSave, quickSave, redo, undo } from './actions';
import { Icons } from './icons';
import { sim, useSimVersion } from './sim';
import { useUI } from './store';

const SPEEDS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4];

export function TopBar() {
  useSimVersion();
  const setHelp = useUI((s) => s.setHelp);
  const [menu, setMenu] = useState<null | 'file'>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const w = sim.world;
  const speedIdx = SPEEDS.reduce((best, s, i) => (Math.abs(Math.log(s / sim.speed)) < Math.abs(Math.log(SPEEDS[best] / sim.speed)) ? i : best), 0);
  const slots = menu === 'file' ? SimController.listSlots() : [];
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-name">
          REALITY COMPILER
          <small title={w.description}>{w.description || 'a laboratory for rewriting physics'}</small>
        </div>
      </div>

      <div className="transport">
        <button className="btn icon" title="Reset to the loaded state (R)" onClick={() => sim.reset()} data-testid="btn-reset">
          <span style={{ width: 16, height: 16, display: 'grid' }}>{Icons.reset}</span>
        </button>
        <button
          className={`btn play ${sim.running ? 'running' : ''}`}
          title={sim.running ? 'Pause (Space)' : 'Play (Space)'}
          onClick={() => sim.setRunning(!sim.running)}
          data-testid="btn-play"
        >
          <span style={{ width: 16, height: 16, display: 'grid' }}>{sim.running ? Icons.pause : Icons.play}</span>
        </button>
        <button className="btn icon" title="Step one tick (N or .)" onClick={() => sim.step(1)} data-testid="btn-step">
          <span style={{ width: 16, height: 16, display: 'grid' }}>{Icons.step}</span>
        </button>
        <div className="speed" title="Simulation speed: slow motion ↔ fast forward ([ and ])">
          <input
            type="range"
            min={0}
            max={SPEEDS.length - 1}
            step={1}
            value={speedIdx}
            style={{ ['--p' as string]: `${(speedIdx / (SPEEDS.length - 1)) * 100}%` }}
            onChange={(e) => sim.setSpeed(SPEEDS[Number(e.target.value)])}
            data-testid="speed"
          />
          <span className="val">×{sim.speed < 0.1 ? sim.speed.toFixed(2) : sim.speed.toFixed(sim.speed < 1 ? 2 : 0)}</span>
        </div>
      </div>

      <div className="flex">
        <button className="btn icon" title="Undo (Ctrl+Z)" disabled={!sim.canUndo} onClick={undo}>
          <span style={{ width: 16, height: 16, display: 'grid' }}>{Icons.undo}</span>
        </button>
        <button className="btn icon" title="Redo (Ctrl+Shift+Z)" disabled={!sim.canRedo} onClick={redo}>
          <span style={{ width: 16, height: 16, display: 'grid' }}>{Icons.redo}</span>
        </button>
      </div>

      <div className="spacer" />

      <div className="flex" style={{ position: 'relative' }} ref={menuRef}>
        <button className="btn" title="Quick save to this browser (Ctrl+S)" onClick={() => quickSave()}>
          <span style={{ width: 15, height: 15, display: 'grid' }}>{Icons.save}</span> Save
        </button>
        <button className={`btn ${menu === 'file' ? 'active' : ''}`} onClick={() => setMenu(menu ? null : 'file')} data-testid="btn-file">
          <span style={{ width: 15, height: 15, display: 'grid' }}>{Icons.download}</span> World & Rules
        </button>
        {menu === 'file' && (
          <div className="menu" onClick={() => setMenu(null)}>
            <button className="menu-item" onClick={exportWorld}>
              Export world JSON <small>Ctrl+E</small>
            </button>
            <button className="menu-item" onClick={() => importWorld()}>
              Import world JSON… <small>Ctrl+O</small>
            </button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={exportRules}>
              Export rules + modules JSON
            </button>
            <button className="menu-item" onClick={() => importRules('append')}>
              Import rules (append)…
            </button>
            <button className="menu-item" onClick={() => importRules('replace')}>
              Import rules (replace all)…
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                const name = prompt('Save name', w.name)?.trim();
                if (name) quickSave(name.slice(0, 40));
              }}
            >
              Save as…
            </button>
            {slots.length > 0 && <div className="menu-sep" />}
            {slots.slice(0, 8).map((s) => (
              <div key={s.name} className="flex">
                <button className="menu-item" onClick={() => loadSave(s.name)}>
                  Load “{s.name}” <small>{new Date(s.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </button>
                <button
                  className="btn sm icon danger"
                  title="Delete save"
                  onClick={(e) => {
                    e.stopPropagation();
                    SimController.deleteSlot(s.name);
                    setMenu(null);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="btn icon" title="Help & shortcuts (?)" onClick={() => setHelp(true)}>
          <span style={{ width: 16, height: 16, display: 'grid' }}>{Icons.help}</span>
        </button>
      </div>
    </header>
  );
}
