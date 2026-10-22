# Kaleidoscope

Folds a slice of the picture into mirrored wedges around a centre, like looking through a kaleidoscope. The pattern stays round on any picture size, and a moving figure becomes a flower that opens and closes.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-clip docs-compare docs-shot--float-left">
<video src="../assets/effects/clips/kaleidoscope.mp4" poster="../assets/effects/clips/kaleidoscope.webp" width="960" height="480" autoplay muted loop playsinline preload="none" aria-label="The dancer turning on a dark stage, original left and with Kaleidoscope right: her dress and legs below the middle of the frame are folded into a six-pointed flower that opens, closes and changes shape as she moves"></video>
<figcaption>Left: original. Right: Kaleidoscope with six mirrored pairs and Source Angle 75°, the slice straight below the middle.</figcaption>
</figure>

**Use it for:** psychedelic and ornamental patterns · a symmetric flower from a dancer or from lights · a slow, hypnotic background.

- **Segments** – how many mirrored pairs go round the circle.
- **Source Angle** – which slice of the picture the mirrors show.
- **Zoom** – how close that slice is.

**Tip:** **Source Angle** starts at 75°, the slice straight below the centre at six pairs, so a figure in the middle of the frame is folded whole. When you change **Segments**, set Source Angle to 90° − 90° / Segments to keep reading that slice. Keyframe Source Angle slowly for the classic look of a turning kaleidoscope.

<div class="docs-float-end"></div>

## Presets

<figure class="docs-shot docs-shot--detail">

![The dancer four times in a grid, labelled: Ink Blot with her dress and arms mirrored left to right and top to bottom into one broad shape, Crystal with three large overlapping facets of the dress, Mandala with a dense round flower of thin petals and feet in a ring, Tiles with a small flower in the middle ringed by mirrored copies of the dress](../assets/effects/presets/kaleidoscope.webp)

<figcaption>The four presets on the dancer.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so. Every preset reads the slice straight below the centre, where a figure in the middle of the frame stands. **Center X / Center Y** go back to the middle of the frame.

**Ink Blot** – two mirrored pairs, slightly enlarged: the figure is mirrored left to right and top to bottom, like a folded ink print. Still readable as a body, so it works for a dreamlike double.

**Crystal** – three pairs, close up: big facets, as in a toy kaleidoscope with three mirrors. Strong on fabric, smoke and light.

**Mandala** – twelve pairs at full size: a dense, round flower of thin petals. For ornament, ritual and a hypnotic background.

**Tiles** – four pairs, zoomed out: a small flower in the middle, ringed by mirrored copies of the picture. On a busy picture the frame fills with a grid of tiles.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Kaleidoscope card: the Preset menu showing Crystal, Segments 3, Rotation 0°, Source Angle 60°, Zoom 1.50, Center X and Center Y 0.50, Shape Circle and Frame Edges Mirror, beside a strip of the preview with the dancer's dress and legs folded into large mirrored facets](../assets/effects/editor/kaleidoscope-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 656" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 282 L649 282" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="282" r="18" /><text x="565" y="282" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M537 344 L621 344" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="537" cy="344" r="18" /><text x="537" y="344" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M551 382 L635 382" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="551" cy="382" r="18" /><text x="551" y="382" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M512 419 L596 419" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="512" cy="419" r="18" /><text x="512" y="419" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M571 457 L655 457" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="571" cy="457" r="18" /><text x="571" y="457" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Kaleidoscope with the Crystal preset. 1 — Preset: pick a starting point. 2 — Segments: how many mirrored pairs. 3 — Rotation: spins the pattern. 4 — Source Angle: which slice the mirrors show. 5 — Zoom: how close the slice is.</figcaption>
</figure>

