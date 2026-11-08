/**
 * Uniform grid spatial hash. Items are inserted by AABB into every cell they
 * overlap. Queries de-duplicate with a stamp array, and iteration order only
 * depends on insertion order, which keeps the simulation deterministic.
 */
export class SpatialHash {
  private cells = new Map<number, number[]>();
  private pool: number[][] = [];
  private stamps: Int32Array = new Int32Array(1024);
  private stamp = 1;
  cellSize: number;

  constructor(cellSize = 64) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    return ((cx + 0x8000) & 0xffff) * 0x10000 + ((cy + 0x8000) & 0xffff);
  }

  clear(capacity: number): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.cells.clear();
    if (this.stamps.length < capacity) this.stamps = new Int32Array(Math.max(capacity, this.stamps.length * 2));
  }

  insert(index: number, minX: number, minY: number, maxX: number, maxY: number): void {
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const y0 = Math.floor(minY / cs);
    const x1 = Math.floor(maxX / cs);
    const y1 = Math.floor(maxY / cs);
    // Huge objects are clamped to a reasonable number of cells.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) {
      for (let cx = x0; cx <= x1; cx += Math.ceil((x1 - x0 + 1) / 64)) this.push(cx, y0, index);
      return;
    }
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) this.push(cx, cy, index);
  }

  private push(cx: number, cy: number, index: number): void {
    const k = this.key(cx, cy);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = this.pool.pop() ?? [];
      this.cells.set(k, arr);
    }
    arr.push(index);
  }

  /** Calls cb once per distinct item whose cells overlap the AABB. */
  query(minX: number, minY: number, maxX: number, maxY: number, cb: (index: number) => void): void {
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const y0 = Math.floor(minY / cs);
    const x1 = Math.floor(maxX / cs);
    const y1 = Math.floor(maxY / cs);
    const s = ++this.stamp;
    if (s > 2_000_000_000) {
      this.stamps.fill(0);
      this.stamp = 1;
    }
    const stamps = this.stamps;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const idx = arr[i];
          if (stamps[idx] === this.stamp) continue;
          stamps[idx] = this.stamp;
          cb(idx);
        }
      }
    }
  }

  get cellCount(): number {
    return this.cells.size;
  }
}
