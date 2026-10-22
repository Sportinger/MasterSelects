# Riso

<!-- effect-docs: basic page sha=34d2e643e703, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Simulates two-ink risograph printing on cream paper with misregistered layers; Registration sets the offset, Dark and Warm Ink pick the colors.

Group: [Print & Halftone](../Effects-Print.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Riso on the harbour town: the original on the left, Riso at its default settings on the right](../assets/effects/riso.webp)

<figcaption>Left: the original. Right: Riso at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Registration | 1 to 32 | 8 |
| **Mix** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Dark Ink | a colour | `#2046b3` |
| Warm Ink | a colour | `#ef476f` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls you changed keep their values and keyframes when the new look has the same control, also under another name; the others start at the new look's defaults. Looks of Print & Halftone: [Dither Studio](./dither-studio.md), [Dithering](./dither.md), [Halftone](./halftone.md), [Paper Print](./paper-print.md), [Pattern Halftone](./pattern-halftone.md), [Riso Glow](./riso-glow.md), [Tone Geometry](./tone-geometry.md). Further looks under [Lens & Distort](../Effects-Distort.md) (4), [Pixel & Mosaic](../Effects-Pixel.md) (2), [Lines & Engraving](../Effects-Lines.md) (6), [Textile & Craft](../Effects-Textile.md) (3), [Analog & Glitch](../Effects-Analog.md) (4), [3D & Particles](../Effects-3D-Particles.md) (1).

## Technical details

Riso is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
