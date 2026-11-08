import { create } from 'zustand';
import { DEFAULT_VIEW, type ViewOptions } from '../render/renderer';
import type { FieldKind } from '../sim/types';

export type Tool =
  | 'select'
  | 'circle'
  | 'box'
  | 'triangle'
  | 'hexagon'
  | 'particle'
  | 'wall'
  | 'connect'
  | 'erase'
  | 'blast'
  | 'field';

export type Tab = 'inspect' | 'rules' | 'matter' | 'world' | 'presets';
export type DockTab = 'events' | 'metrics' | 'diagnostics';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  title: string;
  details?: string[];
}

interface UIState {
  tool: Tool;
  fieldKind: FieldKind;
  material: string;
  size: number;
  staticSpawn: boolean;
  selectedId?: number;
  selectedFieldId?: number;
  tab: Tab;
  dock: DockTab;
  dockOpen: boolean;
  view: ViewOptions;
  toasts: Toast[];
  help: boolean;
  wideSide: boolean;
  focusRuleId?: string;
  setTool: (t: Tool) => void;
  setFieldKind: (k: FieldKind) => void;
  setMaterial: (m: string) => void;
  setSize: (s: number) => void;
  setStaticSpawn: (s: boolean) => void;
  select: (id?: number) => void;
  selectField: (id?: number) => void;
  setTab: (t: Tab) => void;
  setDock: (d: DockTab) => void;
  toggleDock: () => void;
  toggleView: (k: keyof ViewOptions) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  setHelp: (h: boolean) => void;
  setWide: (w: boolean) => void;
  focusRule: (id?: string) => void;
}

let toastId = 0;

function loadView(): ViewOptions {
  try {
    const raw = localStorage.getItem('reality-compiler:view');
    if (raw) return { ...DEFAULT_VIEW, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_VIEW };
}

export const useUI = create<UIState>((set, get) => ({
  tool: 'select',
  fieldKind: 'well',
  material: 'rubber',
  size: 16,
  staticSpawn: false,
  tab: 'inspect',
  dock: 'events',
  dockOpen: true,
  view: loadView(),
  toasts: [],
  help: false,
  wideSide: false,
  setTool: (tool) => set({ tool }),
  setFieldKind: (fieldKind) => set({ fieldKind, tool: 'field' }),
  setMaterial: (material) => set({ material }),
  setSize: (size) => set({ size: Math.max(2, Math.min(120, size)) }),
  setStaticSpawn: (staticSpawn) => set({ staticSpawn }),
  select: (selectedId) => set({ selectedId, selectedFieldId: undefined, ...(selectedId !== undefined && get().tab !== 'rules' ? { tab: 'inspect' as Tab } : {}) }),
  selectField: (selectedFieldId) => set({ selectedFieldId, selectedId: undefined, ...(selectedFieldId !== undefined && get().tab !== 'rules' ? { tab: 'inspect' as Tab } : {}) }),
  setTab: (tab) => set({ tab }),
  setDock: (dock) => set({ dock, dockOpen: true }),
  toggleDock: () => set({ dockOpen: !get().dockOpen }),
  toggleView: (k) => {
    const view = { ...get().view, [k]: !get().view[k] };
    try {
      localStorage.setItem('reality-compiler:view', JSON.stringify(view));
    } catch {
      /* ignore */
    }
    set({ view });
  },
  toast: (t) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 7000 : 2600);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setHelp: (help) => set({ help }),
  setWide: (wideSide) => set({ wideSide }),
  focusRule: (focusRuleId) => set({ focusRuleId, tab: focusRuleId ? 'rules' : get().tab }),
}));
