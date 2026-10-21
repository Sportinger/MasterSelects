# Twirl

Turns the picture around a centre point: strongest in the middle, fading out to nothing at the
edge of the area.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The dancer twice: on top the original; below, her dress and body swirled into a spiral around the middle of the picture](../assets/effects/twirl.webp)

<figcaption>Top: original. Bottom: Twist 200°, Radius 0.6.</figcaption>
</figure>

**Use it for:** a swirl transition · a dream or a dizzy spell · a whirlpool in water, smoke or
light.

- **Twist** – how far the middle turns, in degrees. 45° is a soft swirl, 115° (the default) a clear
  one, 360° a full turn; negative values turn the other way.
- **Radius** – size of the area, as a share of the picture height (the width in a portrait
  picture): 0.5 makes a circle as tall as the picture.
- **Center X / Center Y** – the centre of the swirl.

**Tip:** keyframe Twist from 0 up and back to 0 for a swirl transition.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Twist | −720 to 720° | 114.59° |
| Radius | 0.05 to 1 | 0.5 |
| Center X | 0 to 1 | 0.5 |
| Center Y | 0 to 1 | 0.5 |
| Shape | Circle, Stretch to Frame | Circle |
| Frame Edges | Mirror, Clamp, Transparent | Mirror |
<!-- generated:controls end -->

## Node setup

Twirl moves where each pixel reads, like every distortion in its group
([the shared idea](../Effects-Distort.md#the-shared-idea)). Its middle folder, **Twirl Angle**,
turns each pixel's offset from the centre.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Twirl Angle folder opened, its cables running around the cards. Top row: Distance / Radius, Minimum, Subtract, Multiply, Twist and a second Multiply that outputs Turn Angle. Bottom row: Offset, Rotate UV, Shape Scale, Divide, Centre and Add, which outputs Read Position. Turn Angle runs back from the end of the top row into the Angle input of Rotate UV](../assets/effects/graphs/twirl-angle.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 449" aria-hidden="true" focusable="false">
<defs><marker id="twirl-angle-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M587 22 L587 79" marker-end="url(#twirl-angle-arrow)" />
<circle class="docs-shot-number" cx="587" cy="22" r="18" /><text x="587" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M907 22 L907 79" marker-end="url(#twirl-angle-arrow)" />
<circle class="docs-shot-number" cx="907" cy="22" r="18" /><text x="907" y="22" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>Twirl's Twirl Angle folder, with cables routed around the cards (the <strong>Avoid</strong> button in the Node Workspace toolbar). Green cards are values from outside the folder. 1 — the Multiply that squares the falloff. 2 — the Multiply that makes Turn Angle.</figcaption>
</figure>

**Minimum**, **Subtract** and the first **Multiply** (1) turn the distance into a falloff: full
strength in the middle, fading in a soft curve to nothing at the edge of the area. The free dots on
Minimum (B) and Subtract (A) hold the constant 1, so together they compute (1 − min(distance, 1))².
The second **Multiply** (2) scales it by **Twist** into the **Turn Angle**. **Rotate UV** turns the
offset by that angle, and **Divide** and **Add** turn the result back into a position in the
picture.

**Remix:** connect the output of **Subtract** straight to input **B** of the Multiply (2), in place
of the cable from Multiply (1). The turn then fades in a straight line instead of a curve, and the
swirl stays strong further out.

## Technical details

- **Formula.** With p the offset from the centre and r = |p| / Radius, Twirl turns p by
  Twist × (1 − min(r, 1))² radians.
- **Units.** Twist is stored in radians (default 2, range ±4π). The inspector rows show degrees, also
  when Twist takes a node source; keyframe lanes, MIDI and tools use radians.
- **Twist 0** skips the recipe, so the picture passes through exactly.
- **Limits.** Each pixel is read once, so a very strong Twist (above about 10 radians) shimmers on
  fine detail.
- **Saved projects.** An untouched graph, an effect saved before effects owned a graph and an effect
  preset of the earlier recipe load as the current recipe with Stretch to Frame and Clamp, which keeps
  their look.

Units, frame edges and transparency: [Lens & Distort](../Effect-System.md#lens--distort-notes).
Recipes: [Effect system: editable UV distortions](../Effect-System.md#editable-uv-distortions).
Nodes: [Node Catalog](../Node-Catalog.md).
