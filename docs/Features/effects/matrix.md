# Matrix Rain

<!-- effect-docs: basic page sha=a1e9272c6544, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Covers the image with falling green code characters with bright moving heads, like digital rain; Speed sets the fall rate, Cell Size the glyph size.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Matrix Rain on an enlarged detail of the dancer on a dark stage: the original on the left, Matrix Rain at its default settings on the right](../assets/effects/matrix.webp)

<figcaption>Left: the original. Right: Matrix Rain at its default settings, one frame of its movement. An enlarged detail, so the characters can be read.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Grid** | | |
| Cell Size | 4 to 72 px | 14 px |
| **Style** | | |
| Amount | 0 to 1 | 1 |
| Background | 0 to 1 | 0.3 |
| Invert Ramp | on or off | off |
| **Glyphs** | | |
| Ramp | Standard, Detailed, Blocks, Bars, Binary and 2 more | Symbols |
| Custom Ramp | text | empty |
| Font | Monospace, Serif, Sans Serif | Monospace |
| Weight | 200 to 900 | 600 |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
| Roll | 0 to 1 | 1 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine and keeps the values and keyframes: [Tag Pills](./capsule-cloud.md), [Data Hatching](./data-hatch.md), [Dither Text](./dither-text.md), [Glyph Matrix](./glyph-matrix.md), [Dither Glow](./pixel-dither.md), [Symbol Matrix](./symbol-matrix.md), [Creative UI Collage](./ui-collage.md).

## Technical details

Matrix Rain is one look of the glyph engine; its looks share one node setup. It changes over time: its picture depends on the playback time or on earlier frames. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
