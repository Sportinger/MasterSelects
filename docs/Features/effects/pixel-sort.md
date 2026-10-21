# Pixel Sort

Sorts short runs of pixels by brightness, so bright areas break into fine sideways streaks. A classic glitch-art look, marked *Experimental*.

Group: [Pixel & Mosaic](../Effects-Mirror-Pixel.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Neon signs in the rainy night street, enlarged, original left and with Pixel Sort right: the bright signs and lit windows break into short horizontal runs sorted from dark to bright, which look like fine vertical stripes; the dark sky between them stays unchanged](../assets/effects/pixel-sort.webp)

<figcaption>Left: original. Right: Amount 1, Threshold 0.3 (enlarged 1.2×).</figcaption>
</figure>

**Use it for:** glitch art on lights and bright skies · a datamosh-like accent · album-cover stills.

- **Threshold** – only pixels at least this bright take part. Lower it to sort more of the picture.
- **Amount** – how much of the sorted colour replaces the original.
- **Segment Size** – how long each sorted run is (4 to 16 pixels).

**Experimental:** the effect sorts fixed runs of at most 16 pixels instead of whole bright intervals, so smooth areas such as a sky show a fine pattern of vertical stripes at the run seams instead of long sorted streaks.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Structure** | | |
| Segment Size | 4 to 16 | 16 |
| **Style** | | |
| Amount | 0 to 1 | 0.5 |
| Threshold | 0 to 1 | 0.45 |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--graph">

![The Pixel Sort graph: Input Frame and Segment Size feed Stable Luma Segment Sort; Luminance of the frame and Threshold feed Step, which Multiply scales by Amount; Mix blends the original colour (A) and the sorted colour (B) by that, and Combine RGB + Alpha puts the original alpha back](../assets/effects/graphs/pixel-sort.webp)

<figcaption>Pixel Sort opened in the Nodes tab (the Output card left out).</figcaption>
</figure>

**Stable Luma Segment Sort** sorts every run of Segment Size pixels by brightness. **Step** compares the brightness of each pixel with Threshold: 1 where it is at least as bright, else 0. **Multiply** scales that by Amount, and **Mix** blends the original colour with the sorted one by the result. How to open it: [The node setup](../Effects.md#the-node-setup).

**Remix:** to sort the dark pixels instead of the bright ones, swap the two inputs of **Step**: plug **Luminance** into Edge and **Threshold** into Value.

## Technical details

- **Units.** Runs are horizontal and start every Segment Size pixels of the rendered frame. Brightness is Rec. 709 luma; equal pixels keep their order.
- **Transparency.** The original alpha is kept; only the colour is sorted.
- **Values.** Segment Size outside 4 to 16 renders as the nearest of them; Threshold at or above 1 leaves the picture almost unchanged. The inspector and agent tool results say so.
- **Experimental.** The effect list adds "(Experimental)"; the inspector and agent tool results give the reason above. It runs as a GPU compute effect.

Effect pipelines: [Effect system](../Effect-System.md#pipelines-and-runtimes). Nodes: [Node Catalog](../Node-Catalog.md).
