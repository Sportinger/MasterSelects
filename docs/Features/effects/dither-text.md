# Dither Text

<!-- effect-docs: basic page sha=5221c3e60b5a, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Character art dithered with a checkerboard threshold and flickering noise so glyphs show mostly in brighter cells; Cell Size sets character size.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Dither Text on an enlarged detail of the dancer on a dark stage: the original on the left, Dither Text at its default settings on the right](../assets/effects/dither-text.webp)

<figcaption>Left: the original. Right: Dither Text at its default settings, one frame of its movement. An enlarged detail, so the characters can be read.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Grid** | | |
| Cell Size | 4 to 72 px | 10 px |
| **Style** | | |
| Amount | 0 to 1 | 1 |
| Background | 0 to 1 | 0.2 |
| Black Level | 0 to 0.9 | 0 |
| Invert Ramp | on or off | off |
| **Glyphs** | | |
| Ramp (Used while Custom Ramp is empty) | Standard, Detailed, Blocks, Bars, Binary and 2 more | Standard |
| Custom Ramp | text | empty |
| Font | Monospace, Serif, Sans Serif | Monospace |
| Weight | 200 to 900 | 600 |
| **Color** | | |
| Color Source | Source, Duotone | Source |
| Dark (Used with Color Source Duotone) | a colour | `#081018` |
| Light (Used with Color Source Duotone) | a colour | `#e8fff5` |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
| Roll | 0 to 1 | 1 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine and keeps the values and keyframes: [Tag Pills](./capsule-cloud.md), [Data Hatching](./data-hatch.md), [Glyph Matrix](./glyph-matrix.md), [Matrix Rain](./matrix.md), [Dither Glow](./pixel-dither.md), [Creative UI Collage](./ui-collage.md).

## Technical details

Dither Text is one look of the glyph engine; its looks share one node setup. It changes over time: its picture depends on the playback time or on earlier frames. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
