# Mirror

Copies one half of the picture onto the other for perfect symmetry, with a seamless mirror line.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The harbour twice: on top the original; below, the upper half with sky, mountain and houses reflected into the lower half like a still lake](../assets/effects/mirror.webp)

<figcaption>Top: original. Bottom: Top / Bottom on, Left / Right off.</figcaption>
</figure>

**Use it for:** a calm reflection in water · symmetric faces, bodies and architecture · a doubled
dancer facing herself.

- **Left / Right** – the left half appears again, flipped, on the right (on by default).
- **Top / Bottom** – the top half appears again, flipped, at the bottom.
- **Keep** – which side is kept and copied: Left / Top or Right / Bottom.
- **Center X / Center Y and Angle** – move and turn the mirror line.

**Tip:** Top / Bottom on a landscape gives a calm reflection in water.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Left / Right | on or off | on |
| Top / Bottom | on or off | off |
| Keep | Left / Top, Right / Bottom | Left / Top |
| Center X | 0 to 1 | 0.5 |
| Center Y | 0 to 1 | 0.5 |
| Angle | −180 to 180° | 0° |
| Frame Edges | Mirror, Clamp, Transparent | Mirror |
<!-- generated:controls end -->

## Node setup

Mirror moves where each pixel reads, like every distortion in its group
([the shared idea](../Effects-Distort.md#the-shared-idea)). Its **Mirror Lines** folder folds the
offset from the mirror line.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The left-right strand of the Mirror Lines folder, its cables running around the cards. Top row: Offset and −Angle feed Rotate UV, which feeds Split Vector; its X goes to Absolute; Kept Side comes in from outside. Bottom row: a Multiply of Absolute and Kept Side, a Switch controlled by Left / Right that picks the raw or the mirrored X, Combine Vector with the Y from the top-bottom strand, and a second Rotate UV that turns the result back by Angle](../assets/effects/graphs/mirror-lines.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1169" aria-hidden="true" focusable="false">
<defs><marker id="mirror-lines-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M853 24 L853 88" marker-end="url(#mirror-lines-arrow)" />
<circle class="docs-shot-number" cx="853" cy="24" r="18" /><text x="853" y="24" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M162 873 L162 809" marker-end="url(#mirror-lines-arrow)" />
<circle class="docs-shot-number" cx="162" cy="873" r="18" /><text x="162" y="873" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>The left-right strand of the Mirror Lines folder, with cables routed around the cards; the top-bottom strand works the same way. Green cards are values from outside the excerpt. 1 — Absolute, the fold. 2 — the Multiply that picks the kept side.</figcaption>
</figure>

**Rotate UV** turns the offset from the centre by −Angle, so the mirror line is upright, and **Split
Vector** takes it apart. **Absolute** (1) is the whole trick: it turns −0.3 and +0.3 into the same
0.3, so both sides read the same spot. The **Multiply** (2) gives it the sign of the kept side, the
**Switch** uses it only while Left / Right is on, and the second **Rotate UV** turns the result back.

**Remix:** for a hall of mirrors, add a **Mirror Repeat** node between **Absolute** (1) and the
Multiply (2), and feed its Period from a **Value** of 0.5. The picture next to the line now reflects
back and forth in strips a quarter of the picture height wide.

## Technical details

- **Fold.** Offsets are measured in units of the shorter frame side, so the Angle is an on-screen
  angle. Each enabled axis keeps one side in the turned frame, so the reflection is continuous at
  the line: no gap and no doubled row.
- **Units.** Angle is stored in radians and shown in degrees; keyframe lanes, MIDI and tools use
  radians.
- **Saved projects** keep their look; diagonal mirror lines point exactly along the on-screen angle.

Frame edges and transparency: [Lens & Distort](../Effect-System.md#lens--distort-notes).
Recipes: [Effect system: editable mirror, split and pixel graphs](../Effect-System.md#editable-mirror-split-and-pixel-graphs).
Mirror Repeat: [Node Catalog](../Node-Catalog.md#composed-coordinate-nodes).
