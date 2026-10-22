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

Radius is measured on a 1080p frame and scales with the picture, so the preview, the export and 4K show the same softness. Transparent edges blur without a dark rim. A blur at 0 leaves the picture exactly as it was.

Where the editor falls back to its software preview (no WebGPU, for example on some Linux drivers), Motion, Radial and Zoom Blur are painted on the CPU, pixel by pixel, with the same path as the GPU. That path keeps its reads in reused number lists instead of building new ones for every read, so a frame paints about five times faster than in the first smooth version; a test holds it within a budget measured against a plain pass on the same machine.

Developer notes: [Effect system: Blur & Sharpen notes](./Effect-System.md#blur--sharpen-notes).