**Preset** – a starting point for Segments, Zoom and Source Angle; see [Presets](#presets).

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/kaleidoscope-segments.mp4" poster="../assets/effects/clips/kaleidoscope-segments.webp" width="600" height="600" autoplay muted loop playsinline preload="none" aria-label="The dancer with Kaleidoscope while Segments runs from 2 to 12 and back: a broad shape gains more and more petals until it is a dense flower, each new count fading in over the last, and loses them again; the current value is shown at the bottom left"></video>
<figcaption>Segments from 2 to 12 and back, Source Angle 75°.</figcaption>
</figure>

**Segments** – how many mirrored pairs of slices go round the circle: 6 gives 12 slices. 2 is a simple double mirror, 3 to 6 the classic kaleidoscope, 12 and more a dense mandala of thin petals. Whole numbers give a clean pattern; between two whole numbers both patterns show at once, so a keyframed count dissolves from one to the next. Use hold keyframes for clean jumps. 2 to 16, default 6.

<div class="docs-float-end"></div>

**Rotation** – spins the whole pattern around its centre, without changing what it shows. Keyframe it for a slowly turning ornament. −360 to 360°, default 0°; a typed or keyframed angle may go further, because the pattern repeats every turn.

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/kaleidoscope-source-angle.mp4" poster="../assets/effects/clips/kaleidoscope-source-angle.webp" width="600" height="600" autoplay muted loop playsinline preload="none" aria-label="The dancer with Kaleidoscope while Source Angle turns from 30° to 150° and back: the flower stays in place while its petals flow outwards and change, as if the tube of a kaleidoscope were turned"></video>
<figcaption>Source Angle from 30° to 150° and back.</figcaption>
</figure>

**Source Angle** – which slice of the picture the mirrors show, as a direction from the centre: 0° is to the right, 90° straight down, 180° to the left. The slice is 180° / Segments wide (30° at six pairs) and starts at this angle. Turning it is like turning the tube of a real kaleidoscope: the pattern stays in place, while new parts of the picture flow through it. −180 to 180°, default 75°; a typed or keyframed angle may go further and simply goes round again. Effects saved before 75° became the default keep 0°.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/kaleidoscope-zoom.mp4" poster="../assets/effects/clips/kaleidoscope-zoom.webp" width="600" height="600" autoplay muted loop playsinline preload="none" aria-label="The dancer with Kaleidoscope while Zoom runs from 0.5 to 2.5 and back: a flower ringed by mirrored copies of the stage grows until a few large, soft folds of the dress fill the frame, and shrinks again; the current value is shown at the bottom left"></video>
<figcaption>Zoom from 0.5 to 2.5 and back, Source Angle 75°.</figcaption>
</figure>

**Zoom** – how close the slice is. Above 1 a smaller part of the picture fills the pattern, larger and softer; below 1 the mirrors read past the edge of the frame, and **Frame Edges** decides what fills those rings. 0.25 to 4, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/kaleidoscope-center.mp4" poster="../assets/effects/clips/kaleidoscope-center.webp" width="720" height="480" autoplay muted loop playsinline preload="none" aria-label="The dancer with Kaleidoscope while Center X runs from 0.4 to 0.6 and back: the flower slides left and right with its centre and its petals change, because the mirrors now fold another part of the picture; the current value is shown at the bottom left"></video>
<figcaption>Center X from 0.4 to 0.6 and back, Source Angle 75°.</figcaption>
</figure>

**Center X** – where the centre of the pattern sits, from the left edge (0) to the right edge (1). The centre is also where the mirrors read from, so moving it changes the pattern, not only its place. 0 to 1, default 0.5.

<div class="docs-float-end"></div>

**Center Y** – the same from the top (0) to the bottom (1). Keyframe Center X and Y together to keep the pattern on a moving figure. 0 to 1, default 0.5.

**Shape** – **Circle** keeps the wedges true to the angle on any picture size, so the pattern stays round; **Stretch to Frame** stretches it with the frame into an oval on a wide picture. Circle, Stretch to Frame, default Circle.

**Frame Edges** – what fills in where the mirrors read past the edge of the frame, at a Zoom below 1 or a centre near the edge. **Mirror** reflects the picture at the edge, so the pattern continues in rings; **Clamp** repeats the outermost pixels into streaks; **Transparent** leaves those places empty, so a sharp-edged polygon floats over the layer below. Mirror, Clamp, Transparent, default Mirror.

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Kaleidoscope graph: Parameters feed Centre & Shape, whose Offset, Centre and Shape Scale go with Rotation, Source Angle, Zoom and Segments into Wedge Fold; its two Read Positions, the Premultiplied Source made from the Input Frame and the Frame Edges choice go into Frame Edges & Reads, and Crossfade & Straight Alpha blends Pattern A and Pattern B into the result](../assets/effects/graphs/kaleidoscope.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 941" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M314 22 L314 103" marker-end="url(#kaleidoscope-arrow)" />
<circle class="docs-shot-number" cx="314" cy="22" r="18" /><text x="314" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M509 246 L509 330" marker-end="url(#kaleidoscope-arrow)" />
<circle class="docs-shot-number" cx="509" cy="246" r="18" /><text x="509" y="246" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M509 918 L509 834" marker-end="url(#kaleidoscope-arrow)" />
<circle class="docs-shot-number" cx="509" cy="918" r="18" /><text x="509" y="918" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M703 22 L703 96" marker-end="url(#kaleidoscope-arrow)" />
<circle class="docs-shot-number" cx="703" cy="22" r="18" /><text x="703" y="22" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M897 246 L897 330" marker-end="url(#kaleidoscope-arrow)" />
<circle class="docs-shot-number" cx="897" cy="246" r="18" /><text x="897" y="246" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Kaleidoscope opened in the Nodes tab (Constants, Coordinates and the Output card left out). 1 — Centre & Shape: each pixel's offset. 2 — Wedge Fold: folds the angle. 3 — Premultiplied Source: the picture, ready to read. 4 — Frame Edges & Reads: reads the picture there. 5 — Crossfade & Straight Alpha: blends and finishes.</figcaption>
</figure>

Kaleidoscope does not paint anything: it moves where each pixel reads, like every effect in its group ([the shared idea](../Effects-Distort.md#the-shared-idea)). **Centre & Shape** measures each pixel's offset from the centre, **Wedge Fold** folds its angle into one mirrored slice, **Frame Edges & Reads** reads the picture there, from the **Premultiplied Source** prepared once per frame, and **Crossfade & Straight Alpha** blends the two neighbouring whole segment counts and turns the result back into a normal picture. Wedge Fold and Frame Edges & Reads hold two paths each: A for Segments rounded down, B for one more. Click a folder's header to open it; the sections below show what is inside.

### Centre & Shape

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Centre & Shape folder: Minimum of X and Y gives the shorter side; Divide makes Resolution relative to it; a Switch picks it or One by Shape (Greater Than with Half); Subtract takes the Centre from UV, and Multiply scales the result by the Shape Scale into the Offset](../assets/effects/graphs/kaleidoscope-centre-shape.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 987" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-centre-shape-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M509 145 L509 229" marker-end="url(#kaleidoscope-centre-shape-arrow)" />
<circle class="docs-shot-number" cx="509" cy="145" r="18" /><text x="509" y="145" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M703 145 L703 229" marker-end="url(#kaleidoscope-centre-shape-arrow)" />
<circle class="docs-shot-number" cx="703" cy="145" r="18" /><text x="703" y="145" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M703 721 L703 637" marker-end="url(#kaleidoscope-centre-shape-arrow)" />
<circle class="docs-shot-number" cx="703" cy="721" r="18" /><text x="703" y="721" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M897 145 L897 229" marker-end="url(#kaleidoscope-centre-shape-arrow)" />
<circle class="docs-shot-number" cx="897" cy="145" r="18" /><text x="897" y="145" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Centre & Shape (the cards of Center X and Y are left out). Green cards bring values in from outside the folder. 1 — Divide: the frame against its shorter side. 2 — Switch: Circle or Stretch to Frame. 3 — Subtract: the place relative to the centre. 4 — Multiply: the Offset.</figcaption>
</figure>

**Divide** – the frame size divided by its shorter side: (1.78, 1) on 16:9. **Minimum** before it finds the shorter side from the width X and height Y in pixels.

**Switch** – picks that size for **Circle**, or One for **Stretch to Frame** (Greater Than compares Shape with 0.5). This is the Shape Scale.

**Subtract** – the pixel's place (UV) minus the Centre: how far it lies from the middle of the pattern, as a share of the frame.

**Multiply** – that distance times the Shape Scale: the Offset in units of the shorter frame side, so angles on screen are true angles and a circle stays round.

### Wedge Fold

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Wedge Fold folder, path A: Offset Y and X feed Arctangent 2; Add turns the angle by Rotation; Tau divided by Count A makes the Wedge; Mirror Repeat folds the angle into it; a second Add adds Source Angle; Direction from Angle times Read Radius makes the Read Offset](../assets/effects/graphs/kaleidoscope-wedge-fold.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 622" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-wedge-fold-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M230 22 L230 95" marker-end="url(#kaleidoscope-wedge-fold-arrow)" />
<circle class="docs-shot-number" cx="230" cy="22" r="18" /><text x="230" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M369 480 L369 396" marker-end="url(#kaleidoscope-wedge-fold-arrow)" />
<circle class="docs-shot-number" cx="369" cy="480" r="18" /><text x="369" y="480" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M508 22 L508 95" marker-end="url(#kaleidoscope-wedge-fold-arrow)" />
<circle class="docs-shot-number" cx="508" cy="22" r="18" /><text x="508" y="22" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M648 22 L648 95" marker-end="url(#kaleidoscope-wedge-fold-arrow)" />
<circle class="docs-shot-number" cx="648" cy="22" r="18" /><text x="648" y="22" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M926 22 L926 95" marker-end="url(#kaleidoscope-wedge-fold-arrow)" />
<circle class="docs-shot-number" cx="926" cy="22" r="18" /><text x="926" y="22" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Wedge Fold, path A; path B, the zoom and the segment counts are left out. Green cards bring values in from outside this excerpt. 1 — Arctangent 2: the angle around the centre. 2 — Divide: one wedge. 3 — Mirror Repeat: folds the angle. 4 — Add: picks the slice. 5 — Multiply: back to a place.</figcaption>
</figure>

**Arctangent 2** – turns each pixel's offset into its angle around the centre. The first Add card turns that angle by Rotation, which spins the whole pattern.

**Divide** – a full turn (**Tau**, 2π) divided by Count A, Segments rounded down: the width of one mirrored pair, the Wedge.

**Mirror Repeat** – folds every angle into the first half of a wedge, forwards and backwards in turn: from 0 up to half a wedge, then down again. Every slice now reads from the same slice, every second one mirrored. This is the whole trick.

**Add** – adds Source Angle to the folded angle: which slice of the picture the mirrors show. This is the Read Angle.

**Multiply** – the direction of that angle (**Direction from Angle**) times the Read Radius, the distance from the centre divided by Zoom: the Read Offset. Two nodes after it turn it back into a place in the picture, Read Position A. The same chain with Count B makes Read Position B.

**Remix:** for a spiral, add a new Multiply node of **Read Radius** and a **Value** of 3, and a new Add node of the first Add's Turned Angle and that Multiply. Plug the new Add into the Value input of both **Mirror Repeat** nodes (one per path). The pattern now twists further the further it is from the centre.

### Premultiplied Source

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Premultiplied Source folder: Frame goes into Split RGB + Alpha; Multiply multiplies the colour by the alpha, Combine RGB + Alpha joins it with the alpha again, and Cache Image keeps the result as the Premultiplied Source](../assets/effects/graphs/kaleidoscope-premultiplied-source.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 478" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-premultiplied-source-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M589 455 L589 371" marker-end="url(#kaleidoscope-premultiplied-source-arrow)" />
<circle class="docs-shot-number" cx="589" cy="455" r="18" /><text x="589" y="455" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M914 22 L914 106" marker-end="url(#kaleidoscope-premultiplied-source-arrow)" />
<circle class="docs-shot-number" cx="914" cy="22" r="18" /><text x="914" y="22" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>Inside Premultiplied Source (cached). 1 — Multiply: colour times transparency. 2 — Cache Image: keeps the prepared picture.</figcaption>
</figure>

**Multiply** – multiplies every pixel's colour by its transparency. When a read later blends neighbouring pixels, a transparent one then adds no colour, so a cut-out figure keeps clean edges instead of a dark rim.

**Cache Image** – keeps the prepared picture, so it is made once per frame, not once per pixel, and both paths read the same one.

### Frame Edges & Reads

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Frame Edges and Reads folder, path A: Read Position A goes through Clamp (between Zero and One) and through Mirror Repeat; a Switch picks one of them by Not Mirror; Sample Image reads the Premultiplied Source there; a second Switch picks One or Edge Coverage by Is Transparent, and Multiply scales the read by it into Pattern A](../assets/effects/graphs/kaleidoscope-frame-edges.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 947" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-frame-edges-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M314 437 L314 521" marker-end="url(#kaleidoscope-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="314" cy="437" r="18" /><text x="314" y="437" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M314 572 L314 488" marker-end="url(#kaleidoscope-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="314" cy="572" r="18" /><text x="314" y="572" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M509 145 L509 229" marker-end="url(#kaleidoscope-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="509" cy="145" r="18" /><text x="509" y="145" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M703 145 L703 229" marker-end="url(#kaleidoscope-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="703" cy="145" r="18" /><text x="703" y="145" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M897 145 L897 229" marker-end="url(#kaleidoscope-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="897" cy="145" r="18" /><text x="897" y="145" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Frame Edges & Reads, path A, reduced to its recipe (how Edge Coverage, Is Transparent and Not Mirror are worked out is left out). 1 — Mirror Repeat: reflects at the edge. 2 — Clamp: stops at the edge. 3 — Switch: picks one by Frame Edges. 4 — Sample Image: reads the picture. 5 — Multiply: empties the places beyond the edge.</figcaption>
</figure>

**Mirror Repeat** – folds a Read Position beyond the frame back in, as in a mirror: the **Mirror** choice.

**Clamp** – holds the Read Position between Zero and One, so it stops at the outermost pixel: the **Clamp** choice, and the base of **Transparent**.

**Switch** – picks the mirrored or the clamped position; Not Mirror is true for Clamp and Transparent.

**Sample Image** – reads the Premultiplied Source at that position, blending the four nearest pixels.

**Multiply** – scales the read by One, or for Transparent by Edge Coverage, which falls from 1 to 0 within one pixel of the frame edge. The result is Pattern A; the same chain makes Pattern B from Read Position B.

### Crossfade & Straight Alpha

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Crossfade and Straight Alpha folder: Mix blends Pattern A and Pattern B by the Crossfade; RGBA to Image and Split RGB + Alpha take the result apart; Maximum keeps the alpha above Coverage Floor, Divide divides the colour by it, and Combine RGB + Alpha joins colour and alpha into the Result](../assets/effects/graphs/kaleidoscope-crossfade.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 430" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-crossfade-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M204 36 L204 120" marker-end="url(#kaleidoscope-crossfade-arrow)" />
<circle class="docs-shot-number" cx="204" cy="36" r="18" /><text x="204" y="36" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M691 22 L691 75" marker-end="url(#kaleidoscope-crossfade-arrow)" />
<circle class="docs-shot-number" cx="691" cy="22" r="18" /><text x="691" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M813 405 L813 321" marker-end="url(#kaleidoscope-crossfade-arrow)" />
<circle class="docs-shot-number" cx="813" cy="405" r="18" /><text x="813" y="405" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M935 36 L935 120" marker-end="url(#kaleidoscope-crossfade-arrow)" />
<circle class="docs-shot-number" cx="935" cy="36" r="18" /><text x="935" y="36" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Crossfade & Straight Alpha (the two RGBA conversions of the patterns are left out). 1 — Mix: blends the two patterns. 2 — Maximum: never divide by zero. 3 — Divide: the colour back to full strength. 4 — Combine RGB + Alpha: the finished picture.</figcaption>
</figure>

**Mix** – blends Pattern A and Pattern B by the Crossfade, the part of Segments after the point: at 6 only Pattern A shows, at 6.5 both equally, so a keyframed count never cuts a wedge open.

**Maximum** – keeps the transparency above a tiny Coverage Floor, so a fully transparent pixel never divides by zero.

**Divide** – divides the colour by the transparency again: the step back from the Premultiplied Source, so half-transparent edges keep their real colour.

**Combine RGB + Alpha** – joins colour and transparency into the finished picture that goes on to the next effect.

## Technical details

- **Fold.** Offsets are measured in units of the shorter frame side, so angles are on-screen angles and the Circle shape stays round. The angle is folded into one mirrored slice of 180° / Segments, turned by Source Angle and read at distance / Zoom.
- **Fractional Segments** crossfade the patterns of the two neighbouring whole counts, so an animated count changes smoothly and no wedge is cut open; halfway, both patterns show at once. Each count reads the picture once, so the effect costs two reads per pixel.
- **Units.** Rotation and Source Angle are stored in radians and shown in degrees; keyframe lanes, MIDI and tools use radians.
- **Limits.** The Segments slider goes to 16; keyframes, MIDI and tools may go up to 64. Segments outside 2–64 and a Zoom below 0.01 are clamped, and the card says so below the effect.
- **Transparency.** The picture is read premultiplied, so cut-out figures keep clean edges; the preview and the export match.
- **Saved projects** keep their look: an effect saved before effects owned a graph loads as its earlier recipe with Stretch to Frame and Clamp.
- **More:** [Effect system: Lens & Distort](../Effect-System.md#lens--distort-notes) · [Editable mirror, split and pixel graphs](../Effect-System.md#editable-mirror-split-and-pixel-graphs) · [Mirror Repeat in the Node Catalog](../Node-Catalog.md#composed-coordinate-nodes) · [Styles and presets](../Effects.md#styles-and-presets).
