# Analog Effects

Ten effects that make a picture look as if it came through an old TV, a worn tape,
a film lens or a broken digital signal.
Add one in **Properties → Effects → + Add Effect**: type part of its name, click it,
then drag its sliders while the preview follows.

<figure class="docs-shot docs-clip">
<video src="assets/effects/clips/add-glitch.mp4" poster="assets/effects/clips/add-glitch.webp" width="1280" height="716" autoplay muted loop playsinline preload="none" aria-label="Screen recording: the pointer clicks + Add Effect in Properties, Effects, types glitch and clicks the Glitch tile; the Glitch card appears, the pointer drags its Density slider to 1 and the preview of the dancer breaks up"></video>
<figcaption>Adding Glitch: + Add Effect, type glitch, click the tile, drag Density.</figcaption>
</figure>

## The analog effects

### CRT Screen
<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="assets/effects/clips/crt-screen.mp4" poster="assets/effects/clips/crt-screen.webp" width="1206" height="338" autoplay muted loop playsinline preload="none" aria-label="CRT Screen on the dancing figure. Left: the whole frame, bulging, with rounded corners and a faint darker band rolling down. Right: part of the dancer enlarged three times, drawn in horizontal lines with fine red, green and blue stripes"></video>
<figcaption>CRT Screen, Flicker 0.8. Left: the whole frame. Right: enlarged 3× pixel for pixel.</figcaption>
</figure>

Turns the picture into an old tube TV: glowing lines, a fine pattern of red, green
and blue stripes, and a curved screen with rounded corners. Bright parts glow
over the gaps between the lines, dark parts show them.
- **Line Count** – how many lines run down the picture (16 to 1080). 240 is a classic TV; fewer lines look coarser.
- **Line Depth** – how dark the gaps between the lines are.
- **Curvature** – how much the screen bulges. Outside the curved tube the layer is transparent, so the layer below shows through: put a black solid below it for a TV frame. 0 keeps the picture flat and fills the whole frame.
- **Mask** and **Mask Strength** – the stripe pattern of the screen: Aperture Grille (straight stripes) or Slot Mask (stripes with small breaks).

Tip: add Glow after it for the soft bloom of a real tube. At Preview Quality ¼ the
lines and stripes are too fine for the smaller preview and fade out there; the export
shows them.

### Glitch
<figure class="docs-shot docs-clip docs-shot--float-left">
<video src="assets/effects/clips/glitch.mp4" poster="assets/effects/clips/glitch.webp" width="962" height="490" autoplay muted loop playsinline preload="none" aria-label="The dancer turning, original left and with Glitch right: in short bursts rows of the picture tear sideways with red, green and blue fringes and square blocks jump, with clean frames in between"></video>
<figcaption>Left: original. Right: Intensity 0.75, Density 0.45 – bursts with clean frames between.</figcaption>
</figure>

A broken digital signal: rows of the picture tear sideways, blocks jump to the
wrong place and the colours split. It comes in short bursts, with clean frames
in between, and plays back the same way every time.
- **Intensity** – how far the picture tears and jumps.
- **Density** – how often it breaks up and how much of the frame breaks at once. At 1 it never stops.
- **Bands** – how many rows the picture tears into.
- **RGB Split** – how far red and blue slide apart.

Tip: Speed 0 freezes one glitch; change Seed for a different pattern.

### Film Prism
<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="assets/effects/clips/film-prism.mp4" poster="assets/effects/clips/film-prism.webp" width="1206" height="338" autoplay muted loop playsinline preload="none" aria-label="Film Prism on the dancing figure. Left: the whole frame with coloured edges. Right: part of the dancer enlarged three times: the white dress gains a red edge on one side and a blue-green edge on the other, and fine grain moves over the picture"></video>
<figcaption>Fringe 1, Prism shape, Grain 0.4. Left: the whole frame. Right: enlarged 3× pixel for pixel; the grain moves.</figcaption>
</figure>

The look of film shot through a cheap lens or a glass prism: edges gain soft
rainbow fringes, and a fine, living film grain lies over the picture. The picture
itself stays sharp; only the colours spread.
- **Fringe** – how far the colours split at edges.
- **Shape** – Lens: the fringes grow towards the corners. Prism: the same everywhere, in the direction of Prism Angle.
- **Grain** and **Grain Size** – how strong and how coarse the grain is.

Tip: Grain Speed 0 freezes the grain, for still images.

