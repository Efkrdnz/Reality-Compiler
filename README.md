# REALITY COMPILER

A browser-based 2D laboratory where the laws of physics are data. Spawn matter, bend gravity,
open portals, slow down time in one corner of the universe, and write **rules** that turn
collisions into chain reactions, food into self-replicating goo, or sparks into a firestorm.

```
WHEN  collision            (trigger)
IF    self has tag fissile (conditions)
  and other has tag neutron
THEN  destroy other         (actions)
      spawn 3 neutrons at self, random velocity
      explode radius 110, heat 400
      $fissions += 1
```

## Quick start

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev        # http://localhost:5173  (add ?preset=goo to open a specific universe)
```

```bash
npm test           # 91 unit/integration tests (vitest)
```

```bash
npm run smoke      # end-to-end: drives the real app in Chromium (Playwright), writes screenshots to scripts/out/
```

```bash
npm run build      # type-check + production bundle in dist/
```

`npm run smoke` starts its own dev server; pass a URL to test a running instance
(`npm run smoke -- http://localhost:5173/`). It isn't a project dependency (it's ~100 MB). To run
it locally, install it first:

```bash
npm i --no-save playwright && npx playwright install chromium
```

## What you can do

| Area | Features |
| --- | --- |
| **Matter** | Circles, boxes, triangles, hexagons (any convex polygon ≤ 12 vertices), particles, static walls. 22 built-in materials, all editable, plus your own. |
| **Physics** | Fixed 60 Hz timestep with substeps, impulse solver with friction, restitution, speculative contacts, 2-point block solver and warm starting (stable 16-box stacks), distance joints (rods and springs, breakable), drag, wind, charge (Coulomb-like attraction/repulsion), temperature with conduction, ambient exchange and impact heating. |
| **Fields** | Gravity wells (attract/repel; constant, linear or inverse-square falloff), gravity zones (override gravity in a region), wind, vortices, heat/cool zones, **time zones** (local time dilation, 0 = stasis), **portals** (paired, rotate momentum by their angle difference). Fields can be filtered by tag. |
| **Programmable materials** | Density, bounce, friction, conductivity, drag, gravity scale, self-heating, charge, glow, lifetime → decay into another material, and temperature-driven phase transitions (ice → water → steam, wood → ember → ash, stone → lava...). |
| **Time** | Play/pause, single-step, slow motion ×0.05 … fast ×4, reset to the loaded snapshot, rule-controlled world time scale. |
| **Interaction** | Spawn by click, slingshot by dragging back, mouse-spring dragging (and flinging), connect bodies, erase brush, blast, draw walls, place/move/resize/aim fields with handles, rotate bodies and aim their velocity with gizmos, inspect and edit every property. Undo/redo for everything. |
| **Reality programming** | Visual rule editor (WHEN / IF / THEN), 10 triggers, 17 condition fields, 20 actions, priorities, consume, cooldowns, per-step caps, global and per-entity variables, signals, rule → rule calls, modules and 12 templates, live validation, event-chain graph, “fire now”. |
| **Experimentation** | 12 universes, metrics with sparklines, event inspector (filter, search, click to jump to rule/entity), performance and safety diagnostics, state hash for determinism checks, JSON export/import of worlds and rule sets, browser save slots. |

### Universes (presets)

| | |
| --- | --- |
| **Genesis Lab** | A tour: ramps, mixed materials, a gravity well, a portal pair, a heater melting ice, sparks on hard impacts. |
| **Inverted Heaven** | Reversed gravity, a pocket of normal gravity, and a timer rule that flips the sky every 6 s. |
| **Grey Goo** | Self-replicating matter: replicators eat, divide when fed, decay into food when old — boom/bust population cycles. |
| **Chain Reaction** | A fissile lattice; one neutron triggers a cascade of fission, shockwaves and heat. |
| **Orbital Garden** | Zero-g, one inverse-square well, dozens of bodies in orbit. |
| **Portal Cascade** | Floor → sky portal for endless falling, a 90° sideways portal pair, a slow-time zone, a trip counter. |
| **Chrono Garden** | Rain falling through stasis, slow and fast time zones. |
| **Water Cycle** | Heater below, cold deck above: melt → boil → rise → condense → rain, emerging purely from material rules. |
| **Firestorm** | Wood towers, wind and a drop of lava: embers, radiant heat and spark ignition burn the forest to ash. |
| **Electro Swarm** | Charged particles plus a bonding rule: molecules and crystals self-assemble. |
| **Fireworks Foundry** | Rockets heated on a launch pad launch at 420° and detonate at 700°. |
| **Empty Lab** | A floor. Build your own universe. |

