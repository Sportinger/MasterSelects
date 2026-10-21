# Bulge & Pinch

Magnifies a round area like a lens bump, or squeezes it together. The edge of the area blends
smoothly into the untouched picture.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The harbour twice: on top the original; below, the houses in the middle magnified as if under a round glass, the edges unchanged](../assets/effects/bulge.webp)

<figcaption>Top: original. Bottom: Amount 2, Radius 0.5.</figcaption>
</figure>

**Use it for:** a magnifying-glass moment · a bump that grows out of the picture in a transition · a
cartoon squeeze of a face or an object.

- **Amount** – 1 changes nothing. Above 1 the middle is magnified that many times: 2 (the default)
  makes it twice as large. Below 1 pinches.
- **Radius** – size of the area, as a share of the picture height (the width in a portrait
  picture): 0.5 makes a circle as tall as the picture.
- **Center X / Center Y** – where the area sits (0.5 / 0.5 is the middle of the picture).

**Tip:** animate Amount from 1 to let the bump grow out of the picture. A pinch larger than the
picture reads beyond its edge: keep Radius at 0.5 or less in the middle (the pinch then stays
inside the frame), or use **Frame Edges: Transparent** over a background layer.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Amount | 0 to 3 | 2 |
| Radius | 0.05 to 1 | 0.5 |
| Center X | 0 to 1 | 0.5 |
| Center Y | 0 to 1 | 0.5 |
| Shape | Circle, Stretch to Frame | Circle |
| Frame Edges | Mirror, Clamp, Transparent | Mirror |
<!-- generated:controls end -->

## Node setup

Bulge & Pinch moves where each pixel reads, like every distortion in its group
([the shared idea](../Effects-Distort.md#the-shared-idea)). Its middle folder, **Bulge & Pinch
Curve**, decides how far from the centre each pixel reads.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Bulge & Pinch Curve folder in two rows, its cables running around the cards. Top row: Distance / Radius feeds a Multiply with itself, then Subtract from One, Maximum with Zero and a second Multiply that squares the result; Strength comes in from outside. Bottom row: a Multiply by Strength, Subtract from Zero, Exponential, which outputs Lens Scale, and a Multiply with Offset, which outputs Moved Offset](../assets/effects/graphs/bulge-curve.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1138" aria-hidden="true" focusable="false">
<defs><marker id="bulge-curve-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M882 152 L882 216" marker-end="url(#bulge-curve-arrow)" />
<circle class="docs-shot-number" cx="882" cy="152" r="18" /><text x="882" y="152" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M135 1051 L135 987" marker-end="url(#bulge-curve-arrow)" />
<circle class="docs-shot-number" cx="135" cy="1051" r="18" /><text x="135" y="1051" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>The heart of the Bulge & Pinch Curve folder, with cables routed around the cards. Green cards are values from outside the folder (Strength is worked out from Amount); One and Zero are constants. 1 — the Multiply that squares the falloff. 2 — the Multiply that scales it by Strength.</figcaption>
</figure>

**Multiply**, **Subtract** and **Maximum** turn the distance into 1 − r², which is 1 in the middle
and 0 at the edge of the area. Multiply (1) squares it, so the effect fades out smoothly at the rim.
Multiply (2) scales it by **Strength**, and **Exponential** turns the result into the **Lens
Scale**: below 1 in a bulge, so the pixel reads closer to the centre and the picture is magnified,
above 1 in a pinch. The last **Multiply** applies it to the offset.

**Remix:** for a lens with a visible glass rim, connect the output of **Maximum** to input **B** of
Multiply (2), in place of the cable from Multiply (1). The bump then stays strong further out and
ends in a clear edge.

## Technical details

- **Formula.** With p the offset from the centre and r = |p| / Radius, Bulge & Pinch reads
  p × exp(−β (1 − r²)²) for r < 1, with β = ln(max(Amount, 1)) − 0.95 × clamp(1 − Amount, 0, 1).
  Above 1 the centre is magnified exactly Amount times; a pinch stays above β = −1, so it never
  folds the picture back on itself.
- **Amount 1** skips the recipe, so the picture passes through exactly.
- **Limits.** Each pixel is read once: a strong pinch can shimmer on fine detail, and a bulge far
  beyond the slider (Amount 8 magnifies the centre eight times) shows soft magnified pixels.
  A Radius at or below 0 and a negative Amount are reported below the effect.
- **Saved projects.** An untouched graph, an effect saved before effects owned a graph and an effect
  preset of the earlier recipe load as the current recipe with Stretch to Frame and Clamp, and get the
  smooth curve.

Units, frame edges and transparency: [Lens & Distort](../Effect-System.md#lens--distort-notes).
Recipes: [Effect system: editable UV distortions](../Effect-System.md#editable-uv-distortions).
Nodes: [Node Catalog](../Node-Catalog.md).
