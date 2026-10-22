# Sheen

A band of light that sweeps across the layer, the classic shine over a logo or a title. The light stays inside the layer's shape, and the picture underneath stays visible in it.

Group: [Light & Stylize](../Effects-Stylize.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare docs-shot--float-left">

![The dancer on a dark stage, original left and with Sheen at its default values right: a soft white band of light crosses the picture from the lower left to the upper right, brightest along its middle and fading to both sides, strongest on her light dress while the folds of the fabric stay visible](../assets/effects/sheen.webp)

<figcaption>Left: original. Right: Sheen at its default settings.</figcaption>
</figure>

**Use it for:** a glint over a logo or a title · a beam of light crossing a set piece · a glossy or metallic accent.

- **Position** – where the band is; keyframe it from 0 to 1 for the sweep.
- **Angle** – which way the band travels.
- **Width** – how far the light reaches from the middle of the band.
- **Intensity** – how bright it is.

**Tip:** for a glint on a title, pick **Glint** and keyframe **Position** from 0 to 1 over half a second.

<div class="docs-float-end"></div>

## Presets

<figure class="docs-shot docs-shot--detail">

![The dancer on the dark stage four times, labelled: Glint with a thin bright streak across her dress, Golden Beam with a wide warm beam falling from the top left, Glass Streak with a hard-edged white band like a reflection on glass, Moon Wash with a broad cool light across her dress and the haze behind her](../assets/effects/presets/sheen.webp)

<figcaption>The four presets on the dancer.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row shows its name until you change something. A control with keyframes keeps them, and the card says so, so a sweep keyframed on Position keeps running.

**Glint** – a thin, bright streak. Swept quickly across a logo or a title, it reads as the flash of light on a polished surface.

**Golden Beam** – a wide, warm beam falling diagonally from the top left, like low sun through a window. Moved slowly, it wanders across a scene.

**Glass Streak** – a hard-edged white band, like the reflection on a pane of glass or polished metal. Good on graphic shapes and lettering.

**Moon Wash** – a broad, cool light across the middle of the picture that falls mainly on bright surfaces. It brings out a light costume in cold light while the dark stage stays dark.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Sheen card: the Preset menu showing Golden Beam, Position 0.5, Angle -60 degrees, Width 0.16, Softness 0.7, Intensity 1.2, Highlights 0.6 and a golden Color swatch, beside the preview where a warm golden beam crosses the dancer's dress and arm](../assets/effects/editor/sheen-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 434" aria-hidden="true" focusable="false">
<defs><marker id="sheen-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M673 198 L757 198" marker-end="url(#sheen-inspector-arrow)" />
<circle class="docs-shot-number" cx="673" cy="198" r="18" /><text x="673" y="198" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M665 241 L749 241" marker-end="url(#sheen-inspector-arrow)" />
<circle class="docs-shot-number" cx="665" cy="241" r="18" /><text x="665" y="241" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M677 294 L761 294" marker-end="url(#sheen-inspector-arrow)" />
<circle class="docs-shot-number" cx="677" cy="294" r="18" /><text x="677" y="294" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M663 347 L747 347" marker-end="url(#sheen-inspector-arrow)" />
<circle class="docs-shot-number" cx="663" cy="347" r="18" /><text x="663" y="347" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M679 399 L763 399" marker-end="url(#sheen-inspector-arrow)" />
<circle class="docs-shot-number" cx="679" cy="399" r="18" /><text x="679" y="399" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Sheen with the Golden Beam preset. 1 — Preset: pick a starting point. 2 — Position: where the band is. 3 — Width: how far the light reaches. 4 — Intensity: how bright. 5 — Color: the tint of the light.</figcaption>
</figure>

**Preset** – a starting point for all controls; see [Presets](#presets).

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/sheen-position.mp4" poster="../assets/effects/clips/sheen-position.webp" width="960" height="266" autoplay muted loop playsinline preload="none" aria-label="The silver title ACT ONE on a transparent layer, shown over black, while Sheen's Position (Glint preset) runs from 0 to 1 and back: a thin bright glint, leaning to the right, slides across the letters from left to right and back; the light appears only on the letters, never on the empty background between them; the current value is shown at the bottom left"></video>
<figcaption>Glint on a title layer: Position from 0 to 1 and back.</figcaption>
</figure>

**Position** – where the band is on its way across the layer. At 0 it waits just outside one edge, at 1 just outside the other, so a keyframe from 0 to 1 is one complete sweep that starts and ends with no light at all. Near both ends only the tip of the band touches a corner, so the light seems to arrive a little late and leave a little early. Half a second reads as a glint, three seconds and more as a slow beam. On a title layer, as in the loop above, the light falls only on the letters and stops cleanly at their edges; where the band crosses empty layer around the title, nothing shows. 0 to 1, default 0.5.

<div class="docs-float-end"></div>

**Angle** – which way the band travels as Position rises; the band itself stands across that way. At 0° it stands upright and travels from left to right, at 90° it lies flat and travels from top to bottom, and the default 25° leans it to the right. Turning Angle by 180° gives the same band travelling the other way. −180 to 180°, default 25°.

**Width** – how far the light reaches from the middle of the band to each side. 0.03–0.08 is a thin streak, the default 0.18 a soft beam, and at 1 a band in the middle reaches both edges of the layer and lights all of it. It counts in halves of the layer's size along the way the band travels, so on a wide frame the same Width gives a broader upright band (0°) than a lying one (90°). 0.01 to 1, default 0.18.

**Softness** – how gently the light fades towards the band's edges. At 1 it fades all the way from the middle, like a beam in haze; around 0.3 the band has a broad, even middle; at 0 it is a hard-edged band of even light, for a reflection on glass. The very edge always gets one pixel of smoothing, so even a hard band has no stair steps. 0 to 1, default 0.7.

**Intensity** – how bright the light is. 0.5 is a faint sheen, the default 0.9 a clear one, and 2–3 makes the middle of the band almost white. The light is laid on with a soft shoulder, so bright parts approach white without turning into a flat patch, and the folds of a dress or the edges of a letter stay readable inside the band. At 0 there is no light. 0 to 3, default 0.9.

<figure class="docs-shot docs-compare docs-shot--float-right" data-before="Highlights 0" data-after="Highlights 1">

![The dancer with Sheen twice: at Highlights 0 left the band lights the dark stage behind her as a grey haze as much as her dress, at Highlights 1 right the dark stage stays dark and only her light dress, arms and face catch the band](../assets/effects/sheen-highlights.webp)

<figcaption>Left: Highlights 0, the same light everywhere. Right: Highlights 1, only bright surfaces catch it.</figcaption>
</figure>

**Highlights** – how much more the light catches bright surfaces than dark ones. At 0 every part of the band gets the same light, so it also shows over black as a grey haze, like a beam in smoke. At 1 the light falls only where the picture is already bright, like a reflection on a glossy surface, and black stays black. The default 0.6 lies in between: the band shows on the dark stage but is strongest on the dress. 0 to 1, default 0.6.

**Color** – the tint of the light. White keeps the colours of the picture, warm yellow gives sunlight, pale blue moonlight. A darker colour gives a dimmer light of that tint, and black gives none. Color cannot be keyframed; for a change of tint, stack two Sheens and keyframe their Intensity. The swatch takes a colour, default `#ffffff` (white).

<div class="docs-float-end"></div>

## Node setup

Sheen has no node setup to open: it is one fixed shader, and everything it does is in its controls. How its light is shaped and laid on is under [Technical details](#technical-details).

**Remix:** add Sheen twice and give the second one a warm Color, a slightly different Angle and its own Position keyframes that start a little later: two beams cross the layer one after the other, like light through a moving window.

## Technical details

- **Light.** The band's light falls off from its middle as `exp(−4.5 t^(2 / Softness))` (t = 0 in the middle, 1 at Width), lowered by its value at t = 1 and scaled back to 1 in the middle, so it reaches exactly nothing at Width; the edge gets one pixel of anti-aliasing. It is weighted by the pixel's brightness through Highlights and lifts each colour with a soft shoulder, `1 − (1 − c) · exp(−light / (1 − c))`, so it never clips to flat white. A colour channel already at 1 or above (HDR) stays as it is.
- **Size.** Position and Width are shares of the whole layer along the direction of travel, and the band keeps its angle on wide and portrait layers. On a small logo in a large transparent layer, the band crosses the logo during only part of the sweep; place Position keyframes for the part where it does, or crop the layer to the logo.
- **Transparency.** Sheen changes only colour, never transparency: transparent parts stay transparent, and the band ends cleanly at the edges of a cut-out, a logo or a title.
- **Saved projects.** A Sheen saved before the soft falloff and Highlights existed keeps its flat-topped band and even light; the effect card says so, and adding Sheen again gives the current look. Sheens saved with the soft falloff before 2026-10-22 ended in a faint step where the light should fade out (about 1 % of the band's brightness, visible on skies at high Intensity); they now fade to nothing, and are otherwise unchanged.
- **Warnings.** Intensity below 0, Width at or below 0 and Softness or Highlights outside 0–1 are clamped and reported in the effect card and the tool result.
- Shared notes: [Light & Stylize](../Effect-System.md#light--stylize-notes). How effects are stored and rendered: [Effect system](../Effect-System.md).
