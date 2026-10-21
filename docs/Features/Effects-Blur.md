# Blur Effects

Five ways to soften a picture, from a gentle defocus to fast streaks of motion.
Add one in **Properties → Effects → + Add Effect**.

Each blur looks identical in the preview and the export, and transparent edges
(logos, titles, keyed footage) fade out cleanly without a dark rim.

## The five blurs

### Gaussian Blur
<figure class="docs-shot docs-shot--float-right">

![Original left, Gaussian Blur (Radius 12) right, on the harbour image](assets/effects/gaussian-blur.webp)

<figcaption>Left: original. Right: Radius 12.</figcaption>
</figure>

A smooth, even softening, like a lens out of focus. The standard choice for
backgrounds, transitions and anything that should simply look soft.
- **Radius** – how soft. 2–5 takes the edge off, 10 is clearly out of focus, 30 and more turns shapes into light.

Tip: animate Radius from 0 for a smooth focus pull.

### Box Blur
<figure class="docs-shot docs-shot--float-left">

![Original left, Box Blur (Radius 25) right, on the night street with neon signs](assets/effects/box-blur.webp)

<figcaption>Left: original. Right: Radius 25.</figcaption>
</figure>

Averages a square around every pixel. Shapes keep a slightly hard, graphic
edge, and bright lights turn into flat squares instead of round glows.
- **Radius** – size of the square. Changes smoothly when animated.

Tip: for a natural defocus use Gaussian Blur; Box Blur is the graphic look.

<div class="docs-float-end"></div>

<figure class="docs-shot">

![The window lights of the night street twice: Gaussian Blur at Radius 25 makes round, soft glows, Box Blur at Radius 25 flat squares](assets/effects/box-vs-gaussian-lights.webp)

<figcaption>The same lights, close up: Gaussian Blur makes round glows, Box Blur flat squares.</figcaption>
</figure>

### Motion Blur
<figure class="docs-shot docs-shot--float-right">

![Original left, Motion Blur (Length 0.03, horizontal) right, on the dancer](assets/effects/motion-blur.webp)

<figcaption>Left: original. Right: Length 0.03, horizontal.</figcaption>
</figure>

Smears the picture in one direction, as if the camera or the subject moved fast
during the exposure.
- **Length** – how far the streak reaches to each side, as a share of the picture width (of the height for vertical streaks). 0.03 is a quick move, 0.1 a fast pan.
- **Angle** – the direction: 0 is horizontal, 1.57 vertical, 0.79 diagonal.

Tip: keep Length small on faces; long streaks work best on lights and fabric.

### Radial Blur
<figure class="docs-shot docs-shot--float-left">

![Original left, Radial Blur in Spin mode (Amount 0.5) right, on the night street](assets/effects/radial-blur.webp)

<figcaption>Left: original. Right: Spin, Amount 0.5.</figcaption>
</figure>

Blurs around a centre point. **Zoom** streaks the picture towards the centre and
leaves the middle sharp; **Spin** turns it in circles, like a rotating camera.
- **Type** – Zoom or Spin.
- **Amount** – strength. For Spin, 0.5 is a turn of about 10 degrees, 2 about 40.
- **Center X / Center Y** – where the sharp middle sits (0.5 / 0.5 is the centre of the picture).

Tip: put the centre on the performer to keep them sharp while the stage swirls.

### Zoom Blur
<figure class="docs-shot docs-shot--float-right">

![Original left, Zoom Blur (Amount 0.3) right, on the night street](assets/effects/zoom-blur.webp)

<figcaption>Left: original. Right: Amount 0.3.</figcaption>
</figure>

Streaks the picture outward from a centre point, as if zooming in during the
exposure: a burst of speed.
- **Amount** – length of the streaks. 0.1 is subtle, 0.3 a clear zoom burst, 1 is extreme.
- **Center X / Center Y** – where the burst starts.

Tip: Radial Blur's Zoom type is the gentler, fading variant; Zoom Blur is the
strong, even burst.

<div class="docs-float-end"></div>

## How the blur effects are built

