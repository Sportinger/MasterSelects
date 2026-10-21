# Posterize

Reduces the picture to a few flat tones, like a screen print or a poster. Bold at 2–4 tones, subtle
from 8 on.

Group: [Color & Tone](../Effects-Color.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The dancer on stage, original left and posterized right: her dress breaks into a few flat cream and brown tones, the hazy stage drops to black, the floor turns into dark brown patches, and the blue stage light becomes a soft-edged blue band that fades out in a faint, grainy haze, all in their own colours](../assets/effects/posterize.webp)

<figcaption>Left: original. Right: Levels 4, Softness 0.35 (Brightness Only on, as in every new Posterize).</figcaption>
</figure>

**Use it for:** a graphic, screen-printed look · pop-art colours · a base for a comic or stencil
style.

- **Levels** – how many tones: 2–4 is bold and graphic, 8 and more subtle.
- **Softness** – rounds the jumps between tones, so their edges stay smooth instead of jagged and
  noise does not break them up.
- **Brightness Only** – on in a new Posterize: steps only the brightness and keeps every colour as
  it is. Turn it off for pop-art colours: each colour channel is then stepped on its own, which
  tints light grey clouds lavender and adds coloured fringes.

**Tip:** on moving footage keep a little Softness (0.2–0.4), so the edges between the tones do not
flicker.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Levels | 2 to 32 | 6 |
| Softness | 0 to 1 | 0 |
| Brightness Only | on or off | off |
<!-- generated:controls end -->

## Node setup

Everything happens in **Color Processing**. **Multiply** scales each value by Levels, **Floor**
rounds it down to a whole step, and **Divide** spreads the steps back over 0–1. With Softness above
0, a smooth ramp replaces the hard jump at each step. With Brightness Only, the steps are taken on
the brightest channel (**Largest Component**) and every colour is scaled by the same factor, so its
hue stays.

**Remix:** in **Color Processing**, drag a cable from the **Maximum** that gives the effective Levels
into input B of **Divide**, in place of **Subtract**. The brightest tone then sits a little below
white, for a softer, printed look.

## Technical details

- **Formula.** `floor(x · Levels) / (Levels − 1)`, limited to 0–1. Softness 0 without Brightness Only
  is pixel-identical to the earlier hard staircase.
- **Brightness Only** steps the brightest channel and scales the colour with it. New Posterize
  effects start with it on; its parameter default stays off, which is what saved effects and Look
  entries without the value mean. A saved Posterize keeps stepping each colour channel.
- **Warnings.** Levels below 2 or fractional values are reported in the inspector and the tool
  result.
- **Saved projects.** Untouched earlier Posterize graphs become the current recipe automatically;
  edited ones stay as saved.
- Formulas and history: [Effect system](../Effect-System.md#editable-color-effect-graphs); blocks:
  [Node Catalog](../Node-Catalog.md).
