# Motion Design MD1 Shapes and Appearances Evidence

Date: 2026-07-31
Gate: `MD1_SHAPES_AND_APPEARANCES_COMPLETE`
Status: complete; disposable four-surface pixel goldens recorded

## Implemented

- Rectangle, ellipse, polygon, and star render through the same Motion WebGPU
  pipeline.
- Polygon/star points, radii, and corner values are registry-backed and
  animatable.
- The renderer composites up to 8 bottom-to-top appearance items and up to 8
  stable stops per gradient.
- Color fill, multiple aligned strokes, linear/radial gradients, visibility,
  opacity, reorder, duplicate, and six appearance blend modes are supported.
- The Motion properties tab and Media Add menu expose the same primitive and
  appearance families as the AI tools.
- `updateMotionAppearances` applies structured stack operations atomically and
  returns server-created appearance and gradient-stop ids.
- Split clips now deep-clone Motion definitions. Project round-trip, nested/export
  state parity, stable reorder ids, and media-free preset serialization have
  focused regression coverage.
- Texture fills remain assigned to MD5 direct-media Motion work.

## Verification

- App TypeScript check:
  `node_modules/.bin/tsc.cmd -p tsconfig.app.json --noEmit --pretty false`
  passed.
- Production Vite build:
  `npm run build:deploy` passed with 10,390 transformed modules.
- Final focused and adjacent Motion suite:
  10 files and 97 tests passed, covering AI operations, UI authoring, all
  primitive counters, renderer uniform packing, property descriptors, split
  isolation, preset serialization, preview/nested/export state parity, Media
  Add, project/nested restore, clip context, and Motion stats.
- Dawn/node-webgpu compiled `motionShapes.wgsl` with zero messages and accepted
  the production bind-group/pipeline layout with the 1,856-byte uniform buffer.
- A local hardware render probe produced non-empty polygon and star coverage with
  the two-stop gradient. It was diagnostic-only and did not touch editor state.

## Wave 0 adversarial closeout

The disposable MD1 evidence packet now contains a deterministic four-primitive
fixture, crop-scoped RGBA comparisons, and an exact-session runner. It verifies:

- direct preview, direct export, nested preview, and nested export;
- ordered appearances, masks, effects, clip/appearance opacity and blend,
  visibility, gradients, and multiple strokes through isolated differential
  controls;
- a static-versus-animated sample on rectangle appearance opacity and star
  geometry for all four render surfaces, so parity cannot pass while both paths
  ignore nested keyframes;
- copy/paste, production store duplicate, split isolation, project save codec +
  JSON + load codec, stable ids, and full error-path state restoration;
- loopback validation before token access, exact project-free target selection,
  explicit tab targeting, read-only verify mode, and structured PNG chunk
  validation before record writes.

Current focused result:

```text
3 test files passed
22 tests passed
targeted ESLint, runner syntax, and scoped diff check passed
```

The shared app TypeScript check and production build also pass. The final
combined Wave 0 Motion/AI/Graph/Render matrix passes all 506 tests in 34 files,
including the later MD2 exact-target evidence packet.

## Recorded gate evidence

The exact-target record
[`20260731-221321Z-record.report.json`](./md1/20260731-221321Z-record.report.json)
completed with top-level `success=true` and no failures. The four 640x360
baselines are [`direct-preview.png`](./md1/baselines/direct-preview.png),
[`direct-export.png`](./md1/baselines/direct-export.png),
[`nested-preview.png`](./md1/baselines/nested-preview.png), and
[`nested-export.png`](./md1/baselines/nested-export.png).

They cover rectangle, ellipse, polygon, and star together with every required
appearance/mask/effect differential, and prove direct/export/nested parity.
The apparent `passed=false` values inside differential comparisons are expected:
those controls must visibly differ from their reference state. The record was
captured only in the isolated disposable session; no user project was mutated.
