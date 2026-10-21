---
title: "Color Effects"
---

Nine effects for light and colour, from a quick brightness fix to a complete
colour mood. Add one in **Properties → Effects → + Add Effect**.

Black stays black and white stays white unless you ask for it, and colours keep
their shade when you push them. The export renders the same graphs as the preview
(adjustment layers in the optional worker GPU modes excepted, see Known gaps).
Effects in projects and custom Looks saved before this update keep their earlier
look; to get the new one, add the effect again (for a Look: rebuild it from freshly
added effects and save it again).

## The nine color effects

### Brightness
<figure class="docs-shot docs-shot--float-right">

<a class="docs-shot-zoom" href="/docs/assets/effects/brightness.webp" title="Open the full-size picture"><img src="/docs/assets/effects/brightness.webp" alt="The rainy night street with neon signs, split in the middle: left half original, right half with Brightness 0.5, where walls and the wet street are lighter and the darkest areas are still black" width="1600" height="900" decoding="async"></a>

<figcaption>Left: original. Right: Amount 0.5.</figcaption>
</figure>

Makes the picture lighter or darker in the middle tones, while the deepest blacks
and the brightest whites stay where they are. No grey veil, no washed-out shadows.
- **Amount** – up to lighten, down to darken. 0.3 is a gentle lift, 1 is strong.

Tip: Brightness never burns out the brightest whites; for a camera-like change of light, use Exposure.

### Contrast
<figure class="docs-shot docs-shot--float-left">

<a class="docs-shot-zoom" href="/docs/assets/effects/contrast.webp" title="Open the full-size picture"><img src="/docs/assets/effects/contrast.webp" alt="The whole dancer twice, the same crop: left original, right Contrast 1.4, where the dark background and floor are deeper and the lit dress and skin stand out brighter and a little warmer" width="1600" height="900" loading="lazy" decoding="async"></a>

<figcaption>The same part of the frame. Left: original. Right: Amount 1.4.</figcaption>
</figure>

Adds punch: shadows get deeper and highlights brighter, on a soft S-shaped curve,
so bright details roll off gently instead of burning out. Strong settings also
make colours stronger.
- **Amount** – 1 leaves the picture unchanged, 1.2–1.5 adds punch (1.1–1.3 on dark scenes), below 1 flatter, 0 almost plain grey.

### Exposure
<figure class="docs-shot docs-shot--float-right">

<a class="docs-shot-zoom" href="/docs/assets/effects/exposure.webp" title="Open the full-size picture"><img src="/docs/assets/effects/exposure.webp" alt="The whole dancer twice, the same crop: left original, right Exposure +1 EV, where skin, dress, the hazy background and the floor are all brighter and the brightest part of the dress is close to white" width="1600" height="900" loading="lazy" decoding="async"></a>

<figcaption>The same part of the frame. Left: original. Right: Exposure +1 EV.</figcaption>
</figure>

Works like the camera's exposure: it changes the amount of light. +1 doubles it,
−1 halves it. Bright areas can burn out, just as in a camera.
- **Exposure** – in camera stops (EV). ±0.3 is a small correction, ±1 a clear change.
- **Offset** – lifts or lowers everything by the same amount.
- **Gamma** – above 1 opens up the mid-tones, below 1 makes them heavier.

### Levels
<figure class="docs-shot docs-shot--float-left">

<a class="docs-shot-zoom" href="/docs/assets/effects/levels.webp" title="Open the full-size picture"><img src="/docs/assets/effects/levels.webp" alt="The whole dancer twice, the same crop: left original, right with Output Black 0.12 and Output White 0.92, where the black background and floor have turned a soft dark grey and the dress is slightly duller" width="1600" height="900" loading="lazy" decoding="async"></a>

<figcaption>The same part of the frame. Left: original. Right: Output Black 0.12, Output White 0.92.</figcaption>
</figure>

The classic Levels from photo editing: you choose which tone becomes black, which
becomes white and how bright the middle is.
- **Input Black / Input White** – everything darker than Input Black becomes black, everything brighter than Input White becomes white. Moving them inward adds contrast.
- **Gamma** – above 1 brightens the mid-tones, below 1 darkens them.
- **Output Black / Output White** – raise the black or lower the white for a softer, faded film look.

Tip: equal Input Black and Input White give a hard threshold per colour channel, a posterised look; put Saturation 0 before Levels for a pure black-and-white threshold.

### Saturation
<figure class="docs-shot docs-shot--float-right">

