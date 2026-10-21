# Light & Stylize

Looks that add light or turn the picture into something else: glowing lights, a sweep of shine,
darker edges, outlines or paint. Add one in **Properties → Effects → + Add Effect**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: stylize -->

## Which one?

| I want… | Use |
|---|---|
| lights that bloom with a soft halo | [Glow](./effects/glow.md) |
| a band of light sweeping over a logo or title | [Sheen](./effects/sheen.md) |
| darker edges that lead the eye to the middle | [Vignette](./effects/vignette.md) |
| outlines or a pencil-drawing look | [Edge Detect](./effects/edge-detect.md) |
| a watercolour painting | [Acuarela](./effects/acuarela.md) |
| watery smoke and trails of light | [Rom1](./effects/rom1.md) |

Film Grain and Scanlines are in [Analog & Glitch](./Effects-Analog.md); Posterize and Threshold in
[Color & Tone](./Effects-Color.md).

## The shared idea

These effects are built in four different ways, each the way its look needs:

- **Pixel by pixel.** Vignette changes every pixel on its own, from its colour and its place in the
  frame.
- **With the neighbours.** Glow, Edge Detect and Acuarela also read the pixels around each one. Like
  the blurs, they first weigh each colour by its transparency (**Premultiplied Source**), so
  transparent edges stay clean.
- **With the previous frame.** Rom1 builds every frame on its own last result, so its trails grow
  while the clip plays.
- **One fixed shader.** Sheen has no node setup to open.

Inside a graph, each stage is a folder with a plain name, such as **Bright Pass** or **Edge
Pooling**; each effect page shows them under *Node setup*. How to open a graph:
[The node setup](./Effects.md#the-node-setup).

## Technical details

Formulas and history: [Effect system: editable color effect graphs](./Effect-System.md#editable-color-effect-graphs)
(Vignette, and Film Grain, Scanlines, Posterize, Threshold),
[Effect system: editable blur kernels](./Effect-System.md#editable-blur-kernels) (Glow, Edge Detect,
Sharpen) and [Effect system: glyph, cell and compute effects](./Effect-System.md#glyph-cell-and-compute-effects)
(Acuarela); nodes in [Node Catalog](./Node-Catalog.md#composed-coordinate-nodes), compilation in
[Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Units.** Glow Radius, Edge Detect Width and Acuarela's Wash and Bleed are in pixels of a 1080p
  frame (its shorter side) and scale with the rendered size, so preview, export and 4K match.
- **Out-of-range values.** Tool results and the inspector list every value that is clamped or
  ignored (`paramWarnings`), instead of failing silently. The notes describe the current recipes; an
  effect that still runs an earlier one gets a single note naming that version instead, and an
  edited graph gets them as one hedged note (its own nodes decide). A note function that fails is
  logged and reported.
- **Saved projects.** Glow, Vignette, Edge Detect (and Film Grain, Scanlines and Sharpen) saved
  before 2026-10-21 keep their earlier graph and folders (`stylizeRecipes.ts`); the card offers
  **Use the new …**, which for Glow and Vignette also resets the values and removes their keyframes,
  in one undo step. Custom Looks record `recipe: 'earlier'` for such effects (Looks saved before are
  migrated), so applying them recreates the earlier graph.
- **Transitions** build their effects without a graph at render time, so they use the current
  recipes: Vignette Bloom is retuned (Glow Radius 60–240; Vignette Roundness 0 with Size and
  Softness ÷ √2, the same falloff as before; Glow Amount 0.1–1.4 for the bloom's ramp to white).
- **Software preview.** The worker software renderer (the Linux fallback) evaluates effects that
  carry a graph on the CPU, which is slow at large sizes (the Glow pyramid most of all). Graphless
  ones, as transitions create them, use dedicated pixel paths (`workerSoftwareBloom.ts` for Glow).
  Rom1 runs on the CPU; the watercolour Acuarela falls back to the main-thread GPU renderer.
- **Pictures.** `scripts/effect-lab.mjs --pairs`, `scripts/effect-graph-shot.mjs` and
  `scripts/effect-editor-shot.mjs`, with the manifests `stylize.json` and `stylize-art.json` in
  `scripts/effect-*-shots/`.