## The rule language

A rule is pure JSON data interpreted by the rule engine:

- **Triggers:** `collision` (once per contact begin, for each body as *self*; optional minimum
  impact speed), `proximity` (enter / while, surface-to-surface radius), `timer` (world or each
  entity), `creation`, `destruction` (the dying entity is still readable), `temperature` and
  `velocity` (threshold crossings), `stateChange` (material/phase change, with from/to filters),
  `signal` (named broadcast; portals emit `portal:<name>`), `manual` (called by another rule).
- **Conditions** (all/any): material, tag, mass, speed, temperature, colour (exact or *near*),
  x/y, size, age, charge, phase, kind, shape, variable, random chance, or any expression.
  Subjects: `self`, `other` or `world`.
- **Actions:** apply force, push (away/toward/forward/up/random/angle), teleport, transform
  (material/size/colour), duplicate, destroy, change gravity, change property (set/add/multiply),
  add/remove tag, emit particles, spawn objects, explode, connect (create a joint), trigger rule,
  emit signal, set variable, environment (ambient temperature, wind, world time scale, drag, charge
  force, impact heat), modify field (by name), log. Actions can target `self`, `other`, every
  entity with a tag, or the world.
- **Priorities:** higher runs first for the same event; *consume* stops lower-priority rules from
  seeing that event. Cooldowns are per entity or per rule.

### Expressions

Every numeric value is an expression in a small sandboxed language. It is tokenised and parsed
against a whitelist and interpreted with an instruction budget. Nothing is ever passed to `eval` or
`Function`, and prototype-chain names are rejected.

```
self.mass * 2                 rand(-100, 100)              $score + 1
other.speed > 300 ? 1 : 0     clamp(event.relSpeed / 90, 2, 10)
self.$charges - 1             count('replicator') < 50     50 + 90 * sin(world.time * 0.35)
```

- `self.` / `other.`: `x y vx vy speed heading mass temp radius age angle av charge id
  restitution friction lifetime gravityScale drag $var`
- `world.`: `time step count gx gy ambient timeScale width height windX windY dt`
- `event.`: `impulse relSpeed x y depth distance`
- `$name` is a global variable.
- Functions: `rand randint sin cos tan atan2 abs sqrt floor ceil round sign min max clamp pow hypot
  lerp log exp count('tag') countMat('material')`.
- Operators: `+ - * / % ^ == != < <= > >= && || ! ?:` (division by zero yields 0).

### Safety: recursion, cycles and budgets

Rules can call rules and signals can trigger more signals, so the engine enforces:

1. **Instruction budget** per step (default 60,000). Expression nodes, conditions, actions and
   spawns all cost instructions. When the budget runs out, the rest of that step's rule work is
   skipped and a warning is logged.
2. **Chain depth limit** (default 16) for rule → rule calls, signals and state changes caused by rules.
3. **Cycle protection:** within one event chain, the same rule can't fire twice for the same
   entity.
4. **Per-rule cap** on firings per step, **events-per-step cap**, and a hard **entity cap**
   (default 2,500), so self-replication can't run away.
5. Entity **creation events are deferred to the next step**, so duplicate-on-creation becomes
   generational growth instead of instant recursion.
6. **Static analysis:** the editor flags loops in the rule graph, unknown materials, missing rule
   references, bad expressions (with position), `other.*` in triggers that have no other body, and
   more. Rules with errors are skipped, never half-executed.

Every guard that trips shows up in the HUD, the event inspector and the diagnostics panel.

## Architecture

