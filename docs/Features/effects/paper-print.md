# Paper Print

<!-- effect-docs: basic page sha=907eeb98ab03, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Maps brightness to a grainy two-color press print between Ink and Paper; Press Grain sets the size of the noise texture.

Group: [Print & Halftone](../Effects-Print.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Paper Print on the harbour town: the original on the left, Paper Print at its default settings on the right](../assets/effects/paper-print.webp)

<figcaption>Left: the original. Right: Paper Print at its default settings.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Press Grain | 4 to 80 | 18 |
| **Style** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Ink | a colour | `#111827` |
| Paper | a colour | `#f8fafc` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine and keeps the shared values and keyframes: [Riso Glow](./riso-glow.md), [Dithering](./dither.md), [Halftone](./halftone.md), [Riso](./riso.md), [Dither Studio](./dither-studio.md), [Pattern Halftone](./pattern-halftone.md), [Tone Geometry](./tone-geometry.md), and 20 more looks from other groups.

## Technical details

Paper Print is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
