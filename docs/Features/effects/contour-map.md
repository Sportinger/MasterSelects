# Contour Map

<!-- effect-docs: basic page sha=87bb60ea39c7, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Turns brightness into banded elevation zones between Ink and Paper with lines at each band, like a topographic map; Scale sets band count.

Group: [Lines & Engraving](../Effects-Lines.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Contour Map on the dancer on a dark stage: the original on the left, Contour Map at its default settings on the right](../assets/effects/contour-map.webp)

<figcaption>Left: the original. Right: Contour Map at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Scale | 2 to 80 | 14 |
| **Style** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Ink | a colour | `#111827` |
| Paper | a colour | `#f8fafc` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine and keeps the values and keyframes: [Cross Stitch](./cross-stitch.md), [Halftone](./halftone.md), [Pixel Poster](./pixel-poster.md), [Crosshatch](./crosshatch.md), [Kilim Carpet](./kilim.md), [Vector Engraving](./vector-tiling.md).

## Technical details

Contour Map is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
