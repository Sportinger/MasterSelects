# Halftone

<!-- effect-docs: basic page sha=f421090d656d, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Turns the image into rotated halftone dots that grow in dark areas, drawn in Ink on Paper; Scale sets dot spacing, Angle the screen angle.

Group: [Print & Halftone](../Effects-Print.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Halftone on the harbour town: the original on the left, Halftone at its default settings on the right](../assets/effects/halftone.webp)

<figcaption>Left: the original. Right: Halftone at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Scale | 2 to 80 | 14 |
| Angle | −180 to 180 | 0 |
| **Mix** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Ink | a colour | `#111827` |
| Paper | a colour | `#f8fafc` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls you changed keep their values and keyframes when the new look has the same control, also under another name; the others start at the new look's defaults. Looks of Print & Halftone: [Dither Studio](./dither-studio.md), [Dithering](./dither.md), [Paper Print](./paper-print.md), [Pattern Halftone](./pattern-halftone.md), [Riso](./riso.md), [Riso Glow](./riso-glow.md), [Tone Geometry](./tone-geometry.md). Further looks under [Lens & Distort](../Effects-Distort.md) (4), [Pixel & Mosaic](../Effects-Pixel.md) (2), [Lines & Engraving](../Effects-Lines.md) (6), [Textile & Craft](../Effects-Textile.md) (3), [Analog & Glitch](../Effects-Analog.md) (4), [3D & Particles](../Effects-3D-Particles.md) (1).

## Technical details

Halftone is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
