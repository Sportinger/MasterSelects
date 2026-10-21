# Distort Effects

Effects that bend, swirl or straighten the picture: playful lens looks and
corrections for photos. Add one in **Properties → Effects → + Add Effect → Lens & Distort**.

Every distortion looks the same in the preview and the export, and pictures with
transparency (titles, logos, keyed footage) keep clean edges without a dark rim.

## The seven distort effects

### Bulge & Pinch
<figure class="docs-shot docs-shot--float-right">

![The harbour twice: on top the original; below, the houses in the middle magnified as if under a round glass, the edges unchanged](assets/effects/bulge.webp)

<figcaption>Top: original. Bottom: Amount 2, Radius 0.5.</figcaption>
</figure>

Magnifies a round area like a lens bump, or squeezes it together. The edge of
the area blends smoothly into the untouched picture.
- **Amount** – 1 changes nothing, above 1 magnifies (1.6 is a clear bump, 2.5 a strong one), below 1 pinches.
- **Radius** – size of the area, as a share of the picture height (the width in a portrait picture): 0.5 makes a circle as tall as the picture.
- **Center X / Center Y** – where the area sits (0.5 / 0.5 is the middle of the picture).

Tip: animate Amount from 1 to let the bump grow out of the picture.

<div class="docs-float-end"></div>

### Twirl
<figure class="docs-shot docs-shot--float-left">

![The dancer twice: on top the original; below, her dress and body swirled into a spiral around the middle of the picture](assets/effects/twirl.webp)

<figcaption>Top: original. Bottom: Twist 200°, Radius 0.6.</figcaption>
</figure>

Turns the picture around a centre point: strongest in the middle, fading out to
nothing at the edge of the area.
- **Twist** – how far the middle turns, in degrees. 115° is a soft swirl, 360° a full turn; negative values turn the other way.
- **Radius** – size of the area, as for Bulge & Pinch.
- **Center X / Center Y** – the centre of the swirl.

Tip: keyframe Twist from 0 up and back to 0 for a swirl transition.

<div class="docs-float-end"></div>

### Wave
<figure class="docs-shot docs-shot--float-right">

![The night street twice: on top the original; below, the shop fronts, neon signs and the walker rippling in vertical and horizontal waves](assets/effects/wave.webp)

<figcaption>Top: original. Bottom: the default settings.</figcaption>
</figure>

Ripples the picture with smooth waves, like a reflection in water or heat haze.
The waves travel by themselves.
- **Horizontal Height / Vertical Height** – how far the picture moves, as a share of the picture (0.015 is 1.5 %).
- **Horizontal Waves / Vertical Waves** – how many waves fit across and down the picture.
- **Speed** – how fast the waves travel, in waves per second. 0 stands still, negative values run the other way.

Tip: small heights (0.005) with a slow Speed read as heat shimmer.

<div class="docs-float-end"></div>

### Fisheye Lens
<figure class="docs-shot docs-shot--float-left">

![The night street twice: on top the original; below, the walker in the middle enlarged and the house fronts at the sides curving like through a fisheye lens](assets/effects/fisheye.webp)

<figcaption>Top: original. Bottom: the default settings (Strength 1, Field of View 140°).</figcaption>
</figure>

The rounded look of an ultra-wide fisheye lens: the middle comes closer and
straight lines bend towards the edges.
- **Strength** – 1 is the full fisheye, 0 no change, negative values bend the other way and flatten a fisheye picture.
- **Field of View** – how wide the imagined lens sees, in degrees: wider looks rounder.
- **Zoom** – below 1 shows more of the picture around the middle.
- **Lens Radius** – 1 or less shows the round image circle of the lens (1 is as tall as the picture).

Tip: Lens Radius 0.9 with **Outside Lens: Transparent** makes a round porthole.

<div class="docs-float-end"></div>

### Lens Correction
<figure class="docs-shot docs-shot--float-right">

![The night street twice: on top with simulated wide-angle distortion, the house edges bowing outward; below, corrected, the edges straight](assets/effects/lens-correction.webp)

