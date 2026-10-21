# Distort Effects

Effects that bend, swirl or straighten the picture: playful lens looks and
corrections for photos. Add one in **Properties → Effects → + Add Effect → Lens & Distort**.

Every distortion looks the same in the preview and the export, and pictures with
transparency (titles, logos, keyed footage) keep clean edges without a dark rim.

## The distort effects

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

Known limitations: AI Edge Fill has no picture here because it needs a generated
fill. Very strong Twist, Wave with many tiny waves, or a strongly squeezed picture
can shimmer on fine detail, because each pixel is read once.

Saved projects: they open with their settings. Bulge & Pinch gets its smoother
edge, Fisheye Lens loses the dark rim at transparent edges, and Guided
Perspective keeps lines straight below full Strength.

<div class="docs-float-end"></div>
<!-- docs agent: middle and technical levels go here -->
