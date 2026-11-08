import { FIELD_INFO } from '../sim/fields';
import { hexToRgb } from '../sim/math';
import type { Entity, Field } from '../sim/types';
import type { World } from '../sim/world';
import { Camera } from './camera';

export interface ViewOptions {
  trails: boolean;
  fields: boolean;
  vectors: boolean;
  heat: boolean;
  grid: boolean;
  contacts: boolean;
  glow: boolean;
  labels: boolean;
}

export const DEFAULT_VIEW: ViewOptions = {
  trails: true,
  fields: true,
  vectors: false,
  heat: false,
  grid: true,
  contacts: false,
  glow: true,
  labels: false,
};

export interface Ghost {
  kind: 'circle' | 'box' | 'triangle' | 'hexagon' | 'particle' | 'field' | 'wall' | 'eraser' | 'blast';
  x: number;
  y: number;
  size: number;
  color: string;
  fieldKind?: Field['kind'];
}

export interface Overlay {
  selectedId?: number;
  selectedFieldId?: number;
  hoverId?: number;
  hoverFieldId?: number;
  ghost?: Ghost;
  /** slingshot / wall / link previews, world coords */
  line?: { x1: number; y1: number; x2: number; y2: number; style: 'sling' | 'wall' | 'link' | 'portal' };
  /** rule highlight: entities that fired a rule recently glow */
  pulse?: Map<number, number>;
}

interface Trail {
  xs: Float32Array;
  ys: Float32Array;
  head: number;
  len: number;
  seen: number;
}

interface Fx {
  kind: 'shockwave' | 'flash' | 'link' | 'signal' | 'spark';
  x: number;
  y: number;
  r: number;
  color: string;
  t: number;
  life: number;
  x2?: number;
  y2?: number;
}

const TRAIL_LEN = 26;
const BLOOM_SCALE = 0.25;

/** Blackbody-ish colour for temperatures (for hot glow and heat view). */
export function heatColor(t: number): [number, number, number] {
  if (t < -50) return [70, 120, 255];
  if (t < 0) {
    const k = (t + 50) / 50;
    return [70 + 30 * k, 120 + 100 * k, 255];
  }
  if (t < 60) {
    const k = t / 60;
    return [100 + 20 * k, 220 - 40 * k, 255 - 155 * k];
  }
  if (t < 300) {
    const k = (t - 60) / 240;
    return [120 + 135 * k, 180 - 80 * k, 100 - 80 * k];
  }
  if (t < 900) {
    const k = (t - 300) / 600;
    return [255, 100 + 120 * k, 20 + 40 * k];
  }
  const k = Math.min(1, (t - 900) / 1500);
  return [255, 220 + 35 * k, 60 + 195 * k];
}

