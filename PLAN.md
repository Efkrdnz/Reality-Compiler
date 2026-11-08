# REALITY COMPILER — Engineering Plan

A browser 2D sandbox where the laws of physics are data, and users can rewrite them.

## 1. Architecture

```
src/
  sim/            Pure TypeScript simulation. No DOM, no React. Deterministic.
    math.ts         vec2 helpers, clamp, hashing
    rng.ts          seeded PRNG (sfc32) whose state is part of the world
    types.ts        Entity, Joint, Field, Material, WorldSettings, WorldState
    materials.ts    built-in programmable materials (phase changes, ignition, heat)
    spatial.ts      uniform-grid spatial hash for broadphase + proximity queries
    collide.ts      narrowphase: circle/circle, circle/box, box/box (SAT + clipping)
    solver.ts       sequential-impulse contact solver w/ friction, positional correction
    joints.ts       distance/spring joints ("connect")
    fields.ts       gravity wells, attract/repel, directional gravity zones, wind,
                    vortex, heat zones, time zones, portals
    thermal.ts      conduction on contact, ambient exchange, phase transitions
    world.ts        World class: fixed-step pipeline, entity lifecycle, events
    rules/
      types.ts        Rule, Trigger, Condition, Action, Module schemas
      expr.ts         safe expression language (tokenizer + Pratt parser + budgeted
                      interpreter, whitelisted identifiers/functions, no eval)
      engine.ts       event queue, matching, priorities, cooldowns, variables,
                      instruction budget, recursion depth, cycle protection
      catalog.ts      metadata used by the editor (labels, params, defaults)
      templates.ts    reusable rule modules / templates
      validate.ts     static rule validation with human-readable errors
    serialize.ts    world <-> JSON, zod-based import validation, versioning
    presets.ts      curated universes demonstrating emergent mechanics
    metrics.ts      per-step metrics + rolling history
  render/         Canvas2D renderer (additive glow sprites, trails, overlays)
    renderer.ts, camera.ts, sprites.ts, palette.ts
  ui/             React UI (lab interface)
    App.tsx, store.ts (zustand), panels/*, components/*
  engine/         glue: SimController (rAF loop, accumulator, time controls,
                  history snapshots, save/load), input/tools
tests/            vitest: rules, expr, stability, determinism, serialization, fields
scripts/          playwright smoke test that drives the real app
```

Simulation and rendering are separated: the renderer reads `World` state only;
all mutation happens through `World` methods or the controller.

### Why a custom physics engine
Libraries such as matter-js/planck can't easily express per-body time dilation
(time zones), portal teleportation with velocity remapping, heat transfer,
material phase transitions, and rule hooks inside the contact pipeline, and
their determinism guarantees are weaker. A compact custom impulse engine (circles
+ oriented boxes, SAT, sequential impulses, warm-starting-free but iterated)
gives full control and determinism under a fixed timestep.

### Determinism
* Fixed timestep (1/120 s internal, 2 substeps per 1/60 tick).
* Seeded sfc32 RNG stored in world state; all randomness (rules, emitters) uses it.
* Entities processed in stable id order; spatial hash iteration is order-stable.
* Same world JSON + same seed ⇒ identical state hash after N steps (tested).

### Safety
* Rule values use a tiny expression language, never `eval`/`Function`.
* Per-step instruction budget (expression nodes + actions + conditions cost units).
* Max chain depth for rule→rule triggers; per-(rule,entity) cycle detection inside
  a chain; max events per step; hard entity cap (replication can't explode).
* Every guard that trips emits a visible diagnostic event.

## 2. Feature checklist

Core
- [ ] particles, circles, boxes; static bodies; walls
- [ ] collisions w/ restitution, friction, rotation
- [ ] gravity, forces, drag, temperature, materials
- [ ] time controls: play/pause, slow motion / fast, step, reset
- [ ] spawn / drag (mouse spring) / connect (joints) / delete / inspect
- [ ] save/load (localStorage slots), export/import JSON

Reality programming
- [ ] triggers: collision, proximity, timer, creation, destruction, temperature,
      velocity, state change, signal (event chains), always/tick
- [ ] conditions: material, mass, color, position, speed, tags, temperature,
      state, variables, expression; subject self/other
- [ ] actions: force, impulse, teleport, transform, duplicate, destroy, set gravity,
      set property, tag add/remove, emit particles, spawn, trigger rule, emit signal,
      set variable, set environment (ambient temp, wind, time scale)
- [ ] priorities, cooldowns, enable/disable, variables, modules, event chains
- [ ] visual editor with validation, templates, module save/install

Advanced
- [ ] gravity wells, attract/repel, gravity zones, wind/vortex, heat zones
- [ ] portals (paired), time zones (local dilation)
- [ ] programmable materials editor (phase changes, ignition, emission)
- [ ] strange universes presets: reversed gravity, self-replication, chain reaction

Experimentation
- [ ] presets, rule templates, metrics w/ sparklines, event inspector, perf diagnostics

Visuals
- [ ] dark lab aesthetic, glow sprites, trails, field overlays, force vectors,
      gizmos (selection, field radius handles), heat-view, smooth UI animation

Quality
- [ ] keyboard shortcuts, undo for edits, toasts for errors, validation
- [ ] vitest suite; playwright smoke run; README with setup + limitations

## 3. Execution order
1. Scaffold (Vite/React/TS/vitest), math/rng/types.
2. Physics core + fields + thermal + world pipeline; stability + determinism tests.
3. Rules engine + expression language + validation; tests.
4. Serialization + presets + templates; tests.
5. Renderer + controller + input tools.
6. React UI: top bar, tools, inspector, rule editor, materials, world, events, metrics.
7. Playwright smoke run, screenshots, polish visuals and UX.
8. README, limitations, final verification, commit & push.
