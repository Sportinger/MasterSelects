# Tone Geometry

<!-- effect-docs: basic page sha=74837227bd38, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Replaces the image with a grid of squares, circles or triangles sized by darkness, in Ink on Paper; Shape picks the form, Scale the cell size.

Group: [Print & Halftone](../Effects-Print.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Tone Geometry on the harbour town: the original on the left, Tone Geometry at its default settings on the right](../assets/effects/tone-geometry.webp)

<figcaption>Left: the original. Right: Tone Geometry at its default settings, one frame of its movement.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Pattern** | | |
| Scale | 2 to 80 | 14 |
| Angle | −180 to 180 | 0 |
| Shape | square, circle, triangle | square |
| **Style** | | |
| Amount | 0 to 1 | 0.75 |
| **Color** | | |
| Ink | a colour | `#111827` |
| Paper | a colour | `#f8fafc` |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
<!-- generated:controls end -->

## Technical details

It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
