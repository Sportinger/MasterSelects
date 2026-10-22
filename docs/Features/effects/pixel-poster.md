# Pixel Poster

<!-- effect-docs: basic page sha=0833a87c4d3d, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Pixelates the image into blocks and posterizes each to a few color levels; Block Size sets the pixel size.

Group: [Pixel & Mosaic](../Effects-Pixel.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Pixel Poster on the night street with neon signs: the original on the left, Pixel Poster at its default settings on the right](../assets/effects/pixel-poster.webp)

<figcaption>Left: the original. Right: Pixel Poster at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Block Size | 2 to 64 | 10 |
| **Mix** | | |
| Amount | 0 to 1 | 0.75 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls with the same name keep their values and keyframes; the others start at their defaults. Looks of Pixel & Mosaic: [Scatter Mosaic](./scatter-mosaic.md). Further looks under [Lens & Distort](../Effects-Distort.md) (4), [Print & Halftone](../Effects-Print.md) (8), [Lines & Engraving](../Effects-Lines.md) (6), [Textile & Craft](../Effects-Textile.md) (3), [Analog & Glitch](../Effects-Analog.md) (4), [3D & Particles](../Effects-3D-Particles.md) (1).

## Technical details

Pixel Poster is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
