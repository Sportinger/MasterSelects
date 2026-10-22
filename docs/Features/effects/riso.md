# Riso

<!-- effect-docs: basic page sha=5067ae7a2c00, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

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
| **Style** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Dark Ink | a colour | `#2046b3` |
| Warm Ink | a colour | `#ef476f` |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine and keeps the shared values and keyframes: [Riso Glow](./riso-glow.md), [Dithering](./dither.md), [Halftone](./halftone.md), [Paper Print](./paper-print.md), [Dither Studio](./dither-studio.md), [Pattern Halftone](./pattern-halftone.md), [Tone Geometry](./tone-geometry.md), and 20 more looks from other groups.

## Technical details

Riso is one look of the pattern engine; its looks share one node setup. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