export class Renderer {
  camera = new Camera();
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  private glowCache = new Map<string, HTMLCanvasElement>();
  private trails = new Map<number, Trail>();
  private fx: Fx[] = [];
  private frame = 0;
  time = 0;
  lastDrawMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available in this browser');
    this.ctx = ctx;
  }

  resize(w: number, h: number, dpr: number): void {
    this.camera.viewW = w;
    this.camera.viewH = h;
    this.camera.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  private bloom: HTMLCanvasElement | null = null;
  private bloomG: CanvasRenderingContext2D | null = null;
  private bloomCtx(): CanvasRenderingContext2D {
    const w = Math.max(1, Math.ceil(this.camera.viewW * BLOOM_SCALE));
    const h = Math.max(1, Math.ceil(this.camera.viewH * BLOOM_SCALE));
    if (!this.bloom) {
      this.bloom = document.createElement('canvas');
      this.bloomG = this.bloom.getContext('2d')!;
    }
    if (this.bloom.width !== w || this.bloom.height !== h) {
      this.bloom.width = w;
      this.bloom.height = h;
    }
    return this.bloomG!;
  }

  /** Radial glow sprite tinted with a colour; cached by colour. */
  private glow(color: string): HTMLCanvasElement {
    let c = this.glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const [r, gg, b] = hexToRgb(color);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r},${gg},${b},0.9)`);
    grad.addColorStop(0.25, `rgba(${r},${gg},${b},0.35)`);
    grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.08)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    if (this.glowCache.size > 512) this.glowCache.clear();
    this.glowCache.set(color, c);
    return c;
  }

  /** Feed per-step events into visual effects + trails. Called after every simulation step. */
  ingest(world: World): void {
    for (const c of world.collisionsThisStep) {
      if (c.relSpeed > 260 && this.fx.length < 400) {
        this.fx.push({ kind: 'spark', x: c.x, y: c.y, r: Math.min(30, c.relSpeed / 30), color: '#bff8ff', t: 0, life: 0.25 });
      }
    }
    for (const f of world.engine.fx) {
      if (this.fx.length > 500) break;
      this.fx.push({ ...f, t: 0, life: f.kind === 'shockwave' ? 0.6 : f.kind === 'link' ? 0.5 : 0.4 });
    }
    world.engine.fx.length = 0;
    this.frame++;
    for (const e of world.entities) {
      if (e.dead || e.isStatic) continue;
      if (e.kind === 'particle') continue;
      let tr = this.trails.get(e.id);
      if (!tr) {
        tr = { xs: new Float32Array(TRAIL_LEN), ys: new Float32Array(TRAIL_LEN), head: 0, len: 0, seen: 0 };
        this.trails.set(e.id, tr);
      }
      const last = (tr.head - 1 + TRAIL_LEN) % TRAIL_LEN;
      if (tr.len > 0) {
        const dx = e.x - tr.xs[last];
        const dy = e.y - tr.ys[last];
        if (dx * dx + dy * dy > 220 * 220) tr.len = 0; // teleported / wrapped
        else if (dx * dx + dy * dy < 1.5) {
          tr.seen = this.frame;
          continue;
        }
      }
      tr.xs[tr.head] = e.x;
      tr.ys[tr.head] = e.y;
      tr.head = (tr.head + 1) % TRAIL_LEN;
      tr.len = Math.min(TRAIL_LEN, tr.len + 1);
      tr.seen = this.frame;
    }
    if (this.frame % 120 === 0) {
      for (const [id, tr] of this.trails) if (this.frame - tr.seen > 60 || !world.byId.has(id)) this.trails.delete(id);
    }
  }

  clearTrails(): void {
    this.trails.clear();
    this.fx.length = 0;
  }

  draw(world: World, view: ViewOptions, overlay: Overlay, dt: number): void {
    const t0 = performance.now();
    this.time += dt;
    const { ctx, camera } = this;
    camera.update(dt);
    const dpr = camera.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.background(view);

    // world transform
    ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * (camera.viewW / 2 - camera.x * camera.zoom), dpr * (camera.viewH / 2 - camera.y * camera.zoom));
    this.bounds(world);
    if (view.fields) this.fields(world, overlay);
    if (view.trails) this.drawTrails(world);
    this.joints(world);
    this.entities(world, view, overlay);
    if (view.vectors) this.vectors(world, overlay);
    if (view.contacts) this.contacts(world);
    this.drawFx(dt);
    this.gizmos(world, overlay, view);
    this.lastDrawMs = performance.now() - t0;
  }

  // ---------------------------------------------------------------- layers

  private bg: HTMLCanvasElement | null = null;
  private bgKey = '';

  private background(view: ViewOptions): void {
    const { ctx, camera } = this;
    const W = camera.viewW;
    const H = camera.viewH;
    const z = camera.zoom;
    // re-render the cached layer only when the camera or size actually changed
    const key = `${W}|${H}|${camera.dpr}|${view.grid}|${z.toFixed(4)}|${camera.x.toFixed(2)}|${camera.y.toFixed(2)}`;
    if (!this.bg) this.bg = document.createElement('canvas');
    if (key !== this.bgKey) {
      this.bgKey = key;
      const c = this.bg;
      const dpr = camera.dpr;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const g2 = c.getContext('2d')!;
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = g2.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      g.addColorStop(0, '#0a1020');
      g.addColorStop(0.6, '#060912');
      g.addColorStop(1, '#030409');
      g2.fillStyle = g;
      g2.fillRect(0, 0, W, H);
      if (view.grid) this.grid(g2);
    }
    ctx.drawImage(this.bg, 0, 0, W, H);
  }

  private grid(ctx: CanvasRenderingContext2D): void {
    const camera = this.camera;
    const W = camera.viewW;
    const H = camera.viewH;
    const z = camera.zoom;
    let step = 50;
    while (step * z < 22) step *= 2;
    while (step * z > 90) step /= 2;
    const tl = camera.toWorld(0, 0);
    const br = camera.toWorld(W, H);
    ctx.lineWidth = 1;
    const x0 = Math.floor(tl.x / step) * step;
    const y0 = Math.floor(tl.y / step) * step;
    ctx.beginPath();
    for (let x = x0; x <= br.x; x += step) {
      const sx = Math.round((x - camera.x) * z + W / 2) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    }
    for (let y = y0; y <= br.y; y += step) {
      const sy = Math.round((y - camera.y) * z + H / 2) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.strokeStyle = 'rgba(90,160,255,0.045)';
    ctx.stroke();
    const major = step * 4;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / major) * major; x <= br.x; x += major) {
      const sx = Math.round((x - camera.x) * z + W / 2) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    }
    for (let y = Math.floor(tl.y / major) * major; y <= br.y; y += major) {
      const sy = Math.round((y - camera.y) * z + H / 2) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.strokeStyle = 'rgba(90,160,255,0.075)';
    ctx.stroke();
  }

  private bounds(world: World): void {
    const { ctx } = this;
    const { width, height, boundary } = world.settings;
    const z = this.camera.zoom;
    ctx.save();
    ctx.lineWidth = 1.5 / z;
    if (boundary === 'walls') {
      ctx.strokeStyle = 'rgba(0,240,255,0.08)';
      ctx.lineWidth = 7 / z;
      ctx.strokeRect(0, 0, width, height);
      ctx.lineWidth = 1.5 / z;
      ctx.strokeStyle = 'rgba(0,240,255,0.4)';
    } else if (boundary === 'wrap') {
      ctx.setLineDash([10 / z, 8 / z]);
      ctx.strokeStyle = 'rgba(255,61,242,0.4)';
    } else {
      ctx.setLineDash([3 / z, 9 / z]);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    }
    ctx.strokeRect(0, 0, width, height);
    ctx.restore();
    // corner brackets
    ctx.strokeStyle = 'rgba(0,240,255,0.7)';
    ctx.lineWidth = 2 / z;
    const L = 26;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [
      [0, 0, 1, 1],
      [width, 0, -1, 1],
      [0, height, 1, -1],
      [width, height, -1, -1],
    ]) {
      ctx.moveTo(cx + sx * L, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * L);
    }
    ctx.stroke();
  }

  private fields(world: World, overlay: Overlay): void {
    const { ctx } = this;
    const t = this.time;
    const byId = new Map(world.fields.map((f) => [f.id, f]));
    for (const f of world.fields) {
      const info = FIELD_INFO[f.kind];
      const col = f.color || info.color;
      const [r, g, b] = hexToRgb(col);
      const alpha = f.enabled ? 1 : 0.35;
      const sel = overlay.selectedFieldId === f.id || overlay.hoverFieldId === f.id;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (f.shape === 'rect') {
        ctx.beginPath();
        ctx.rect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h);
      } else {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
      }
      const R = f.shape === 'rect' ? Math.max(f.w, f.h) / 2 : f.radius;
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, R);
      const core = f.kind === 'portal' ? 0.35 : f.kind === 'timeZone' ? 0.12 : 0.16;
      grad.addColorStop(0, `rgba(${r},${g},${b},${core})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0.02)`);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = (sel ? 2 : 1) / this.camera.zoom;
      ctx.strokeStyle = `rgba(${r},${g},${b},${sel ? 0.9 : 0.35})`;
      ctx.setLineDash(f.kind === 'timeZone' ? [6, 6] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${r},${g},${b},0.35)`;
      ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
      ctx.lineWidth = 1.5;
      switch (f.kind) {
        case 'well': {
          // rings flowing in (attract) or out (repel)
          const dir = f.strength >= 0 ? -1 : 1;
          for (let i = 0; i < 5; i++) {
            let p = ((t * 0.35 * dir + i / 5) % 1 + 1) % 1;
            p = f.strength >= 0 ? p : p;
            const rr = R * p;
            ctx.globalAlpha = alpha * (1 - p) * 0.9;
            ctx.beginPath();
            ctx.arc(f.x, f.y, rr, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = alpha;
          const core2 = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 26);
          core2.addColorStop(0, `rgba(255,255,255,0.8)`);
          core2.addColorStop(0.3, `rgba(${r},${g},${b},0.6)`);
          core2.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = core2;
          ctx.fillRect(f.x - 26, f.y - 26, 52, 52);
          break;
        }
        case 'gravityZone':
        case 'wind': {
          const ang = f.angle;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const speed = f.kind === 'wind' ? 140 : 70;
          const spacing = 46;
          const offs = (t * speed) % spacing;
          const ext = R * 1.5;
          for (let u = -ext; u < ext; u += spacing) {
            for (let v = -ext; v < ext; v += spacing) {
              const along = u + offs;
              const px = f.x + ca * along - sa * v;
              const py = f.y + sa * along + ca * v;
              if (f.kind === 'wind') {
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px - ca * 16, py - sa * 16);
                ctx.stroke();
              } else {
                ctx.beginPath();
                ctx.moveTo(px + ca * 7, py + sa * 7);
                ctx.lineTo(px - ca * 5 - sa * 5, py - sa * 5 + ca * 5);
                ctx.lineTo(px - ca * 5 + sa * 5, py - sa * 5 - ca * 5);
                ctx.closePath();
                ctx.fill();
              }
            }
          }
          break;
        }
        case 'vortex': {
          const spin = t * (f.strength >= 0 ? 1.2 : -1.2);
          for (let arm = 0; arm < 4; arm++) {
            ctx.beginPath();
            for (let k = 0; k <= 40; k++) {
              const p = k / 40;
              const a = spin + arm * (Math.PI / 2) + p * 4;
              const rr = p * R;
              const px = f.x + Math.cos(a) * rr;
              const py = f.y + Math.sin(a) * rr;
              if (k === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
          break;
        }
        case 'heat': {
          const hot = f.strength >= 0;
          const n = 22;
          for (let i = 0; i < n; i++) {
            const seed = i * 97.31;
            const px = f.x - (f.shape === 'rect' ? f.w / 2 : R) + ((seed * 13.7) % 1) * 0 + (((i * 0.6180339) % 1) * (f.shape === 'rect' ? f.w : R * 2));
            const phase = (t * (hot ? 0.5 : 0.25) + (seed % 1)) % 1;
            const span = f.shape === 'rect' ? f.h : R * 2;
            const py = hot ? f.y + span / 2 - phase * span : f.y - span / 2 + phase * span;
            ctx.globalAlpha = alpha * Math.sin(phase * Math.PI) * 0.7;
            ctx.beginPath();
            ctx.arc(px + Math.sin(t * 2 + i) * 6, py, hot ? 3 : 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'timeZone': {
          // ticking clock ring rotating at the local time rate
          ctx.globalAlpha = alpha * 0.8;
          const rot = this.time * f.strength * 0.6;
          for (let i = 0; i < 60; i++) {
            const a = rot + (i / 60) * Math.PI * 2;
            const long = i % 5 === 0;
            const r1 = R - (long ? 16 : 8);
            ctx.beginPath();
            ctx.moveTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
            ctx.lineTo(f.x + Math.cos(a) * (R - 2), f.y + Math.sin(a) * (R - 2));
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(f.x, f.y);
          ctx.lineTo(f.x + Math.cos(rot * 3) * R * 0.6, f.y + Math.sin(rot * 3) * R * 0.6);
          ctx.stroke();
          break;
        }
        case 'portal': {
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            const a0 = t * (2 + i) + i * 2;
            ctx.arc(f.x, f.y, R * (0.55 + i * 0.18), a0, a0 + Math.PI * 1.2);
            ctx.lineWidth = 3 - i * 0.6;
            ctx.stroke();
          }
          break;
        }
      }
      ctx.restore();
      // portal exit direction + link
      if (f.kind === 'portal') {
        ctx.save();
        ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
        ctx.lineWidth = 3;
        ctx.shadowColor = col;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const dest = byId.get(f.link);
        if (dest && dest.id > f.id) {
          ctx.save();
          ctx.setLineDash([4, 10]);
          ctx.lineDashOffset = -t * 30;
          ctx.strokeStyle = `rgba(${r},${g},${b},0.18)`;
          ctx.lineWidth = 1.5 / this.camera.zoom;
          ctx.beginPath();
          ctx.moveTo(f.x, f.y);
          ctx.lineTo(dest.x, dest.y);
          ctx.stroke();
          ctx.restore();
        } else if (dest && dest.id < f.id && dest.link !== f.id) {
          // one-way link drawn from the source
          ctx.save();
          ctx.setLineDash([4, 10]);
          ctx.strokeStyle = `rgba(${r},${g},${b},0.18)`;
          ctx.beginPath();
          ctx.moveTo(f.x, f.y);
          ctx.lineTo(dest.x, dest.y);
          ctx.stroke();
          ctx.restore();
        }
      }
      // label
      if (sel || this.camera.zoom > 0.45) {
        ctx.save();
        const z = this.camera.zoom;
        ctx.font = `${11 / z}px "JetBrains Mono", monospace`;
        ctx.fillStyle = `rgba(${r},${g},${b},${sel ? 0.95 : 0.55})`;
        ctx.textAlign = 'center';
        const ly = f.shape === 'rect' ? f.y - f.h / 2 - 8 / z : f.y - f.radius - 8 / z;
        const val = f.kind === 'portal' ? (f.link ? `→ ${byId.get(f.link)?.name ?? '?'}` : world.fields.some((o) => o.link === f.id) ? 'exit' : 'unlinked') : `${round(f.strength)}${info.unit ? ' ' + info.unit : ''}`;
        ctx.fillText(`${f.name} · ${val}`, f.x, ly);
        ctx.restore();
      }
    }
  }

  private drawTrails(world: World): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const CHUNKS = 4;
    for (const [id, tr] of this.trails) {
      if (tr.len < 3) continue;
      const e = world.byId.get(id);
      if (!e || e.dead) continue;
      const [r, g, b] = hexToRgb(e.color);
      const w = Math.max(1, Math.min(e.radius * 0.7, 6));
      const per = Math.ceil(tr.len / CHUNKS);
      for (let c = 0; c < CHUNKS; c++) {
        const k0 = c * per;
        const k1 = Math.min(tr.len - 1, (c + 1) * per);
        if (k1 <= k0) continue;
        const f = (c + 1) / CHUNKS;
        ctx.strokeStyle = `rgba(${r},${g},${b},${(f * 0.32).toFixed(3)})`;
        ctx.lineWidth = w * f;
        ctx.beginPath();
        for (let k = k0; k <= k1; k++) {
          const idx = (tr.head - tr.len + k + TRAIL_LEN) % TRAIL_LEN;
          if (k === k0) ctx.moveTo(tr.xs[idx], tr.ys[idx]);
          else ctx.lineTo(tr.xs[idx], tr.ys[idx]);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private joints(world: World): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const j of world.joints) {
      const a = world.byId.get(j.a);
      const b = world.byId.get(j.b);
      if (!a || !b) continue;
      const strain = j.breakImpulse > 0 ? Math.min(1, j.load / (j.breakImpulse * 60)) : Math.min(1, j.load / 400000);
      const [r, g, bb] = hexToRgb(j.color);
      const cr = Math.round(r + (255 - r) * strain);
      const cg = Math.round(g * (1 - strain * 0.7));
      ctx.strokeStyle = `rgba(${cr},${cg},${bb},0.75)`;
      ctx.lineWidth = j.stiffness >= 0.95 ? 2.4 : 1.6;
      if (j.stiffness < 0.95) {
        // zig-zag spring
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d;
        const ny = dx / d;
        const coils = Math.max(4, Math.round(d / 9));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        for (let k = 1; k < coils; k++) {
          const p = k / coils;
          const off = (k % 2 ? 1 : -1) * 4;
          ctx.lineTo(a.x + dx * p + nx * off, a.y + dy * p + ny * off);
        }
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private entities(world: World, view: ViewOptions, overlay: Overlay): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    const tl = this.camera.toWorld(-50, -50);
    const br = this.camera.toWorld(this.camera.viewW + 50, this.camera.viewH + 50);
    const ents = world.entities;
    // glow pass: additive sprites into a quarter-resolution buffer, composited once (cheap bloom)
    if (view.glow) {
      const gctx = this.bloomCtx();
      const cam = this.camera;
      const k = BLOOM_SCALE;
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.globalCompositeOperation = 'source-over';
      gctx.clearRect(0, 0, this.bloom!.width, this.bloom!.height);
      gctx.setTransform(cam.zoom * k, 0, 0, cam.zoom * k, (cam.viewW / 2 - cam.x * cam.zoom) * k, (cam.viewH / 2 - cam.y * cam.zoom) * k);
      gctx.globalCompositeOperation = 'lighter';
      for (const e of ents) {
        if (e.dead || e.x < tl.x - e.radius || e.x > br.x + e.radius || e.y < tl.y - e.radius || e.y > br.y + e.radius) continue;
        const mat = world.materials.get(e.material);
        let glow = mat?.glow ?? 0.3;
        let color = e.color;
        if (view.heat) {
          color = rgbStr(heatColor(qT(e.temperature)));
          glow = 0.6;
        } else if (e.temperature > 350 && e.state !== 'plasma') {
          color = rgbStr(heatColor(qT(e.temperature)));
          glow = Math.max(glow, Math.min(1, (e.temperature - 300) / 700));
        }
        const pulse = overlay.pulse?.get(e.id) ?? 0;
        glow = Math.min(1.4, glow + pulse);
        if (glow < 0.06) continue;
        const size = e.radius * (e.kind === 'particle' ? 5.5 : 2.4 + glow * 2.2);
        gctx.globalAlpha = Math.min(1, (e.kind === 'particle' ? 0.7 : 0.55) * glow * (e.kind === 'particle' && e.lifetime >= 0 ? Math.min(1, e.lifetime * 3) : 1));
        gctx.drawImage(this.glow(color), e.x - size, e.y - size, size * 2, size * 2);
      }
      ctx.save();
      ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.bloom!, 0, 0, cam.viewW, cam.viewH);
      ctx.restore();
    }
    // bodies
    ctx.save();
    ctx.lineJoin = 'round';
    for (const e of ents) {
      if (e.dead || e.x < tl.x - e.radius || e.x > br.x + e.radius || e.y < tl.y - e.radius || e.y > br.y + e.radius) continue;
      let color = e.color;
      if (view.heat) color = rgbStr(heatColor(qT(e.temperature)));
      const [r, g, b] = hexToRgb(color);
      // spawn pop-in
      const born = Math.min(1, (e.age + 0.02) / 0.18);
      const s = born < 1 ? 0.55 + 0.45 * easeOutBack(born) : 1;
      if (e.kind === 'particle') {
        const fade = e.lifetime >= 0 ? Math.min(1, e.lifetime * 3) : 1;
        ctx.globalAlpha = fade;
        ctx.fillStyle = `rgb(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)})`;
        const rr = Math.max(e.radius, 0.8 / z);
        ctx.fillRect(e.x - rr, e.y - rr, rr * 2, rr * 2);
        continue;
      }
      ctx.globalAlpha = e.state === 'gas' ? 0.55 : 1;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);
      if (s !== 1) ctx.scale(s, s);
      ctx.beginPath();
      if (e.shape === 'circle') ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
      else {
        ctx.moveTo(e.verts[0].x, e.verts[0].y);
        for (let k = 1; k < e.verts.length; k++) ctx.lineTo(e.verts[k].x, e.verts[k].y);
        ctx.closePath();
      }
      const dark = e.isStatic ? 0.16 : 0.28;
      ctx.fillStyle = `rgba(${Math.round(r * dark)},${Math.round(g * dark)},${Math.round(b * dark)},0.95)`;
      ctx.fill();
      // inner sheen
      if (e.radius * z > 6) {
        const sheen = ctx.createLinearGradient(-e.radius, -e.radius, e.radius, e.radius);
        sheen.addColorStop(0, `rgba(${r},${g},${b},0.35)`);
        sheen.addColorStop(1, `rgba(${r},${g},${b},0.04)`);
        ctx.fillStyle = sheen;
        ctx.fill();
      }
      ctx.lineWidth = Math.max(1, Math.min(2.2, e.radius * 0.12)) + (e.isStatic ? 0 : 0.3);
      ctx.strokeStyle = `rgba(${r},${g},${b},${e.isStatic ? 0.75 : 1})`;
      ctx.stroke();
      if (e.shape === 'circle' && e.radius * z > 5 && !e.isStatic) {
        ctx.beginPath();
        ctx.moveTo(e.radius * 0.25, 0);
        ctx.lineTo(e.radius * 0.85, 0);
        ctx.stroke();
      }
      if (e.isStatic && e.shape === 'poly') {
        // hatch pattern hint for static geometry
        ctx.globalAlpha = 0.18;
        ctx.clip();
        ctx.beginPath();
        const R = e.radius;
        for (let k = -R * 2; k < R * 2; k += 10) {
          ctx.moveTo(k, -R);
          ctx.lineTo(k + R, R);
        }
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
      if (view.labels && e.radius * z > 8) {
        ctx.globalAlpha = 0.7;
        ctx.font = `${10 / z}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#cfe8ff';
        ctx.textAlign = 'center';
        ctx.fillText(`${e.material} ${Math.round(e.temperature)}°`, e.x, e.y - e.radius - 4 / z);
      }
    }
    ctx.restore();
  }

  private vectors(world: World, overlay: Overlay): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    ctx.save();
    ctx.lineWidth = 1.4 / z;
    for (const e of world.entities) {
      if (e.dead || e.isStatic || e.kind === 'particle') continue;
      const sp = Math.hypot(e.vx, e.vy);
      if (sp < 5) continue;
      const k = 0.12;
      const sel = overlay.selectedId === e.id;
      arrow(ctx, e.x, e.y, e.x + e.vx * k, e.y + e.vy * k, sel ? '#7dff4f' : 'rgba(125,255,79,0.55)', 6 / z);
    }
    ctx.restore();
  }

  private contacts(world: World): void {
    const { ctx } = this;
    const d = world.debugContacts;
    const z = this.camera.zoom;
    ctx.save();
    ctx.fillStyle = '#ffb020';
    ctx.strokeStyle = 'rgba(255,176,32,0.8)';
    ctx.lineWidth = 1 / z;
    for (let i = 0; i < d.length; i += 4) {
      ctx.fillRect(d[i] - 2 / z, d[i + 1] - 2 / z, 4 / z, 4 / z);
      ctx.beginPath();
      ctx.moveTo(d[i], d[i + 1]);
      ctx.lineTo(d[i] + d[i + 2] * 12 / z, d[i + 1] + d[i + 3] * 12 / z);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawFx(dt: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const keep: Fx[] = [];
    for (const f of this.fx) {
      f.t += dt;
      const p = f.t / f.life;
      if (p >= 1) continue;
      keep.push(f);
      const [r, g, b] = hexToRgb(f.color);
      switch (f.kind) {
        case 'shockwave':
          ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - p) * 0.8})`;
          ctx.lineWidth = 6 * (1 - p) + 1;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * easeOutCubic(p), 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = (1 - p) * 0.5;
          ctx.drawImage(this.glow(f.color), f.x - f.r * 0.6, f.y - f.r * 0.6, f.r * 1.2, f.r * 1.2);
          ctx.globalAlpha = 1;
          break;
        case 'spark':
        case 'flash':
          ctx.globalAlpha = 1 - p;
          ctx.drawImage(this.glow(f.color), f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
          ctx.globalAlpha = 1;
          break;
        case 'signal':
          ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - p) * 0.9})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * (0.3 + p), 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'link':
          ctx.strokeStyle = `rgba(255,255,255,${1 - p})`;
          ctx.lineWidth = 3 * (1 - p);
          ctx.beginPath();
          ctx.moveTo(f.x, f.y);
          ctx.lineTo(f.x2 ?? f.x, f.y2 ?? f.y);
          ctx.stroke();
          break;
      }
    }
    this.fx = keep;
    ctx.restore();
  }

  private gizmos(world: World, o: Overlay, view: ViewOptions): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    const t = this.time;
    const hover = world.get(o.hoverId);
    if (hover && hover.id !== o.selectedId) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, hover.radius + 5 / z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const sel = world.get(o.selectedId);
    if (sel) {
      ctx.save();
      const R = sel.radius + 8 / z;
      ctx.strokeStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([6 / z, 5 / z]);
      ctx.lineDashOffset = -t * 20 / z;
      ctx.beginPath();
      ctx.arc(sel.x, sel.y, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // brackets
      const B = R + 6 / z;
      const L = 8 / z;
      ctx.beginPath();
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        ctx.moveTo(sel.x + sx * B, sel.y + sy * (B - L));
        ctx.lineTo(sel.x + sx * B, sel.y + sy * B);
        ctx.lineTo(sel.x + sx * (B - L), sel.y + sy * B);
      }
      ctx.stroke();
      ctx.restore();
      if (!view.vectors && !sel.isStatic) {
        const sp = Math.hypot(sel.vx, sel.vy);
        if (sp > 5) arrow(ctx, sel.x, sel.y, sel.x + sel.vx * 0.12, sel.y + sel.vy * 0.12, '#7dff4f', 7 / z);
        const g = world.settings.gravity;
        if (Math.hypot(g.x, g.y) > 1 && sel.gravityScale !== 0)
          arrow(ctx, sel.x, sel.y, sel.x + g.x * 0.05 * sel.gravityScale, sel.y + g.y * 0.05 * sel.gravityScale, 'rgba(255,61,242,0.8)', 6 / z);
      }
      // connected joints
      ctx.save();
      ctx.strokeStyle = 'rgba(0,240,255,0.5)';
      ctx.lineWidth = 1 / z;
      for (const j of world.joints) {
        if (j.a !== sel.id && j.b !== sel.id) continue;
        const other = world.byId.get(j.a === sel.id ? j.b : j.a);
        if (other) {
          ctx.beginPath();
          ctx.arc(other.x, other.y, other.radius + 4 / z, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    const sf = world.fields.find((f) => f.id === o.selectedFieldId);
    if (sf) this.fieldGizmo(sf);
    if (o.line) {
      const l = o.line;
      ctx.save();
      ctx.lineWidth = 2 / z;
      if (l.style === 'sling') {
        arrow(ctx, l.x1, l.y1, l.x1 + (l.x1 - l.x2), l.y1 + (l.y1 - l.y2), '#ffe066', 9 / z);
        ctx.setLineDash([4 / z, 4 / z]);
        ctx.strokeStyle = 'rgba(255,224,102,0.5)';
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
      } else if (l.style === 'wall') {
        ctx.strokeStyle = 'rgba(143,163,191,0.9)';
        ctx.lineWidth = 16;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
      } else {
        ctx.setLineDash([6 / z, 6 / z]);
        ctx.lineDashOffset = -t * 30 / z;
        ctx.strokeStyle = l.style === 'portal' ? '#00f0ff' : '#7af7ff';
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (o.ghost) this.ghost(o.ghost);
  }

  private fieldGizmo(f: Field): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#05070d';
    ctx.lineWidth = 1.5 / z;
    const h = 6 / z;
    // centre handle
    ctx.beginPath();
    ctx.arc(f.x, f.y, h, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // size handle
    const hx = f.shape === 'rect' ? f.x + f.w / 2 : f.x + f.radius;
    const hy = f.shape === 'rect' ? f.y + f.h / 2 : f.y;
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(hx - h, hy - h, h * 2, h * 2);
    // direction handle
    if (f.kind === 'gravityZone' || f.kind === 'wind' || f.kind === 'portal') {
      const L = (f.shape === 'rect' ? Math.min(f.w, f.h) / 2 : f.radius) * 0.8;
      const ax = f.x + Math.cos(f.angle) * L;
      const ay = f.y + Math.sin(f.angle) * L;
      arrow(ctx, f.x, f.y, ax, ay, '#ff3df2', 8 / z);
      ctx.fillStyle = '#ff3df2';
      ctx.beginPath();
      ctx.arc(ax, ay, h, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private ghost(g: Ghost): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = g.color;
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([4 / z, 4 / z]);
    ctx.beginPath();
    switch (g.kind) {
      case 'box':
        ctx.rect(g.x - g.size, g.y - g.size, g.size * 2, g.size * 2);
        break;
      case 'triangle':
      case 'hexagon': {
        const n = g.kind === 'triangle' ? 3 : 6;
        const R = g.kind === 'triangle' ? g.size * 1.2 : g.size;
        for (let i = 0; i <= n; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
          if (i === 0) ctx.moveTo(g.x + Math.cos(a) * R, g.y + Math.sin(a) * R);
          else ctx.lineTo(g.x + Math.cos(a) * R, g.y + Math.sin(a) * R);
        }
        break;
      }
      case 'field':
        ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2);
        break;
      case 'eraser':
        ctx.strokeStyle = '#ff4f6a';
        ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2);
        break;
      case 'blast':
        ctx.strokeStyle = '#ffb020';
        ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2);
        break;
      default:
        ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(g.x - 5 / z, g.y);
    ctx.lineTo(g.x + 5 / z, g.y);
    ctx.moveTo(g.x, g.y - 5 / z);
    ctx.lineTo(g.x, g.y + 5 / z);
    ctx.stroke();
    ctx.restore();
  }
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, head: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  if (L < 1e-3) return;
  const ux = dx / L;
  const uy = dy / L;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - ux * head * 0.6, y2 - uy * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * head - uy * head * 0.5, y2 - uy * head + ux * head * 0.5);
  ctx.lineTo(x2 - ux * head + uy * head * 0.5, y2 - uy * head - ux * head * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const rgbStr = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const qT = (t: number) => Math.round(t / 20) * 20;
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};
const round = (v: number) => (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100);

export type { Entity };
