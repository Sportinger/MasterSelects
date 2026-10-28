# Block Dissolve

<!-- effect-docs: basic page sha=33c316264650, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Breaks an object into blocks of different shapes, like a product render dissolving in a data glitch: whole parts vanish (Holes), edges flicker between the outline, a staircase and a 1-bit dither in Ink and Paper, some blocks jump sideways (Displace); Object picks dark, light or alpha as the object, Structure Rate and Flicker Rate the two clocks.

Group: [Analog & Glitch](../Effects-Analog.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![Block Dissolve on the night street with neon signs: the original on the left, Block Dissolve at its default settings on the right](../assets/effects/block-dissolve.webp)

<figcaption>Left: the original. Right: Block Dissolve at its default settings, one frame of its movement.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

**Presets:** Data Dissolve · 350Z Burst · Cross Grid · Crumble · Big Blocks. Pick one in the **Preset** row of the effect card.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Blocks** | | |
| Block Size | 4 to 120 px | 24 px |
| Variation | 0 to 1 | 0.6 |
| Object | Dark on light, Light on dark, Alpha, Everywhere, Differs from edge | Dark on light |
| Threshold | 0 to 1 | 0.75 |
| Solid | 0 to 1 | 0 |
| **Holes** | | |
| Holes | 0 to 1 | 0.12 |
| Placement | Edges, Anywhere | Edges |
| Hole Size | 2 to 16 blocks | 3 blocks |
| **Dither** | | |
| Edge Amount | 0 to 1 | 0.35 |
| Edge Dither | 0 to 1 | 0.7 |
| Dither | 0 to 1 | 0 |
| Slant | 0 to 1 | 0.5 |
| Slant Direction | Falling, Rising, Both | Falling |
| Edge Width | 1 to 80 px | 10 px |
| Dot Size | 1 to 16 px | 3 px |
| Displace | 0 to 1 | 0.06 |
| Pattern | Checker, Bayer, Diagonal | Checker |
| Dot Colour | Original, Ink, Mark Colour | Original |
| **Color** | | |
| Ink | a colour | `#000000` |
| Paper | a colour | `#ffffff` |
| Paper Marks | None, Dots, Crosses | None |
| Mark Grid | 4 to 200 px | 36 px |
| Mark Size | 1 to 24 px | 3 px |
| Mark Colour | a colour | `#ffffff` |
| Removed | Paper, Transparent | Paper |
| **Motion** | | |
| Structure Rate | 0 to 60 /s | 1 /s |
| Flicker Rate | 0 to 60 /s | 3 /s |
| Seed | 0 to 9999 | 0 |
| **Mix** | | |
| Amount | 0 to 1 | 1 |
<!-- generated:controls end -->

## Technical details

It changes over time: its picture depends on the playback time or on earlier frames. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
