# Dither Glow

<!-- effect-docs: basic page sha=a2dd72dcc147, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Renders glowing neon characters with soft cell halos, colored from Dark to Light by brightness; Cell Size sets character size.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Dither Glow on an enlarged detail of the dancer on a dark stage: the original on the left, Dither Glow at its default settings on the right](../assets/effects/pixel-dither.webp)

<figcaption>Left: the original. Right: Dither Glow at its default settings, one frame of its movement. An enlarged detail, so the characters can be read.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Grid** | | |
| Cell Size | 4 to 72 px | 9 px |
| **Style** | | |
| Amount | 0 to 1 | 1 |
| Background | 0 to 1 | 0.3 |
| Invert Ramp | on or off | off |
| **Glyphs** | | |
| Ramp | Standard, Detailed, Blocks, Bars, Binary and 2 more | Standard |
| Custom Ramp | text | empty |
| Font | Monospace, Serif, Sans Serif | Monospace |
| Weight | 200 to 900 | 600 |
| **Color** | | |
| Dark | a colour | `#081018` |
| Light | a colour | `#e8fff5` |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
| Roll | 0 to 1 | 1 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine and keeps the values and keyframes: [Tag Pills](./capsule-cloud.md), [Data Hatching](./data-hatch.md), [Dither Text](./dither-text.md), [Glyph Matrix](./glyph-matrix.md), [Matrix Rain](./matrix.md), [Symbol Matrix](./symbol-matrix.md), [Creative UI Collage](./ui-collage.md).

## Technical details

Dither Glow is one look of the glyph engine; its looks share one node setup. It changes over time: its picture depends on the playback time or on earlier frames. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
