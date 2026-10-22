# Lens Correction

Repairs what a camera lens does to a picture: bowed lines, coloured fringes along hard edges and dark corners.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare docs-shot--float-left">

![The rainy night street as a strong wide-angle lens bends it, original left and with Lens Correction right: on the left the shop fronts at both edges bow outward like a barrel; on the right they stand straight and upright, the street runs straight to the vanishing point and the picture is slightly enlarged](../assets/effects/lens-correction.webp)

<figcaption>Left: a shot from a strong wide-angle lens. Right: Distortion −28, Scale 120 (the Action Cam preset).</figcaption>
</figure>

**Use it for:** straight walls, door frames and horizons in wide-angle or action-cam shots · a photo of the set that has to line up with its real edges in a projection · colour fringes and dark corners from a cheap or very wide lens.

- **Distortion** – straightens lines that bow: below 0 for a wide lens, above 0 for a long one.
- **Scale** – zooms in or out after the correction.
- **Framing** – keeps the frame size or shows the whole photo.
- **Amount** (Vignette) – lifts dark corners.

**Tip:** put Lens Correction first in the effect stack, before [Guided Perspective](./guided-perspective.md) and every look. Lines that still lean after it come from the camera's tilt, not from the lens: Guided Perspective straightens those.

<div class="docs-float-end"></div>

## Presets

<figure class="docs-shot docs-shot--detail">

![The bent night street four times, labelled: Wide Angle with the shop fronts half straightened, Action Cam with them straight and upright and the picture slightly enlarged, Whole Photo with the corrected street shrunk into a cushion shape whose empty edges show blue, Even Corners with the street still bent and its dark corners a little brighter](../assets/effects/presets/lens-correction.webp)

<figcaption>The four presets on the shot from a strong wide-angle lens. Blue: the empty edges Whole Photo leaves.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A preset sets the lens to Manual; a control with keyframes keeps them, and the card says so.

**Wide Angle** – Distortion −14: the gentle bow of a 16–24 mm lens or a phone's wide camera. The frame stays full, the outer edge is cropped a little.

**Action Cam** – Distortion −28 and Scale 120: the strong barrel of an action camera or a very wide zoom. Scale enlarges the picture into the part that comes out straight.

**Whole Photo** – Distortion −14 with Framing on Fit entire photo: the same correction as Wide Angle, but nothing is cropped. The picture shrinks into a cushion shape with empty, transparent edges; fill them with [AI Edge Fill](./ai-edge-fill.md) or a background track.

