# Brand Generator

<!-- effect-docs: basic page sha=3044fdfb1c16, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Block-glyph art whose characters shift in concentric rings around the center, framed by a border, for a logo-like pattern; Cell Size sets glyph size.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Brand Generator on an enlarged detail of the dancer on a dark stage: the original on the left, Brand Generator at its default settings on the right](../assets/effects/brand-generator.webp)

<figcaption>Left: the original. Right: Brand Generator at its default settings. An enlarged detail, so the characters can be read.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Grid** | | |
| Cell Size | 4 to 72 px | 24 px |
| **Style** | | |
| Amount | 0 to 1 | 1 |
| Background | 0 to 1 | 0.2 |
| Black Level | 0 to 0.9 | 0 |
| Invert Ramp | on or off | off |
| **Glyphs** | | |
| Ramp (Used while Custom Ramp is empty) | Standard, Detailed, Blocks, Bars, Binary and 2 more | Blocks |
| Custom Ramp | text | empty |
| Font | Monospace, Serif, Sans Serif | Monospace |
| Weight | 200 to 900 | 600 |
| **Color** | | |
| Color Source | Source, Duotone | Source |
| Dark (Used with Color Source Duotone) | a colour | `#081018` |
| Light (Used with Color Source Duotone) | a colour | `#e8fff5` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls you changed keep their values and keyframes when the new look has the same control, also under another name; the others start at the new look's defaults. Looks of Text & Glyph: [ASCII](./ascii.md), [Contour Type](./contour-type.md), [Creative UI Collage](./ui-collage.md), [Data Hatching](./data-hatch.md), [Dither Glow](./pixel-dither.md), [Dither Text](./dither-text.md), [Glyph Matrix](./glyph-matrix.md), [Grid Glyph](./grid-glyph.md), [Inscribe](./inscribe.md), [Matrix Rain](./matrix.md), [Number Field](./number-field.md), [Pixel Code](./pixel-code.md), [Retro Matrix](./retro-matrix.md), [Symbol Matrix](./symbol-matrix.md), [Tag Pills](./capsule-cloud.md), [Word Mosaic](./word-mosaic.md). Also: [Stitch Poster](./stitch-poster.md) ([Textile & Craft](../Effects-Textile.md)).

## Technical details

Brand Generator is one look of the glyph engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
