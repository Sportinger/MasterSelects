# Invert

Turns the picture into its negative: dark becomes light and every colour becomes its opposite.
Transparent areas stay transparent, and Invert has no controls.

Group: [Color & Tone](../Effects-Color.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The harbour town, split in the middle: left half original, right half inverted like a photo negative, with an orange sky and pale blue houses](../assets/effects/invert.webp)

<figcaption>Left: original. Right: Invert.</figcaption>
</figure>

**Use it for:** a photo-negative or X-ray look · a flash frame on a hit in the music · strange,
cold colours together with Hue Shift.

**Tip:** add [Hue Shift](./hue-shift.md) at 180° after Invert to get roughly the original colours
back, with light and dark swapped.

## Controls

<!-- generated:controls start -->
This effect has no controls.
<!-- generated:controls end -->

## Node setup

**Image to RGBA** and **Split Vector** take the picture apart into red, green, blue and alpha. In
**Color Processing**, three **Subtract** nodes take each colour channel away from the **Value** 1.
**Clamp & Alpha** puts the three back together with the untouched alpha.

**Remix:** select the **Value** 1 and set it to 0.8 in the node inspector: the negative gets darker,
and what was bright before turns black.

## Technical details

Invert works on the screen colours, one channel at a time (`1 − x`), and leaves the transparency as
it is. On an adjustment layer it inverts everything below it. Shared colour notes:
[Color & Tone](../Effects-Color.md#technical-details); blocks: [Node Catalog](../Node-Catalog.md).