<a class="docs-shot-zoom" href="/docs/assets/effects/saturation.webp" title="Open the full-size picture"><img src="/docs/assets/effects/saturation.webp" alt="The harbour town, split in the middle: left half original, right half with Saturation 1.6, where the sky, the sea and the house fronts are more colourful" width="1440" height="810" loading="lazy" decoding="async"></a>

<figcaption>Left: original. Right: Amount 1.6.</figcaption>
</figure>

Makes colours stronger or weaker. When you push it, every colour stops at the
strongest version the screen can show, so it keeps its shade instead of turning
into a flat block.
- **Amount** – 0 is black and white, 1 unchanged, 1.3–1.6 rich.

### Vibrance
<figure class="docs-shot docs-shot--float-left">

<a class="docs-shot-zoom" href="/docs/assets/effects/vibrance.webp" title="Open the full-size picture"><img src="/docs/assets/effects/vibrance.webp" alt="The dancer's face, arms and dress, the same crop three times: left original; middle Saturation 1.6, where skin and dress turn orange; right Vibrance 1, where the skin stays natural and the dress is only a little warmer" width="1600" height="899" loading="lazy" decoding="async"></a>

<figcaption>The same part of the frame. Left: original. Middle: Saturation 1.6. Right: Vibrance 1.</figcaption>
</figure>

A gentler saturation: it strengthens pale colours a lot and strong colours only a
little, and it goes easy on lit skin tones. Good for faces. Brightly lit warm
surfaces count as skin too, so on a warm-lit stage use Saturation for a stronger push.
- **Amount** – up for livelier colours, down for a muted look.

Tip: on people, use Vibrance instead of Saturation so skin does not turn orange.

### Temperature
<figure class="docs-shot docs-shot--float-right">

<a class="docs-shot-zoom" href="/docs/assets/effects/temperature.webp" title="Open the full-size picture"><img src="/docs/assets/effects/temperature.webp" alt="The same part of the harbour town twice: on the left the original, on the right with Temperature −0.6, where the white and yellow house fronts look cooler and slightly bluish, the turquoise sea turns a cooler blue and the sky a deeper blue" width="1296" height="729" loading="lazy" decoding="async"></a>

<figcaption>The same part of the frame. Left: original. Right: Temperature −0.6.</figcaption>
</figure>

White balance, like the camera setting: makes the light warmer or cooler. Blacks
stay black and the overall brightness stays the same.
- **Temperature** – positive is warmer (orange), negative cooler (blue). 0.2–0.3 is a correction, 0.6–1 a colour mood.
- **Tint** – positive towards magenta, negative towards green.

Tip: a little cool (−0.3 to −0.6) gives a moonlit or night-time mood.

### Hue Shift
<figure class="docs-shot docs-shot--float-left">

<a class="docs-shot-zoom" href="/docs/assets/effects/hue-shift.webp" title="Open the full-size picture"><img src="/docs/assets/effects/hue-shift.webp" alt="The rainy night street, split in the middle: left half original, right half with Hue Shift 120 degrees, where the orange neon sign has turned green and the pink one yellow, with the same brightness" width="1600" height="900" loading="lazy" decoding="async"></a>

<figcaption>Left: original. Right: Shift 120°.</figcaption>
</figure>

Turns every colour around the colour wheel, so orange can become green and pink
yellow. Each colour keeps its brightness and strength, so an animated shift does
not flicker in brightness.
- **Shift** – in degrees, 0–360°. 180° gives the opposite colours; 360° is back to the original.

Tip: keyframe Shift from 0° to 360° for a smooth colour cycle.

### Invert
<figure class="docs-shot docs-shot--float-right">

<a class="docs-shot-zoom" href="/docs/assets/effects/invert.webp" title="Open the full-size picture"><img src="/docs/assets/effects/invert.webp" alt="The harbour town, split in the middle: left half original, right half inverted like a photo negative, with an orange sky and pale blue houses" width="1440" height="810" loading="lazy" decoding="async"></a>

<figcaption>Left: original. Right: Invert.</figcaption>
</figure>

Turns the picture into its negative: dark becomes light and every colour becomes
its opposite. Transparent areas stay transparent. Invert has no controls.

Tip: add Hue Shift at 180° after Invert to get roughly the original colours back with light and dark swapped.

<div class="docs-float-end"></div>

## How the color effects are built

Every color effect is a small node graph. The inspector shows its controls, the
Node Workspace shows the nodes behind them, and you can change those nodes.

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

