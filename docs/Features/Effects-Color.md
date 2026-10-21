# Color Effects

Nine effects for light and colour, from a quick brightness fix to a complete
colour mood. Add one in **Properties → Effects → + Add Effect**.

Black stays black and white stays white unless you ask for it, colours keep their
shade when you push them, and the preview and the export look the same. Effects in
projects saved before October 2026 keep their earlier look; add the effect again to
get the new one.

## The nine color effects

### Brightness
<figure class="docs-shot docs-shot--float-right">

![The rainy night street with neon signs, split in the middle: left half original, right half with Brightness 0.5, where walls and the wet street are lighter and the darkest areas are still black](assets/effects/brightness.webp)

<figcaption>Left: original. Right: Amount 0.5.</figcaption>
</figure>

Makes the picture lighter or darker in the middle tones, while the deepest blacks
and the brightest whites stay where they are. No grey veil, no washed-out shadows.
- **Amount** – up to lighten, down to darken. 0.3 is a gentle lift, 1 is strong.

Tip: to brighten a dark stage without losing its black, use Brightness rather than Exposure.

### Contrast
<figure class="docs-shot docs-shot--float-left">

![The dancer on a dark stage, split in the middle: left half original, right half with Contrast 1.4, where the background is darker and the lit dress glows brighter](assets/effects/contrast.webp)

<figcaption>Left: original. Right: Amount 1.4.</figcaption>
</figure>

Adds punch: shadows get deeper and highlights brighter, on a soft S-shaped curve,
so bright details roll off gently instead of burning out.
- **Amount** – 1 leaves the picture unchanged, 1.2–1.5 adds punch, below 1 the picture gets flatter, 0 is almost plain grey.

Tip: for a dark scene, small values (1.1–1.3) are usually enough.

### Exposure
<figure class="docs-shot docs-shot--float-right">

![The dancer on stage, split in the middle: left half original, right half with Exposure +1 EV, where the dress, the haze and the stage are brighter, like twice as much light](assets/effects/exposure.webp)

<figcaption>Left: original. Right: Exposure +1 EV.</figcaption>
</figure>

Works like the camera's exposure: it changes the amount of light. +1 doubles it,
−1 halves it. Bright areas can burn out, just as in a camera.
- **Exposure** – in camera stops (EV). ±0.3 is a small correction, ±1 a clear change.
- **Offset** – lifts or lowers everything by the same amount.
- **Gamma** – above 1 opens up the mid-tones, below 1 makes them heavier.

### Levels
<figure class="docs-shot docs-shot--float-left">

![The dancer on stage, split in the middle: left half original, right half with Output Black 0.12 and Output White 0.92, where the black stage floor and background have turned a soft dark grey](assets/effects/levels.webp)

<figcaption>Left: original. Right: Output Black 0.12, Output White 0.92.</figcaption>
</figure>

The classic Levels from photo editing: you choose which tone becomes black, which
becomes white and how bright the middle is.
- **Input Black / Input White** – everything darker than Input Black becomes black, everything brighter than Input White becomes white. Moving them inward adds contrast.
- **Gamma** – above 1 brightens the mid-tones, below 1 darkens them.
- **Output Black / Output White** – raise the black or lower the white for a softer, faded film look.

Tip: setting Input Black and Input White to the same value gives a hard black-and-white threshold.

### Saturation
<figure class="docs-shot docs-shot--float-right">

![The harbour town, split in the middle: left half original, right half with Saturation 1.6, where the sky, the sea and the house fronts are more colourful](assets/effects/saturation.webp)

<figcaption>Left: original. Right: Amount 1.6.</figcaption>
</figure>

Makes colours stronger or weaker. When you push it, every colour stops at the
strongest version the screen can show, so it keeps its shade instead of turning
into a flat block.
- **Amount** – 0 is black and white, 1 unchanged, 1.3–1.6 rich.

### Vibrance
<figure class="docs-shot docs-shot--float-left">

![The harbour town, split in the middle: left half original, right half with Vibrance 1, where the blue sky and the sea are deeper while the colourful houses change little](assets/effects/vibrance.webp)

<figcaption>Left: original. Right: Amount 1.</figcaption>
</figure>

A gentler saturation: it strengthens pale colours a lot and strong colours only a
little, and it goes easy on skin tones. Good for faces.
- **Amount** – up for livelier colours, down for a muted look.

Tip: on people, use Vibrance instead of Saturation so skin does not turn orange.

### Temperature
<figure class="docs-shot docs-shot--float-right">

![The dancer on stage, split in the middle: left half original, right half with Temperature −0.6, where the warm brown stage and the dress have turned cooler and bluer](assets/effects/temperature.webp)

<figcaption>Left: original. Right: Temperature −0.6.</figcaption>
</figure>

White balance, like the camera setting: makes the light warmer or cooler. Blacks
stay black and the overall brightness stays the same.
- **Temperature** – positive is warmer (orange), negative cooler (blue). 0.2–0.3 is a correction, 0.6–1 a colour mood.
- **Tint** – positive towards magenta, negative towards green.

Tip: a little cool (−0.3 to −0.6) gives a moonlit or night-time mood.

### Hue Shift
<figure class="docs-shot docs-shot--float-left">

![The rainy night street, split in the middle: left half original, right half with Hue Shift 120 degrees, where the orange neon sign has turned green and the pink one yellow, with the same brightness](assets/effects/hue-shift.webp)

<figcaption>Left: original. Right: Shift 120°.</figcaption>
</figure>

Turns every colour around the colour wheel, so orange can become green and pink
yellow. Each colour keeps its brightness and strength, so an animated shift does
not flicker in brightness.
- **Shift** – in degrees, 0–360°. 180° gives the opposite colours; 360° is back to the original.

Tip: keyframe Shift from 0° to 360° for a smooth colour cycle.

### Invert
<figure class="docs-shot docs-shot--float-right">

![The harbour town, split in the middle: left half original, right half inverted like a photo negative, with an orange sky and pale blue houses](assets/effects/invert.webp)

<figcaption>Left: original. Right: Invert.</figcaption>
</figure>

Turns the picture into its negative: dark becomes light and every colour becomes
its opposite. Transparent areas stay transparent. Invert has no controls.

Tip: add Hue Shift at 180° after Invert to get roughly the original colours back with light and dark swapped.

Known limitations: on adjustment layers, Brightness, Contrast and Saturation can
still show their earlier, simpler look in some playback modes.

<div class="docs-float-end"></div>

<!-- docs agent: middle and technical levels go here -->
