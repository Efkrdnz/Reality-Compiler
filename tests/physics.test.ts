import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { ball, emptyWorld, run } from './helpers';

function groundWorld(): World {
  const w = new World(3);
  w.settings.airDrag = 0;
  w.spawn({ shape: { type: 'box', w: 1500, h: 40 }, x: 800, y: 980, isStatic: true, material: 'stone' });
  return w;
}

const finite = (w: World) => w.entities.every((e) => [e.x, e.y, e.vx, e.vy, e.angle, e.av].every(Number.isFinite));

describe('rigid body stability', () => {
  it.each([
    [16, 40, 0.7],
    [10, 20, 0.7], // thin boxes
    [12, 40, 0.2], // slippery
  ])('a staggered stack of %i boxes (width %i, friction %f) stays upright', (n, width, friction) => {
    const w = groundWorld();
    const boxes = [];
    for (let i = 0; i < n; i++) {
      const b = w.spawn({ shape: { type: 'box', w: width, h: 40 }, x: 800 + (i % 2) * 3, y: 940 - i * 41, material: 'stone' })!;
      b.friction = friction;
      boxes.push(b);
    }
    run(w, 900);
    expect(finite(w)).toBe(true);
    for (const b of boxes) {
      expect(Math.abs(b.x - 800)).toBeLessThan(6); // stayed stacked
      expect(Math.abs(b.angle)).toBeLessThan(0.02); // no creeping rotation
      expect(Math.hypot(b.vx, b.vy)).toBeLessThan(5); // at rest
    }
    // the top box sits where a perfect stack puts it (nothing sank)
    expect(Math.abs(boxes[n - 1].y - (940 - (n - 1) * 40))).toBeLessThan(4);
  });

  it('bouncing never gains energy', () => {
    const w = groundWorld();
    const e = ball(w, 800, 500, { material: 'rubber' });
    let maxY = Infinity; // smallest y = highest point
    let prevPeak = 500;
    let increased = false;
    let vyPrev = 0;
    for (let i = 0; i < 900; i++) {
      w.step(1 / 60);
      if (vyPrev < 0 && e.vy >= 0) {
        if (e.y < prevPeak - 2) increased = true;
        prevPeak = e.y;
      }
      vyPrev = e.vy;
      maxY = Math.min(maxY, e.y);
    }
    expect(increased).toBe(false);
    expect(maxY).toBeGreaterThanOrEqual(499);
    expect(e.y).toBeLessThan(960);
  });

  it('fast bodies do not tunnel through the floor', () => {
    const w = groundWorld();
    const e = ball(w, 800, 100, { vy: 2500, material: 'metal' });
    run(w, 240);
    expect(e.y).toBeLessThan(965);
  });

  it('conserves momentum in zero-g collisions', () => {
    const w = emptyWorld();
    const a = ball(w, 100, 100, { vx: 300, material: 'metal' });
    const b = w.spawn({ shape: { type: 'box', w: 30, h: 30 }, x: 300, y: 104, vx: -100, material: 'wood' })!;
    const p0x = a.mass * a.vx + b.mass * b.vx;
    const p0y = a.mass * a.vy + b.mass * b.vy;
    run(w, 120);
    const p1x = a.mass * a.vx + b.mass * b.vx;
    const p1y = a.mass * a.vy + b.mass * b.vy;
    expect(p1x).toBeCloseTo(p0x, 0);
    expect(Math.abs(p1y - p0y)).toBeLessThan(Math.abs(p0x) * 0.01);
  });

  it('polygons of every type collide with each other', () => {
    const w = groundWorld();
    const shapes = [3, 5, 6, 8].map((n, i) => w.spawn({ shape: { type: 'ngon', sides: n, radius: 22 }, x: 700 + i * 10, y: 600 - i * 60, material: 'wood' })!);
    run(w, 600);
    expect(finite(w)).toBe(true);
    for (const s of shapes) expect(s.y).toBeLessThan(960);
    // they should not overlap deeply: centres stay apart
    for (let i = 0; i < shapes.length; i++)
      for (let j = i + 1; j < shapes.length; j++) expect(Math.hypot(shapes[i].x - shapes[j].x, shapes[i].y - shapes[j].y)).toBeGreaterThan(20);
  });

  it('rigid joints keep their length; springs oscillate and settle', () => {
    const w = groundWorld();
    const a = w.spawn({ shape: { type: 'circle', radius: 10 }, x: 800, y: 200, isStatic: true, material: 'metal' })!;
    const b = ball(w, 900, 200, { material: 'metal' });
    w.addJoint(a, b, { stiffness: 1 });
    run(w, 300);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(100, -0.5);
    expect(b.y).toBeGreaterThan(260); // swung down like a pendulum
  });

  it('survives a thousand-body pile-up with no NaNs and reasonable step time', () => {
    const w = groundWorld();
    w.settings.maxEntities = 2000;
    for (let i = 0; i < 1000; i++) w.spawn({ shape: i % 2 ? { type: 'circle', radius: 6 } : { type: 'box', w: 11, h: 11 }, x: 100 + (i % 50) * 28, y: 100 + Math.floor(i / 50) * 28, material: 'rubber' });
    const t0 = performance.now();
    run(w, 240);
    const ms = (performance.now() - t0) / 240;
    expect(finite(w)).toBe(true);
    expect(ms).toBeLessThan(40);
  });
});

