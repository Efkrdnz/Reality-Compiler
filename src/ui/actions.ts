import { ImportError, parseRulesDoc, serializeRules } from '../sim/serialize';
import { ruleId } from '../sim/rules/build';
import { sim } from './sim';
import { useUI } from './store';

const toast = (...a: Parameters<ReturnType<typeof useUI.getState>['toast']>) => useUI.getState().toast(...a);

export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'universe';
}

export function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      if (f.size > 25 * 1024 * 1024) {
        toast({ kind: 'error', title: 'File too large (max 25 MB)' });
        return resolve(null);
      }
      f.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}

export function reportImportError(e: unknown, what: string): void {
  if (e instanceof ImportError) toast({ kind: 'error', title: `${what}: ${e.message}`, details: e.details });
  else toast({ kind: 'error', title: `${what}: ${(e as Error).message ?? String(e)}` });
}

export function exportWorld(): void {
  downloadJSON(`${slug(sim.world.name)}.world.json`, sim.exportDoc());
  toast({ kind: 'ok', title: 'World exported as JSON' });
}

export async function importWorld(text?: string): Promise<void> {
  const src = text ?? (await pickFile());
  if (src == null) return;
  try {
    sim.loadDoc(src);
    useUI.getState().select(undefined);
    toast({ kind: 'ok', title: `Loaded “${sim.world.name}”` });
  } catch (e) {
    reportImportError(e, 'Import failed');
  }
}

export function exportRules(): void {
  const w = sim.world;
  const usedMats = new Set<string>();
  for (const r of w.rules) for (const a of r.actions) if (typeof a.params.material === 'string' && a.params.material) usedMats.add(a.params.material);
  const mats = [...w.materials.values()].filter((m) => !m.builtin || usedMats.has(m.id));
  downloadJSON(`${slug(w.name)}.rules.json`, serializeRules(w.rules, w.modules.filter((m) => !m.builtin), mats));
  toast({ kind: 'ok', title: `Exported ${w.rules.length} rules` });
}

export async function importRules(mode: 'append' | 'replace' = 'append', text?: string): Promise<void> {
  const src = text ?? (await pickFile());
  if (src == null) return;
  try {
    const doc = parseRulesDoc(src);
    sim.commit('import rules');
    const w = sim.world;
    for (const m of doc.materials ?? []) if (!w.materials.has(m.id) || !w.materials.get(m.id)!.builtin) w.setMaterial({ ...m, builtin: false });
    const existing = new Set(w.rules.map((r) => r.id));
    const map = new Map<string, string>();
    for (const r of doc.rules) if (mode === 'append' && existing.has(r.id)) map.set(r.id, ruleId());
    const rules = doc.rules.map((r) => {
      const c = structuredClone(r);
      if (map.has(c.id)) c.id = map.get(c.id)!;
      for (const a of c.actions) if (a.type === 'triggerRule' && map.has(String(a.params.rule))) a.params.rule = map.get(String(a.params.rule))!;
      return c;
    });
    w.rules = mode === 'replace' ? rules : [...w.rules, ...rules];
    for (const m of doc.modules ?? []) if (!w.modules.some((x) => x.id === m.id)) w.modules.push(m);
    sim.rulesChanged();
    toast({ kind: 'ok', title: `Imported ${rules.length} rules${doc.modules?.length ? ` and ${doc.modules.length} modules` : ''}` });
  } catch (e) {
    reportImportError(e, 'Rule import failed');
  }
}

export function quickSave(name = 'quicksave'): void {
  try {
    sim.saveSlot(name);
    toast({ kind: 'ok', title: `Saved “${name}” to this browser` });
  } catch (e) {
    toast({ kind: 'error', title: (e as Error).message });
  }
}

export function loadSave(name: string): void {
  try {
    sim.loadSlot(name);
    useUI.getState().select(undefined);
    toast({ kind: 'ok', title: `Loaded save “${name}”` });
  } catch (e) {
    reportImportError(e, 'Load failed');
  }
}

export function deleteSelection(): void {
  const ui = useUI.getState();
  const w = sim.world;
  if (ui.selectedId !== undefined) {
    const e = w.get(ui.selectedId);
    if (e) {
      sim.commit('delete');
      w.destroy(e, 'deleted by user');
      ui.select(undefined);
      sim.touch();
    }
  } else if (ui.selectedFieldId !== undefined) {
    sim.commit('delete field');
    w.removeField(ui.selectedFieldId);
    w.engine.invalidate();
    ui.selectField(undefined);
    sim.touch();
  }
}

export function duplicateSelection(): void {
  const ui = useUI.getState();
  const w = sim.world;
  const e = w.get(ui.selectedId);
  if (e) {
    sim.commit('duplicate');
    const c = w.spawn({
      shape: e.shape === 'circle' ? { type: 'circle', radius: e.radius } : { type: 'poly', verts: e.verts, label: e.shapeLabel },
      kind: e.kind,
      x: e.x + e.radius * 2.2,
      y: e.y,
      vx: e.vx,
      vy: e.vy,
      angle: e.angle,
      material: e.material,
      color: e.color,
      tags: e.tags,
      isStatic: e.isStatic,
      temperature: e.temperature,
      origin: 'user',
    });
    if (c) {
      c.vars = { ...e.vars };
      c.charge = e.charge;
      c.gravityScale = e.gravityScale;
      c.restitution = e.restitution;
      c.friction = e.friction;
      ui.select(c.id);
    }
    sim.touch();
    return;
  }
  const f = w.fields.find((x) => x.id === ui.selectedFieldId);
  if (f) {
    sim.commit('duplicate field');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, name: _name, link: _link, x: _x, y: _y, ...rest } = f;
    const nf = w.addField(f.kind, f.x + 40, f.y + 40, rest);
    w.engine.invalidate();
    ui.selectField(nf.id);
    sim.touch();
  }
}

export function undo(): void {
  const l = sim.undo();
  if (l) toast({ kind: 'info', title: `Undid: ${l}` });
  else toast({ kind: 'info', title: 'Nothing to undo' });
}

export function redo(): void {
  const l = sim.redo();
  if (l) toast({ kind: 'info', title: `Redid: ${l}` });
}