### Analog Signal Lab
<figure class="docs-shot docs-clip docs-shot--float-left">
<video src="assets/effects/clips/analog-signal-lab.mp4" poster="assets/effects/clips/analog-signal-lab.webp" width="962" height="534" autoplay muted loop playsinline preload="none" aria-label="The dancer, original left and through Analog Signal Lab's Worn VHS Look right: softer, warm cream colours kept, noise streaks crawling through the dark background and along the bottom edge where the video heads switch"></video>
<figcaption>Left: original. Right: the Worn VHS Look.</figcaption>
</figure>

Sends the picture through a simulated PAL television chain – antenna, video tape
and tube TV – with real faults: noise, ghost images, rolling, colour that bleeds
and tracking errors. It is the most realistic analog look, and the deepest. A
broadcast stays fairly sharp from side to side; a VHS tape is clearly softer.
- **RF / Antenna Stage**, **VHS Stage** and **CRT Stage** – how strongly each part of the chain acts; 0 leaves it out.
- **Signal Strength** – weaker reception adds noise; very weak reception makes the picture roll.
- **Tracking Error** and **Tape Wear** – the typical faults of a worn VHS tape.
- **Luma Bandwidth** – how sharp the picture is from side to side (2.5 to 5.5 MHz).
- **Y/C Crosstalk** – how much fine detail turns into colour moiré, as on a real PAL TV. 0 keeps detail clean.

Tip: start from the Looks PAL Broadcast, Weak Antenna or Worn VHS and adjust from there.

<div class="docs-float-end"></div>

### Holo and Ribbon Scan

**Holo** lays a holographic foil over the picture: diagonal rainbow bands between
Spectrum A and B that bend with the picture's tones and light up along outlines.
**Amount** goes from the original (0) to the full foil (1); **Stripes** from an even
tint to full bands. Black stays black, except along outlines.

**Ribbon Scan** rolls soft horizontal ribbons down the picture that push it sideways.
**Displacement** grows gently: at the default 0.3 a face stays readable, at 1 the
picture tears apart. **Edges** decides whether reads past the frame edge mirror back
or wrap around to the other side.

### The rest

**Wave Lines** redraws the picture as wavy black lines on a light background, a
graphic line-art look: from about Amount 0.5 the drawing covers most of the picture,
so new Wave Lines start at 0.3. **Crystal Glass**, **Glass
Dispersion** and **Pixel Sort** are marked *Experimental* in the effect list; the
effect card says why. Start them low: their defaults are gentle for that reason.

**Saved projects:** CRT Screen, Glitch, Film Prism, Holo and Ribbon Scan were rebuilt
in this update. Effects and custom Looks saved before it keep their earlier look and
controls; add the effect again for the new version. The built-in Looks use the new
versions. Analog Signal Lab's PAL chain was fixed, on purpose for every saved effect:
saved Analog Signal Lab effects keep their settings but look cleaner and sharper (no
colour dots on detail or at the frame edges, a worn tape keeps its colours and is
softer than a broadcast). There is no switch back to the earlier look. New Wave Lines
start at Amount 0.3; saved ones keep theirs.

**Known limitations:** Crystal Glass's facets stretch with the frame shape and have
hard seams, and strong Refraction doubles edges into ghost copies. Glass
Dispersion's cells change size with the frame resolution, and strong Dispersion
looks like blocks of RGB noise. Pixel Sort only sorts runs of up to 16 pixels, so
smooth areas such as sky get a fine pattern of vertical stripes instead of long
sorted streaks. CRT Screen has no bloom of its own (add Glow). Analog Signal Lab
works on one PAL field of 288 lines, so its picture has half the line detail of a
full PAL frame from top to bottom.

<div class="docs-float-end"></div>

