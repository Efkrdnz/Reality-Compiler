import { useEffect, useRef } from 'react';
import { Renderer, VEL_SCALE, entityHandles, type Overlay } from '../render/renderer';
import { FIELD_INFO } from '../sim/fields';
import { shapeSpecFor } from '../sim/rules/engine';
import type { Entity, Field } from '../sim/types';
import { Hud } from './Hud';
import { sim } from './sim';
import { useUI, type Tool } from './store';

interface DragState {
  mode: 'none' | 'pan' | 'entity' | 'field' | 'fieldSize' | 'fieldAngle' | 'spawn' | 'wall' | 'erase' | 'spray' | 'rotate' | 'aim';
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  id?: number;
  offX: number;
  offY: number;
  moved: boolean;
}

export const viewRef: { renderer: Renderer | null; fps: number; frameMs: number } = { renderer: null, fps: 0, frameMs: 0 };

const SHAPE_TOOLS: Tool[] = ['circle', 'box', 'triangle', 'hexagon'];

export function Viewport() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<Overlay>({ pulse: new Map() });
  const drag = useRef<DragState>({ mode: 'none', sx: 0, sy: 0, wx: 0, wy: 0, offX: 0, offY: 0, moved: false });
  const cursor = useRef({ sx: -1, sy: -1, wx: 0, wy: 0, inside: false });
  const connectFrom = useRef<number | undefined>(undefined);
  const portalFrom = useRef<number | undefined>(undefined);
  const spaceHeld = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const renderer = new Renderer(canvas);
    viewRef.renderer = renderer;
    // exposed for debugging and the automated smoke test (scripts/smoke.mjs)
    (globalThis as unknown as { __rcView: Renderer }).__rcView = renderer;
    const cam = renderer.camera;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      renderer.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1));
    };
    resize();
    cam.fit(sim.world.settings.width, sim.world.settings.height);
    cam.snap();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    sim.onStep = (w) => {
      renderer.ingest(w);
      // rule pulse highlight: entities that fired a rule glow briefly
      const pulse = overlay.current.pulse!;
      for (const [id, v] of pulse) {
        const nv = v * 0.9;
        if (nv < 0.03) pulse.delete(id);
        else pulse.set(id, nv);
      }
      const log = w.log;
      for (let i = log.length - 1; i >= 0 && log[i].step === w.stepCount - 1; i--) {
        const e = log[i];
        if (e.kind === 'rule' && e.entityId !== undefined) pulse.set(e.entityId, 0.6);
      }
    };
    sim.onLoad = (w) => {
      renderer.clearTrails();
      cam.fit(w.settings.width, w.settings.height);
      const ui = useUI.getState();
      if (ui.selectedId !== undefined && !w.get(ui.selectedId)) ui.select(undefined);
      if (ui.selectedFieldId !== undefined && !w.fields.some((f) => f.id === ui.selectedFieldId)) ui.selectField(undefined);
    };

    let last = performance.now();
    let raf = 0;
    let fpsAcc = 0;
    let fpsN = 0;
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const f0 = performance.now();
      applyDrag();
      spray();
      sim.frame(dt);
      updateOverlay();
      const ui = useUI.getState();
      renderer.draw(sim.world, ui.view, overlay.current, dt);
      viewRef.frameMs = performance.now() - f0;
      fpsAcc += dt;
      fpsN++;
      if (fpsAcc > 0.5) {
        viewRef.fps = fpsN / fpsAcc;
        fpsAcc = 0;
        fpsN = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT') spaceHeld.current = e.type === 'keydown';
      if (e.key === 'Escape') {
        connectFrom.current = undefined;
        portalFrom.current = undefined;
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const fitHandler = () => cam.fit(sim.world.settings.width, sim.world.settings.height);
    window.addEventListener('rc:fit', fitHandler);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('rc:fit', fitHandler);
      sim.onStep = null;
      sim.onLoad = null;
      viewRef.renderer = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ helpers

  function world() {
    return sim.world;
  }
  function cam() {
    return viewRef.renderer!.camera;
  }

  function toWorld(e: { clientX: number; clientY: number }) {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const p = cam().toWorld(sx, sy);
    return { sx, sy, wx: p.x, wy: p.y };
  }

  function fieldHandleAt(wx: number, wy: number): { f: Field; handle: 'size' | 'angle' } | undefined {
    const ui = useUI.getState();
    const f = world().fields.find((x) => x.id === ui.selectedFieldId);
    if (!f) return undefined;
    const tol = 10 / cam().zoom;
    const hx = f.shape === 'rect' ? f.x + f.w / 2 : f.x + f.radius;
    const hy = f.shape === 'rect' ? f.y + f.h / 2 : f.y;
    if (Math.hypot(wx - hx, wy - hy) < tol) return { f, handle: 'size' };
    if (f.kind === 'gravityZone' || f.kind === 'wind' || f.kind === 'portal') {
      const L = (f.shape === 'rect' ? Math.min(f.w, f.h) / 2 : f.radius) * 0.8;
      if (Math.hypot(wx - (f.x + Math.cos(f.angle) * L), wy - (f.y + Math.sin(f.angle) * L)) < tol) return { f, handle: 'angle' };
    }
    return undefined;
  }

  function entityHandleAt(wx: number, wy: number): { id: number; handle: 'rotate' | 'aim' } | undefined {
    const ui = useUI.getState();
    const e = world().get(ui.selectedId);
    if (!e) return undefined;
    const z = cam().zoom;
    const h = entityHandles(e, z, !sim.running);
    const tol = 9 / z;
    if (h.vx !== undefined && h.vy !== undefined && Math.hypot(wx - h.vx, wy - h.vy) < tol) return { id: e.id, handle: 'aim' };
    if (Math.hypot(wx - h.rx, wy - h.ry) < tol) return { id: e.id, handle: 'rotate' };
    return undefined;
  }

  function spawnShape(tool: Tool, x: number, y: number, vx = 0, vy = 0): Entity | null {
    const ui = useUI.getState();
    const w = world();
    const e = w.spawn({
      shape: shapeSpecFor(tool === 'particle' ? 'particle' : tool, ui.size),
      kind: tool === 'particle' ? 'particle' : 'body',
      x,
      y,
      vx,
      vy,
      material: ui.material,
      isStatic: ui.staticSpawn && tool !== 'particle',
      angle: tool === 'triangle' || tool === 'hexagon' ? 0 : 0,
      origin: 'user',
    });
    if (!e) useUI.getState().toast({ kind: 'error', title: `Entity cap reached (${w.settings.maxEntities}). Raise it in World → Limits.` });
    return e;
  }

  function applyDrag() {
    const d = drag.current;
    const w = world();
    if (d.mode === 'entity' && d.id !== undefined) {
      const e = w.get(d.id);
      if (!e) {
        d.mode = 'none';
        return;
      }
      const tx = cursor.current.wx - d.offX;
      const ty = cursor.current.wy - d.offY;
      if (!sim.running || e.isStatic) {
        e.x = tx;
        e.y = ty;
        e.vx = e.vy = 0;
      } else {
        // critically damped "mouse joint": velocity steering towards the cursor
        const k = 16;
        e.vx = Math.max(-4000, Math.min(4000, (tx - e.x) * k));
        e.vy = Math.max(-4000, Math.min(4000, (ty - e.y) * k));
        e.av *= 0.85;
      }
    }
  }

  function spray() {
    const d = drag.current;
    if (d.mode !== 'spray') return;
    const w = world();
    for (let i = 0; i < 3; i++) {
      const a = w.rng.next() * Math.PI * 2;
      const s = 40 + w.rng.next() * 160;
      spawnShape('particle', cursor.current.wx + Math.cos(a) * 6, cursor.current.wy + Math.sin(a) * 6, Math.cos(a) * s, Math.sin(a) * s);
    }
  }

  function eraseAt(wx: number, wy: number) {
    const ui = useUI.getState();
    const w = world();
    const R = Math.max(10, ui.size * 1.5);
    let n = 0;
    for (const e of w.entities) {
      if (e.dead) continue;
      if (Math.hypot(e.x - wx, e.y - wy) <= R + e.radius * 0.5) {
        w.destroy(e, 'erased by user');
        n++;
      }
    }
    if (n && ui.selectedId !== undefined && !w.get(ui.selectedId)) ui.select(undefined);
    return n;
  }

  function updateOverlay() {
    const o = overlay.current;
    const ui = useUI.getState();
    const c = cursor.current;
    o.selectedId = ui.selectedId;
    o.selectedFieldId = ui.selectedFieldId;
    o.paused = !sim.running;
    o.ghost = undefined;
    o.line = undefined;
    const d = drag.current;
    if (!c.inside && d.mode === 'none') return;
    const tool = ui.tool;
    const mat = sim.world.materials.get(ui.material);
    const color = mat?.color ?? '#ffffff';
    if (SHAPE_TOOLS.includes(tool) || tool === 'particle') {
      const sx = d.mode === 'spawn' ? d.wx : c.wx;
      const sy = d.mode === 'spawn' ? d.wy : c.wy;
      o.ghost = { kind: tool as 'circle', x: sx, y: sy, size: tool === 'particle' ? 6 : ui.size, color };
      if (d.mode === 'spawn' && d.moved) o.line = { x1: d.wx, y1: d.wy, x2: c.wx, y2: c.wy, style: 'sling' };
    } else if (tool === 'wall') {
      if (d.mode === 'wall') o.line = { x1: d.wx, y1: d.wy, x2: c.wx, y2: c.wy, style: 'wall' };
      else o.ghost = { kind: 'wall', x: c.wx, y: c.wy, size: 8, color: '#8fa3bf' };
    } else if (tool === 'erase') {
      o.ghost = { kind: 'eraser', x: c.wx, y: c.wy, size: Math.max(10, ui.size * 1.5), color: '#ff4f6a' };
    } else if (tool === 'blast') {
      o.ghost = { kind: 'blast', x: c.wx, y: c.wy, size: 220, color: '#ffb020' };
    } else if (tool === 'field') {
      o.ghost = { kind: 'field', x: c.wx, y: c.wy, size: ui.fieldKind === 'portal' ? 46 : 180, color: FIELD_INFO[ui.fieldKind].color, fieldKind: ui.fieldKind };
      const pf = sim.world.fields.find((f) => f.id === portalFrom.current);
      if (ui.fieldKind === 'portal' && pf) o.line = { x1: pf.x, y1: pf.y, x2: c.wx, y2: c.wy, style: 'portal' };
    } else if (tool === 'connect') {
      const a = sim.world.get(connectFrom.current);
      if (a) o.line = { x1: a.x, y1: a.y, x2: c.wx, y2: c.wy, style: 'link' };
    }
  }

  // ------------------------------------------------------------------ pointer handlers

  function onPointerDown(ev: React.PointerEvent) {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(ev.pointerId);
    canvas.focus();
    const p = toWorld(ev);
    cursor.current = { ...p, inside: true };
    const d = drag.current;
    Object.assign(d, { sx: p.sx, sy: p.sy, wx: p.wx, wy: p.wy, moved: false, id: undefined, offX: 0, offY: 0 });
    const ui = useUI.getState();
    const w = world();
    if (ev.button === 1 || ev.button === 2 || spaceHeld.current) {
      d.mode = 'pan';
      return;
    }
    switch (ui.tool) {
      case 'select': {
        const eh = entityHandleAt(p.wx, p.wy);
        if (eh) {
          sim.commit(eh.handle === 'rotate' ? 'rotate' : 'aim velocity');
          d.mode = eh.handle === 'rotate' ? 'rotate' : 'aim';
          d.id = eh.id;
          return;
        }
        const h = fieldHandleAt(p.wx, p.wy);
        if (h) {
          sim.commit('edit field');
          d.mode = h.handle === 'size' ? 'fieldSize' : 'fieldAngle';
          d.id = h.f.id;
          return;
        }
        const e = w.pick(p.wx, p.wy, 4 / cam().zoom);
        if (e) {
          ui.select(e.id);
          sim.commit('move');
          d.mode = 'entity';
          d.id = e.id;
          d.offX = p.wx - e.x;
          d.offY = p.wy - e.y;
          return;
        }
        const f = w.pickField(p.wx, p.wy);
        if (f) {
          ui.selectField(f.id);
          sim.commit('move field');
          d.mode = 'field';
          d.id = f.id;
          d.offX = p.wx - f.x;
          d.offY = p.wy - f.y;
          return;
        }
        ui.select(undefined);
        d.mode = 'pan';
        return;
      }
      case 'circle':
      case 'box':
      case 'triangle':
      case 'hexagon':
        d.mode = 'spawn';
        return;
      case 'particle':
        sim.commit('spray');
        d.mode = 'spray';
        return;
      case 'wall':
        d.mode = 'wall';
        return;
      case 'erase':
        sim.commit('erase');
        d.mode = 'erase';
        if (!eraseAt(p.wx, p.wy)) {
          const f = w.pickField(p.wx, p.wy);
          if (f) {
            w.removeField(f.id);
            w.engine.invalidate();
            sim.touch();
          }
        }
        return;
      case 'blast': {
        sim.commit('blast');
        const R = 220;
        w.queryCircle(p.wx, p.wy, R, (o) => {
          if (o.isStatic) return;
          const dx = o.x - p.wx;
          const dy = o.y - p.wy;
          const dist = Math.hypot(dx, dy) || 1;
          const k = (1 - Math.min(1, dist / R)) * 1100;
          o.vx += (dx / dist) * k;
          o.vy += (dy / dist) * k;
        });
        w.engine.fx.push({ kind: 'shockwave', x: p.wx, y: p.wy, r: R, color: '#ffb020' });
        if (!sim.running) viewRef.renderer?.ingest(w);
        return;
      }
      case 'connect': {
        const e = w.pick(p.wx, p.wy, 6 / cam().zoom);
        if (!e) {
          connectFrom.current = undefined;
          return;
        }
        if (connectFrom.current === undefined || !w.get(connectFrom.current)) {
          connectFrom.current = e.id;
          ui.select(e.id);
        } else if (connectFrom.current !== e.id) {
          const a = w.get(connectFrom.current)!;
          sim.commit('connect');
          const j = w.addJoint(a, e, { stiffness: ev.shiftKey ? 0.35 : 1, damping: ev.shiftKey ? 0.6 : 0.2, color: a.color });
          if (!j) ui.toast({ kind: 'info', title: 'Those two are already connected' });
          else w.engine.fx.push({ kind: 'link', x: a.x, y: a.y, x2: e.x, y2: e.y, r: 0, color: '#ffffff' });
          connectFrom.current = ev.altKey ? connectFrom.current : e.id;
          ui.select(e.id);
          sim.touch();
        }
        return;
      }
      case 'field': {
        sim.commit('add field');
        const kind = ui.fieldKind;
        const info = FIELD_INFO[kind];
        const f = w.addField(kind, p.wx, p.wy, { strength: info.defaultStrength * (ev.altKey && kind !== 'timeZone' && kind !== 'portal' ? -1 : 1) });
        if (kind === 'portal') {
          const prev = w.fields.find((x) => x.id === portalFrom.current);
          if (prev && !prev.link) {
            prev.link = f.id;
            f.link = prev.id;
            f.color = '#ffb020';
            portalFrom.current = undefined;
            ui.toast({ kind: 'ok', title: `Portals linked: ${prev.name} ⇄ ${f.name}` });
          } else {
            portalFrom.current = f.id;
            ui.toast({ kind: 'info', title: 'Portal placed — click again to place its partner' });
          }
        }
        w.engine.invalidate();
        ui.selectField(f.id);
        sim.touch();
        return;
      }
    }
  }

  function onPointerMove(ev: React.PointerEvent) {
    const p = toWorld(ev);
    const prev = cursor.current;
    cursor.current = { ...p, inside: true };
    const d = drag.current;
    if (d.mode !== 'none' && Math.hypot(p.sx - d.sx, p.sy - d.sy) > 4) d.moved = true;
    const w = world();
    switch (d.mode) {
      case 'pan':
        cam().panBy(p.sx - prev.sx, p.sy - prev.sy);
        return;
      case 'field':
      case 'fieldSize':
      case 'fieldAngle': {
        const f = w.fields.find((x) => x.id === d.id);
        if (!f) return;
        if (d.mode === 'field') {
          f.x = p.wx - d.offX;
          f.y = p.wy - d.offY;
        } else if (d.mode === 'fieldSize') {
          if (f.shape === 'rect') {
            f.w = Math.max(20, Math.abs(p.wx - f.x) * 2);
            f.h = Math.max(20, Math.abs(p.wy - f.y) * 2);
          } else f.radius = Math.max(8, Math.hypot(p.wx - f.x, p.wy - f.y));
        } else {
          f.angle = Math.atan2(p.wy - f.y, p.wx - f.x);
          if (ev.shiftKey) f.angle = Math.round(f.angle / (Math.PI / 12)) * (Math.PI / 12);
        }
        return;
      }
      case 'erase':
        eraseAt(p.wx, p.wy);
        return;
      case 'rotate':
      case 'aim': {
        const e = w.get(d.id);
        if (!e) return;
        if (d.mode === 'rotate') {
          let a = Math.atan2(p.wy - e.y, p.wx - e.x);
          if (ev.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
          e.angle = a;
          e.av = 0;
        } else {
          e.vx = Math.max(-4000, Math.min(4000, (p.wx - e.x) / VEL_SCALE));
          e.vy = Math.max(-4000, Math.min(4000, (p.wy - e.y) / VEL_SCALE));
        }
        return;
      }
    }
    // hover
    const ui = useUI.getState();
    if (ui.tool === 'select' || ui.tool === 'connect') {
      const e = w.pick(p.wx, p.wy, 4 / cam().zoom);
      overlay.current.hoverId = e?.id;
      overlay.current.hoverFieldId = e ? undefined : w.pickField(p.wx, p.wy)?.id;
      const h = ui.tool === 'select' ? fieldHandleAt(p.wx, p.wy) ?? entityHandleAt(p.wx, p.wy) : undefined;
      canvasRef.current!.style.cursor = h ? (h.handle === 'size' ? 'nwse-resize' : 'grab') : e || overlay.current.hoverFieldId ? 'pointer' : 'default';
    } else {
      overlay.current.hoverId = undefined;
      overlay.current.hoverFieldId = undefined;
      canvasRef.current!.style.cursor = 'crosshair';
    }
  }

  function onPointerUp(ev: React.PointerEvent) {
    const p = toWorld(ev);
    const d = drag.current;
    const ui = useUI.getState();
    const w = world();
    if (d.mode === 'spawn') {
      sim.commit('spawn');
      let vx = 0;
      let vy = 0;
      if (d.moved) {
        vx = (d.wx - p.wx) * 4;
        vy = (d.wy - p.wy) * 4;
      }
      const e = spawnShape(ui.tool, d.wx, d.wy, vx, vy);
      if (e) sim.touch();
    } else if (d.mode === 'wall') {
      const len = Math.hypot(p.wx - d.wx, p.wy - d.wy);
      if (len > 6) {
        sim.commit('wall');
        w.spawn({
          shape: { type: 'box', w: len, h: 16 },
          x: (p.wx + d.wx) / 2,
          y: (p.wy + d.wy) / 2,
          angle: Math.atan2(p.wy - d.wy, p.wx - d.wx),
          isStatic: true,
          material: ui.material,
          origin: 'user',
        });
        sim.touch();
      }
    } else if (d.mode === 'entity' && d.id !== undefined) {
      const e = w.get(d.id);
      if (e && sim.running && !e.isStatic) {
        // keep fling velocity but clamp it
        const sp = Math.hypot(e.vx, e.vy);
        if (sp > 2200) {
          e.vx *= 2200 / sp;
          e.vy *= 2200 / sp;
        }
      }
      sim.touch();
    } else if (d.mode === 'field' || d.mode === 'fieldSize' || d.mode === 'fieldAngle' || d.mode === 'spray' || d.mode === 'erase' || d.mode === 'rotate' || d.mode === 'aim') {
      sim.touch();
    }
    d.mode = 'none';
    try {
      canvasRef.current!.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onWheel(ev: React.WheelEvent) {
    const p = toWorld(ev);
    const factor = Math.exp(-ev.deltaY * 0.0015);
    cam().zoomAt(p.sx, p.sy, factor);
  }

  return (
    <div className="viewport" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        data-testid="world-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (cursor.current.inside = drag.current.mode !== 'none')}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <Hud cursor={cursor} />
    </div>
  );
}
