# Edge Detect

Turns the picture into its outlines: bright lines where things meet, dark everywhere else. With Invert it looks like a pencil drawing.

Group: [Light & Stylize](../Effects-Stylize.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare docs-shot--float-left">

![The harbour town in daylight, original left and with Edge Detect at its default values right: the houses, boats, mountain ridge and clouds become fine white lines on black, and the calm water and sky stay dark](../assets/effects/edge-detect.webp)

<figcaption>Left: original. Right: the default values (Strength 1, Width 1 px, Color 0, Invert off).</figcaption>
</figure>

**Use it for:** a drawn or neon-outline look · glowing contours on black for projection · an outline around a title or a cut-out.

- **Strength** – how bright and how many lines.
- **Width** – how thick the lines are; it stays the same at any resolution.
- **Color** – white lines, or lines in the picture's own colours.
- **Invert** – dark lines on white, like a pencil drawing.

**Tip:** on a title or a cut-out on a transparent layer, the outline is drawn just outside it too. Add [Glow](./glow.md) after Edge Detect for neon tubes.

<div class="docs-float-end"></div>

## Presets

<figure class="docs-shot docs-shot--detail">

![The dancer on a dark stage four times, labelled: Neon Outline with her dress, arms and hair drawn in their own warm colours on black, Pencil Sketch with dark grey lines on white, Coloured Pencil with pale warm lines on white, Bold Contours with thick, soft white lines around her body, arms and the big folds of the dress and a faint pattern on the floor](../assets/effects/presets/edge-detect.webp)

<figcaption>The four presets on the dancer.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all four controls in one undo step, and the row shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Neon Outline** – glowing contours in the picture's own colours on black. Strong on stage footage with a dark background, and a good start for projection; add Glow after it for neon tubes.

**Pencil Sketch** – fine dark grey lines on white paper, like a quick drawing. Works best on a sharp picture with clear shapes.

**Coloured Pencil** – lines in the picture's colours on white, like a drawing with coloured pencils. It reads best on colourful pictures; on pale skin and white costumes the lines stay light.

**Bold Contours** – thick, soft white lines around the figure and the big folds, like chalk or a cartoon. Most fine texture fades; a busy floor keeps a faint pattern.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with an Edge Detect card: the Preset menu showing Neon Outline, Strength 2, Width 1.5 px, Color 1 and Invert off, beside a strip of the preview where the dancer's arm, hair and dress are drawn as glowing warm lines on black](../assets/effects/editor/edge-detect-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 422" aria-hidden="true" focusable="false">
<defs><marker id="edge-detect-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M639 224 L723 224" marker-end="url(#edge-detect-inspector-arrow)" />
<circle class="docs-shot-number" cx="639" cy="224" r="18" /><text x="639" y="224" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M627 274 L711 274" marker-end="url(#edge-detect-inspector-arrow)" />
<circle class="docs-shot-number" cx="627" cy="274" r="18" /><text x="627" y="274" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M643 304 L727 304" marker-end="url(#edge-detect-inspector-arrow)" />
<circle class="docs-shot-number" cx="643" cy="304" r="18" /><text x="643" y="304" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M646 334 L730 334" marker-end="url(#edge-detect-inspector-arrow)" />
<circle class="docs-shot-number" cx="646" cy="334" r="18" /><text x="646" y="334" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M644 364 L728 364" marker-end="url(#edge-detect-inspector-arrow)" />
<circle class="docs-shot-number" cx="644" cy="364" r="18" /><text x="644" y="364" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Edge Detect with the Neon Outline preset. 1 — Preset: pick a starting point. 2 — Strength: how bright and how many lines. 3 — Width: how thick. 4 — Color: white or the picture's colours. 5 — Invert: dark lines on white.</figcaption>
</figure>

**Preset** – a starting point for all four controls; see [Presets](#presets).

**Strength** – how bright the lines get, and with that how many show. Around 0.3 only the strongest outlines remain; the default 1 draws clear outlines and a soft web of fine detail; 2–3 brings out texture such as hair, fabric and a stage floor. Strong edges never clip to a flat white: they approach it softly, so busy detail keeps its structure even at 5. 0 draws no lines at all. 0 to 5, default 1.

<figure class="docs-shot docs-compare docs-shot--float-right" data-before="Width 1 px" data-after="Width 4 px">

![The dancer as outlines twice: at Width 1 px left thin lines trace her hair, the folds of her dress and the pebbles of the floor, at Width 4 px right thick soft lines follow her body, arms and the large folds, and the floor turns into a pattern of soft loops](../assets/effects/edge-detect-width.webp)

<figcaption>Left: Width 1 px, every fine detail. Right: Width 4 px, only the big shapes.</figcaption>
</figure>

**Width** – how thick the lines are, and how big a detail has to be to get one. At 1 every hair and fold gets a line; at 3–4 fine texture fades and thick, soft lines follow only the big shapes. It is measured in pixels of a 1080p frame, so a half-size preview, the 1080p export and a 4K export draw the same line and let the same fine texture through. A 1080p frame cannot show lines thinner than about 0.7 px, so the lowest values look alike there (the card says so). Animating Width changes the lines smoothly. 0.5 to 6 px, default 1 px.

**Color** – the colour of the lines. At 0 they are white (with Invert: black); at 1 each line takes the colour of the picture next to it, at full brightness, so a dark red stays a clear red line. Values between mix the two. 0 to 1, default 0.

**Invert** – swaps line and background: dark lines on white, like a pencil drawing. With Color the lines take the picture's colours on white. A switch: on or off, default off.

<div class="docs-float-end"></div>

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Edge Detect graph: Parameters feed Line Width (sigma & window), Gradient & Edge Strength and Line Color & Alpha; Line Width passes Sigma, Reach, Tap Spacing, Covered Reach and Window Size on to both passes; Input Frame feeds the Horizontal Pass and Line Color & Alpha; the Horizontal Pass hands its cached Row Moments to the Vertical Pass, which passes its Window Sums to Gradient & Edge Strength, which passes the Gradient and the Edge to Line Color & Alpha](../assets/effects/graphs/edge-detect.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 787" aria-hidden="true" focusable="false">
<defs><marker id="edge-detect-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M264 415 L264 331" marker-end="url(#edge-detect-arrow)" />
<circle class="docs-shot-number" cx="264" cy="415" r="18" /><text x="264" y="415" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M427 341 L427 425" marker-end="url(#edge-detect-arrow)" />
<circle class="docs-shot-number" cx="427" cy="341" r="18" /><text x="427" y="341" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M589 355 L589 271" marker-end="url(#edge-detect-arrow)" />
<circle class="docs-shot-number" cx="589" cy="355" r="18" /><text x="589" y="355" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M752 140 L752 224" marker-end="url(#edge-detect-arrow)" />
<circle class="docs-shot-number" cx="752" cy="140" r="18" /><text x="752" y="140" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M914 583 L914 499" marker-end="url(#edge-detect-arrow)" />
<circle class="docs-shot-number" cx="914" cy="583" r="18" /><text x="914" y="583" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Edge Detect opened in the Nodes tab (Constants, Coordinates and the Output card left out). 1 — Line Width (sigma & window): how wide a line is in pixels. 2 — Horizontal Pass (row brightness & x slope): each row of the window, cached. 3 — Vertical Pass (window sums): the rows added up. 4 — Gradient & Edge Strength: how strongly it changes. 5 — Line Color & Alpha: the line over the background.</figcaption>
</figure>

Edge Detect reads a window around each pixel in two passes over the picture. **Line Width (sigma & window)** turns Width into a blur size in pixels and the size of that window. **Horizontal Pass (row brightness & x slope)** reads the brightness along a row of the window, weighted by distance, and keeps two sums per pixel in a cache: the brightness, and how it rises from left to right. **Vertical Pass (window sums)** adds those rows up, weighted the same way, so together they cover the whole square window. **Gradient & Edge Strength** works out from those sums how strongly the brightness changes across the pixel, and turns that into a line strength from 0 to 1. **Line Color & Alpha** draws the line in white, black or the picture's colour over the background. Click a folder's header to open it.

Every tap reads one whole pixel, so the window takes in all the detail it covers. That is why Width lets the same fine texture through in a half-size preview and in a 4K export.

### Line Width (sigma & window)

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Line Width folder: Multiply of Width (at least 0.25) and Short Side ÷ 1080 gives the size in pixels; Maximum with Sigma Minimum 0.7 gives the Sigma; Multiply by Two gives 2 Sigma; Ceiling rounds it up to whole taps; Minimum with Reach Limit 64 gives the Covered Reach; Divide of 2 Sigma (at least 64 px) by Reach Limit 64 gives the Tap Spacing](../assets/effects/graphs/edge-detect-width.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 782" aria-hidden="true" focusable="false">
<defs><marker id="edge-detect-width-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M220 178 L234 178" marker-end="url(#edge-detect-width-arrow)" />
<circle class="docs-shot-number" cx="220" cy="178" r="18" /><text x="220" y="178" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M509 296 L509 274" marker-end="url(#edge-detect-width-arrow)" />
<circle class="docs-shot-number" cx="509" cy="296" r="18" /><text x="509" y="296" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M897 223 L897 307" marker-end="url(#edge-detect-width-arrow)" />
<circle class="docs-shot-number" cx="897" cy="223" r="18" /><text x="897" y="223" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M897 760 L897 676" marker-end="url(#edge-detect-width-arrow)" />
<circle class="docs-shot-number" cx="897" cy="760" r="18" /><text x="897" y="760" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M409 403 L395 403" marker-end="url(#edge-detect-width-arrow)" />
<circle class="docs-shot-number" cx="409" cy="403" r="18" /><text x="409" y="403" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Line Width, reduced to its recipe (the window size the Ceiling feeds is left out). 1 — Multiply: Width in pixels of this frame. 2 — Maximum: never finer than 0.7 px. 3 — Ceiling: whole taps. 4 — Minimum: the Covered Reach, at most 64 taps. 5 — Divide: how far apart the taps sit.</figcaption>
</figure>

**Multiply** – Width times the frame's short side divided by 1080: the line's blur size (sigma) in pixels of this frame. That is why a line looks the same in a 1080p preview and a 4K export.

**Maximum** – keeps sigma at 0.7 px or more. A pixel grid cannot show a finer line; it would only fade.

**Ceiling** – two sigma rounded up to whole pixels: how many taps each pass reads to each side. A second Minimum, left out of the picture, limits that to 64.

**Minimum** – the Covered Reach: two sigma counted in taps, also limited to 64, but not rounded. Both passes use it to count the outermost tap only with the share of it the reach covers.

**Divide** – the Tap Spacing, how far apart the taps sit: two sigma, at least 64 px, divided by 64. It stays 1 px for every Width the slider reaches, even at 4K (Width 6 there needs 24 taps to each side). Only a keyframed Width above 8 at 4K spreads the taps apart; the card then says so.

### Horizontal Pass (row brightness & x slope)

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Horizontal Pass folder: Gaussian Falloff of Tap X with Sigma; Clamp of Covered Reach − |x| + 1 gives the Tap Share; Multiply of both gives the Tap Weight; Luminance of the Tap RGB, multiplied by the Tap Alpha, is the premultiplied brightness; Sequence Reduce adds up the Row Moments with the Tap Weight over the Window Size](../assets/effects/graphs/edge-detect-horizontal.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1346" aria-hidden="true" focusable="false">
<defs><marker id="edge-detect-horizontal-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M386 199 L386 283" marker-end="url(#edge-detect-horizontal-arrow)" />
<circle class="docs-shot-number" cx="386" cy="199" r="18" /><text x="386" y="199" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M507 723 L485 723" marker-end="url(#edge-detect-horizontal-arrow)" />
<circle class="docs-shot-number" cx="507" cy="723" r="18" /><text x="507" y="723" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M629 1248 L629 1164" marker-end="url(#edge-detect-horizontal-arrow)" />
<circle class="docs-shot-number" cx="629" cy="1248" r="18" /><text x="629" y="1248" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M872 199 L872 283" marker-end="url(#edge-detect-horizontal-arrow)" />
<circle class="docs-shot-number" cx="872" cy="199" r="18" /><text x="872" y="199" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside the Horizontal Pass, reduced to its recipe (the tap positions, how the Row Moments are put together and the cache after the sum are left out). 1 — Gaussian Falloff: near taps count more. 2 — Clamp: the share of the outer tap. 3 — Multiply: the brightness of a tap, weighed by its alpha. 4 — Sequence Reduce: the whole row at once.</figcaption>
</figure>

**Gaussian Falloff** – the weight of each tap: 1 at the pixel itself, falling off smoothly with the distance, at the speed sigma sets.

**Clamp** – the share of a tap that lies inside the Covered Reach: 1 for every tap inside it, a part for the outermost one. When an animated Width makes the window one tap wider, the new tap fades in instead of appearing at once, so the lines do not jump. The Multiply after it scales the Gaussian weight by it: the Tap Weight.

**Multiply** – the Luminance of the tap times its alpha (premultiplied brightness), so the outline of a title on a transparent layer is an edge too.

**Sequence Reduce** – reads every tap of the row, one pixel apart, and adds up the Row Moments: the brightness, the brightness times the offset across, the offset squared, and the weights themselves. A **Cache Image** after it keeps these sums for every pixel, divided by the weights, for the Vertical Pass.

### Vertical Pass (window sums)

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Vertical Pass folder: Sample Image reads the Row Moments (cached) at Pixel + Tap Y; Image to RGBA and Split Vector take it apart; Multiply of the row brightness R and Tap Y is the slope down; Sequence Reduce adds up the Window Moments with the Tap Weight over the Window Size into the Window Sums](../assets/effects/graphs/edge-detect-vertical.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1875" aria-hidden="true" focusable="false">
<defs><marker id="edge-detect-vertical-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M720 631 L636 631" marker-end="url(#edge-detect-vertical-arrow)" />
<circle class="docs-shot-number" cx="720" cy="631" r="18" /><text x="720" y="631" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M509 24 L509 108" marker-end="url(#edge-detect-vertical-arrow)" />
<circle class="docs-shot-number" cx="509" cy="24" r="18" /><text x="509" y="24" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M827 497 L827 413" marker-end="url(#edge-detect-vertical-arrow)" />
<circle class="docs-shot-number" cx="827" cy="497" r="18" /><text x="827" y="497" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M720 965 L636 965" marker-end="url(#edge-detect-vertical-arrow)" />
<circle class="docs-shot-number" cx="720" cy="965" r="18" /><text x="720" y="965" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside the Vertical Pass, reduced to its recipe (the tap weight, built as in the Horizontal Pass, and how the Window Moments are put together are left out). 1 — Sample Image: one cached row. 2 — Split Vector: its four sums. 3 — Multiply: the slope down. 4 — Sequence Reduce: the whole window.</figcaption>
</figure>

**Sample Image** – reads the cached row sums one whole pixel above or below this pixel, out to two sigma.

**Split Vector** – takes the row apart: the row's brightness (R), its slope across (G) and its spread (B).

**Multiply** – the row's brightness times its offset down: from these, the Sequence Reduce gets the slope from top to bottom.

**Sequence Reduce** – adds up all rows with the same Tap Weight as the Horizontal Pass: the slope across, the slope down, the spread and the weights of the whole square window, the Window Sums. Adding up rows of a Gaussian gives exactly the square Gaussian window, so two passes of up to 2 × 64 + 1 taps replace one window of up to 129 × 129.

### Gradient & Edge Strength

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Gradient & Edge Strength folder: Length of the Gradient (x, y); Square Root of Σ w x² × Σ w; Divide gives the normalized gradient; two Multiply cards scale it and by Strength (at least 0); Exponential of − Response and Subtract give the Edge](../assets/effects/graphs/edge-detect-gradient.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 693" aria-hidden="true" focusable="false">
<defs><marker id="edge-detect-gradient-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M314 23 L314 107" marker-end="url(#edge-detect-gradient-arrow)" />
<circle class="docs-shot-number" cx="314" cy="23" r="18" /><text x="314" y="23" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M314 670 L314 586" marker-end="url(#edge-detect-gradient-arrow)" />
<circle class="docs-shot-number" cx="314" cy="670" r="18" /><text x="314" y="670" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M509 23 L509 107" marker-end="url(#edge-detect-gradient-arrow)" />
<circle class="docs-shot-number" cx="509" cy="23" r="18" /><text x="509" y="23" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M509 607 L509 523" marker-end="url(#edge-detect-gradient-arrow)" />
<circle class="docs-shot-number" cx="509" cy="607" r="18" /><text x="509" y="607" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Gradient & Edge Strength, reduced to its recipe (the Step Scale 10.03 and the One are left out). 1 — Square Root: the window's own spread. 2 — Length: how steep. 3 — Divide: the same at any Width. 4 — Subtract: the soft roll-off.</figcaption>
</figure>

**Square Root** – the spread of the window: the root of its squared offsets times its weights. It is the yardstick the gradient is measured with.

**Length** – how steep the brightness rises across the pixel, in any direction: the length of the summed brightness times offset, across and down.

**Divide** – the steepness divided by the spread. A step of the same contrast therefore gives the same line strength at every Width and every resolution. The two Multiply cards after it scale it (Step Scale 10.03, so a step of contrast 0.25 gives a response of about 1) and by Strength.

**Subtract** – 1 minus the Exponential of minus the response. Faint edges grow almost in proportion; strong ones approach 1 softly instead of clipping, which keeps dense detail readable.

### Line Color & Alpha

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Line Color & Alpha folder: a Switch on Invert chooses the background; Divide turns the Mean Colour Nearby into full brightness by its Brightest Channel; Mix blends the Plain Line colour and that Picture Colour by Color (0 to 1) into the Line Color; Multiply of the source Alpha and 1 − Edge is the background's coverage; Add of the Edge and that coverage is the alpha](../assets/effects/graphs/edge-detect-color.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 2003" aria-hidden="true" focusable="false">
<defs><marker id="edge-detect-color-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M507 703 L507 725" marker-end="url(#edge-detect-color-arrow)" />
<circle class="docs-shot-number" cx="507" cy="703" r="18" /><text x="507" y="703" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M823 641 L823 725" marker-end="url(#edge-detect-color-arrow)" />
<circle class="docs-shot-number" cx="823" cy="641" r="18" /><text x="823" y="641" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M507 351 L507 373" marker-end="url(#edge-detect-color-arrow)" />
<circle class="docs-shot-number" cx="507" cy="351" r="18" /><text x="507" y="351" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M507 1413 L507 1391" marker-end="url(#edge-detect-color-arrow)" />
<circle class="docs-shot-number" cx="507" cy="1413" r="18" /><text x="507" y="1413" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M823 1585 L823 1501" marker-end="url(#edge-detect-color-arrow)" />
<circle class="docs-shot-number" cx="823" cy="1585" r="18" /><text x="823" y="1585" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Line Color & Alpha, reduced to its recipe (the Zero and One the Switch reads, and the colour taps, are left out). 1 — Divide: the picture's colour at full brightness. 2 — Mix: the line colour. 3 — Switch: black or white background. 4 — Multiply: how much background shows. 5 — Add: the alpha.</figcaption>
</figure>

**Divide** – the colour of the picture beside the line, divided by its brightest channel, so it comes out at full brightness. Edge Detect takes that colour from this pixel and two taps towards the brighter side of the edge, so an outline just outside a layer takes the layer's colour.

**Mix** – blends the plain line colour (white, with Invert black) towards that picture colour by **Color**: the Line Color.

**Switch** – the background: Zero (black) while Invert is off, One (white) while it is on.

**Multiply** – how much background shows: the source alpha times 1 minus the Edge. Where the layer is transparent no background is drawn, so surroundings stay transparent.

**Add** – the alpha of the result: the Edge plus that background share. The line therefore shows in its full colour even outside a transparent layer, where it is drawn over nothing.

**Remix:** for chalk on a slate, open **Line Color & Alpha** and find the **Switch**. Plug a **Value** of 0.15 into its False input, in place of Zero: with Invert off, the background turns dark grey.

## Technical details

- **Lines.** A derivative of a Gaussian on premultiplied brightness (Rec. 709) over a window of ±2 sigma, normalized by the window's own second moment; line strength `1 − exp(−4 · contrast · Strength)`. The Gaussian is separable, so the window runs as a horizontal pass (Sequence Reduce, then a Cache Image of the row sums) and a vertical pass.
- **Width** is sigma in pixels of a 1080p frame (at least 0.7 px). Each pass reads whole pixels out to 2 sigma, up to 64 taps to each side: 2 × (2 · ceil(2 sigma) + 1) reads per pixel plus two for Color, about 100 at 4K and Width 6. Every pixel of the window counts, so fine texture leaves the same speckle in a preview, at 1080p and at 4K. The outermost taps count with the share 2 sigma covers, so an animated Width changes smoothly. Above 64 taps per side (a keyframed Width above 8 at 4K) the taps spread apart; the card and the tool result say so, as they do for a Width finer than a pixel, a negative Strength and a Color outside 0–1. Wide lines cost more render time.
- **Transparency.** Lines are composited premultiplied (alpha = edge + source alpha × (1 − edge)), so transparent surroundings stay transparent and a layer's outline shows in its full line colour.
- **Saved projects.** An Edge Detect saved before 2026-10-21 keeps its earlier one-pixel Sobel (Width and Color have no effect on it); one saved with version 3.2.7 keeps whole taps out to 2 sigma, whose lines can jump a step while Width is animated, and a window that ends at 8 px, so its wide lines come out thinner in large frames (at 4K above Width 2; the card says so). The card of both offers **Use the new Edge Detect**.
- Shared notes: [Light & Stylize](../Effect-System.md#light--stylize-notes). Formulas: [Effect system](../Effect-System.md#editable-blur-kernels); blocks: [Node Catalog](../Node-Catalog.md).
