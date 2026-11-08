#!/usr/bin/env node
/**
 * End-to-end smoke test: drives the real app in Chromium and verifies the key workflows.
 *
 *   npm run smoke                 # starts a Vite dev server on a free port
 *   npm run smoke -- http://...   # test an already running instance
 *
 * Screenshots are written to scripts/out/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

let server;
let url = process.argv[2];
if (!url) {
  const port = 5199;
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: join(here, '..'), stdio: 'pipe' });
  url = `http://localhost:${port}/`;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start')), 20000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('Local')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

const results = [];
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}\n      ${String(e.message ?? e).split('\n')[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const rc = (fn, arg) => page.evaluate(fn, arg);
const world = () => rc(() => {
  const w = globalThis.__rc.world;
  return { n: w.liveCount, step: w.stepCount, rules: w.rules.length, fields: w.fields.length, joints: w.joints.length, name: w.name, vars: { ...w.vars }, running: globalThis.__rc.running };
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const canvas = page.getByTestId('world-canvas');
const box = await canvas.boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

await check('app boots and the simulation advances', async () => {
  const a = await world();
  await page.waitForTimeout(500);
  const b = await world();
  assert(b.step > a.step, `step did not advance (${a.step} → ${b.step})`);
  assert(a.n > 10, 'preset should have bodies');
});
await page.screenshot({ path: join(out, '01-genesis.png') });

await check('pause (Space), step (N) and resume', async () => {
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  const a = await world();
  assert(!a.running, 'should be paused');
  await page.waitForTimeout(300);
  const b = await world();
  assert(a.step === b.step, 'paused world must not advance');
  await page.keyboard.press('n');
  await page.getByTestId('btn-step').click();
  const c = await world();
  assert(c.step === b.step + 2, `two single steps expected, got ${c.step - b.step}`);
  await page.getByTestId('btn-play').click();
  await page.waitForTimeout(200);
  assert((await world()).running, 'should be running again');
});

await check('slow motion via speed control', async () => {
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  const s = await rc(() => globalThis.__rc.speed);
  assert(s < 1, `speed should be < 1, got ${s}`);
  await page.keyboard.press('\\');
  assert((await rc(() => globalThis.__rc.speed)) === 1, 'speed reset to 1');
});

await check('spawn a circle by clicking, slingshot by dragging', async () => {
  await page.keyboard.press('Space'); // pause: expiring sparks would change the count
  await page.keyboard.press('2');
  const a = await world();
  const p = at(0.5, 0.15);
  await page.mouse.click(p.x, p.y);
  const b = await world();
  assert(b.n === a.n + 1, `expected +1 entity, got ${b.n - a.n}`);
  await page.mouse.move(p.x + 60, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 160, p.y + 40, { steps: 5 });
  await page.mouse.up();
  const v = await rc(() => {
    const e = globalThis.__rc.world.entities.at(-1);
    return e.vx;
  });
  assert(v < -100, `slingshot should launch leftwards, vx=${v}`);
  await page.keyboard.press('Space');
});

await check('select an entity, inspect it and delete it', async () => {
  await page.keyboard.press('Space'); // pause so it stays put
  await page.keyboard.press('1');
  const pos = await rc(() => {
    const w = globalThis.__rc.world;
    const e = w.entities.find((x) => !x.isStatic && x.radius > 8);
    return { id: e.id, x: e.x, y: e.y };
  });
  const sp = await rc(({ x, y }) => {
    const r = globalThis.__rcView?.camera;
    return r ? r.toScreen(x, y) : null;
  }, pos);
  assert(sp, 'camera not exposed');
  await page.mouse.click(box.x + sp.x, box.y + sp.y);
  await page.getByTestId('entity-inspector').waitFor({ timeout: 2000 });
  const before = await world();
  await page.keyboard.press('Delete');
  const after = await world();
  assert(after.n === before.n - 1, 'delete should remove the entity');
  await page.keyboard.press('Control+z');
  assert((await world()).n === before.n, 'undo should restore it');
  await page.keyboard.press('Space');
});

await check('place a gravity well and a linked portal pair', async () => {
  const a = await world();
  await page.getByTestId('field-well').click();
  const p = at(0.3, 0.3);
  await page.mouse.click(p.x, p.y);
  await page.getByTestId('field-inspector').waitFor({ timeout: 2000 });
  await page.getByTestId('field-portal').click();
  const p1 = at(0.2, 0.6);
  const p2 = at(0.8, 0.6);
  await page.mouse.click(p1.x, p1.y);
  await page.mouse.click(p2.x, p2.y);
  const b = await world();
  assert(b.fields === a.fields + 3, `expected 3 new fields, got ${b.fields - a.fields}`);
  const linked = await rc(() => {
    const f = globalThis.__rc.world.fields.filter((x) => x.kind === 'portal').slice(-2);
    return f[0].link === f[1].id && f[1].link === f[0].id;
  });
  assert(linked, 'portals should be linked both ways');
  await page.keyboard.press('1');
});

await check('connect two bodies with the joint tool', async () => {
  await page.keyboard.press('Space');
  const ids = await rc(() => {
    const w = globalThis.__rc.world;
    const cam = globalThis.__rcView.camera;
    const es = w.entities.filter((e) => !e.isStatic && e.radius > 8).slice(0, 2);
    return es.map((e) => cam.toScreen(e.x, e.y));
  });
  const a = await world();
  await page.keyboard.press('8');
  await page.mouse.click(box.x + ids[0].x, box.y + ids[0].y);
  await page.mouse.click(box.x + ids[1].x, box.y + ids[1].y);
  const b = await world();
  assert(b.joints === a.joints + 1, `expected a new joint (${a.joints} → ${b.joints})`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('1');
  await page.keyboard.press('Space');
});

await check('create a rule in the visual editor, with live validation', async () => {
  await page.getByTestId('tab-rules').click();
  const a = await world();
  await page.getByTestId('new-rule').selectOption('collision');
  const b = await world();
  assert(b.rules === a.rules + 1, 'rule should be added');
  const card = page.getByTestId('rule-card').last();
  await card.getByTestId('add-condition').click();
  await card.getByTestId('add-action').selectOption('setVar');
  const exprInputs = card.locator('input.input.mono');
  const count = await exprInputs.count();
  assert(count > 0, 'expected expression inputs');
  // type an invalid expression in the action's value field and blur → validator error appears
  const value = card.locator('.action-block').last().locator('input.input.mono').last();
  await value.fill('self.mass +');
  await value.blur();
  await card.locator('.issue.error').first().waitFor({ timeout: 2000 });
  await value.fill('self.mass * 2');
  await value.blur();
  await page.waitForTimeout(100);
  const errs = await card.locator('.issue.error').count();
  assert(errs === 0, `errors should clear after fixing, still ${errs}`);
});
await page.screenshot({ path: join(out, '02-rule-editor.png') });

await check('install a rule template module', async () => {
  const a = await world();
  await page.getByTestId('btn-library').click();
  await page.getByTestId('install-tpl_gravity_flip').click();
  const b = await world();
  assert(b.rules === a.rules + 1, 'template should add one rule');
});

await check('every universe preset loads and runs without errors', async () => {
  await page.getByTestId('tab-presets').click();
  const ids = await rc(() => [...document.querySelectorAll('[data-testid^="preset-"]')].map((e) => e.dataset.testid));
  assert(ids.length >= 10, `expected ≥10 presets, got ${ids.length}`);
  for (const id of ids) {
    await page.getByTestId(id).click();
    await page.waitForTimeout(700);
    const w = await world();
    assert(w.step > 10, `${id} did not run`);
    if (id === 'preset-goo') await page.screenshot({ path: join(out, '03-grey-goo.png') });
    if (id === 'preset-orbits') await page.screenshot({ path: join(out, '04-orbits.png') });
    if (id === 'preset-portals') await page.screenshot({ path: join(out, '05-portals.png') });
  }
});

await check('fission preset demonstrates a chain reaction', async () => {
  await page.getByTestId('preset-fission').click();
  await page.waitForTimeout(3500);
  const w = await world();
  assert((w.vars.fissions ?? 0) > 10, `fissions=${w.vars.fissions}`);
  await page.screenshot({ path: join(out, '06-fission.png') });
});

await check('export world JSON and import it back', async () => {
  await page.getByTestId('preset-phase').click();
  await page.waitForTimeout(300);
  await page.getByTestId('btn-file').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('Export world JSON').click()]);
  const path = join(out, 'exported.world.json');
  await dl.saveAs(path);
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  assert(doc.format === 'reality-compiler/world' && doc.entities.length > 10, 'export looks wrong');
  // load a different universe, then import the file
  await page.getByTestId('preset-blank').click();
  await page.getByTestId('btn-file').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Import world JSON…').click()]);
  await chooser.setFiles(path);
  await page.waitForTimeout(400);
  const w = await world();
  assert(w.name === doc.name, `imported name ${w.name} != ${doc.name}`);
});

await check('import of an invalid file shows a readable error', async () => {
  const bad = join(out, 'bad.world.json');
  writeFileSync(bad, JSON.stringify({ format: 'reality-compiler/world', version: 1, name: 'x', description: '', seed: 1, settings: {}, materials: [], entities: [{ id: 1 }], joints: [], fields: [], rules: [], modules: [], vars: {} }));
  await page.getByTestId('btn-file').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Import world JSON…').click()]);
  await chooser.setFiles(bad);
  await page.locator('.toast.error').first().waitFor({ timeout: 2000 });
  const text = await page.locator('.toast.error').first().innerText();
  assert(/failed validation/i.test(text) && /entities\.0/.test(text), `unexpected error text: ${text}`);
});

await check('event inspector, metrics and diagnostics render live data', async () => {
  await page.getByTestId('preset-goo').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('dock-metrics').click();
  await page.getByTestId('dock-events').click();
  const rows = await page.getByTestId('event-list').locator('.event').count();
  assert(rows > 0, 'event inspector should list rule firings');
  await page.getByTestId('dock-metrics').click();
  await page.getByTestId('metrics').waitFor();
  await page.getByTestId('dock-diagnostics').click();
  await page.getByTestId('diagnostics').waitFor();
  await page.getByText('Compute state hash').click();
});
await page.screenshot({ path: join(out, '07-diagnostics.png') });

await check('materials editor creates a programmable material', async () => {
  await page.getByTestId('tab-matter').click();
  const before = await rc(() => globalThis.__rc.world.materials.size);
  await page.getByTestId('btn-new-material').click();
  const after = await rc(() => globalThis.__rc.world.materials.size);
  assert(after === before + 1, 'material not created');
});
await page.screenshot({ path: join(out, '08-materials.png') });

await check('no uncaught errors in the console', async () => {
  assert(errors.length === 0, errors.slice(0, 3).join(' | '));
});

await browser.close();
server?.kill();
console.log(`\nReality Compiler smoke test — ${url}\n${results.join('\n')}\n`);
console.log(failed ? `${failed} check(s) failed` : 'all checks passed', `· screenshots in ${out}`);
process.exit(failed ? 1 : 0);
