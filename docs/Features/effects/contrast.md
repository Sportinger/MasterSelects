# Contrast

Adds punch: deeper shadows and brighter highlights on a soft S-shaped curve. Bright details roll
off gently instead of burning out, and strong settings also make colours stronger.

Group: [Color & Tone](../Effects-Color.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The whole dancer twice, the same crop: left original, right Contrast 1.4, where the dark background and floor are deeper and the lit dress and skin stand out brighter and a little warmer](../assets/effects/contrast.webp)

<figcaption>The same part of the frame. Left: original. Right: Amount 1.4.</figcaption>
</figure>

**Use it for:** flat or hazy footage · making a projection read from the back of the house ·
a soft, faded look (below 1).

- **Amount** – 1 leaves the picture unchanged, 1.2–1.5 adds punch (1.1–1.3 on dark scenes), below
  1 it gets flatter, 0 is almost plain grey.

**Tip:** strong Contrast makes warm light more orange. If skin tones go too far, lower
[Saturation](./saturation.md) a little after it.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Amount | 0 to 3 | 1 |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--graph">

![The Contrast Curve folder as a recipe: the Value 1 into Scalar to RGB; the RGB input into Clamp; Subtract takes the clamped colour from 1; one Power raises the clamped colour to the Slope, the other raises the Subtract result to the Slope; Add sums both Powers, and Divide divides the first Power by that sum](../assets/effects/graphs/contrast-curve.webp)

<figcaption>The Contrast Curve folder (Clamp's limits 0 and 1 are left out). The green Slope comes from the Amount.</figcaption>
</figure>

**Clamp** keeps each channel between 0 and 1. The lower **Power** raises it to the **Slope** (the
shadows), **Subtract** and the upper **Power** do the same for its distance to white (the
highlights), and **Divide** sets the first against the sum of both (**Add**). With a Slope of 1
nothing changes, and mid-grey always stays mid-grey.

**Remix:** to deepen only the shadows, drag a cable from the **Scalar to RGB** of the Value 1 into
input B of the upper **Power** (the one fed by **Subtract**), in place of the Slope. Dark and middle
tones get darker, the highlights stay almost as they are.

## Technical details

- **Formula.** `x^c / (x^c + (1 − x)^c)` on each colour channel, where the slope `c` at mid-grey is
  the Amount (at least 0.01). The curve pivots at a fixed mid-grey.
- **Colour.** It works per channel, so strong values also raise the saturation and can push warm
  lights towards red-orange.
- **Range.** The slider covers 0 to 3; typed values render up to 10, and the inspector reports
  anything beyond that.
- Shared colour notes: [Color & Tone](../Effects-Color.md#technical-details). Formulas:
  [Effect system](../Effect-System.md#editable-color-effect-graphs); blocks:
  [Node Catalog](../Node-Catalog.md).
