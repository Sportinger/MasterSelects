# Glitch Grid

<!-- effect-docs: basic page sha=423982a7d305, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Randomly jumps grid cells sideways in flickering bursts for a blocky digital glitch; Scale sets cell size, Amount the displacement.

Group: [Analog & Glitch](../Effects-Analog.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Glitch Grid on the night street with neon signs: the original on the left, Glitch Grid at its default settings on the right](../assets/effects/glitch-grid.webp)

<figcaption>Left: the original. Right: Glitch Grid at its default settings, one frame of its movement.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Scale | 2 to 80 | 14 |
| **Mix** | | |
| Amount | 0 to 1 | 0.75 |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine. Controls you changed keep their values and keyframes when the new look has the same control, also under another name; the others start at the new look's defaults. Looks of Analog & Glitch: [CRT Screen](./crt-screen.md), [Glitch](./glitch.md), [Ribbon Scan](./ribbon-scan.md). Further looks under [Lens & Distort](../Effects-Distort.md) (4), [Pixel & Mosaic](../Effects-Pixel.md) (2), [Print & Halftone](../Effects-Print.md) (8), [Lines & Engraving](../Effects-Lines.md) (6), [Textile & Craft](../Effects-Textile.md) (3), [3D & Particles](../Effects-3D-Particles.md) (1).

## Technical details

Glitch Grid is one look of the pattern engine; its looks share one node setup. It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
