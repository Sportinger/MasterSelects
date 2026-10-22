# Pattern Halftone

<!-- effect-docs: basic page sha=317ffe83c268, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Halftone screen of circle, diamond or line marks sized by image darkness, in Ink on Paper; Shape picks the mark, Scale the cell size.

Group: [Print & Halftone](../Effects-Print.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Pattern Halftone on the harbour town: the original on the left, Pattern Halftone at its default settings on the right](../assets/effects/pattern-halftone.webp)

<figcaption>Left: the original. Right: Pattern Halftone at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Scale | 2 to 80 | 14 |
| Angle | −180 to 180 | 0 |
| Shape | circle, diamond, line | circle |
| **Mix** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Ink | a colour | `#111827` |
| Paper | a colour | `#f8fafc` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls with the same name keep their values and keyframes; the others start at their defaults. Looks of Print & Halftone: [Dither Studio](./dither-studio.md), [Dithering](./dither.md), [Halftone](./halftone.md), [Paper Print](./paper-print.md), [Riso](./riso.md), [Riso Glow](./riso-glow.md), [Tone Geometry](./tone-geometry.md). Further looks under [Lens & Distort](../Effects-Distort.md) (4), [Pixel & Mosaic](../Effects-Pixel.md) (2), [Lines & Engraving](../Effects-Lines.md) (6), [Textile & Craft](../Effects-Textile.md) (3), [Analog & Glitch](../Effects-Analog.md) (4), [3D & Particles](../Effects-3D-Particles.md) (1).

## Technical details

Pattern Halftone is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