## How the analog effects are built

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![The CRT Screen card in Properties, Effects at its defaults: Mix, Curvature, Line Count 240, Line Depth, Mask (Aperture Grille), Mask Strength, Mask Size, Flicker and Speed, each a slider with a value field and reset](assets/effects/editor/crt-screen-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 750" aria-hidden="true" focusable="false">
<defs><marker id="crt-screen-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M101 209 L185 209" marker-end="url(#crt-screen-inspector-arrow)" />
<circle class="docs-shot-number" cx="101" cy="209" r="18" /><text x="101" y="209" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M94 322 L178 322" marker-end="url(#crt-screen-inspector-arrow)" />
<circle class="docs-shot-number" cx="94" cy="322" r="18" /><text x="94" y="322" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M67 507 L151 507" marker-end="url(#crt-screen-inspector-arrow)" />
<circle class="docs-shot-number" cx="67" cy="507" r="18" /><text x="67" y="507" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M493 145 L493 61" marker-end="url(#crt-screen-inspector-arrow)" />
<circle class="docs-shot-number" cx="493" cy="145" r="18" /><text x="493" y="145" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>1 — Curvature: how much the screen bulges. 2 — Line Count: lines down the picture. 3 — Mask Strength: the red, green and blue stripes. 4 — Bypass, to compare with the original.</figcaption>
</figure>

CRT Screen, Glitch, Film Prism, Holo and Ribbon Scan are small node graphs you can
open and change; the first three open as stage folders.
Open the **Nodes** tab and pick the clip in its source list: the effect is a folded
card, and the › left of its title opens it ([Using effects](./Effects.md#the-node-setup)
shows where). Inside, every stage is a folder with its own ›. Changes apply to this
one effect. [Node Workspace](./Node-Workspace.md) shows how to add and connect nodes.

<div class="docs-float-end"></div>

### The shared idea

<figure class="docs-shot docs-shot--graph">

![The stage folders of Glitch from left to right: Parameters feed Burst Clock; Burst Clock feeds Torn Rows and Block Copies; both feed Read Position & RGB Split, which feeds Channel Reads & Swap; Block Copies also sends Swap Channels and the Input Frame sends the frame to Channel Reads & Swap, which feeds Colour & Alpha](assets/effects/graphs/glitch-stages.svg)

<figcaption>The stage folders of Glitch and the main signals between them (a diagram; the Node Workspace also shows the Constants and Coordinates folders and each folder's ports).</figcaption>
</figure>

All three first decide **where** to read the picture, then **what light** to show.
In Glitch, **Burst Clock** decides when the signal breaks, **Torn Rows** and **Block
Copies** decide where, **Read Position & RGB Split** moves the three colour reads,
**Channel Reads & Swap** reads the picture there and swaps the channels of a few
blocks, and **Colour & Alpha** puts the colours back together. CRT Screen bends the read position into a tube (**Tube Shape & Rim**),
Film Prism spreads it into seven reads along a rainbow (**Tap Positions**) and then
puts the sharp brightness of the pixel back (**Sharp Brightness**).

Sizes count against the frame (lines per picture height, pixels at 1080 lines), so
export, 4K and a full-quality preview look the same. Every random choice comes from
a **Random (Integer Hash)** node keyed by whole numbers (position, glitch state,
seed), so a frame looks the same every time you play or scrub back to it, on the GPU
and in the software fallback alike.

### CRT Screen: the beam

<figure class="docs-shot docs-shot--graph">

![Inside CRT Screen's Scanline Beams: Mix blends Scan Sigma Min (0.16) and Scan Sigma Max (0.42) by Line Brightness; Maximum keeps it at least the Half-Pixel Floor; Multiply nodes square that width and double it with Two; Distance to Line is squared, divided by it, subtracted from Zero and fed to Exponential; a last Divide divides that by Scan Root Tau (2.5066) times the width, giving the Beam Weight](assets/effects/graphs/crt-screen-beam.webp)

<figcaption>One beam inside Scanline Beams: the brighter the line, the wider its beam; the light stays the same.</figcaption>
</figure>

Each pixel adds the light of the two nearest lines; this is the weight of one of
them. The line's brightness picks a beam width between **Scan Sigma Min** (dark
lines) and **Scan Sigma Max** (bright lines) in a **Mix** node, and **Maximum** keeps
it at least half a pixel wide (**Half-Pixel Floor**). **Exponential** of
−distance² ÷ (2 × width²) turns the distance to the line into a soft Gaussian beam,
and the last **Divide** by **Scan Root Tau** (√(2π) ≈ 2.5066) × width gives every beam
the light of its line, wide or narrow: the picture keeps its brightness. Highlights
fill the gaps, dark parts show the lines.

Remix: for thin, hard lines even in the highlights, select **Scan Sigma Max** and set
it from 0.42 to 0.25 in the node inspector; for soft lines that almost close, raise
**Scan Sigma Min** from 0.16 to 0.3. Both lines read the same two values.

### Glitch: bursts

<figure class="docs-shot docs-shot--graph">

![Inside Glitch's Burst Clock: Density times State Burst Range (0.8) plus State Burst Base (0.2) is the burst chance; Glitch State plus Seed Key Offset and Zero plus State Burst Roll Salt (262144) form a Combine Vector for Random (Integer Hash); Greater Than compares the chance with the roll, a Switch outputs Zero or One as Glitching, and two Multiply nodes scale it by Intensity and Burst Strength into Burst Level](assets/effects/graphs/glitch-burst.webp)

<figcaption>The burst decision inside Burst Clock: one random roll per glitch state.</figcaption>
</figure>

Burst Clock counts glitch states, 12 × Speed per second of timeline. For each state,
**Random (Integer Hash)** rolls a number from a key of whole numbers: the state plus
the **Seed Key Offset**, and this roll's own salt (**State Burst Roll Salt**), so
every kind of roll gets its own numbers. **Greater Than** compares the burst chance (**State Burst Base** + Density × **State Burst
Range**) with it, and **Switch** says glitch (1) or clean (0). The two **Multiply**
nodes scale that by Intensity and a random **Burst Strength**: the Burst Level every
other stage reads.

Remix: for a glitch that never pauses, select **State Burst Base** and set it from
0.2 to 1. At 0, Density alone decides, and Density 0 never glitches.

### Film Prism: grain in the mid-tones

<figure class="docs-shot docs-shot--graph">

![Inside Film Prism's Grain Strength: Brightness is clamped between Zero and One; One minus it times it, times Grain Midtone Scale (4), plus Grain Floor (0.25), times Grain times Grain Scale (0.12)](assets/effects/graphs/film-prism-grain.webp)

<figcaption>Grain Strength: 4 · l · (1 − l) + 0.25, times Grain × 0.12, where l is the brightness.</figcaption>
</figure>

Real film grain shows most in the mid-tones. **Grain Strength** takes the brightness
of the pixel (**Brightness** from Sharp Brightness, **Clamp**), forms 4 × l × (1 − l) with
**Subtract** and two **Multiply** nodes (1 in the mid-tones, 0 in pure black and
white), adds **Grain Floor** and scales the result by Grain × **Grain Scale**.

Remix: for grain that is equally strong in shadows and highlights, set **Grain
Midtone Scale** from 4 to 0 and **Grain Floor** from 0.25 to 1.

The fringe works the same way in **Spectrum Reads & Sum**: each of the seven reads
adds to red, green and blue with its own weight value (**Fringe Tap… Weight**), so
changing those weights changes the colours of the rainbow.

### Analog Signal Lab

Analog Signal Lab opens as a chain of large stage nodes (PAL Encode, RF Channel,
VHS Transport, Receiver Analysis, PAL Decode, Display Resolve). Bypass **RF
Channel** or **VHS Transport** there to leave that stage out entirely; the
**Display Resolve** group holds the editable tube: curvature, bloom, scanlines,
phosphor mask and flicker.

## Technical details

Notes for developers. The recipes live in `src/services/operators/crtScreenRecipe.ts`,
`glitchRecipe.ts`, `filmPrismRecipe.ts`, `holoRecipe.ts` and `ribbonScanRecipe.ts`
(shared helpers in `analogRecipeBuilder.ts`);
formulas and history in [Effect system: CRT Screen](./Effect-System.md#crt-screen) and
[Effect system: Analog Signal Lab](./Effect-System.md#analog-signal-lab), nodes in
[Node Catalog](./Node-Catalog.md#random-nodes), compilation in
[Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Units.** CRT Line Count is lines per frame height (16 to 1080, the control's
  range); Mask Size and Film Prism's Grain Size are pixels at 1080 lines and scale
  with the frame height. Glitch Bands is the number of tear rows over the frame
  height, each split once at a random height; torn rows shift by up to 15 % of the
  width, thin slices by up to 2 %; block offsets round to the nearest block. Film
  Prism reaches ±1.5 % at Fringe 1: Lens scales about the frame centre, Prism shifts
  along Prism Angle (degrees, counter-clockwise from the right) in frame heights.
  Ribbon Scan shifts by Displacement² × 6 % of the width; Holo's outlines compare
  brightness ±0.2 % of the frame height apart.
- **Light and sampling.** CRT Screen caches the frame once as premultiplied linear
  light (`rgba16float`), then a second cache averages it down the frame over an
  eighth of a line height (16 reads, at most one pixel apart up to 128 px lines).
  Each pixel reads that 8 times per line, an eighth of a line apart, so a line
  averages every one of its rows at any line height (export, 4K or coarse Line
  Count): a single bright row keeps 0.94 to 1.08 of its light wherever it lies in
  the line. Each beam is divided by its area, so dark, mid and
  bright tones keep their exposure, and both masks keep the average light (the Slot
  Mask divides its slot term by its mean). Film Prism (7 reads) and Ribbon Scan (2)
  read a premultiplied cache bilinearly, so cut-out edges keep their colour; Film
  Prism then replaces the Rec. 709 luma of the spread with that of the pixel where it
  has coverage (only colour spreads; a hard edge stays within 2 px in brightness).
  Glitch reads the frame 3 times at texel centres and wraps around the edges; swapped
  blocks mix their rotated channels up to half into their own on textured blocks
  and 0.15 on flat ones (luma range of four points of the copied block below 0.03).
  Glitch and Film Prism keep each channel's coverage. Holo's even sheen is weighted
  by smoothstep(0.02, 0.35, brightness), so true blacks stay black.
- **Time.** Glitch changes 12 × Speed times per timeline second, Film Prism's grain
  24 × Grain Speed times; Speed 0 freezes either. Counters cycle (1024 states, 997
  grain frames). CRT flicker and Holo's bands follow timeline time. Preview,
  scrubbing and export match.
- **Hash keys.** Every key the recipes hash is an exact integer below 2^24 (the seed
  and the cycle fold into 509 keys by integer modulo, each kind of roll adds its own
  integer salt, grain frames move the keys by 16384 rows), so neighbouring grain
  cells share bit-identical corner keys and the GPU and the worker software path
  hash the same bits (`tests/unit/analogHashKeys.test.ts`).
- **Limits.** CRT lines closer than 2.25 px and mask stripes below 1 px fade out
  instead of aliasing; the frame being rendered counts, so at Preview Quality ¼ the
  default lines fade in the preview only. Values outside a control's range are
  clamped (or, for some Analog Signal Lab controls, used as given) and reported in
  the inspector and in agent tool results, as are Pixel Sort's Segment Size outside
  4–16 and Threshold ≥ 1.
- **Zero strength.** CRT Mix 0, Glitch Intensity 0, Film Prism Fringe 0 with Grain 0,
  Holo Amount 0 and Ribbon Scan Displacement 0 leave every pixel unchanged.
- **Experimental.** Crystal Glass, Glass Dispersion and Pixel Sort carry an
  `experimental` note on their definition: the effect list adds "(Experimental)", the
  inspector and `listEffects`/`addEffect` tool results give the reason.
- **Random nodes.** Glitch and Film Prism use `noise.hash2d-pcg.vec2` (Random
  (Integer Hash)); the older sine hash stays unchanged for other effects.
- **Stage folders.** The folders are presentation only (`effectPresentationPlans.ts`)
  and appear on the untouched recipe; a saved original CRT graph opens with the
  folders it had before the rebuild. A graph with your own folders keeps them. A
  folded plain folder offers only the outputs that are used, not the unused
  components of a Split node; a composition keeps every output it declares.
- **Saved projects.** Effects and custom Looks saved before the rebuild keep their
  original graphs (`legacyCrtScreenGraph.ts`, `legacyGlitchGraph.ts`,
  `legacyFilmPrismGraph.ts`, `legacyHoloGraph.ts`, `legacyRibbonScanGraph.ts`, pinned
  by `analogLegacyGraphs.ts`), in Look thumbnails too, without the new recipe's
  own parameters; add the effect again for the new version.
- **Analog Signal Lab** is a compute effect on a 702 × 288 PAL raster (one decoded
  pixel per 13.5 MHz picture sample and field line), independent of the frame size.
  A footprint pass box-averages the source over each sample and line (every source
  row and column, alpha-weighted). PAL Encode low-passes luma to the Luma Bandwidth
  cutoff (2.5 to 5.5 MHz) and removes it from the band the decoder reads as chroma
  except for the Y/C Crosstalk share; PAL Decode notches luma over about 3.6 to 5.2 MHz and
  low-passes the demodulated U/V to 0.6 to 1.3 MHz (Chroma Bandwidth). The filters are
  41-tap FIRs built per workgroup. The picture carries 16 samples of its edge colour
  into the blanking on either side, so filters at the frame edges and small sync
  shifts read picture, not black. VHS Transport low-passes luma to 3 / 2.6 / 2.2 MHz
  (SP / LP / EP, lower with Tape Wear), records chroma colour-under (sideways chroma
  noise, hue kept, saturation 0.93 / 0.87 / 0.81) and fades in over the first tenth
  of VHS Stage. Details in [Effect system: Analog Signal Lab](./Effect-System.md#analog-signal-lab).
  Pixel Sort is a compute effect with segments of at most 16 px.
- **Pictures and clips on this page.** `scripts/doc-clip.mjs` (the four effect
  loops and the operation clip, `scripts/doc-clips/analog.json`; see
  [Documentation Website: Docs clips](./Documentation-Site.md#docs-clips-motion-and-editor-operations)),
  `scripts/effect-graph-shot.mjs` and `scripts/effect-editor-shot.mjs`, each with an
  `analog.json` manifest next to it (`scripts/effect-*-shots/`).

