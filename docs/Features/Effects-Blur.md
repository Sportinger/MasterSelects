# Blur & Sharpen

Soften a picture, from a gentle defocus to fast streaks of motion, or make soft footage crisper.
Add one in **Properties → Effects → + Add Effect** ([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: blur -->

## Which one?

| I want… | Use |
|---|---|
| a natural, out-of-focus softness | [Gaussian Blur](./effects/gaussian-blur.md) |
| a graphic softness with square lights | [Box Blur](./effects/box-blur.md) |
| streaks of movement in one direction | [Motion Blur](./effects/motion-blur.md) |
| a swirl or a soft rush towards one point | [Radial Blur](./effects/radial-blur.md) |
| a strong, even zoom burst | [Zoom Blur](./effects/zoom-blur.md) |
| crisper detail | [Sharpen](./effects/sharpen.md) |

<figure class="docs-shot">

![Two street lamps of the night street, enlarged: Gaussian Blur at Radius 10 makes soft round glows, Box Blur at Radius 10 flat, blocky squares](assets/effects/box-vs-gaussian-lights.webp)

<figcaption>The same street lamps, enlarged (Radius 10): Gaussian Blur makes soft round glows, Box Blur flat, blocky squares.</figcaption>
</figure>

## The shared idea

All five blurs follow one recipe: weigh each colour by its transparency (**Premultiplied Source**),
read neighbouring pixels (**Sample Image**), weigh each read, add them up and divide by the total
weight (**Sequence Reduce**, **Normalize by Weight**), then restore normal transparency (**Straight
Alpha Output**). That is why transparent edges (logos, titles, keyed footage) fade out cleanly,
without a dark rim.

- [Gaussian](./effects/gaussian-blur.md#node-setup) and [Box Blur](./effects/box-blur.md#node-setup)
  do this along the rows, then along the columns. They differ only in the weight of each read.
- [Motion](./effects/motion-blur.md#node-setup), [Radial](./effects/radial-blur.md#node-setup) and
  [Zoom Blur](./effects/zoom-blur.md#node-setup) do it along a path, in short pieces first.
- [Sharpen](./effects/sharpen.md#node-setup) blurs a copy with Gaussian Blur's passes and adds the
  difference back.

How to open a graph: [The node setup](./Effects.md#the-node-setup).

## Technical details

The contract lives in `src/effects/blur/blurSampling.ts`; formulas and history in
[Effect system: editable blur kernels](./Effect-System.md#editable-blur-kernels), nodes in
[Node Catalog](./Node-Catalog.md), compilation in [Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Units.** Radius is in pixels of a 1080p frame (its shorter side) and scales with the rendered
  size, so preview, export and 4K match; 3D layer-space effects count their layer's own resolution.
  Motion, Radial and Zoom are relative to the frame.
- **Premultiplied source.** The frame is premultiplied into an `rgba16float` cache first; every
  filtered read after that is exact at alpha edges. The GPU preview and the export show the same
  blur.
- **Read budgets.** Gaussian and Box read up to 127 merged pairs per side and pass; Motion, Radial
  and Zoom up to 256 (Stage A) and 64 (Stage B) reads per pixel. Beyond that the reads spread out,
  and the inspector and the tool result say so.
- **Zero strength.** An unedited blur at 0 is skipped, so the picture passes through exactly; an
  edited graph always runs.
- **Saved projects.** Untouched old blur graphs upgrade automatically; edited graphs stay as saved.
  Older projects render with the current kernels, and a 4K project blurs twice as many pixels as
  before (Radius follows the frame size).
- **Software preview.** The worker software preview approximates: Gaussian and Box as a canvas
  blur, Motion, Radial and Zoom with up to 64 evenly spaced reads (longer streaks step; the
  `SoftwareBlur` log says so).
- **Pictures.** `scripts/effect-graph-shot.mjs`, `scripts/effect-editor-shot.mjs` and
  `scripts/effect-lab.mjs --pairs`, each with a `blur.json` manifest (`scripts/effect-*-shots/`;
  Sharpen in `stylize.json`).
