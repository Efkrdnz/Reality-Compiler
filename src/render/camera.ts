export class Camera {
  /** World coordinate at the centre of the viewport. */
  x = 800;
  y = 500;
  zoom = 0.8;
  viewW = 1;
  viewH = 1;
  dpr = 1;

  // smoothed targets for satisfying zoom/pan
  tx = 800;
  ty = 500;
  tzoom = 0.8;

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 };
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.viewW / 2) / this.zoom + this.x, y: (sy - this.viewH / 2) / this.zoom + this.y };
  }

  fit(w: number, h: number, margin = 60): void {
    const z = Math.min((this.viewW - margin * 2) / w, (this.viewH - margin * 2) / h);
    this.tzoom = Math.max(0.1, Math.min(4, z));
    this.tx = w / 2;
    this.ty = h / 2;
  }

  snap(): void {
    this.x = this.tx;
    this.y = this.ty;
    this.zoom = this.tzoom;
  }

  /** Zoom keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorldTarget(sx, sy);
    this.tzoom = Math.max(0.12, Math.min(6, this.tzoom * factor));
    const after = this.toWorldTarget(sx, sy);
    this.tx += before.x - after.x;
    this.ty += before.y - after.y;
  }

  private toWorldTarget(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.viewW / 2) / this.tzoom + this.tx, y: (sy - this.viewH / 2) / this.tzoom + this.ty };
  }

  panBy(dsx: number, dsy: number): void {
    this.tx -= dsx / this.tzoom;
    this.ty -= dsy / this.tzoom;
    this.x = this.tx;
    this.y = this.ty;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tzoom - this.zoom) * k;
  }
}
