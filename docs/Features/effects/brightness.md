# Brightness

Lightens or darkens the mid-tones while black and white stay where they are. No grey veil, no
washed-out shadows.

Group: [Color & Tone](../Effects-Color.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The rainy night street with neon signs, split in the middle: left half original, right half with Brightness 0.5, where walls and the wet street are lighter and the darkest areas are still black](../assets/effects/brightness.webp)

<figcaption>Left: original. Right: Amount 0.5.</figcaption>
</figure>

**Use it for:** footage that is a little too dark or too bright · lifting a dim projection without
greying it · calming a background behind a title.

- **Amount** – up to lighten, down to darken. 0.3 is a gentle lift, 1 is strong.

**Tip:** Brightness never burns out the brightest whites. For a camera-like change of light, use
[Exposure](./exposure.md).

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Amount | −1 to 1 | 0 |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Brightness Curve folder opened: on the left the Value cards 1 and 2.5 and the Amount and RGB inputs, then Scalar to RGB, Multiply and Clamp, Power of Two and Subtract, Multiply, Add and Divide](../assets/effects/graphs/brightness-curve.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 690" aria-hidden="true" focusable="false">
<defs><marker id="brightness-curve-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M101 316 L101 400" marker-end="url(#brightness-curve-arrow)" />
<circle class="docs-shot-number" cx="101" cy="316" r="18" /><text x="101" y="316" class="docs-shot-number-text">1</text>
</svg>
</div>

<figcaption>Brightness Curve (Clamp's limits 0 and 1 are left out). 1 — the Value 2.5: Amount × 2.5 goes through Power of Two to become the gain; Multiply, Add and Divide bend each colour channel with it.</figcaption>
</figure>

The curve brightens the dark-to-middle tones of each channel by the gain from **Power of Two**,
then **Divide** squeezes the result back so that 0 stays 0 and 1 stays 1. That is why Brightness
has no grey veil and never clips. The **Value** card **2.5** (1) decides how many stops one unit of
Amount is worth.

**Remix:** set the Value (1) to 1.25 and the whole slider becomes half as strong, for finer
control; set it to 4 for a harder push.

## Technical details

- **Formula.** `y = x·m / (x·m + 1 − x)` on each colour channel, with `m = 2^(2.5 · Amount)`.
- **Range.** The slider covers −1 to 1; typed values, keyframes and nodes render up to ±4. Beyond
  that the curve uses the limit, and the inspector and the tool result say so.
- What all colour effects share (8-bit range, saved projects, adjustment layers):
  [Color & Tone](../Effects-Color.md#technical-details). Formulas:
  [Effect system](../Effect-System.md#editable-color-effect-graphs); blocks:
  [Node Catalog](../Node-Catalog.md).