<figcaption>Top: the street with simulated wide-angle (barrel) distortion. Bottom: Remove Distortion −14.</figcaption>
</figure>

Repairs what a camera lens does to a photo or clip: bowed lines, coloured
fringes at contrast edges and dark corners.
- **Lens Profile** – the measured Canon EF 24–105mm f/4L IS USM, or Manual.
- **Remove Distortion** – negative values straighten lines that bow outward (wide angle), positive values lines that bow inward.
- **Red/Cyan Fringe and Blue/Yellow Fringe** – remove coloured edges.
- **Vignette Amount** – lifts dark corners (negative darkens them).

Tip: very strong correction leaves empty corners. Raise Scale to crop them, or
fill them on still photos with AI Edge Fill.

<div class="docs-float-end"></div>

### Guided Perspective
<figure class="docs-shot docs-shot--float-left">

![The night street twice: on top seen with a camera tilted upward, the house edges leaning inward; below, corrected, the house edges vertical](assets/effects/guided-perspective.webp)

<figcaption>Top: the street with a simulated upward camera tilt. Bottom: corrected by Guided Perspective.</figcaption>
</figure>

Straightens buildings and walls that lean because the camera was tilted. Choose
**Edit guides** and draw lines along edges that should be vertical (or horizontal),
then **Apply**.
- **Strength** – 100 is the full correction; lower values keep some of the lean, and lines stay straight.
- **Scale** – enlarges the result to crop the empty borders.

Tip: add it directly after Lens Correction and draw guides along long edges far apart.

<div class="docs-float-end"></div>

### AI Edge Fill

