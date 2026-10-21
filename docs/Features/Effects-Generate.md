# Generate

Effects that make a new picture instead of changing the clip: a colour wheel, a stage floor and a
stick figure. Add one in **Properties → Effects → + Add Effect → Generate**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: generate -->

## Which one?

| Look | Use |
|---|---|
| a colour reference or a gel spot | [Color Wheel](./effects/color-wheel.md) |
| a retro floor running to the horizon | [Perspective Grid](./effects/perspective-grid.md) |
| a posable figure, a choreography sketch | [Stick Figure](./effects/stick-figure.md) |
| a swarm in 3D | [Flocking](./effects/flocking.md), under 3D & Particles |
| woven threads, ropes and knots | [Weave](./effects/weave.md), under 3D & Particles |
| raw computer memory as a glitch | [Memory Leak](./effects/memory-leak.md), under Analog & Glitch |

## The shared idea

A generator draws its own picture over the clip; on a **Blank** clip only that picture shows. They
build it in three ways:

- **One fixed drawing:** Color Wheel, Perspective Grid and Stick Figure each draw their picture in a
  single built-in step. Everything you can change is in the card: sliders with units (%, px, °), a ◇
  to set keyframes and ↺ to reset. Values a generator cannot draw, such as a Stick Figure scaled to 0
  or standing outside the picture, are named in the card instead of failing silently, in the same
  units as the rows.
- **An image graph:** [Memory Leak](./effects/memory-leak.md#node-setup) is a small node graph that
  turns bytes into pixels. You can open and rewire it like the distort or blur effects.
- **A 3D scene:** [Weave](./effects/weave.md#node-setup) and [Flocking](./effects/flocking.md) build
  threads or a swarm in the editor's 3D scene, above the clip. Their graphs work on curves and
  particles, not on pixels.

## Technical details

Notes for developers. Registry, uniforms and the byte-texture binding are in
[Effect system](./Effect-System.md#registry-and-ui), nodes in [Node Catalog](./Node-Catalog.md), graph
compilation in [Operator Graph Compiler](./Operator-Graph-Compiler.md). Shared helpers for finite
reads and choice warnings live in `src/effects/generate/generatorParams.ts`.

- **Robust values.** Numbers are read as finite values (NaN and infinities use the default). Values
  outside a parameter's rendered range (`renderMin`/`renderMax`) are named in the inspector, in the
  units of its row, and in `addEffect`/`updateEffect` results, in stored units; `paramWarnings` name
  unknown choices and settings that draw nothing. The coverage and compositing maths of the grid,
  wheel and ring head run on the CPU in unit tests, translated from the WGSL source.
- **Keyframed rates.** Perspective Grid Speed and Color Wheel Spin declare `integratedAs`. The
  timeline and the composition evaluator (nested compositions, transitions, export) share one
  keyframe step (`evaluateEffectKeyframes`) that adds the distance a keyed rate has travelled: the
  area under the curve from the start of the render clock (−clip start in clip time) to now, with the
  first key's value held before it. It equals rate × time while the rate is constant, adding the
  first key does not move the pattern, and a head trim (keys stay on the timeline, at negative clip
  times) keeps the phase of a keyed ramp. Unkeyed, the rate runs from the timeline (or composition)
  time. The step evaluates the clip's own keyframe array, so the property index and a table of
  cumulative segment integrals are built once per edit: a frame binary-searches its segment and
  integrates only that part (O(log K), about 1 µs for 1000 keys). Two keys at one time are a jump.
  Effects without keys keep their identity. The travel values are runtime-only: project,
  composition, preset and undo-history loads drop stored ones, tools and Looks do not store them, and
  an instance that still carries one renders without it (one log line). A node source or the
  Constant mode on a rate runs it at rate × time and logs which of the two overrides the keys. Scroll
  and hue are wrapped on the CPU in double precision.
- **Saved projects.** Choices and numbers an old instance lacks render, and show in the inspector, at
  their `legacyDefault` (each effect page names them). A Look saved from such an instance stores these
  values, and custom Looks saved earlier without them apply and preview with them too; built-in Looks
  use the current defaults. New defaults apply only to new instances.
- **Pictures.** `scripts/effect-lab.mjs --pairs`, `scripts/effect-graph-shot.mjs` and
  `scripts/effect-editor-shot.mjs` with the `generate.json` manifests in `scripts/effect-*-shots/`;
  Flocking and Weave use the editor shot's `"view": "preview"` mode (the preview without and with the
  effect).
