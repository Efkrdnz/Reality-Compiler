import type { World } from './world';

export const METRIC_KEYS = ['entities', 'energy', 'temperature', 'ruleFires', 'collisions', 'stepMs', 'instructions', 'contacts'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_INFO: Record<MetricKey, { label: string; unit: string; color: string; format: (v: number) => string }> = {
  entities: { label: 'Entities', unit: '', color: '#00f0ff', format: (v) => v.toFixed(0) },
  energy: { label: 'Kinetic energy', unit: 'MJ*', color: '#ff3df2', format: (v) => (v / 1e6).toFixed(2) },
  temperature: { label: 'Mean temperature', unit: '°', color: '#ff7a1a', format: (v) => v.toFixed(0) },
  ruleFires: { label: 'Rule firings / step', unit: '', color: '#7dff4f', format: (v) => v.toFixed(0) },
  collisions: { label: 'New contacts / step', unit: '', color: '#ffe066', format: (v) => v.toFixed(0) },
  stepMs: { label: 'Step time', unit: 'ms', color: '#8a7bff', format: (v) => v.toFixed(2) },
  instructions: { label: 'Rule instructions', unit: '', color: '#34fff1', format: (v) => v.toFixed(0) },
  contacts: { label: 'Contacts', unit: '', color: '#ff4f9a', format: (v) => v.toFixed(0) },
};

/** Fixed-size ring buffers of per-step metrics, sampled every N steps. */
export class MetricsHistory {
  readonly size: number;
  data: Record<MetricKey, Float32Array>;
  head = 0;
  count = 0;
  private sampleEvery: number;
  private acc: Record<MetricKey, number>;
  private accN = 0;

  constructor(size = 240, sampleEvery = 4) {
    this.size = size;
    this.sampleEvery = sampleEvery;
    this.data = Object.fromEntries(METRIC_KEYS.map((k) => [k, new Float32Array(size)])) as Record<MetricKey, Float32Array>;
    this.acc = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as Record<MetricKey, number>;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.accN = 0;
    for (const k of METRIC_KEYS) this.acc[k] = 0;
  }

  record(w: World): void {
    const s = w.stats;
    this.acc.ruleFires += s.ruleFires;
    this.acc.collisions += s.collisionsBegun;
    this.acc.stepMs += s.stepMs;
    this.acc.instructions += s.instructions;
    this.acc.contacts += s.contacts;
    this.accN++;
    if (this.accN < this.sampleEvery) return;
    const n = this.accN;
    const put = (k: MetricKey, v: number) => (this.data[k][this.head] = v);
    put('entities', w.liveCount);
    put('energy', w.kineticEnergy());
    put('temperature', w.averageTemperature());
    put('ruleFires', this.acc.ruleFires / n);
    put('collisions', this.acc.collisions / n);
    put('stepMs', this.acc.stepMs / n);
    put('instructions', this.acc.instructions / n);
    put('contacts', this.acc.contacts / n);
    for (const k of METRIC_KEYS) this.acc[k] = 0;
    this.accN = 0;
    this.head = (this.head + 1) % this.size;
    this.count = Math.min(this.size, this.count + 1);
  }

  /** Values oldest→newest. */
  series(k: MetricKey): number[] {
    const out: number[] = [];
    const arr = this.data[k];
    for (let i = 0; i < this.count; i++) out.push(arr[(this.head - this.count + i + this.size) % this.size]);
    return out;
  }

  latest(k: MetricKey): number {
    if (!this.count) return 0;
    return this.data[k][(this.head - 1 + this.size) % this.size];
  }
}
