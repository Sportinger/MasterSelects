# Data HUD

<!-- effect-docs: basic page sha=f75d0b892c1f, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Draws a measurement overlay over the object, like a product render under analysis: lime boxes open in the middle of each side, teal centre dots, coordinate labels (x 537 y 984) and free blocks of data text; the marks keep their place and grow or shrink one by one; Boxes and Text Blocks set how many, Box Size, Gap and Line Width their look, Object where they may sit, Rate and Glide the rhythm.

Group: [Analog & Glitch](../Effects-Analog.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![Data HUD on the night street with neon signs: the original on the left, Data HUD at its default settings on the right](../assets/effects/data-hud.webp)

<figcaption>Left: the original. Right: Data HUD at its default settings, one frame of its movement.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

**Presets:** Tracking Data · 350Z Overlay · Quiet Scan · Dense Readout. Pick one in the **Preset** row of the effect card.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Boxes** | | |
| Box Size | 40 to 400 px | 240 px |
| Boxes | 0 to 3 | 3 |
| Size Variation | 0 to 1 | 0.6 |
| Gap | 0 to 0.9 | 0.35 |
| Line Width | 1 to 12 px | 3 px |
| **Marks** | | |
| Labels | 0 to 1 | 0.7 |
| Text Size | 6 to 60 px | 15 px |
| Dots | 0 to 1 | 0.9 |
| Small Marks | 0 to 4 | 3 |
| Text Blocks | 0 to 3 | 2 |
| **Object** | | |
| Object | Dark on light, Light on dark, Alpha, Everywhere, Differs from edge | Dark on light |
| Threshold | 0 to 1 | 0.75 |
| **Color** | | |
| Lines | a colour | `#c8e04c` |
| Labels | a colour | `#e4e6e0` |
| Dots | a colour | `#3cc8b4` |
| Marks | a colour | `#c8e04c` |
| **Motion** | | |
| Rate | 0 to 60 /s | 1.5 /s |
| Glide | 0 to 1 | 0.3 |
| Seed | 0 to 9999 | 0 |
| **Mix** | | |
| Amount | 0 to 1 | 1 |
<!-- generated:controls end -->

## Technical details

It changes over time: its picture depends on the playback time or on earlier frames. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
