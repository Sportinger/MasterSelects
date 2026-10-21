# Wave

Ripples the picture with smooth waves, from a gentle ripple to a funhouse wobble. The waves travel
by themselves.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The night street twice: on top the original; below, the shop fronts, neon signs and the walker rippling in vertical and horizontal waves](../assets/effects/wave.webp)

<figcaption>Top: original. Bottom: the default settings.</figcaption>
</figure>

**Use it for:** heat shimmer · an underwater or dream look · a wobbly transition.

- **Horizontal Height / Vertical Height** – how far the picture moves, as a share of the picture
  (0.015 is 1.5 %). Horizontal Height moves the picture up and down in waves that run across it;
  Vertical Height moves it sideways.
- **Horizontal Waves / Vertical Waves** – how many waves fit across and down the picture.
- **Speed** – how fast the waves travel, in waves per second. 0 stands still, negative values run
  the other way.
- **Phase** – shifts the waves along, in degrees (useful with Speed 0).

**Tip:** small heights (0.005) with a slow Speed read as heat shimmer.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **General** | | |
| Horizontal Height | 0 to 0.1 | 0.015 |
| Horizontal Waves | 0.5 to 20 | 4 |
| Vertical Height | 0 to 0.1 | 0.015 |
| Vertical Waves | 0.5 to 20 | 4 |
| Frame Edges | Mirror, Clamp, Transparent | Mirror |
| **Motion** | | |
| Speed | −4 to 4 | 0.5 |
| Phase | 0 to 360 | 0 |
<!-- generated:controls end -->

## Node setup

Wave moves where each pixel reads, like every distortion in its group
([the shared idea](../Effects-Distort.md#the-shared-idea)). Its middle folder, **Wave
Displacement**, adds two sine waves to the position.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The up-and-down strand of the Wave Displacement folder in two rows, its cables running around the cards. Top row: X and Horizontal Waves, two Multiply nodes, Phase, Add and Sine. Bottom row: Horizontal Height, Multiply, Y and Add. The Sine output runs back from the end of the top row into the bottom-row Multiply](../assets/effects/graphs/wave-displacement.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 577" aria-hidden="true" focusable="false">
<defs><marker id="wave-displacement-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M418 527 L418 443" marker-end="url(#wave-displacement-arrow)" />
<circle class="docs-shot-number" cx="418" cy="527" r="18" /><text x="418" y="527" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M902 247 L902 163" marker-end="url(#wave-displacement-arrow)" />
<circle class="docs-shot-number" cx="902" cy="247" r="18" /><text x="902" y="247" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M253 554 L253 490" marker-end="url(#wave-displacement-arrow)" />
<circle class="docs-shot-number" cx="253" cy="554" r="18" /><text x="253" y="554" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>The up-and-down strand of Wave's Wave Displacement folder, with cables routed around the cards; the sideways strand and the Split Vector node are left out. Green cards are inputs: X and Y, the picture position from Split Vector, and values from outside the folder. 1 — Y. 2 — Sine. 3 — the Multiply that scales the wave by Horizontal Height.</figcaption>
</figure>

This strand moves the picture up and down. **Split Vector**, at the start of the folder, splits each
pixel's position into **X** and **Y** (1). X times **Horizontal Waves** (and 2π, the free dot on the
second Multiply) plus **Phase** goes into a **Sine** (2); the **Multiply** (3) scales that wave by
**Horizontal Height**, and the last **Add** shifts Y by it. A second strand in the same folder does
the same along Y with the vertical controls and shifts X; **Combine Vector** joins both into the
**Read Position**. Phase grows with Speed over time, so the waves travel.

**Remix:** for ripples that grow towards the bottom, add a **Multiply** node between the **Sine** (2)
and the Multiply (3), and connect the **Y** output of **Split Vector** (the Y card (1) in the
picture) to its second input. Y runs from 0 at the top of the picture to 1 at the bottom, so the
ripples are calm at the top and strongest at the bottom, like a water surface.

## Technical details

- **Formula.** Wave adds sin(2π × Horizontal Waves × x + φ) × Horizontal Height to y, then
  sin(2π × Vertical Waves × y′ + φ) × Vertical Height to x, where y′ is the shifted y and
  φ = Phase (converted to radians) + 2π × Speed × time in seconds. The time is the timeline time, so seeking and the export show the
  same waves.
- **Units.** The heights are fractions of the picture per axis, so equal values give different
  pixel shifts on a 16:9 frame.
- **Both heights 0** skip the recipe, so the picture passes through exactly.
- **Limits.** Each pixel is read once, so many tiny waves shimmer on fine detail.
- **Saved projects.** An untouched graph, an effect saved before effects owned a graph and an effect
  preset of the earlier recipe load as the current recipe with Clamp and Speed 0, so they look as
  before.

Frame edges and transparency: [Lens & Distort](../Effects-Distort.md#technical-details).
Recipes: [Effect system: editable UV distortions](../Effect-System.md#editable-uv-distortions).
Nodes: [Node Catalog](../Node-Catalog.md).
