# Kaleidoscope

Folds a slice of the picture into mirrored wedges around a centre, like looking through a
kaleidoscope. The pattern stays round on any picture size.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The dancer twice: on the left the original; on the right, her figure folded into sixteen mirrored slices around the middle, a symmetric flower on the dark stage](../assets/effects/kaleidoscope.webp)

<figcaption>Left: original. Right: Segments 8.</figcaption>
</figure>

**Use it for:** psychedelic and ornamental patterns · a symmetric flower from a dancer or from
lights · a slow, hypnotic background.

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![The Kaleidoscope effect card in Properties → Effects: Segments 8, Rotation 0°, Source Angle 0°, Zoom 1.00, Center X and Center Y 0.50, Shape Circle and Frame Edges Mirror](../assets/effects/editor/kaleidoscope-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 509" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M55 132 L115 132" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="55" cy="132" r="18" /><text x="55" y="132" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M24 223 L84 223" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="24" cy="223" r="18" /><text x="24" y="223" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M23 449 L83 449" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="23" cy="449" r="18" /><text x="23" y="449" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>The Kaleidoscope card. 1 — Segments. 2 — Source Angle, which part of the picture the mirrors show. 3 — Frame Edges: what appears where a read lands past the picture (Mirror, Clamp or Transparent).</figcaption>
</figure>

- **Segments** – how many times a mirrored pair of slices repeats around the circle (8 gives 16
  slices). Whole numbers give a clean pattern; animated, it dissolves from one count to the next.
- **Rotation** – spins the whole pattern, in degrees.
- **Source Angle** – picks which slice of the picture the mirrors show.
- **Zoom** – above 1 shows a smaller part of the picture, larger.

**Tip:** animate Source Angle slowly for the classic look of a turning kaleidoscope. For clean
jumps between counts, keyframe Segments with hold keyframes.

<div class="docs-float-end"></div>

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Segments | 2 to 16 | 6 |
| Rotation | −360 to 360° | 0° |
| Source Angle | −180 to 180° | 0° |
| Zoom | 0.25 to 4 | 1 |
| Center X | 0 to 1 | 0.5 |
| Center Y | 0 to 1 | 0.5 |
| Shape | Circle, Stretch to Frame | Circle |
| Frame Edges | Mirror, Clamp, Transparent | Mirror |
<!-- generated:controls end -->

## Node setup

Kaleidoscope moves where each pixel reads, like every distortion in its group
([the shared idea](../Effects-Distort.md#the-shared-idea)). Its **Wedge Fold** folder folds the
angle around the centre.

<figure class="docs-shot docs-shot--graph">

![Kaleidoscope's Wedge Fold folder, one of its two paths. Offset Y and X feed Arctangent 2; an Add with Rotation makes Turned Angle; Tau divided by Fewer Segments makes Wedge; both feed Mirror Repeat, whose Folded Angle plus Source Angle makes Read Angle; Direction from Angle times Read Radius makes Read Offset](../assets/effects/graphs/kaleidoscope-wedge-fold.webp)

<figcaption>Part of the Wedge Fold folder: the path for the lower whole segment count. Green cards stand for values the excerpt does not show: Offset X and Y come from Centre & Shape, while Rotation, Source Angle, Read Radius and Fewer Segments sit in this folder too, beside the zoom, segment-count and second-path nodes.</figcaption>
</figure>

**Arctangent 2** turns each pixel's offset from the centre into an angle, and **Add** turns it by
Rotation. **Divide** makes the width of one wedge (a full turn, **Tau**, divided by the segment
count). **Mirror Repeat** folds every angle into that one wedge, back and forth, which is the whole
trick. **Source Angle** then picks the slice of the picture, and **Direction from Angle** and
**Multiply** turn angle and distance back into a place to read.

**Remix:** for a spiral, add a **Multiply** of **Read Radius** and a **Value** of 3, and an **Add**
of **Turned Angle** and that Multiply. Plug the Add into the Value input of both **Mirror Repeat**
nodes (one per path). The pattern now twists further the further it is from the centre.

## Technical details

- **Fold.** Offsets are measured in units of the shorter frame side, so angles are on-screen angles
  and the Circle shape stays round. The angle is folded into one mirrored wedge of 360° / n, turned
  by Source Angle and read at distance / Zoom.
- **Fractional Segments** crossfade the patterns of the two neighbouring whole counts, so an animated
  count changes smoothly and no wedge is cut open; halfway, both patterns show at once.
- **Units.** Angles are stored in radians and shown in degrees; keyframe lanes, MIDI and tools use
  radians.
- **Limits.** Segments is clamped to 2–64 and Zoom to at least 0.01; both clamps are reported below
  the effect.
- **Saved projects** keep their look.

Frame edges and transparency: [Lens & Distort](../Effect-System.md#lens--distort-notes).
Recipes: [Effect system: editable mirror, split and pixel graphs](../Effect-System.md#editable-mirror-split-and-pixel-graphs).
Mirror Repeat: [Node Catalog](../Node-Catalog.md#composed-coordinate-nodes).