**Even Corners** – Amount 40, Midpoint 30: lifts dark lens corners without touching the geometry. Good for photos of a white cyc or a projection surface that should look evenly lit.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Lens Correction card: the Preset menu showing Action Cam, the Lens menu on Manual, the Geometry section with Framing on Original size, Distortion −28, Fine Distortion 0, Scale 120 and Center X and Y 0.5, the folded Chromatic aberration section and the Vignette section with its switch, Amount and Midpoint, beside a strip of the preview with the straightened night street](../assets/effects/editor/lens-correction-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 921" aria-hidden="true" focusable="false">
<defs><marker id="lens-correction-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 282 L649 282" marker-end="url(#lens-correction-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="282" r="18" /><text x="565" y="282" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M588 376 L672 376" marker-end="url(#lens-correction-inspector-arrow)" />
<circle class="docs-shot-number" cx="588" cy="376" r="18" /><text x="588" y="376" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M562 480 L646 480" marker-end="url(#lens-correction-inspector-arrow)" />
<circle class="docs-shot-number" cx="562" cy="480" r="18" /><text x="562" y="480" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M486 517 L636 517" marker-end="url(#lens-correction-inspector-arrow)" />
<circle class="docs-shot-number" cx="486" cy="517" r="18" /><text x="486" y="517" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M582 593 L666 593" marker-end="url(#lens-correction-inspector-arrow)" />
<circle class="docs-shot-number" cx="582" cy="593" r="18" /><text x="582" y="593" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Lens Correction with the Action Cam preset. 1 — Preset: pick a starting point. 2 — Lens: a measured lens or Manual. 3 — Framing: keep the size or show the whole photo. 4 — Distortion: straightens bowed lines. 5 — Scale: zooms in or out.</figcaption>
</figure>

**Preset** – a starting point for the whole card; see [Presets](#presets).

Every number can be keyframed. Work on a frame with long straight lines (a door frame, the edge of a stage, a horizon) and watch those lines while you drag.

### Lens profile

**Lens** – a measured lens or Manual. Manual leaves the picture alone until you set the controls below. **Canon EF 24-105mm f/4L IS USM** (the original EF lens, not the II or RF versions) applies measured corrections for its distortion, colour fringes and dark corners; on a Canon raw photo (CR2) it reads the focal length and aperture from the file, and the card shows the lens it found. The manual controls add to the profile. Manual, Canon EF 24-105mm f/4L IS USM, default Manual.

The next four rows appear only with a measured lens.

**Focal Length** – the zoom setting the picture was taken at. The profile's distortion changes a lot along the zoom: barrel at 24 mm, almost none around 40 mm, a slight inward bow at 105 mm. 24 to 105 mm, default 24 mm.

**Aperture** – the f-number the picture was taken at. It changes only the dark corners: they are darkest wide open at f/4 and get lighter as the lens is stopped down. f/4 to f/22, default f/4.

**Focus Distance** – how far away the camera was focused, in metres. It also changes only the dark corners, and only a little; leave it at 1000 m (as good as infinity) when you do not know it. 0.45 to 1000 m, default 1000 m.

**Sensor Crop** – how much smaller the camera's sensor is than full frame: 1 for a full-frame camera, 1.6 for a Canon APS-C body. A smaller sensor sees only the middle of the lens, so the correction is weaker. 1× to 2×, default 1×.

### Geometry

**Framing** – what happens to the edges. **Original size** keeps the frame as it is; correcting a barrel pulls the outer picture inward, so a little of the edge is cropped. **Fit entire photo** shrinks the corrected picture until every pixel of the original is visible again and leaves the free edges transparent; the Scale row is hidden meanwhile, since the fit sets the size. It shows the whole photo up to about Distortion −14; beyond that the fold below cuts off the outer corners, and the card says so. Original size or Fit entire photo, default Original size.

**Distortion** – straightens lines that bow. Below 0 pulls the outer picture inward: lines that bulge outward like a barrel (wide lenses, action cameras) become straight. Above 0 pushes it outward: lines that pinch inward (long lenses) become straight, and empty edges appear that Scale can crop. −5 to −15 fixes a typical wide lens, −25 to −30 an action camera. Below about −33 the correction folds the outer picture back on itself: the area beyond the fold stays transparent, and the card says so. −100 to 100, default 0.

**Fine Distortion** – the same kind of correction, but it acts mostly at the outer edge and leaves the middle alone. Use it after Distortion when the middle is straight and the edges still bend, the "moustache" bow of some wide lenses. Below about −20 it folds the edge like Distortion. −50 to 50, default 0.

**Scale** – zooms the corrected picture in or out around the lens centre, in percent. Above 100 crops empty or still bent edges, below 100 shows more and leaves transparent edges. 50 to 200, default 100.

**Center X** – where the middle of the lens lies across the frame, as a share of the width (0.5 is the middle). Move it for a photo that was cropped off-centre or shot with a shifted lens, until the bow is the same on both sides. 0 to 1, default 0.5.

**Center Y** – the same from top to bottom (0 is the top edge). 0 to 1, default 0.5.

### Chromatic aberration

**Red/Cyan** – removes red or cyan edges along hard contrast, which grow towards the corners. It enlarges or shrinks the red picture a little around the lens centre; try one direction, and if the fringe gets wider, go the other way. 1–3 fixes most lenses, 20 moves red by about 2 % of the distance to the centre (about 20 px in the corners of an HD frame). −20 to 20, default 0.

**Blue/Yellow** – the same for blue or yellow edges, with the blue picture. −20 to 20, default 0.

### Vignette

**Vignette Correction** – the switch in the **Vignette** header. Off turns off both the measured corner correction of a lens profile and Amount, and keeps their values for when you switch it on again. Distortion and fringe correction go on working. On or off, default on.

**Amount** – brightens or darkens towards the corners. Above 0 lifts dark lens corners, below 0 adds a dark vignette. 100 makes the corners two stops (4×) brighter, which already burns out a bright sky; 20–50 is typical. −100 to 100, default 0.

**Midpoint** – where the brightening starts, from the middle (0) to the corners (100). Low values spread it over the whole frame, high values keep it to the very corners; at 100 Amount has almost nothing left to act on. 0 to 100, default 50.

## Node setup

Lens Correction is one fixed shader with its own card: it has no node graph to open. For every pixel of the result it works out how far the pixel lies from the lens centre, looks up where that point lay in the bent picture (the measured profile and Distortion, Fine Distortion and Scale), reads the red and the blue picture a little further in or out (the fringe controls), and brightens it towards the corners (Vignette).

## Technical details

- **Units.** Distortion and Fine Distortion are coefficients of r² and r⁴ in percent, where r is the distance from the lens centre and 1 the distance of the frame corner. The fringe controls scale the red or blue channel by 0.1 % per step. Amount 100 brightens the corner by two stops.
- **Profile.** The measured lens uses Lensfun calibrations (PTLens distortion, poly3 lateral fringes, PA vignetting), interpolated across focal length, aperture and focus distance; values outside the calibration use its nearest end. The vignetting correction acts on linear light.
- **Empty edges.** Areas the corrected picture no longer covers are transparent. A correction strong enough to fold the picture back on itself stops at the fold, with a one-pixel soft edge; the card and the tool results say so.
- **Edges.** The fringe channels repeat the border pixel, so no coloured line runs along the frame. Cut-outs in the source keep their transparency.
- **Saved projects.** Projects keep their values. With Fit entire photo the fit alone sets the size: a Scale kept from Original size, whose row is hidden, does not shrink the picture.
- Corrections are saved with the effect and applied in the export.
- **More:** [Effect system: Lens Correction](../Effect-System.md#lens-correction) · [Guided Perspective](./guided-perspective.md) · [AI Edge Fill](./ai-edge-fill.md).
