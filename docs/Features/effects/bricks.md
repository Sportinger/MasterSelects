# Toy Bricks

<!-- effect-docs: basic page, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Rebuilds the image from staggered, beveled toy bricks, each filled with one color; Scale sets the brick size.

Group: [3D & Particles](./index.md#3d--particles) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Toy Bricks on the harbour town: the original on the left, Toy Bricks at its default settings on the right](../assets/effects/bricks.webp)

<figcaption>Left: the original. Right: Toy Bricks at its default settings.</figcaption>
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

**Styles:** the **Style** menu in the effect card switches to another look with the same controls and keyframes: [Drift Lines](./drift-lines.md), [Glitch Grid](./glitch-grid.md), [Riso Glow](./riso-glow.md), [Scatter Mosaic](./scatter-mosaic.md), Crystal Glass, Glass Dispersion, Wave Lines, [Embroidery](./embroidery.md), [Outline](./outline.md).

## Technical details

Toy Bricks is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
