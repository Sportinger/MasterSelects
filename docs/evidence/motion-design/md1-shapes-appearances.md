# Motion Design MD1 Shapes and Appearances Evidence

Date: 2026-07-31

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

## Remaining Gate Evidence

`MD1_SHAPES_AND_APPEARANCES_COMPLETE` stays unchecked until a disposable project
captures representative preview and export pixels for all four primitives,
both gradient families, multiple strokes, and blend ordering. The connected
editor contained user work, so this implementation run deliberately made no
live-project edits.