Fills the empty borders that Lens Correction and Guided Perspective leave on a
still photo with an AI-generated continuation of the scene, so the frame is full
again. It uses the cloud AI service and its credits; see [AI Edge Fill](./Effects.md#ai-edge-fill).

Known limitations: AI Edge Fill has no picture here because it needs a cloud
generation. Very strong Twist, Wave with many tiny waves or a strong pinch can
shimmer on fine detail, and an extreme bulge looks soft, because each pixel is
read once.

<div class="docs-float-end"></div>

## How the distort effects are built

Bulge & Pinch, Twirl and Wave share their controls and their idea. Twirl shows
both best.

<figure class="docs-shot">

<div class="docs-shot-stage">

![The dancer swirled into a spiral in the preview, next to Properties, Effects, with Twirl at Twist 200 degrees, Radius 0.6, Shape Circle and Frame Edges Mirror](assets/effects/editor/twirl-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 437" aria-hidden="true" focusable="false">
<defs><marker id="twirl-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M617 264 L701 264" marker-end="url(#twirl-inspector-arrow)" />
<circle class="docs-shot-number" cx="617" cy="264" r="18" /><text x="617" y="264" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M617 401 L701 401" marker-end="url(#twirl-inspector-arrow)" />
<circle class="docs-shot-number" cx="617" cy="401" r="18" /><text x="617" y="401" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>Twirl in Properties → Effects. 1 — Twist, in degrees. 2 — Frame Edges.</figcaption>
</figure>

- **Twist** (1) is the turn in the middle of the swirl, in degrees.
- **Shape**, just above Frame Edges: **Circle** keeps the area round on any
  picture. **Stretch to Frame** stretches it to the shape of the frame, an oval
  on a wide picture. Bulge & Pinch has the same choice.
- **Frame Edges** (2) decides what appears where the effect reaches past the
  edge of the picture, for example in a pinch or in waves along the border:
  **Mirror** reflects the picture, **Clamp** repeats the border pixels as
  streaks, **Transparent** leaves those places empty. All three effects have it.

### One idea: move where each pixel reads

<figure class="docs-shot docs-shot--graph">

![The Twirl graph from left to right: Parameters and Input Frame, then Centre, Shape & Radius, Twirl Angle, Premultiplied Source (cached), Frame Edges & Sampling, Straight Alpha Output and Output; the Constants and Coordinates folders are hidden](assets/effects/graphs/twirl.webp)

<figcaption>Twirl as it opens in the Node Workspace, with the Constants and Coordinates & Resources folders left out of the picture.</figcaption>
</figure>

A distortion does not move pixels. Every pixel of the result asks: which spot
of the original do I show? Change that spot and the picture bends. To see the
graph, select the clip and open the **Nodes** tab; the arrow on a folder card
opens it.

- **Centre, Shape & Radius** measures each pixel's **Offset** from the centre
  and its **Distance / Radius**: 0 in the middle, 1 at the edge of the area.
- The middle folder is the effect itself: **Twirl Angle**, **Bulge & Pinch
  Curve** or **Wave Displacement**. It turns the offset into a **Read Position**.
- **Frame Edges & Sampling** reads the picture once at that position.
  **Premultiplied Source** and **Straight Alpha Output** around it keep
  transparent edges clean.

Bulge & Pinch and Twirl differ only in the middle folder.

### Twirl: a turn that fades out

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Twirl Angle folder opened. Top row: the stub Distance / Radius, Minimum, Subtract, Multiply, the stub Twist and a second Multiply that outputs Turn Angle. Bottom row: the stub Offset, Rotate UV, the stub Shape Scale, Divide, the stub Centre and Add, which outputs Read Position](assets/effects/graphs/twirl-angle.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 461" aria-hidden="true" focusable="false">
<defs><marker id="twirl-angle-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M420 283 L420 199" marker-end="url(#twirl-angle-arrow)" />
<circle class="docs-shot-number" cx="420" cy="283" r="18" /><text x="420" y="283" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M922 283 L922 199" marker-end="url(#twirl-angle-arrow)" />
<circle class="docs-shot-number" cx="922" cy="283" r="18" /><text x="922" y="283" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>Twirl's Twirl Angle folder. Green cards are values from outside the folder. 1 — the Multiply that squares the falloff. 2 — the Multiply that makes Turn Angle.</figcaption>
</figure>

**Minimum**, **Subtract** and the first **Multiply** (1) turn the distance into
a falloff: full strength in the middle, fading in a soft curve to nothing at the
edge of the area. The second **Multiply** (2) scales it by **Twist** into the
**Turn Angle**. **Rotate UV** turns the offset by that angle, and **Divide** and
**Add** turn the result back into a position in the picture.

Remix: connect the output of **Subtract** straight to input **B** of the
Multiply (2), in place of the cable from Multiply (1). The turn then fades in a
straight line instead of a curve, and the swirl stays strong further out.

### Wave: two sine waves

<figure class="docs-shot docs-shot--graph">

![The Wave Displacement folder opened. Top row: UV, Split Vector, Horizontal Waves, two Multiply nodes, Phase, Add, Sine, Horizontal Height, Multiply and Add. Bottom row: Vertical Waves, two Multiply nodes, Add, Sine, Vertical Height, Multiply, Add and Combine Vector, which outputs Read Position](assets/effects/graphs/wave-displacement.webp)

<figcaption>Wave's Wave Displacement folder. Top row: the up-and-down ripples. Bottom row: the sideways ripples.</figcaption>
</figure>

The top row moves the picture up and down. **Split Vector** splits the
position into X and Y. X times **Horizontal Waves** (and 2π) plus **Phase** goes
into a **Sine**; the **Multiply** after **Horizontal Height** scales that wave,
and **Add** shifts Y by it. The bottom row does the same along Y with the
vertical controls and shifts X. **Combine Vector** joins both into the **Read
Position**. Phase grows with Speed over time, so the waves travel.

Remix, a water reflection: in the top row, add a **Multiply** node between the
**Sine** and the Multiply after it, and connect the **Y** output of **Split
Vector** to its second input. Y runs from 0 at the top of the picture to 1 at
the bottom, so the ripples are calm at the top and strongest at the bottom.

### The other distort effects

Fisheye Lens is an editable graph too, in a single pass: **Lens Projection**,
**Frame Edges**, **Chromatic Aberration** and **Lens Resolve**, which averages
its edge samples. Lens Correction, Guided Perspective and AI Edge Fill are fixed
shaders with their own controls and have no node graph.

## Technical details

Notes for developers. The recipes live in
`src/services/operators/uvDistortRecipes.ts`; more in
[Effects: editable UV distortions](./Effects.md#editable-uv-distortions),
[Fisheye Lens](./Effects.md#fisheye-lens),
[Lens Correction](./Effects.md#lens-correction),
[Guided Perspective](./Effects.md#guided-perspective),
[Node Catalog](./Node-Catalog.md) and
[Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Formulas.** With p the offset from the centre and r = |p| / Radius:
  Bulge & Pinch reads p × exp(−β (1 − r²)²) for r < 1, with
  β = 1.232 × max(Amount − 1, 0) − 0.95 × clamp(1 − Amount, 0, 1); a pinch stays
  above β = −1, so it never folds the picture. Twirl turns p by
  Twist × (1 − min(r, 1))² radians. Wave adds sin(2π × Horizontal Waves × x + φ) ×
  Horizontal Height to y, then sin(2π × Vertical Waves × y + φ) × Vertical Height
  to x, with φ = Phase (converted to radians) + 2π × Speed × time in seconds.
- **Units.** Shape Circle measures Radius in units of the shorter frame side
  (0.5 = half of it), so circles stay round and match at every resolution;
  Stretch to Frame measures each axis in its own 0–1 range. Twist is stored in
  radians (default 2, range ±4π) and only the inspector shows degrees; keyframes
  and tools use radians. Wave heights are fractions of the picture per axis, so
  equal values give different pixel shifts on a 16:9 frame.
- **Sampling.** The frame is premultiplied into an `rgba16float` cache, read
  with one bilinear sample at the read position and unpremultiplied: two passes,
  and transparent edges keep their colour. Frame Edges mirrors, clamps or clears
  samples outside the frame; Transparent fades over one source pixel by lowering
  alpha only. One sample per pixel means very strong Twist (above about 10 rad),
  dense waves and strong pinches alias; an Amount of about 8 shows soft
  magnified pixels.
- **Zero strength.** Amount 1, Twist 0 or both Wave heights 0 skip the built-in
  recipe, so the picture passes through exactly.
- **Fisheye Lens.** One pass with up to 8 samples per pixel. Each sample is
  premultiplied as it is read and the average is unpremultiplied, so lens and
  frame feathering lower coverage instead of darkening colour; the worker CPU
  path matches. The hardware filter still mixes straight texels across a
  transparent edge inside the source (about one source pixel).
- **Lens Correction.** Beyond the radius where strong correction would fold the
  picture back, pixels stay transparent with a one-pixel soft edge and a
  warning. The fringe channels sample the clamped border, and the frame edge is
  anti-aliased. Cut-outs in the source are read with straight-alpha bilinear
  filtering, like any layer transform.
- **Guided Perspective.** Strength blends the normalized homography towards the
  identity, so lines stay straight at any value. A degenerate matrix gives a
  transparent frame and a warning instead of invalid pixels.
- **AI Edge Fill.** Missing or non-numeric placements fall back to finite values
  and a zero-area placement no longer divides by zero.
- **Warnings.** Clamped or degenerate values (Radius ≤ 0, negative Amount,
  out-of-range Fisheye values, Lens Correction folding, Guided Perspective
  limits) appear below the effect in the inspector and in the `addEffect` /
  `updateEffect` tool results.
- **Saved projects.** They open with their settings. Untouched Wave, Twirl and
  Bulge graphs load as the current recipes with Stretch to Frame and Clamp, so
  Wave and Twirl look as before; Bulge & Pinch gets the smooth curve. Untouched
  Fisheye graphs of the earlier recipe are recognized by a frozen fingerprint
  and load as the current one; edited graphs stay as saved. Guided Perspective
  below Strength 100 renders the straight-line blend.
