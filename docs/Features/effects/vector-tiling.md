# Vector Engraving

<!-- effect-docs: basic page, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Redraws the image as rows of engraved wavy lines whose wave depth follows darkness, in Ink on Paper; Scale sets line spacing, Angle the direction.

Group: [Lines & Engraving](./index.md#lines--engraving) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Vector Engraving on the dancer on a dark stage: the original on the left, Vector Engraving at its default settings on the right](../assets/effects/vector-tiling.webp)

<figcaption>Left: the original. Right: Vector Engraving at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Scale | 2 to 80 | 14 |
| Angle | −180 to 180 | 0 |
| **Style** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Ink | a colour | `#111827` |
| Paper | a colour | `#f8fafc` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look with the same controls and keyframes: [Cross Stitch](./cross-stitch.md), [Dithering](./dither.md), [Halftone](./halftone.md), [Paper Print](./paper-print.md), [Pixel Poster](./pixel-poster.md), [Riso](./riso.md), [Contour Map](./contour-map.md), [Crosshatch](./crosshatch.md), [Kilim Carpet](./kilim.md).

## Technical details

Vector Engraving is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
