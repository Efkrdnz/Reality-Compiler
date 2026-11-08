import { MetricsHistory } from '../sim/metrics';
import { buildPreset, PRESETS } from '../sim/presets';
import { deserializeWorld, serializeWorld } from '../sim/serialize';
import type { WorldDoc } from '../sim/types';
import type { World } from '../sim/world';

export const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 6;
const UNDO_LIMIT = 50;
const SLOT_PREFIX = 'reality-compiler:slot:';

export interface SaveSlot {
  name: string;
  savedAt: number;
  entities: number;
  rules: number;
}

type Listener = () => void;

/**
 * Owns the World and drives it with a fixed timestep accumulator.
 * The UI talks to the simulation exclusively through this object.
 */
export class SimController {
  world: World;
  /** Snapshot taken when the current universe was loaded — used by Reset. */
  private origin: WorldDoc;
  presetId = 'genesis';
  running = true;
  /** UI speed multiplier (slow motion < 1 < fast forward). */
  speed = 1;
  private acc = 0;
  metrics = new MetricsHistory();
  /** Increments on structural changes (rules, materials, entities added/removed by the user...). */
  version = 0;
  stepsLastFrame = 0;
  lagging = false;
  private listeners = new Set<Listener>();
  private undoStack: { label: string; doc: WorldDoc; at: number }[] = [];
  private redoStack: { label: string; doc: WorldDoc }[] = [];
  /** called after each simulation step (renderer hooks in here) */
  onStep: ((w: World) => void) | null = null;
  onLoad: ((w: World) => void) | null = null;

  constructor(presetId = 'genesis', seed = 1) {
    this.presetId = presetId;
    this.world = buildPreset(presetId, seed);
    this.origin = serializeWorld(this.world);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Notify the UI that something structural changed. */
  touch(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ time

  /** Advance by real elapsed seconds. Returns the number of fixed steps taken. */
  frame(realDt: number): number {
    if (!this.running) {
      this.stepsLastFrame = 0;
      return 0;
    }
    this.acc += Math.min(realDt, 0.1) * this.speed;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.stepOnce();
      this.acc -= FIXED_DT;
      steps++;
    }
    // spiral-of-death protection: drop backlog we can't catch up on
    this.lagging = this.acc >= FIXED_DT;
    if (this.lagging) this.acc = 0;
    this.stepsLastFrame = steps;
    return steps;
  }

  stepOnce(): void {
    const before = this.world.liveCount;
    this.world.step(FIXED_DT);
    this.metrics.record(this.world);
    this.onStep?.(this.world);
    if (this.world.liveCount !== before) this.version++;
  }

  /** Manual single step (works while paused). */
  step(n = 1): void {
    for (let i = 0; i < n; i++) this.stepOnce();
    this.touch();
  }

  setRunning(r: boolean): void {
    this.running = r;
    this.acc = 0;
    this.touch();
  }

  setSpeed(s: number): void {
    this.speed = Math.max(0.05, Math.min(8, s));
    this.touch();
  }

  /** Fractional progress towards the next fixed step (for render interpolation hints). */
  get alpha(): number {
    return this.acc / FIXED_DT;
  }

  // ------------------------------------------------------------ loading

  private replaceWorld(w: World, keepOrigin = false): void {
    this.world = w;
    if (!keepOrigin) this.origin = serializeWorld(w);
    this.metrics.clear();
    this.acc = 0;
    this.onLoad?.(w);
    this.touch();
  }

  loadPreset(id: string, seed?: number): void {
    this.commit(`load preset`);
    this.presetId = id;
    this.replaceWorld(buildPreset(id, seed ?? this.world.seed));
  }

  /** Rebuilds the current universe from its loaded snapshot (deterministic replay). */
  reset(): void {
    this.commit('reset');
    this.replaceWorld(deserializeWorld(this.origin), true);
  }

  /** Re-seed: rebuild the current preset with a new seed. */
  reseed(seed: number): void {
    this.commit('reseed');
    if (PRESETS.some((p) => p.id === this.presetId)) this.replaceWorld(buildPreset(this.presetId, seed));
    else {
      const doc = serializeWorld(this.world);
      doc.seed = seed;
      delete doc.rngState;
      this.replaceWorld(deserializeWorld(doc));
    }
  }

  /** Makes the current state the new reset point. */
  setResetPoint(): void {
    this.origin = serializeWorld(this.world);
    this.touch();
  }

  loadDoc(input: unknown): void {
    const w = deserializeWorld(input); // throws ImportError with details
    this.commit('import world');
    this.presetId = 'custom';
    this.replaceWorld(w);
  }

  exportDoc(): WorldDoc {
    return serializeWorld(this.world);
  }

  // ------------------------------------------------------------ undo

  /** Record an undo point BEFORE a change. Rapid commits with the same label coalesce. */
  commit(label: string): void {
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.label === label && now - top.at < 700) {
      top.at = now;
      return;
    }
    this.undoStack.push({ label, doc: serializeWorld(this.world), at: now });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string {
    return this.undoStack[this.undoStack.length - 1]?.label ?? '';
  }

  undo(): string | null {
    const top = this.undoStack.pop();
    if (!top) return null;
    this.redoStack.push({ label: top.label, doc: serializeWorld(this.world) });
    this.replaceWorld(deserializeWorld(top.doc), true);
    return top.label;
  }

  redo(): string | null {
    const top = this.redoStack.pop();
    if (!top) return null;
    this.undoStack.push({ label: top.label, doc: serializeWorld(this.world), at: 0 });
    this.replaceWorld(deserializeWorld(top.doc), true);
    return top.label;
  }

  // ------------------------------------------------------------ rules/materials changed

  rulesChanged(): void {
    this.world.engine.invalidate();
    this.touch();
  }

  // ------------------------------------------------------------ save slots (localStorage)

  static listSlots(): SaveSlot[] {
    const out: SaveSlot[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(SLOT_PREFIX)) continue;
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const meta = JSON.parse(raw).__meta as SaveSlot | undefined;
        if (meta) out.push(meta);
      }
    } catch {
      /* storage unavailable */
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  saveSlot(name: string): SaveSlot {
    const doc = serializeWorld(this.world);
    const meta: SaveSlot = { name, savedAt: Date.now(), entities: doc.entities.length, rules: doc.rules.length };
    const payload = JSON.stringify({ ...doc, __meta: meta });
    try {
      localStorage.setItem(SLOT_PREFIX + name, payload);
    } catch (e) {
      throw new Error(`Could not save: browser storage is full or unavailable (${(e as Error).message})`);
    }
    return meta;
  }

  loadSlot(name: string): void {
    const raw = localStorage.getItem(SLOT_PREFIX + name);
    if (!raw) throw new Error(`No save named “${name}”`);
    const data = JSON.parse(raw);
    delete data.__meta;
    this.loadDoc(data);
  }

  static deleteSlot(name: string): void {
    try {
      localStorage.removeItem(SLOT_PREFIX + name);
    } catch {
      /* ignore */
    }
  }
}
