# Drift Lines

<!-- effect-docs: basic page, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Shifts horizontal bands sideways in a wavy animated drift and shades them into lines; Scale sets band height, Amount the drift.

Group: [Lines & Engraving](./index.md#lines--engraving) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Drift Lines on the dancer on a dark stage: the original on the left, Drift Lines at its default settings on the right](../assets/effects/drift-lines.webp)

<figcaption>Left: the original. Right: Drift Lines at its default settings, one frame of its movement.</figcaption>
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

**Styles:** the **Style** menu in the effect card switches to another look with the same controls and keyframes: [Glitch Grid](./glitch-grid.md), [Riso Glow](./riso-glow.md), [Scatter Mosaic](./scatter-mosaic.md), [Crystal Glass](./crystal.md), [Glass Dispersion](./glass-dispersion.md), [Wave Lines](./wave-lines.md), [Toy Bricks](./bricks.md), [Embroidery](./embroidery.md), [Outline](./outline.md).

## Technical details

Drift Lines is one look of the pattern engine; its looks share one node setup. It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