<a class="docs-shot-zoom" href="/docs/assets/effects/editor/exposure-inspector.webp" title="Open the full-size picture"><img src="/docs/assets/effects/editor/exposure-inspector.webp" alt="Properties, Effects with the Exposure card: Exposure at 1.0 EV, Offset 0 and Gamma 1, with keyframe and reset buttons beside each row" width="646" height="578" loading="lazy" decoding="async"></a>

<svg class="docs-shot-overlay" viewBox="0 0 590 527" aria-hidden="true" focusable="false">
<defs><marker id="exposure-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M355 148 L355 64" marker-end="url(#exposure-inspector-arrow)" />
<circle class="docs-shot-number" cx="355" cy="148" r="18" /><text x="355" y="148" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M22 370 L49 370" marker-end="url(#exposure-inspector-arrow)" />
<circle class="docs-shot-number" cx="22" cy="370" r="18" /><text x="22" y="370" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M22 465 L49 465" marker-end="url(#exposure-inspector-arrow)" />
<circle class="docs-shot-number" cx="22" cy="465" r="18" /><text x="22" y="465" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M464 173 L464 257" marker-end="url(#exposure-inspector-arrow)" />
<circle class="docs-shot-number" cx="464" cy="173" r="18" /><text x="464" y="173" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>1 — Properties → Effects lists the effects of the selected clip. 2 — Exposure, in camera stops (the field shows EV). 3 — Gamma, for the mid-tones. 4 — Bypass, to compare with the original.</figcaption>
</figure>

Each control is a node in the graph: **Exposure** (2) is the **Exposure** card in
the Exposure (Stops) picture further down. To see the graph, select the clip and
open the **Nodes** tab (in the tab row Media · AI Studio · Nodes). The effect
appears as folders; the arrow on a folder card opens it. Changes apply to this
one effect on this clip.

In the number field you can type past the end of a slider, up to what the effect
can show (Exposure up to ±20 EV). If a keyframe, a node or the AI agent goes
further, the effect uses the limit and the inspector says so.

<div class="docs-float-end"></div>

### One block between colour in and colour out

<figure class="docs-shot docs-shot--graph">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/brightness.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/brightness.webp" alt="The Brightness graph: Input Frame, Split RGB + Alpha, the Parameters folder with its Amount output, the Brightness Curve folder, Combine RGB + Alpha and Output; the Constants folder is hidden" width="1506" height="574" loading="lazy" decoding="async"></a>

<figcaption>Brightness as it opens in the Node Workspace, with the Constants folder left out. Every color effect has this shape.</figcaption>
</figure>

All color effects share one simple shape:

- **Split RGB + Alpha** separates the colour from the transparency.
- **Parameters** holds the controls. Each one passes through a limit, so a
  typed-in extreme value cannot break the picture.
- One folder does the actual work: **Brightness Curve**, **Contrast Curve**,
  **Exposure (Stops)**, **White Balance**, **Saturation (Gamut-Safe)** or
  **Hue Rotate (OkLCh)**.
- **Combine RGB + Alpha** puts the untouched transparency back.

These six blocks are also in **right-click → Reusable Nodes** (category Color &
Mask), so you can drop, say, a Brightness Curve into any other image effect graph.

### Brightness: one number sets the strength

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/brightness-curve.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/brightness-curve.webp" alt="The Brightness Curve folder opened: on the left the Value cards 1 and 2.5 and the Amount and RGB inputs, then Scalar to RGB, Multiply and Clamp, Power of Two and Subtract, Multiply, Add and Divide" width="1314" height="892" loading="lazy" decoding="async"></a>

<svg class="docs-shot-overlay" viewBox="0 0 1017 690" aria-hidden="true" focusable="false">
<defs><marker id="brightness-curve-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M101 316 L101 400" marker-end="url(#brightness-curve-arrow)" />
<circle class="docs-shot-number" cx="101" cy="316" r="18" /><text x="101" y="316" class="docs-shot-number-text">1</text>
</svg>
</div>

<figcaption>Brightness Curve (Clamp's limits 0 and 1 are left out). 1 — the Value 2.5: Amount × 2.5 goes through Power of Two to become the gain; Multiply, Add and Divide bend each colour channel with it.</figcaption>
</figure>

The curve brightens the dark-to-middle tones of each channel by the gain from
**Power of Two**, then **Divide** squeezes the result back so that 0 stays 0 and
1 stays 1. That is why Brightness has no grey veil and never clips. The **Value**
card **2.5** (1) decides how many stops one unit of Amount is worth.

Remix: set the Value (1) to 1.25 and the whole slider becomes half as strong, for
finer control; set it to 4 for a harder push.

### Exposure and Temperature: working in light

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/exposure-stops.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/exposure-stops.webp" alt="The Exposure (Stops) folder opened: the Exposure input into Power of Two, the RGB input into sRGB to Linear, both into Multiply, then Linear to sRGB" width="1252" height="704" loading="lazy" decoding="async"></a>

<svg class="docs-shot-overlay" viewBox="0 0 1017 572" aria-hidden="true" focusable="false">
<defs><marker id="exposure-stops-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M358 22 L358 68" marker-end="url(#exposure-stops-arrow)" />
<circle class="docs-shot-number" cx="358" cy="22" r="18" /><text x="358" y="22" class="docs-shot-number-text">1</text>
</svg>
</div>

<figcaption>Exposure (Stops). 1 — Power of Two turns stops into a light factor: +1 becomes ×2.</figcaption>
</figure>

Screen colours are stored brighter than the light they stand for. **sRGB to
Linear** turns them back into amounts of light, **Multiply** changes the light by
the factor from **Power of Two** (1), and **Linear to sRGB** turns the result
back into screen colours. That is what makes +1 EV look like twice the light.

Temperature's **White Balance** folder uses the same two conversions, but
multiplies red, green and blue by different factors. Its **Value** card **0.6** is
the strength of one Temperature unit: red goes up and blue down by 0.6 stops each
(1.2 stops apart) before the overall brightness is restored.

Remix: for a twice as strong Exposure slider, put a **Multiply** with a
**Value** of 2 between the **Exposure** card and **Power of Two** (1).

### Hue Shift: turning only the hue

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/hue-shift-rotate.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/hue-shift-rotate.webp" alt="The Hue Rotate (OkLCh) folder opened: RGB into RGB to OkLCh and Split Vector with the outputs Lightness, Chroma and Hue; Hue and the Shift input into Add and Fraction; Combine Vector with the inputs Lightness, Chroma and Hue, then OkLCh to RGB" width="1498" height="754" loading="lazy" decoding="async"></a>

<svg class="docs-shot-overlay" viewBox="0 0 1017 512" aria-hidden="true" focusable="false">
<defs><marker id="hue-shift-rotate-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M492 22 L492 54" marker-end="url(#hue-shift-rotate-arrow)" />
<circle class="docs-shot-number" cx="492" cy="22" r="18" /><text x="492" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M700 193 L700 277" marker-end="url(#hue-shift-rotate-arrow)" />
<circle class="docs-shot-number" cx="700" cy="193" r="18" /><text x="700" y="193" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>Hue Rotate (OkLCh). 1 — Split Vector gives Lightness, Chroma (colour strength) and Hue. 2 — Combine Vector puts them back together.</figcaption>
</figure>

**RGB to OkLCh** describes every colour as lightness, colour strength (chroma)
and hue, in a colour space made to match how we see. Only the hue is changed:
**Add** adds the Shift and **Fraction** wraps it around the colour wheel. Lightness
and chroma go straight from **Split Vector** (1) to **Combine Vector** (2), so the
brightness cannot change.

Remix: for richer colours without any shift in hue, put a **Multiply** with a
**Value** of 1.3 on the cable from **Chroma** of (1) into the **Chroma** input of
(2). Colours the screen cannot show are cut off at the end, so stay below about 1.5.

### Vibrance: Saturation with a weight

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/vibrance.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/vibrance.webp" alt="The Muted-Colour Weight folder opened: Saturation into Subtract, then Multiply with Skin Weight, Multiply with Amount, Add and Maximum, whose output is Mix Amount" width="1506" height="370" loading="lazy" decoding="async"></a>

<svg class="docs-shot-overlay" viewBox="0 0 1017 250" aria-hidden="true" focusable="false">
<defs><marker id="vibrance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M442 228 L442 163" marker-end="url(#vibrance-arrow)" />
<circle class="docs-shot-number" cx="442" cy="228" r="18" /><text x="442" y="228" class="docs-shot-number-text">1</text>
</svg>
</div>

<figcaption>Muted-Colour Weight, the middle of Vibrance (the constants 1 and 0 are left out). 1 — Multiply weighs the paleness (1 − Saturation) by Skin Weight.</figcaption>
</figure>

Vibrance reuses Saturation's block and only computes a different amount for every
pixel. **Hue & Saturation** measures each colour, **Muted-Colour Weight** gives
pale colours more of the Amount than strong ones, and **Skin Protection** lowers it
on lit, skin-coloured hues. The result, **Mix Amount**, is the Amount input of
**Saturation (Gamut-Safe)**.

Remix: to treat skin like every other colour, connect a **Value** of 1 to input B
of the **Multiply** (1), in place of **Skin Weight**.

## Technical details

Notes for developers. The recipes live in `src/services/operators/colorEffectGraphs.ts`
(tuning in `COLOR_RECIPE`); formulas in
[Effects: editable color effect graphs](/docs/features/effects/#editable-color-effect-graphs),
blocks in the [Node Catalog](/docs/features/node-catalog/) and the graph contract in the
[Operator Graph Compiler](/docs/features/operator-graph-compiler/).

- **Range.** The effect chain carries 8-bit, display-referred colour; the recipes
  limit their input to 0–1, so there is no HDR headroom between effects.
- **Formulas.** Brightness `y = x·m / (x·m + 1 − x)`, `m = 2^(2.5·Amount)`;
  Contrast `x^c / (x^c + (1 − x)^c)` with slope `c` = Amount at mid-grey; Exposure
  `2^EV` in linear light with the exact sRGB transfer, then Offset and Gamma as
  before; Temperature raises red and lowers blue by 0.6 stops each per unit (1.2
  stops apart), Tint lowers green 0.5 stops and raises red and blue 0.25, then the
  gains are normalised to keep Rec.709 luminance. Contrast works per channel, so
  strong values also raise saturation and can push warm lights towards red-orange.
- **Saturation and Vibrance.** Rec.709 luma mix, stopped where the first channel
  reaches 0 or 1 (hue and luma stay). Vibrance weights Amount by `1 − S` (HSV) and
  spares up to 70 % on skin hues (Gaussian at 0.07 turns, about 25°, width 0.05);
  the protection fades in over HSV value 0.15–0.35 and out over saturation 0.6–0.8,
  so dark warm stage floors and strongly saturated orange light get the full Amount.
- **Hue Shift.** Rotation in OkLCh; colours that leave sRGB are clamped per channel
  (no gamut mapping). Stored in turns: 0.25 is 90°, and keyframes and agent tools
  use turns; only the inspector shows degrees.
- **Render ranges.** Sliders cover the useful range; typed values render up to
  Brightness ±4, Contrast and Saturation 0–10, Vibrance −1 to 4, Exposure ±20 EV,
  Gamma 0.2–10 (Exposure) and 0.1–10 (Levels), Temperature and Tint ±4. Beyond that
  the graph clamps, and the inspector, `addEffect`/`updateEffect` warnings and
  `listEffects` (`renderRange`) report it. A gamma at its floor is very dark
  (Exposure, x^5) or almost black (Levels, x^10), and the notice says so. Levels
  with equal input points is a hard per-channel threshold, swapped points give a
  negative.
- **Performance.** All recipes are per-pixel math without extra texture reads. A
  single color effect runs inside the composite pass; in a stack each one is its
  own pass. The worker software render modes evaluate the same graphs on the CPU,
  once per distinct colour of the frame (about 0.2–0.4 s for a 1080p photo); a layer
  that mixes them with the retired `blur` effect is skipped and reported
  (`unsupported-effects`).
- **Saved projects.** Effects keep the graph they were saved with, so projects from
  before the 2026-10 rebuild look as before (`legacyColorEffectGraphs.ts`). A color
  effect saved before effect graphs existed (no graph at all) loads with the
  original graph; new effects get the recipe graph when they are added, also on
  adjustment layers, where an agent's `configure` keeps the graph of every effect
  it keeps. Custom Looks saved before the 2026-10 rebuild apply their color effects
  with the original graphs; new Looks store each color effect's graph (Look schema 2).
  A stored Look graph is validated when the Look is applied; one that no longer
  validates renders the current recipe and the Looks panel says so. To move an old
  Look to the new math, rebuild it from freshly added effects and save it again.
- **Known gaps.** Adjustment layers in the optional worker GPU render modes still
  use the older 4×5 colour matrix for Brightness, Contrast and Saturation; the
  `WorkerGpuAdjustment` log, and the adjustment inspector while such a mode is
  selected, name each effect that looks different there
  (`adjustment-color-recipe-unsupported`). Exposure clips each channel
  hard, so strong +EV can shift hues in the highlights. Contrast pivots at fixed
  mid-grey, Levels has no per-channel mode, Temperature has no Kelvin scale.