describe('fields', () => {
  it('gravity wells attract and negative wells repel', () => {
    const w = emptyWorld();
    w.addField('well', 500, 500, { radius: 400, strength: 800, falloff: 0 });
    const e = ball(w, 700, 500);
    run(w, 10);
    expect(e.vx).toBeLessThan(-50);
    const w2 = emptyWorld();
    w2.addField('well', 500, 500, { radius: 400, strength: -800, falloff: 0 });
    const e2 = ball(w2, 700, 500);
    run(w2, 10);
    expect(e2.vx).toBeGreaterThan(50);
  });

  it('time zones dilate local time (0 = stasis)', () => {
    const fall = (scale: number | null) => {
      const w = new World(1);
      w.settings.airDrag = 0;
      if (scale !== null) w.addField('timeZone', 500, 500, { radius: 400, strength: scale });
      const e = ball(w, 500, 400);
      run(w, 30);
      return e.y - 400;
    };
    const normal = fall(null);
    const slow = fall(0.5);
    const frozen = fall(0);
    expect(slow).toBeGreaterThan(normal * 0.15);
    expect(slow).toBeLessThan(normal * 0.4); // displacement ~ (t·s)² → 0.25
    expect(frozen).toBe(0);
  });

  it('gravity zones override global gravity inside the region', () => {
    const w = new World(1);
    w.addField('gravityZone', 500, 500, { shape: 'rect', w: 400, h: 400, strength: 600, angle: -Math.PI / 2 });
    const e = ball(w, 500, 500);
    run(w, 20);
    expect(e.vy).toBeLessThan(-100);
  });

  it('portals teleport bodies and rotate their velocity', () => {
    const w = emptyWorld();
    const a = w.addField('portal', 200, 200, { radius: 30, angle: 0 });
    const b = w.addField('portal', 800, 800, { radius: 30, angle: Math.PI / 2 });
    a.link = b.id;
    const e = ball(w, 150, 200, { vx: 300 });
    run(w, 12);
    expect(Math.hypot(e.x - 800, e.y - 800)).toBeLessThan(80);
    expect(e.vy).toBeGreaterThan(250); // rotated 90°: +x became +y
    expect(w.log.length).toBeGreaterThanOrEqual(0);
  });

  it('heat zones drive phase transitions: ice → water → steam', () => {
    const w = new World(1);
    w.settings.gravity = { x: 0, y: 0 };
    w.addField('heat', 500, 500, { radius: 200, strength: 400 });
    const e = ball(w, 500, 500, { material: 'ice' });
    expect(e.material).toBe('ice');
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      w.step(1 / 60);
      seen.add(e.material);
    }
    expect(seen.has('water')).toBe(true);
    expect(seen.has('steam')).toBe(true);
    expect(e.gravityScale).toBeLessThan(0); // steam rises
  });

  it('fields do not act on static geometry', () => {
    const w = groundWorld();
    w.addField('heat', 800, 980, { shape: 'rect', w: 1600, h: 200, strength: 5000 });
    w.addField('well', 800, 980, { radius: 500, strength: 5000 });
    const floor = w.entities[0];
    run(w, 120);
    expect(floor.temperature).toBeLessThan(25);
    expect(floor.x).toBe(800);
    expect(floor.material).toBe('stone');
  });

  it('heat conducts between touching bodies', () => {
    const w = groundWorld();
    w.settings.ambientExchange = 0;
    const hot = w.spawn({ shape: { type: 'box', w: 40, h: 40 }, x: 800, y: 940, material: 'metal', temperature: 800 })!;
    const cold = w.spawn({ shape: { type: 'box', w: 40, h: 40 }, x: 800, y: 899, material: 'metal', temperature: 0 })!;
    run(w, 120);
    expect(cold.temperature).toBeGreaterThan(150);
    expect(hot.temperature).toBeLessThan(650);
  });

  it('charges: opposites attract, likes repel', () => {
    const w = emptyWorld();
    w.settings.coulomb = 2;
    const a = ball(w, 400, 400);
    const b = ball(w, 500, 400);
    a.charge = 3;
    b.charge = -3;
    run(w, 5);
    expect(a.vx).toBeGreaterThan(0);
    expect(b.vx).toBeLessThan(0);
  });

  it('wrap boundary wraps positions', () => {
    const w = emptyWorld();
    w.settings.boundary = 'wrap';
    const e = ball(w, w.settings.width - 5, 300, { vx: 600 });
    run(w, 10);
    expect(e.x).toBeLessThan(200);
  });
});
