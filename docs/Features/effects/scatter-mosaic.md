# Scatter Mosaic

<!-- effect-docs: basic page, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Breaks the image into tiles that sample from randomly jittered, drifting positions; Scale sets tile size, Amount the scatter distance.

Group: [Pixel & Mosaic](../Effects-Mirror-Pixel.md) · [How to add an effect](../Effects.md#add-an-effect)

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
| Angle | −180 to 180 | 0 |
| **Style** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Ink | a colour | `#111827` |
| Paper | a colour | `#f8fafc` |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look with the same controls and keyframes: [Drift Lines](./drift-lines.md), [Glitch Grid](./glitch-grid.md), [Riso Glow](./riso-glow.md), [Crystal Glass](./crystal.md), [Glass Dispersion](./glass-dispersion.md), [Wave Lines](./wave-lines.md), [Toy Bricks](./bricks.md), [Embroidery](./embroidery.md), [Outline](./outline.md).

## Technical details

Scatter Mosaic is one look of the pattern engine; its looks share one node setup. It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
