# Levels

Chooses which tone becomes black, which becomes white and how bright the middle is. The classic
Levels from photo editing.

Group: [Color & Tone](../Effects-Color.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The whole dancer twice, the same crop: left original, right with Output Black 0.12 and Output White 0.92, where the black background and floor have turned a soft dark grey and the dress is slightly duller](../assets/effects/levels.webp)

<figcaption>The same part of the frame. Left: original. Right: Output Black 0.12, Output White 0.92.</figcaption>
</figure>

**Use it for:** setting clean black and white points · a faded, matte film look · matching the
tonal range of two shots.

- **Input Black / Input White** – everything darker than Input Black becomes black, everything
  brighter than Input White becomes white. Moving them inward adds contrast.
- **Gamma** – above 1 brightens the mid-tones, below 1 darkens them.
- **Output Black / Output White** – raise the black or lower the white for a softer, faded look.

**Tip:** Output Black around 0.1 and Output White around 0.9 give the matte look of the picture
above. Equal Input Black and Input White make a hard cut per colour channel, a posterised look; for
a clean black-and-white cut use [Threshold](./threshold.md).

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Input Black | 0 to 1 | 0 |
| Input White | 0 to 1 | 1 |
| Gamma | 0.1 to 3 | 1 |
| Output Black | 0 to 1 | 0 |
| Output White | 0 to 1 | 1 |
<!-- generated:controls end -->

## Node setup

Three folders do the work, in this order. **Input Black & White** stretches the range between the
two input points to 0–1, **Gamma** bends the middle of it, and **Mix per Channel** places the
result between Output Black (input A) and Output White (input B). **Clamp & Alpha** keeps it
within 0–1 and puts the transparency back.

**Remix:** swap the two cables into A and B of **Mix per Channel**: the picture turns into its
negative, with the same black and white points.

## Technical details

- **Range.** Gamma renders 0.1 to 10; at its floor the picture is almost black (x^10), and the
  inspector says so.
- **Special cases.** Equal input points give a hard threshold per channel; swapped input points
  give a negative. There is no per-channel mode.
- Shared colour notes: [Color & Tone](../Effect-System.md#color--tone-notes). Formulas:
  [Effect system](../Effect-System.md#editable-color-effect-graphs); blocks:
  [Node Catalog](../Node-Catalog.md).