Every blur is a small node graph. To see it, select the clip and open the
**Nodes** tab; the arrow on a folder card opens that stage. Changes apply to this
one effect. [Node Workspace](./Node-Workspace.md) shows how to add and connect nodes.

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with Gaussian Blur at Radius 10, beside a strip of the blurred preview](assets/effects/editor/gaussian-blur-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 497" aria-hidden="true" focusable="false">
<defs><marker id="gaussian-blur-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M766 152 L766 68" marker-end="url(#gaussian-blur-inspector-arrow)" />
<circle class="docs-shot-number" cx="766" cy="152" r="18" /><text x="766" y="152" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M357 394 L441 394" marker-end="url(#gaussian-blur-inspector-arrow)" />
<circle class="docs-shot-number" cx="357" cy="394" r="18" /><text x="357" y="394" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M882 190 L882 274" marker-end="url(#gaussian-blur-inspector-arrow)" />
<circle class="docs-shot-number" cx="882" cy="190" r="18" /><text x="882" y="190" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>1 — Properties → Effects. 2 — Radius, the white Radius card in the graph. 3 — Bypass, to compare with the original.</figcaption>
</figure>

### The shared idea

All five blurs follow one recipe: weigh each colour by its transparency, read
neighbouring pixels, weigh each read, add them up and divide by the total weight,
then restore normal transparency. [Gaussian and Box Blur](#gaussian-blur-two-passes)
do this along the rows, then along the columns.
[Motion, Radial and Zoom Blur](#motion-radial-and-zoom-blur-two-stages) do it
along a path, in short pieces first.

### Gaussian Blur: two passes

<figure class="docs-shot docs-shot--graph">

![The Gaussian Blur graph: Input Frame and Radius on the left, then Premultiplied Source and Radius & Tap Count, Horizontal Pass, Vertical Pass, Straight Alpha Output and Output](assets/effects/graphs/gaussian-blur.webp)

<figcaption>Gaussian Blur in the Node Workspace (Constants and Coordinates folders left out).</figcaption>
</figure>

**Radius & Tap Count** turns Radius into the width of the bell curve (**Sigma**)
and the number of reads. **Horizontal Pass** blurs the rows, **Vertical Pass**
the columns of that result.

### Inside a pass

<figure class="docs-shot docs-shot--graph">

![The Horizontal Pass of Gaussian Blur as a recipe. Left column: the inputs Tap Index, Pairs and Stride feeding Pair Tap Offsets; top: Sigma and two Gaussian Falloff nodes feeding Merge Pair Weights; bottom: Premultiplied Source and Read Position feeding Sample Image; right: Tap Count, Sequence Reduce, Normalize by Weight and Cache Image](assets/effects/graphs/gaussian-blur-horizontal-pass.webp)

<figcaption>The Horizontal Pass, reduced to its recipe. Green cards come from elsewhere in the graph.</figcaption>
</figure>

1. **Pair Tap Offsets** lists where to read: the pixel and pairs of neighbours.
2. Two **Gaussian Falloff** nodes weigh each neighbour. They are the kernel.
3. **Merge Pair Weights** folds each pair into one read (a speed trick).
4. **Sample Image** reads, **Sequence Reduce** adds up, **Normalize by Weight**
   averages and **Cache Image** keeps the result for the vertical pass.

Remix: for a blur that stretches sideways, open **Vertical Pass** and put a
**Multiply** with a value below 1 between the Sigma input and both **Gaussian
Falloff** nodes.

### Box Blur: a different weight

<figure class="docs-shot docs-shot--float-right">

![Inside Box Blur's Horizontal Pass: the inputs Reach and Far offset on the left feed Subtract, which feeds Clamp](assets/effects/graphs/box-blur-weight.webp)

<figcaption>The weight of one read in Box Blur: Subtract and Clamp, where Gaussian Blur has a Gaussian Falloff.</figcaption>
</figure>

Box Blur is the Gaussian graph with one change in both passes: every neighbour
inside the radius counts fully. **Subtract** measures how far a read lies inside
the **Reach**, and **Clamp** limits that to 0–1.

Remix: invent your own kernel here. Any math that turns the offset into a weight
of 0 or more works; change both passes the same way.

<div class="docs-float-end"></div>

### Motion, Radial and Zoom Blur: two stages

<figure class="docs-shot docs-shot--graph">

![The Motion Blur graph: Parameters and Input Frame on the left, then Blur Range and Premultiplied Source, Tap Counts & Box Length, Stage A, Stage B, Straight Alpha Output and Output](assets/effects/graphs/motion-blur.webp)

<figcaption>Motion Blur; Radial and Zoom Blur have the same stages.</figcaption>
</figure>

These blurs smear every pixel along a path: a line (Motion), a ray from the
centre (Zoom) or a circle (Spin). **Blur Range** works out the path. **Stage A**
averages one short piece of it and caches that; **Stage B** reads the cache once
per piece along the whole path, so a long streak needs dozens of reads, not hundreds.

<figure class="docs-shot docs-shot--graph">

![Motion Blur's taper inside Stage B, in one row: Position t, Multiply, Subtract, Multiply, Multiply, Exponential, then the input Box Weight and the Multiply that gives each read its weight](assets/effects/graphs/motion-blur-taper.webp)

<figcaption>Motion Blur's taper in Stage B: Exponential fades both ends of the streak; the last Multiply weighs each read with it.</figcaption>
</figure>

Remix: for an even streak, open **Stage B**, unplug **Exponential** from input A
of the last **Multiply** and plug a **Value** of 1 into A. Leave input B alone:
it carries the Box Weight.

### Radial Blur: Zoom or Spin

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![Inside Radial Blur's Blur Range: Type feeds Greater Than; its Is Spin output and the inputs Zoom Range and Spin Arc feed a Switch that outputs Range Length](assets/effects/graphs/radial-blur-type.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 356" aria-hidden="true" focusable="false">
<defs><marker id="radial-blur-type-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M222 239 L222 155" marker-end="url(#radial-blur-type-arrow)" />
<circle class="docs-shot-number" cx="222" cy="239" r="18" /><text x="222" y="239" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M506 258 L506 174" marker-end="url(#radial-blur-type-arrow)" />
<circle class="docs-shot-number" cx="506" cy="258" r="18" /><text x="506" y="258" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>1 — Greater Than turns Type into Is Spin. 2 — a Switch picks the Zoom or the Spin range.</figcaption>
</figure>

Inside **Blur Range**, **Greater Than** (1) turns Type into Is Spin, and
**Switch** nodes (2) pick the path: a ray for Zoom, a circle for Spin.

<div class="docs-float-end"></div>

### Zoom Blur: an even burst

Zoom Blur has the same stages without a Type. At the same Amount it stretches
much further than Radial Blur's Zoom type, and every read counts the same.

Remix: to let the burst fade outward, open **Stage B**, **Multiply** Position t
by a Value of 0.5, **Subtract** that from a Value of 1 and plug the result into
input A of the **Multiply** that weighs each read.

## Technical details

Notes for developers. The contract lives in `src/effects/blur/blurSampling.ts`;
more in [Effects: editable blur kernels](./Effects.md#editable-blur-kernels),
[Node Catalog](./Node-Catalog.md) and
[Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Units.** Radius is in pixels of a 1080p frame (its shorter side) and scales
  with the rendered size, so preview, export and 4K match; 3D layer-space effects
  count their layer's own resolution. Motion Length reaches
  Length × |(cos × width, sin × height)| to each side (the legacy length); Angle is
  the on-screen direction in radians (0–6.28). Radial and Zoom are relative to the frame.
- **Premultiplied source.** The frame is premultiplied into an `rgba16float`
  cache first; every filtered read after that is exact at alpha edges.
- **Separable kernels.** Gaussian and Box run a horizontal pass into an
  `rgba16float` cache, then a vertical pass: about 1.5 × Radius + 1 (Gaussian) or
  Radius + 2 (Box) reads per pass at 1080p. Gaussian uses sigma = Radius / 2, cut
  at 3 sigma.
- **Pair-merged taps.** One linear-filtered read covers two neighbouring texels
  at their weighted centre, exact for any weights. Up to 127 pairs per side;
  beyond that the pairs spread out, and the tool result and inspector say so.
- **Two stages.** Each tap moves the read along a line (Motion), along a ray on a
  logarithmic scale (Zoom, Radial Zoom) or along an arc (Spin), so the short boxes
  of Stage A tile the path exactly. Stage A reads at most one pixel apart (up to
  256 reads), Stage B one box apart (up to 64): about 2 × √(2 × streak length in
  px) reads per pixel; longer streaks are reported. Motion mirrors at the frame
  edge; Radial and Zoom clamp.
- **Zoom against Radial Zoom.** Zoom Blur samples the scales 1 to
  1 + 0.5 × Amount with even weights; Radial Zoom samples 1 − 0.2 × Amount ×
  distance to 1 (distance in UV units: 0.5 is half the picture) with the weight
  1 − t / 2. At Amount 0.3, half a picture from the centre, Zoom Blur's streak is
  about five times longer.
- **Below 0.** Motion and Radial Blur leave the picture unchanged, as before, and
  the inspector and tool results say so; Zoom Blur streaks inward.
- **Zero strength.** A blur at 0 is skipped, so the picture passes through exactly.
- **Saved projects.** Untouched old blur graphs upgrade automatically; edited
  graphs stay as saved.
