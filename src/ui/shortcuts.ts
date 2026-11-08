import { useEffect } from 'react';
import type { ViewOptions } from '../render/renderer';
import { deleteSelection, duplicateSelection, exportWorld, importWorld, quickSave, redo, undo } from './actions';
import { sim } from './sim';
import { useUI, type Tab } from './store';
import { TOOLS } from './Toolbar';

const SPEEDS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4];
const VIEW_KEYS: Record<string, keyof ViewOptions> = { t: 'trails', f: 'fields', v: 'vectors', h: 'heat', k: 'contacts', l: 'labels', b: 'glow', g: 'grid' };
const TABS: Tab[] = ['inspect', 'rules', 'matter', 'world', 'presets'];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (ui.help) ui.setHelp(false);
        else {
          ui.select(undefined);
          ui.selectField(undefined);
        }
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        quickSave();
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        exportWorld();
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        importWorld();
        return;
      }
      if (isTyping(e)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod) return;
      if (e.altKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        ui.setTab(TABS[Number(e.key) - 1]);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        sim.setRunning(!sim.running);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'n' || k === '.') return sim.step(1);
      if (k === 'r') return sim.reset();
      if (k === '[' || k === ']') {
        const i = SPEEDS.findIndex((s) => s >= sim.speed - 1e-6);
        const cur = i < 0 ? SPEEDS.length - 1 : i;
        sim.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, cur + (k === ']' ? 1 : -1)))]);
        return;
      }
      if (k === '\\') return sim.setSpeed(1);
      if (k === 'delete' || k === 'backspace') return deleteSelection();
      if (k === 'home') return void window.dispatchEvent(new Event('rc:fit'));
      if (k === '`') return ui.toggleDock();
      if (k === '?' || (e.shiftKey && k === '/')) return ui.setHelp(true);
      const tool = TOOLS.find((t) => t.key === e.key);
      if (tool) return ui.setTool(tool.id);
      if (VIEW_KEYS[k]) return ui.toggleView(VIEW_KEYS[k]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
