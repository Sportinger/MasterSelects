# Vignette

Darkens the edges and corners so the eye goes to the middle of the frame. Subtle, it calms busy edges; strong, it looks like an old lens, a follow spot or a keyhole.

Group: [Light & Stylize](../Effects-Stylize.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare docs-shot--float-left">

![The harbour town in daylight, original left and with Vignette at its default values right: the sky, the mountains and the boats darken softly towards all four corners, while the houses and the harbour in the middle keep their brightness](../assets/effects/vignette.webp)

<figcaption>Left: original. Right: the default values (Amount 0.5, Size 0.5, Softness 0.5, Roundness 1).</figcaption>
</figure>

**Use it for:** guiding the eye to a performer · an old-lens or memory look · softening the frame edge of a projection.

- **Amount** – how dark the edges get.
- **Size** – where the darkening begins: smaller values start it closer to the middle.
- **Softness** – how gradually it fades in.
- **Roundness** – 1 is a circle, 0 follows the shape of the frame.

**Tip:** keyframe **Size** of the **Iris** preset from 0 up to 0.7 to open the picture like an iris in a silent film.

<div class="docs-float-end"></div>

## Presets

<figure class="docs-shot docs-shot--detail">

![The dancer on a stage four times, labelled: Soft Frame with only the corners a little darker, Old Lens with dark corners that follow the frame, Spotlight with a round pool of light around the dancer and the stage almost black, Iris with a hard-edged black circle around her](../assets/effects/presets/vignette.webp)

<figcaption>The four presets on the dancer.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all four controls in one undo step, and the row shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Soft Frame** – barely noticeable: the corners settle a little and busy edges calm down, without the picture looking treated. A good default for almost any shot.

**Old Lens** – dark corners that follow the shape of the frame, like an old or wide-open lens. For memories, archive looks and night scenes.

**Spotlight** – a round pool of light in the middle and darkness around it, like a follow spot on a stage. It isolates a performer in the middle of the frame.

**Iris** – a hard black circle, the iris shot of silent film. Keyframe Size to open or close it at the start or end of a scene.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Vignette card: the Preset menu showing Spotlight, Amount 0.95, Size 0.12, Softness 0.5 and Roundness 1, beside a strip of the preview where the harbour town stays lit only in a round patch at the centre and fades to black towards every edge](../assets/effects/editor/vignette-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 422" aria-hidden="true" focusable="false">
<defs><marker id="vignette-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M639 224 L723 224" marker-end="url(#vignette-inspector-arrow)" />
<circle class="docs-shot-number" cx="639" cy="224" r="18" /><text x="639" y="224" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M631 274 L715 274" marker-end="url(#vignette-inspector-arrow)" />
<circle class="docs-shot-number" cx="631" cy="274" r="18" /><text x="631" y="274" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M625 334 L709 334" marker-end="url(#vignette-inspector-arrow)" />
<circle class="docs-shot-number" cx="625" cy="334" r="18" /><text x="625" y="334" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>Vignette with the Spotlight preset. 1 — Preset: pick a starting point. 2 — Amount: how dark the edges get. 3 — Softness: how gradually it fades in.</figcaption>
</figure>

**Preset** – a starting point for all four controls; see [Presets](#presets).

**Amount** – how dark the edges get. 0.3 is barely noticeable, the default 0.5 a clear but natural darkening, and at 1 the darkest part goes fully black, for a spotlight or an iris. Only the colour gets darker; transparent parts stay transparent. 0 to 1, default 0.5.

**Size** – where the darkening begins, measured from the middle (0) to the corners (1). At the default 0.5 it begins about where a circle would touch the top and bottom of a 16:9 frame; at 0.1–0.2 only the middle stays bright. The slider ends at 1, where the darkening starts at the corners and nothing darkens any more; the number field still takes up to 1.5 for Vignettes saved before 2026-10-21, and a Size of 1 or more that arrives from keyframes or the AI tools gets a note in the card. Animate it for an iris that opens or closes. 0 to 1, default 0.5.

**Softness** – how gradually the darkening fades in, from where Size begins to how far it reaches. At 1 it fades over the whole frame, gentle as a lens; around 0.5 it is a clear soft ring; at 0 it is a hard edge, only one and a half pixels wide, for an iris or a keyhole. Size plus Softness above 1 means the corners are only partly dark. 0 to 1, default 0.5.

<figure class="docs-shot docs-compare docs-shot--float-right" data-before="Roundness 1" data-after="Roundness 0">

![The harbour town with a strong Vignette twice: at Roundness 1 left the light falls in a circle that leaves the left and right thirds of the frame dark, at Roundness 0 right it is a wide oval that follows the frame and darkens mostly the corners](../assets/effects/vignette-roundness.webp)

<figcaption>Amount 1, Size 0.45, Softness 0.25. Left: Roundness 1, a circle. Right: Roundness 0, the shape of the frame.</figcaption>
</figure>

**Roundness** – the shape of the bright middle. At 1 it is a true circle on any frame, wide or portrait, like a spotlight. At 0 it is an oval that follows the frame and touches all four edges at once, so mostly the corners darken, like a lens. Values between blend the two; 0.5–0.7 looks the most natural on a wide frame. 0 to 1, default 1.

<div class="docs-float-end"></div>

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Vignette graph: Parameters feed Distance & Roundness and Falloff (Size, Softness, Amount); Distance & Roundness passes the Distance and the Half Diagonal to Falloff; Input Frame goes into Split RGB + Alpha; Multiply darkens the RGB by the Brightness Gain from Falloff; Anti-Banding Dither adds its noise to the Darkened Color; Clamp and Combine RGB + Alpha follow, with the alpha passed straight from Split RGB + Alpha](../assets/effects/graphs/vignette.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 707" aria-hidden="true" focusable="false">
<defs><marker id="vignette-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M230 64 L230 148" marker-end="url(#vignette-arrow)" />
<circle class="docs-shot-number" cx="230" cy="64" r="18" /><text x="230" y="64" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M369 64 L369 148" marker-end="url(#vignette-arrow)" />
<circle class="docs-shot-number" cx="369" cy="64" r="18" /><text x="369" y="64" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M648 349 L648 265" marker-end="url(#vignette-arrow)" />
<circle class="docs-shot-number" cx="648" cy="349" r="18" /><text x="648" y="349" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M508 22 L508 79" marker-end="url(#vignette-arrow)" />
<circle class="docs-shot-number" cx="508" cy="22" r="18" /><text x="508" y="22" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Vignette opened in the Nodes tab (Constants, Coordinates and the Output card left out). 1 — Distance & Roundness: how far each pixel is from the middle. 2 — Falloff: how much it darkens. 3 — Anti-Banding Dither: no steps in dark gradients. 4 — Multiply: the darkening itself.</figcaption>
</figure>

Vignette is one pass over the picture. **Distance & Roundness** measures how far each pixel is from the middle, with every corner at 1. **Falloff** turns that distance into a brightness gain from Size, Softness and Amount, and **Multiply** darkens the colour by it. **Anti-Banding Dither** adds a trace of noise where the gain changes, so a smooth dark background shows no rings. Clamp and Combine RGB + Alpha then put the untouched transparency back. Click a folder's header to open it.

### Distance & Roundness

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Distance & Roundness folder: Roundness is clamped to 0–1 and blends between Frame Scale (√2) and Circle Scale with a Subtract, a Multiply and an Add into the axis scale; Subtract takes the Centre (0.5, 0.5) from UV; a Multiply scales that offset per axis; Length measures it and Divide by the Corner Distance gives the Distance with every corner at 1](../assets/effects/graphs/vignette-distance.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 648" aria-hidden="true" focusable="false">
<defs><marker id="vignette-distance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M508 570 L508 486" marker-end="url(#vignette-distance-arrow)" />
<circle class="docs-shot-number" cx="508" cy="570" r="18" /><text x="508" y="570" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M508 50 L508 134" marker-end="url(#vignette-distance-arrow)" />
<circle class="docs-shot-number" cx="508" cy="50" r="18" /><text x="508" y="50" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M648 409 L648 325" marker-end="url(#vignette-distance-arrow)" />
<circle class="docs-shot-number" cx="648" cy="409" r="18" /><text x="648" y="409" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M787 101 L787 185" marker-end="url(#vignette-distance-arrow)" />
<circle class="docs-shot-number" cx="787" cy="101" r="18" /><text x="787" y="101" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M926 409 L926 325" marker-end="url(#vignette-distance-arrow)" />
<circle class="docs-shot-number" cx="926" cy="409" r="18" /><text x="926" y="409" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Distance & Roundness, reduced to its recipe (how Circle Scale and Corner Distance are worked out is left out). 1 — Subtract: the offset from the middle. 2 — Add: the scale per axis. 3 — Multiply: the offset in that scale. 4 — Length: how far. 5 — Divide: corners at 1.</figcaption>
</figure>

**Subtract** – the pixel's position minus the Centre (0.5, 0.5): how far it lies from the middle of the frame, across and down.

**Add** – the scale for each axis. Frame Scale (√2) on both axes gives an oval that follows the frame; Circle Scale (each side divided by half the diagonal) gives a circle in pixels. The Clamp, Subtract and Multiply before it blend the two by Roundness.

**Multiply** – the offset from the middle in that scale, so a wide frame and a portrait frame measure in the same pixels.

**Length** – the straight-line distance from the middle.

**Divide** – divides by the Corner Distance, the distance the same scale gives a corner. Every corner is therefore at exactly 1 on any frame and at any Roundness, which is what Size counts in.

**Remix:** to put the bright middle on a performer who stands off centre, replace the Centre (0.5, 0.5) card that feeds **Subtract** with a **Combine Vector** of X 0.35 and Y 0.5: the vignette moves left. The corners are then no longer all at 1: the near side darkens less, the far side more.

### Falloff (Size, Softness, Amount)

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Falloff folder: Maximum of Softness and Minimum Feather gives the feather; Add of Size and the feather is the outer edge; Smoothstep of the Distance between Size and the outer edge gives the Falloff; Multiply by Amount gives the darkening; Subtract from One and Maximum with Zero give the Brightness Gain](../assets/effects/graphs/vignette-falloff.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 523" aria-hidden="true" focusable="false">
<defs><marker id="vignette-falloff-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M230 452 L230 368" marker-end="url(#vignette-falloff-arrow)" />
<circle class="docs-shot-number" cx="230" cy="452" r="18" /><text x="230" y="452" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M508 500 L508 416" marker-end="url(#vignette-falloff-arrow)" />
<circle class="docs-shot-number" cx="508" cy="500" r="18" /><text x="508" y="500" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M648 452 L648 368" marker-end="url(#vignette-falloff-arrow)" />
<circle class="docs-shot-number" cx="648" cy="452" r="18" /><text x="648" y="452" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M787 143 L787 227" marker-end="url(#vignette-falloff-arrow)" />
<circle class="docs-shot-number" cx="787" cy="143" r="18" /><text x="787" y="143" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Falloff, reduced to its recipe (the Darkening Depth it passes to the dither is left out). 1 — Maximum: never sharper than a pixel and a half. 2 — Smoothstep: the soft ring. 3 — Multiply: by Amount. 4 — Subtract: the Brightness Gain.</figcaption>
</figure>

**Maximum** – the width of the ring: Softness, but never less than the Minimum Feather of one and a half pixels. That is why Softness 0 still gives a clean edge without stair steps.

**Smoothstep** – 0 inside Size, 1 beyond Size plus that width, with a smooth S-curve between: how far into the darkening each pixel lies.

**Multiply** – that share times Amount: how much each pixel darkens.

**Subtract** – 1 minus the darkening, the Brightness Gain. The Maximum after it keeps it from going below 0 when Amount is typed above 1.

### Anti-Banding Dither

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Anti-Banding Dither folder: two Random (Cell) nodes read the Pixel Position and the Shifted Pixel; Add and Subtract One centre their sum; Multiply by Dither Step 0.002 and by the active share; Darkening Depth times Dither Ramp 16, clamped between Zero and One, is the active share; Scalar to RGB and Add put the dither onto the Darkened Color](../assets/effects/graphs/vignette-dither.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 680" aria-hidden="true" focusable="false">
<defs><marker id="vignette-dither-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M204 421 L204 337" marker-end="url(#vignette-dither-arrow)" />
<circle class="docs-shot-number" cx="204" cy="421" r="18" /><text x="204" y="421" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M448 62 L448 146" marker-end="url(#vignette-dither-arrow)" />
<circle class="docs-shot-number" cx="448" cy="62" r="18" /><text x="448" y="62" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M569 538 L569 454" marker-end="url(#vignette-dither-arrow)" />
<circle class="docs-shot-number" cx="569" cy="538" r="18" /><text x="569" y="538" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M935 62 L935 146" marker-end="url(#vignette-dither-arrow)" />
<circle class="docs-shot-number" cx="935" cy="62" r="18" /><text x="935" y="62" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Anti-Banding Dither, reduced to its recipe (how the pixel positions are worked out is left out). 1 — Random (Cell): a fixed random value per pixel. 2 — Subtract: noise around 0. 3 — Clamp: only where it darkens. 4 — Add: onto the picture.</figcaption>
</figure>

A dark, smooth gradient has only a few 8-bit steps to go through, so a wide vignette over a black stage can show faint rings. This folder hides them with noise far too small to see.

**Random (Cell)** – a fixed random number for every pixel; a second one reads a shifted pixel. The pattern stays the same from frame to frame, so it never shimmers.

**Subtract** – the sum of both random numbers minus 1: a noise that lies around 0 and is most often small. The Multiply cards after it scale it to at most half an 8-bit step (Dither Step 0.002).

**Clamp** – how much the darkening at this pixel asks for dither: the Darkening Depth times 16, limited to 0–1. Where Vignette leaves the picture alone, the picture stays exactly as it was.

**Add** – adds the noise to the Darkened Color from Multiply.

**Remix:** to see the rings the dither prevents, drag the cable from **Multiply** (the Darkened Color) straight into the top-level Clamp, past Anti-Banding Dither, and give the Vignette a wide Softness over a dark background.

## Technical details

- **Distance.** Measured in pixels from the middle of the layer, normalized so every corner is at 1 on any size and aspect. Roundness blends the per-axis scale from `√2` (frame-shaped oval) to `side / half diagonal` (circle).
- **Falloff.** `gain = max(0, 1 − Amount · smoothstep(Size, Size + max(Softness, 1.5 px), distance))`, applied to the colour; alpha is kept.
- **Dither.** Triangular, at most half an 8-bit step, fixed per pixel, and only where the gain differs from 1 (full from a darkening of 1/16).
- **Warnings.** Size at or above 1 (nothing darkens), Softness below 0, Roundness outside 0–1 and Amount above 1 are reported in the effect card and the tool result.
- **Saved projects.** A Vignette saved before 2026-10-21 keeps its earlier look (its Roundness 0.5–2 stretched the frame-shaped oval vertically, and its Size reached to about 1.41 at the corners); its card offers **Use the new Vignette (resets its shape)**, which resets Size, Softness and Roundness and removes their keyframes, in one undo step.
- **Transitions.** The Vignette Bloom transition uses the current Vignette (Roundness 0, with Size and Softness ÷ √2, which gives the transition its familiar falloff).
- **Software preview.** Without a graph (as transitions create it) the worker software renderer uses the current pixel distance without the dither.
- Shared notes: [Light & Stylize](../Effect-System.md#light--stylize-notes). Formulas: [Effect system](../Effect-System.md#editable-color-effect-graphs); blocks: [Node Catalog](../Node-Catalog.md).
