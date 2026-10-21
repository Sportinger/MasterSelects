# Temperature

Makes the light warmer or cooler, like the white balance of a camera. Blacks stay black and the
overall brightness stays the same.

Group: [Color & Tone](../Effects-Color.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The same part of the harbour town twice: on the left the original, on the right with Temperature −0.6, where the white and yellow house fronts look cooler and slightly bluish, the turquoise sea turns a cooler blue and the sky a deeper blue](../assets/effects/temperature.webp)

<figcaption>The same part of the frame. Left: original. Right: Temperature −0.6.</figcaption>
</figure>

**Use it for:** footage shot under the wrong white balance · matching cameras · a warm or cold
colour mood.

- **Temperature** – positive is warmer (orange), negative cooler (blue). 0.2–0.3 is a correction,
  0.6–1 a colour mood.
- **Tint** – positive towards magenta, negative towards green.

**Tip:** a little cool (−0.3 to −0.6) gives a moonlit or night-time mood.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Temperature | −1 to 1 | 0 |
| Tint | −1 to 1 | 0 |
<!-- generated:controls end -->

## Node setup

The work happens in **White Balance**. Like [Exposure](./exposure.md#node-setup), it turns the
colours into amounts of light (**sRGB to Linear**), changes them and turns them back (**Linear to
sRGB**), but it multiplies red, green and blue by different factors. Its **Value** card **0.6** is
the strength of one Temperature unit: red goes up and blue down by 0.6 stops each. **Luminance**
and **Divide** then restore the overall brightness.

**Remix:** select the **Value** 0.6 and set it to 0.3 in the node inspector: the Temperature slider
becomes half as strong, for fine corrections.

## Technical details

- **Formula.** Per unit, Temperature raises red and lowers blue by 0.6 stops each (1.2 stops
  apart); Tint lowers green by 0.5 stops and raises red and blue by 0.25. The gains are then
  normalised to keep the Rec.709 brightness, in linear light.
- **Range.** The sliders cover −1 to 1; typed values render up to ±4. There is no Kelvin scale.
- Shared colour notes: [Color & Tone](../Effects-Color.md#technical-details). Formulas:
  [Effect system](../Effect-System.md#editable-color-effect-graphs); blocks:
  [Node Catalog](../Node-Catalog.md).
