# Brand Generator

<!-- effect-docs: basic page, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Block-glyph art whose characters shift in concentric rings around the center, framed by a border, for a logo-like pattern; Cell Size sets glyph size.

Group: [Text & Glyph](./index.md#text--glyph) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Brand Generator on the harbour town: the original on the left, Brand Generator at its default settings on the right](../assets/effects/brand-generator.webp)

<figcaption>Left: the original. Right: Brand Generator at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Grid** | | |
| Cell Size | 4 to 72 | 24 |
| **Style** | | |
| Amount | 0 to 1 | 1 |
| Invert Ramp | on or off | off |
| **Glyphs** | | |
| Ramp | standard, detailed, blocks, binary, numeric, symbols | blocks |
| Custom Ramp | text | empty |
| Font | Monospace, Serif, Sans Serif | Monospace |
| Weight | 200 to 900 | 600 |
| **Color** | | |
| Color Source | Source, Duotone | Source |
| Dark | a colour | `#081018` |
| Light | a colour | `#e8fff5` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look with the same controls and keyframes: [ASCII](./ascii.md), [Grid Glyph](./grid-glyph.md), [Inscribe](./inscribe.md), [Number Field](./number-field.md), [Pixel Code](./pixel-code.md), [Stitch Poster](./stitch-poster.md), [Word Mosaic](./word-mosaic.md), [Contour Type](./contour-type.md).

## Technical details

Brand Generator is one look of the glyph engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