```
src/sim/          pure TypeScript simulation: no DOM, no React, deterministic
  world.ts          fixed-step pipeline: fields → velocities → broadphase → narrowphase →
                    warm-started solver → positions → projection → thermal → rules → cleanup
  collide.ts        circle/circle, polygon/circle, polygon/polygon (SAT + clipping), speculative
  solver.ts         sequential impulses, 2-point block solver, friction, joints, position correction
  spatial.ts        uniform-grid spatial hash (broadphase, proximity queries, charge forces)
  fields.ts  materials.ts  entity.ts  rng.ts (sfc32, serialisable)  metrics.ts
  rules/            expr.ts (sandboxed language) · engine.ts · validate.ts · catalog.ts
                    (editor metadata) · templates.ts · build.ts
  serialize.ts      zod-validated JSON for worlds and rule sets, versioned
  presets.ts        the 12 universes
src/render/       Canvas 2D renderer: quarter-resolution bloom buffer, trails, animated field
                  overlays, gizmos, visual-only effects. It reads the world and never mutates it.
src/engine/       SimController: accumulator loop, time controls, undo/redo, reset, save slots
src/ui/           React lab interface (zustand store); talks to the simulation only via the controller
tests/            vitest suites      scripts/smoke.mjs  end-to-end browser test
```

**Why a custom physics engine instead of matter.js or planck.js?** The features that make this a
*reality compiler* sit inside the physics pipeline: per-body time dilation, portals that remap
momentum, conduction through contacts, material phase changes, rule hooks on contact begin, and
bit-exact save/load. Those are awkward or impossible to bolt onto an off-the-shelf engine.
The engine is compact (~2k lines), deterministic, and fast. It uses the same techniques as Box2D
(warm starting, block solver, speculative contacts) where they matter for stability.

### Determinism

Same world JSON + same seed ⇒ the same simulation. All randomness (rules, `rand()`, presets)
comes from a seeded sfc32 generator whose state is saved with the world. Iteration order is
stable, and the timestep is fixed and independent of frame rate. Saving mid-run serialises the
RNG, the rule engine's timers, cooldowns and proximity memory, the contact history and the
warm-start cache. A loaded world therefore continues **bit-for-bit** like the original, and the
test suite verifies this. *Diagnostics → Compute state hash* shows the fingerprint so you can
check a replay yourself.

### Performance

Typical presets step in 0.2–1.5 ms. A worst-case 2,500-entity spark storm runs at ~7.5 ms per
step, because energy-like particles (sparks, flames, vapour) skip particle-particle contacts and
are passive in the broadphase. Rendering uses cached glow sprites drawn into a quarter-resolution
bloom buffer and composited once, plus a cached background layer. The controller caps catch-up
steps per frame, so a slow machine drops simulated time (shown in the HUD) instead of freezing.

## Keyboard shortcuts

`Space` play/pause · `N`/`.` step · `R` reset · `[` `]` slower/faster · `\` normal speed ·
`1`–`0` tools · `Del` delete · `Ctrl D` duplicate · `Ctrl Z` / `Ctrl Shift Z` undo/redo ·
`Ctrl S` quick save · `Ctrl E` / `Ctrl O` export/import world · `T F V H K L B G` trails, fields,
vectors, heat vision, contacts, labels, bloom, grid · `Home` fit view · `` ` `` toggle dock ·
`Alt 1–5` panels · `?` help. Right-drag, space-drag or dragging empty space pans; the wheel zooms.

## Limitations

- **Shapes:** convex polygons (≤ 12 vertices) and circles only; no concave bodies, no
  soft bodies or fluids (water is rigid droplets).
- **Joints** are centre-to-centre distance constraints (rods/springs); no hinges with offsets, no
  motors.
- **No continuous collision detection.** Speculative contacts and substeps prevent tunnelling
  in practice, but very thin, very fast bodies can still pass through each other.
- **No sleeping.** Large resting piles keep costing CPU.
- **Determinism is per JavaScript engine.** Replays are exact within one browser/Node version,
  but `Math.sin` and friends may differ in the last bits across engines.
- The simulation runs on the main thread (no Web Worker) and renders with Canvas 2D (no WebGL).
  Thousands of glowing particles stay smooth on a GPU-accelerated browser, but software-rendered
  environments are slower.
- Rule expressions can read `self`, `other`, the event, world properties and variables, but
  cannot address arbitrary entities by id. Use tags, signals and the `tagged` action target.
- Undo keeps up to 50 full snapshots; very large worlds make each snapshot (and save slots in
  `localStorage`, ~5 MB) proportionally bigger.
- The UI is designed for desktop (mouse + keyboard). Touch input works for basic tools, but the
  layout isn't optimised for phones.
