# Scatter Mosaic

<!-- effect-docs: basic page sha=9ea7f2b82ed6, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Breaks the image into tiles that sample from randomly jittered, drifting positions; Scale sets tile size, Amount the scatter distance.

Group: [Pixel & Mosaic](../Effects-Pixel.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Scatter Mosaic on the night street with neon signs: the original on the left, Scatter Mosaic at its default settings on the right](../assets/effects/scatter-mosaic.webp)

<figcaption>Left: the original. Right: Scatter Mosaic at its default settings, one frame of its movement.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Scale | 2 to 80 | 14 |
| **Mix** | | |
| Amount | 0 to 1 | 0.75 |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls you changed keep their values and keyframes when the new look has the same control, also under another name; the others start at the new look's defaults. Looks of Pixel & Mosaic: [Pixel Poster](./pixel-poster.md). Further looks under [Lens & Distort](../Effects-Distort.md) (4), [Print & Halftone](../Effects-Print.md) (8), [Lines & Engraving](../Effects-Lines.md) (6), [Textile & Craft](../Effects-Textile.md) (3), [Analog & Glitch](../Effects-Analog.md) (4), [3D & Particles](../Effects-3D-Particles.md) (1).

## Technical details

Scatter Mosaic is one look of the pattern engine; its looks share one node setup. It changes over time: its picture depends on the playback time or on earlier frames. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
