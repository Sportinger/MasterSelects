# Tag Pills

<!-- effect-docs: basic page sha=1eb8327d19d4, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Places each character inside a faint rounded pill, like a cloud of UI tags, with glyphs cycling over time; Cell Size sets the pill size.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Tag Pills on an enlarged detail of the dancer on a dark stage: the original on the left, Tag Pills at its default settings on the right](../assets/effects/capsule-cloud.webp)

<figcaption>Left: the original. Right: Tag Pills at its default settings, one frame of its movement. An enlarged detail, so the characters can be read.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Grid** | | |
| Cell Size | 4 to 72 | 28 |
| **Style** | | |
| Amount | 0 to 1 | 1 |
| Invert Ramp | on or off | off |
| **Glyphs** | | |
| Ramp | standard, detailed, blocks, binary, numeric, symbols | detailed |
| Custom Ramp | text | empty |
| Font | Monospace, Serif, Sans Serif | Monospace |
| Weight | 200 to 900 | 600 |
| **Color** | | |
| Color Source | Source, Duotone | Source |
| Dark | a colour | `#081018` |
| Light | a colour | `#e8fff5` |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls with the same name keep their values and keyframes; the others start at their defaults. Looks of Text & Glyph: [ASCII](./ascii.md), [Brand Generator](./brand-generator.md), [Contour Type](./contour-type.md), [Creative UI Collage](./ui-collage.md), [Data Hatching](./data-hatch.md), [Dither Glow](./pixel-dither.md), [Dither Text](./dither-text.md), [Glyph Matrix](./glyph-matrix.md), [Grid Glyph](./grid-glyph.md), [Inscribe](./inscribe.md), [Matrix Rain](./matrix.md), [Number Field](./number-field.md), [Pixel Code](./pixel-code.md), [Retro Matrix](./retro-matrix.md), [Symbol Matrix](./symbol-matrix.md), [Word Mosaic](./word-mosaic.md). Also: [Stitch Poster](./stitch-poster.md) ([Textile & Craft](../Effects-Textile.md)).

## Technical details

Tag Pills is one look of the glyph engine; its looks share one node setup. It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
