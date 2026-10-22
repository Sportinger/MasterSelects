# Fisheye Lens

The rounded look of an ultra-wide fisheye lens: the middle comes closer and straight lines bend towards the edges.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare docs-shot--float-left">

![The rainy night street with neon signs, original left and with Fisheye Lens right: on the right the walker with the umbrella comes close and large, and the shop front at the left bows outward in one strong curve from top to bottom](../assets/effects/fisheye.webp)

<figcaption>Left: original. Right: the Skate Fisheye preset.</figcaption>
</figure>

**Use it for:** a skate-video or peephole look · a porthole, crystal ball or spy-hole frame · flattening footage from a real fisheye lens.

- **Strength** – how far the picture bends; below 0 it flattens instead.
- **Field of View** – how wide the imagined lens sees: wider looks rounder.
- **Lens Radius** – the size of the lens circle: 1 or less shows a round image circle.
- **Outside Lens** – keeps the picture around the circle or makes it transparent.

**Tip:** Fisheye Lens bends the whole frame like a lens and keeps the corners in place; [Bulge & Pinch](./bulge.md) changes one round area and leaves the rest of the picture untouched ([which one?](../Effects-Distort.md#which-one)). Give the subject room in the middle of the frame. For a round frame on another track, pick **Peephole**.

<div class="docs-float-end"></div>

## Presets

<figure class="docs-shot docs-shot--detail">

![The night street five times, labelled: Wide Angle with the shop fronts gently bowed, Skate Fisheye with the walker large in the middle, the fronts curving hard and darker corners, Crystal Ball with the walker inside a glass ball in the middle of the unchanged street, Peephole with the whole street small and bent inside a dark-rimmed circle alone on blue, and Flatten Fisheye with the street pulled flat and stretched towards the corners](../assets/effects/presets/fisheye.webp)

<figcaption>The five presets on the night street. Blue: the transparent outside of Peephole.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so. A preset also puts **Edge Sampling** back to 4: set it again for a final render at 8.

**Wide Angle** – Strength 0.5, Field of View 120°: a gentle bow, like a 14 mm lens or a phone's ultra-wide camera. The frame stays full.

**Skate Fisheye** – Field of View 165°, Curve Bias −1, Lens Vignette 0.4: the hard bend of a skate or music video. The middle comes close, the sides curve round and the corners darken. Keep the subject near the camera and in the middle.

**Crystal Ball** – Stereographic, Field of View 160°, Lens Radius 0.9, Lens Feather 0.04, Color Fringe 0.012: a round glass ball in the middle of the unchanged picture, with a soft rim and a touch of colour fringe.

**Peephole** – Field of View 170°, Lens Radius 0.95, Zoom 0.25, Frame Edges Mirror, Outside Lens Transparent, Lens Feather 0.03, Lens Vignette 0.6 and Softness 0.35: the view through a door's spy-hole. The whole scene sits small and bent inside a circle with a dark rim, alone on a transparent frame; Mirror fills the far edge of the circle without streaks. Put a background or a black solid on the track below.

**Flatten Fisheye** – Strength −1, Field of View 120°, Zoom 1.5: the other direction, for footage from a real fisheye or action camera. It pulls the bowed lines straight and zooms in until the frame is full again. On normal footage it stretches the corners outward.

## Controls

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![The Fisheye Lens card in Properties → Effects on the Crystal Ball preset: the Lens section with Projection Stereographic, Strength 1, Field of View 160° and Curve Bias 0, the Framing section with Lens Radius 0.9, Zoom, Center X and Y, Squeeze, Lens Rotation and Round Lens, the Edges section with Lens Feather 0.04, and the Optics and Quality sections below](../assets/effects/editor/fisheye-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 1287" aria-hidden="true" focusable="false">
<defs><marker id="fisheye-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M50 106 L195 106" marker-end="url(#fisheye-inspector-arrow)" />
<circle class="docs-shot-number" cx="50" cy="106" r="18" /><text x="50" y="106" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M50 219 L205 219" marker-end="url(#fisheye-inspector-arrow)" />
<circle class="docs-shot-number" cx="50" cy="219" r="18" /><text x="50" y="219" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M50 300 L181 300" marker-end="url(#fisheye-inspector-arrow)" />
<circle class="docs-shot-number" cx="50" cy="300" r="18" /><text x="50" y="300" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M50 465 L184 465" marker-end="url(#fisheye-inspector-arrow)" />
<circle class="docs-shot-number" cx="50" cy="465" r="18" /><text x="50" y="465" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M50 872 L178 872" marker-end="url(#fisheye-inspector-arrow)" />
<circle class="docs-shot-number" cx="50" cy="872" r="18" /><text x="50" y="872" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Fisheye Lens with the Crystal Ball preset. 1 — Preset: pick a starting point. 2 — Projection: the lens model. 3 — Field of View: how wide the lens sees. 4 — Lens Radius: the size of the lens circle. 5 — Lens Feather: softens the rim of the circle.</figcaption>
</figure>

**Preset** – a starting point for every control; see [Presets](#presets).

### Lens

**Projection** – the lens model: how distance from the middle turns into a viewing angle. **Equidistant** is the classic, even fisheye. **Equisolid Angle** is the model of most real fisheye lenses and bends a little less. **Stereographic** keeps shapes near the rim rounder and fuller. **Orthographic** squeezes the rim hardest, like a reflection in a mirror ball. Equidistant, Equisolid Angle, Stereographic, Orthographic, default Equidistant.

**Strength** – how far the picture bends. 1 is the full lens, 0.5 halfway, 0 leaves the picture untouched. Below 0 it bends the other way: it flattens the bowed lines of a real fisheye shot and pulls the corners inward, so the edges beyond the picture show (see **Frame Edges**). Animate it from 0 for a picture that swells into a fisheye. −1 to 1, default 1.

**Field of View** – how wide the imagined lens sees. 90° is a soft bow, the default 140° brings the middle about twice as close, and towards 175° the middle grows very large and gets soft, because it enlarges a small part of the picture. 20° is almost flat. 20 to 175°, default 140°.

**Curve Bias** – shifts the bend between the middle and the edges. Below 0 the middle stays smaller and sharper and the curve moves to the sides; above 0 the middle swells further and the edges squeeze together. −1 to 1, default 0.

### Framing

**Lens Radius** – the size of the lens circle: 1 makes a circle as tall as the picture, 2.1 just reaches the corners of a 16:9 frame, so the whole frame is lens. Up to 1 you see a round image circle and the picture around it (see **Outside Lens**). 0.1 to 3, default 2.1.

**Zoom** – enlarges or shrinks the picture inside the lens. Below 1 you see more around the middle and, at the edges, what lies beyond the picture; above 1 the middle fills the lens. 0.25 to 4, default 1.

**Center X** – where the middle of the lens sits across the frame: 0 is the left edge, 1 the right. Move it to put the bulge on a face that is not in the middle. 0 to 1, default 0.5.

**Center Y** – where the middle of the lens sits from top (0) to bottom (1). 0 to 1, default 0.5.

**Squeeze** – stretches the lens into an oval. Above 1 it gets narrower and taller, below 1 wider and flatter; 2 is like an anamorphic lens. 0.25 to 4, default 1.

**Lens Rotation** – turns the oval of **Squeeze** or of an oval lens (Round Lens off). A round lens looks the same at every angle. −180 to 180°, default 0°.

**Round Lens** – on, the lens is a circle in the picture. Off, it stretches with the frame into an oval as wide as the picture, so a 16:9 frame bends more across than up and down. A switch, on or off, default on.

### Edges

**Outside Lens** – what shows around the lens circle when Lens Radius is small enough to see its rim. **Original Image** keeps the unbent picture around it; **Transparent** cuts the circle out, for a porthole over another track. Original Image, Transparent, default Original Image.

**Lens Feather** – softens the rim of the lens circle, as a share of its radius: 0 is a hard edge, 0.05 a clean but smooth one, 0.5 a wide, dreamy fade. 0 to 0.5, default 0.05.

**Frame Edges** – what appears where the lens reads beyond the picture: with negative Strength, Zoom below 1 or an off-centre lens. **Transparent** leaves those places empty, **Clamp** repeats the border pixels as streaks, **Mirror** reflects the picture and **Repeat** tiles it. Transparent, Clamp, Mirror, Repeat, default Transparent.

**Edge Feather** – with Frame Edges on Transparent, softens the border of the picture, as a share of the frame: 0.005 takes the stair-steps off, 0.1 is a wide fade. 0 to 0.1, default 0.005.

### Optics

**Color Fringe** – the coloured edges of a cheap or very wide lens: red is pushed outward, blue inward, more the farther from the middle. 0.005 is a hint, 0.012 clearly visible on lights near the edge, 0.05 a strong glitchy split. 0 to 0.05, default 0.

**Lens Vignette** – darkens the picture towards the lens rim. With the default Lens Radius the rim sits at the corners, so only the corners darken; with a smaller lens it rings the circle. 0 to 1, default 0.

**Softness** – how far in from the rim the darkening of **Lens Vignette** starts: 0.01 is a thin dark ring at the rim, 1 a fade from the very middle. 0.01 to 1, default 0.25.

### Quality

**Edge Sampling** – in the **Quality** section, which starts closed. How many reads each pixel averages, a little apart, so the lens rim and fine bent lines stay smooth. 1 is the fastest and shows stair-steps at the rim, 4 is smooth, 8 helps on fine detail at strong settings. Every step from 1 to 8 counts. A preset puts it back to 4. 1 to 8, default 4.

<div class="docs-float-end"></div>

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Fisheye Lens graph from left to right: Edge Sampling hands the Sample Position to Lens Projection and Lens Resolve; Input Frame feeds Frame Edges; Lens Projection and Frame Edges feed Chromatic Aberration, whose Lens Colour goes to Lens Resolve, which gives the Fisheye Image. Each stage lists the controls it reads as inputs](../assets/effects/graphs/fisheye.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 897" aria-hidden="true" focusable="false">
<defs><marker id="fisheye-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M22 166 L74 166" marker-end="url(#fisheye-arrow)" />
<circle class="docs-shot-number" cx="22" cy="166" r="18" /><text x="22" y="166" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M404 22 L404 97" marker-end="url(#fisheye-arrow)" />
<circle class="docs-shot-number" cx="404" cy="22" r="18" /><text x="404" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M404 874 L404 790" marker-end="url(#fisheye-arrow)" />
<circle class="docs-shot-number" cx="404" cy="874" r="18" /><text x="404" y="874" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M648 214 L648 298" marker-end="url(#fisheye-arrow)" />
<circle class="docs-shot-number" cx="648" cy="214" r="18" /><text x="648" y="214" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M893 157 L893 241" marker-end="url(#fisheye-arrow)" />
<circle class="docs-shot-number" cx="893" cy="157" r="18" /><text x="893" y="157" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Fisheye Lens opened in the Nodes tab (the Fisheye Parameters, Constants and Coordinates & Resources folders and the Output card left out). 1 — Edge Sampling: where each read sits. 2 — Lens Projection: where it looks through the lens. 3 — Frame Edges: what lies beyond the picture. 4 — Chromatic Aberration: red, green and blue apart. 5 — Lens Resolve: vignette, lens circle and average.</figcaption>
</figure>

Fisheye Lens works in five stages, one folder each in the Nodes tab: **Edge Sampling** places each pixel's reads a little apart, **Lens Projection** works out where each read looks through the lens, **Frame Edges** decides what is read beyond the picture, **Chromatic Aberration** reads red, green and blue at their own places, and **Lens Resolve** adds the vignette, blends the lens with what is outside it and averages the reads. All of it runs in one pass. The picture leaves out the Fisheye Parameters, Constants and Coordinates & Resources folders: the controls arrive at the stages under their card names. Click a folder's header to open it.


### Edge Sampling

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Edge Sampling folder: Sequence Index feeds Eight Sample Offsets; Edge Sampling is compared with One by Greater Than, and a Switch picks the offset or a zero vector; Multiply scales it by one over the Resolution (Divide), and Add puts it onto the UV as the Sample Position](../assets/effects/graphs/fisheye-edge-sampling.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1084" aria-hidden="true" focusable="false">
<defs><marker id="fisheye-edge-sampling-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M479 813 L395 813" marker-end="url(#fisheye-edge-sampling-arrow)" />
<circle class="docs-shot-number" cx="479" cy="813" r="18" /><text x="479" y="813" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M509 141 L509 225" marker-end="url(#fisheye-edge-sampling-arrow)" />
<circle class="docs-shot-number" cx="509" cy="141" r="18" /><text x="509" y="141" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M703 500 L703 416" marker-end="url(#fisheye-edge-sampling-arrow)" />
<circle class="docs-shot-number" cx="703" cy="500" r="18" /><text x="703" y="500" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M897 141 L897 225" marker-end="url(#fisheye-edge-sampling-arrow)" />
<circle class="docs-shot-number" cx="897" cy="141" r="18" /><text x="897" y="141" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Edge Sampling. 1 — Eight Sample Offsets: the pattern of reads. 2 — Switch: no offset for a single read. 3 — Multiply: from pixels to picture coordinates. 4 — Add: the Sample Position.</figcaption>
</figure>

Sequence Index counts the reads of one pixel, 0 to Edge Sampling − 1.

**Eight Sample Offsets** – picks the read's offset from a fixed pattern of eight points within the pixel. They come in opposite pairs, so every even count stays centred on the pixel. Its › opens the pattern.

**Switch** – with Edge Sampling at 1 (Greater Than compares it with One), the single read takes no offset and sits in the middle of the pixel.

**Multiply** – turns the offset from pixels into picture coordinates: one pixel is 1 divided by the Resolution.

**Add** – the pixel's own position plus the offset: the Sample Position every later stage works from.

### Lens Projection

<figure class="docs-shot docs-shot--graph docs-shot--float-right">

<div class="docs-shot-stage">

![Inside the Lens Projection folder: Sample Position, Frame Aspect, Lens Rotation, Lens Radius and the centre feed Image to Lens Coordinates; its distance from the centre, Field of View in radians and Projection feed Projection Model; Greater Than checks Strength; Radius Curve and Zoom takes the result with Curve Bias, Strength and Zoom](../assets/effects/graphs/fisheye-lens-projection.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 1359" aria-hidden="true" focusable="false">
<defs><marker id="fisheye-lens-projection-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M369 621 L285 621" marker-end="url(#fisheye-lens-projection-arrow)" />
<circle class="docs-shot-number" cx="369" cy="621" r="18" /><text x="369" y="621" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M363 22 L363 86" marker-end="url(#fisheye-lens-projection-arrow)" />
<circle class="docs-shot-number" cx="363" cy="22" r="18" /><text x="363" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M228 1109 L228 1025" marker-end="url(#fisheye-lens-projection-arrow)" />
<circle class="docs-shot-number" cx="228" cy="1109" r="18" /><text x="228" y="1109" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M498 381 L498 465" marker-end="url(#fisheye-lens-projection-arrow)" />
<circle class="docs-shot-number" cx="498" cy="381" r="18" /><text x="498" y="381" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Lens Projection, reduced to its stages (Center X, Center Y, Squeeze and Round Lens left out). 1 — Image to Lens Coordinates: into the lens. 2 — Projection Model: the bend. 3 — Greater Than: which direction. 4 — Radius Curve and Zoom: the Read Distance.</figcaption>
</figure>

**Image to Lens Coordinates** – moves the read position into the lens: measured from the lens centre, made round (Round Lens), turned (Lens Rotation), squeezed (Squeeze) and scaled so the lens rim lies at 1. It hands on the distance from the centre and the direction.

**Projection Model** – the heart of the lens. For a positive Strength it turns the distance into a viewing angle with the chosen Projection and back into a distance of a flat picture: the middle comes closer, the edges squeeze. For a negative Strength it runs the other way. Its › opens the four models.

**Greater Than** – checks whether Strength is below 0 and so picks the direction of the Projection Model.

**Radius Curve and Zoom** – bends the result with Curve Bias, mixes it with the unbent distance by Strength and divides it by Zoom: the Read Distance.

**Remix:** for a lens that bends harder, open the **Constants** folder and set Curve Scale from 0.35 to 0.7: Curve Bias then reshapes the lens twice as strongly in both directions.

### Frame Edges

<figure class="docs-shot docs-shot--graph docs-shot--float-right">

<div class="docs-shot-stage">

![Inside the Frame Edges folder: Frame feeds Premultiplied Source; UV and Frame Edges feed Frame Coordinate Modes; Frame Coverage takes the premultiplied picture, the remapped position, the UV and Edge Feather; Greater Than checks Frame Edges and a Switch picks between the two Frame Coverage results](../assets/effects/graphs/fisheye-frame-edges.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 1063" aria-hidden="true" focusable="false">
<defs><marker id="fisheye-frame-edges-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M446 170 L382 170" marker-end="url(#fisheye-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="446" cy="170" r="18" /><text x="446" y="170" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M446 390 L382 390" marker-end="url(#fisheye-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="446" cy="390" r="18" /><text x="446" y="390" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M279 1041 L279 957" marker-end="url(#fisheye-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="279" cy="1041" r="18" /><text x="279" y="1041" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M482 542 L482 626" marker-end="url(#fisheye-frame-edges-arrow)" />
<circle class="docs-shot-number" cx="482" cy="542" r="18" /><text x="482" y="542" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Frame Edges. 1 — Frame Coordinate Modes: Clamp, Mirror or Repeat. 2 — Premultiplied Source: clean transparent edges. 3 — Frame Coverage: the soft empty border. 4 — Switch: which of them.</figcaption>
</figure>

**Frame Coordinate Modes** – turns a read position beyond the picture into one inside it: clamped to the border, mirrored or repeated, after **Frame Edges**.

**Premultiplied Source** – multiplies each pixel's colour by its alpha, so a cut-out figure keeps clean edges when the lens averages its reads.

**Frame Coverage** – for Transparent, fades the picture to nothing at its border over Edge Feather, so the empty edges have a smooth rim.

**Switch** – takes Frame Coverage's picture for Transparent and the remapped picture for the other three choices.

<div class="docs-float-end"></div>

### Chromatic Aberration

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Chromatic Aberration folder, the red read: Color Fringe times the Distance from Centre, times it again (Multiply), plus one (Add); Direction times Read Distance, times that, goes into Restore Lens Coordinates, and Sample Image reads the Frame with Edges there](../assets/effects/graphs/fisheye-chromatic-aberration.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 830" aria-hidden="true" focusable="false">
<defs><marker id="fisheye-chromatic-aberration-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M369 83 L369 167" marker-end="url(#fisheye-chromatic-aberration-arrow)" />
<circle class="docs-shot-number" cx="369" cy="83" r="18" /><text x="369" y="83" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M508 83 L508 167" marker-end="url(#fisheye-chromatic-aberration-arrow)" />
<circle class="docs-shot-number" cx="508" cy="83" r="18" /><text x="508" y="83" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M787 479 L787 395" marker-end="url(#fisheye-chromatic-aberration-arrow)" />
<circle class="docs-shot-number" cx="787" cy="479" r="18" /><text x="787" y="479" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M926 83 L926 167" marker-end="url(#fisheye-chromatic-aberration-arrow)" />
<circle class="docs-shot-number" cx="926" cy="83" r="18" /><text x="926" y="83" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Chromatic Aberration, the red read. 1 — Multiply: the shift, growing towards the rim. 2 — Add: how much farther red reads. 3 — Restore Lens Coordinates: back to the picture. 4 — Sample Image: the red read.</figcaption>
</figure>

The picture shows the red read; blue mirrors it with Subtract, and green reads at the plain Read Distance.

**Multiply** – Color Fringe times the distance from the centre, squared: the fringe is zero in the middle and grows fast towards the rim.

**Add** – one plus that shift: the red read goes that much farther out than green (blue that much nearer).

**Restore Lens Coordinates** – turns the lens position back into a position in the picture, the reverse of Image to Lens Coordinates.

**Sample Image** – reads the picture from Frame Edges there.

Combine Chromatic Channels then takes red from the red read, green from the green one and blue from the blue one, with their average alpha; with Color Fringe at 0 a Switch keeps the single green read.

### Lens Resolve

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Lens Resolve folder: Vignette darkens the Lens Colour by Distance from Centre, Lens Vignette and Softness; a Switch picks Original or Transparent for the outside; Lens Coverage turns the distance and Lens Feather into the blend for Mix; the mixed picture goes through a second Switch into Average Samples with Edge Sampling, and Straight Alpha Output gives the Fisheye Image](../assets/effects/graphs/fisheye-lens-resolve.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1832" aria-hidden="true" focusable="false">
<defs><marker id="fisheye-lens-resolve-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M332 22 L332 106" marker-end="url(#fisheye-lens-resolve-arrow)" />
<circle class="docs-shot-number" cx="332" cy="22" r="18" /><text x="332" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M332 1291 L332 1207" marker-end="url(#fisheye-lens-resolve-arrow)" />
<circle class="docs-shot-number" cx="332" cy="1291" r="18" /><text x="332" y="1291" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M145 1779 L145 1695" marker-end="url(#fisheye-lens-resolve-arrow)" />
<circle class="docs-shot-number" cx="145" cy="1779" r="18" /><text x="145" y="1779" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M705 1361 L705 1445" marker-end="url(#fisheye-lens-resolve-arrow)" />
<circle class="docs-shot-number" cx="705" cy="1361" r="18" /><text x="705" y="1361" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M892 1361 L892 1445" marker-end="url(#fisheye-lens-resolve-arrow)" />
<circle class="docs-shot-number" cx="892" cy="1361" r="18" /><text x="892" y="1361" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Lens Resolve, reduced to its path. 1 — Vignette: the dark rim. 2 — Switch: the outside. 3 — Mix: lens and outside by Lens Coverage. 4 — Average Samples: the reads together. 5 — Straight Alpha Output: a normal picture.</figcaption>
</figure>

**Vignette** – darkens the lens picture towards the rim, by Lens Vignette, starting Softness in from the rim. It changes colour only, never transparency.

**Switch** – the picture around the lens: the original (Original Image) or transparent.

**Mix** – blends the outside with the lens picture by Lens Coverage: 1 inside the circle, fading to 0 across Lens Feather at the rim.

**Average Samples** – adds up the reads of Edge Sampling and divides by their number.

**Straight Alpha Output** – turns the averaged, premultiplied result back into a normal picture, so feathered rims lose coverage instead of turning dark.

## Technical details

- **Lens space.** Lens Radius is the circle's diameter in picture heights with Round Lens on (half of it is the radius the shader uses); Center X and Y are shares of the frame. The effect looks the same at every resolution.
- **Sampling.** One pass with 1 to 8 reads per pixel. Each read is premultiplied as it is taken and the average unpremultiplied, so lens and frame feathering lower coverage instead of darkening colour. Odd counts sit up to an eighth of a pixel off centre.
- **Colour fringes.** Each channel takes its colour from its own read and the averaged alpha, so a fringe across a cut-out never exceeds the source colour.
- **Software preview and export.** Without WebGPU the same recipe runs on the CPU, with the same reads.
- **Warnings.** Out-of-range values, unknown choices and an Edge Sampling that is no whole number are named below the effect and in the tool results.
- **Saved projects.** Untouched graphs of earlier recipes load as the current one; edited graphs stay as saved. A saved Edge Sampling of 2, 3, 5, 6 or 7 used to render 1 or 4 reads and now renders that many: a slightly smoother rim.
- **More:** [Effect system: Fisheye Lens](../Effect-System.md#fisheye-lens) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
