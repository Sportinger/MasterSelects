# Box Blur

Averages a square around every pixel, for a slightly hard, graphic softness. Small lights turn into
flat squares instead of round glows.

Group: [Blur & Sharpen](../Effects-Blur.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Original left, Box Blur (Radius 25) right, on the night street with neon signs](../assets/effects/box-blur.webp)

<figcaption>Left: original. Right: Radius 25.</figcaption>
</figure>

**Use it for:** a graphic, digital look · frosted-glass panels behind text · lights that should
read as squares.

- **Radius** – the size of the square. It changes smoothly when animated.

**Tip:** for a natural defocus use [Gaussian Blur](./gaussian-blur.md); Box Blur is the graphic
look. The difference shows most on small lights:
[Which one?](../Effects-Blur.md#which-one).

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Radius | 0 to 50 | 5 |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--float-right">

![Inside Box Blur's Horizontal Pass: Reach and Far offset feed Subtract, which feeds Clamp; the values Zero and One set Clamp's Min and Max](../assets/effects/graphs/box-blur-weight.webp)

<figcaption>The far-texel weight in Box Blur: Subtract and Clamp, where Gaussian Blur has a Gaussian Falloff.</figcaption>
</figure>

Box Blur is the [Gaussian Blur graph](./gaussian-blur.md#node-setup) with a different weight: every
neighbour inside the radius counts fully. Each pass weighs both pixels of a pair with its own
**Subtract** → **Clamp** (like the two **Gaussian Falloff** nodes): Subtract measures how far a read
lies inside the **Reach**, and Clamp limits that to 0–1.

**Remix:** invent your own kernel here. Any math that turns the offset into a weight of 0 or more
works; change all four weights (near and far, both passes) the same way.

<div class="docs-float-end"></div>

## Technical details

- **Units.** Radius is in pixels of a 1080p frame and scales with the rendered size.
- **Passes.** A horizontal pass into an `rgba16float` cache, then a vertical pass: about Radius + 2
  reads per pass at 1080p, with the same pair-merged reads as Gaussian Blur (up to 127 pairs per
  side, reported beyond).
- Shared blur notes (transparency, saved projects, software preview):
  [Blur & Sharpen](../Effect-System.md#blur--sharpen-notes). Kernels:
  [Effect system](../Effect-System.md#editable-blur-kernels); blocks:
  [Node Catalog](../Node-Catalog.md).
