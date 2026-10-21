# Dithering

<!-- effect-docs: basic page sha=8434e7fe9607, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Applies ordered Bayer dithering that reduces colors to a few levels per channel; Pixel Size sets the dither grain, Amount blends with the original.

Group: [Print & Halftone](../Effects-Print.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Dithering on the harbour town: the original on the left, Dithering at its default settings on the right](../assets/effects/dither.webp)

<figcaption>Left: the original. Right: Dithering at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Pixel Size | 1 to 24 | 3 |
| **Style** | | |
| Amount | 0 to 1 | 0.75 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine and keeps the values and keyframes: [Cross Stitch](./cross-stitch.md), [Halftone](./halftone.md), [Paper Print](./paper-print.md), [Pixel Poster](./pixel-poster.md), [Riso](./riso.md), [Contour Map](./contour-map.md), [Crosshatch](./crosshatch.md), [Kilim Carpet](./kilim.md), [Vector Engraving](./vector-tiling.md).

## Technical details

Dithering is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
