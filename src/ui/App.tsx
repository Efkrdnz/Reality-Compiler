import { Dock } from './Dock';
import { Help, Toasts } from './Help';
import { Inspector } from './panels/Inspector';
import { MaterialsPanel } from './panels/MaterialsPanel';
import { PresetsPanel } from './panels/PresetsPanel';
import { Datalists, RulesPanel } from './panels/RulesPanel';
import { WorldPanel } from './panels/WorldPanel';
import { useShortcuts } from './shortcuts';
import { sim, useSimVersion } from './sim';
import { useUI, type Tab } from './store';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';
import { Viewport } from './Viewport';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'rules', label: 'Rules' },
  { id: 'matter', label: 'Matter' },
  { id: 'world', label: 'World' },
  { id: 'presets', label: 'Universes' },
];

function SidePanel() {
  useSimVersion();
  const { tab, setTab } = useUI();
  const w = sim.world;
  w.engine.prepare(w);
  const errs = w.engine.issues.filter((i) => i.level === 'error').length;
  return (
    <aside className="side">
      <Datalists />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}
            {t.id === 'rules' && <span className={`badge ${errs ? 'err' : ''}`}>{errs ? `${errs}!` : w.rules.length}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body" key={tab}>
        {tab === 'inspect' && <Inspector />}
        {tab === 'rules' && <RulesPanel />}
        {tab === 'matter' && <MaterialsPanel />}
        {tab === 'world' && <WorldPanel />}
        {tab === 'presets' && <PresetsPanel />}
      </div>
    </aside>
  );
}

export function App() {
  useShortcuts();
  const wide = useUI((s) => s.wideSide);
  return (
    <div className={`app ${wide ? 'wide' : ''}`}>
      <TopBar />
      <Toolbar />
      <Viewport />
      <SidePanel />
      <Dock />
      <Help />
      <Toasts />
    </div>
  );
}
