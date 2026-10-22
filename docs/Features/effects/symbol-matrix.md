# Symbol Matrix

Rebuilds the picture from small signs that twinkle: each cell swaps its sign at its own moment and breathes. For starry skies, sparks and restless data: the figure stays readable while its surface never settles.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-clip docs-compare">
<video src="../assets/effects/clips/symbol-matrix.mp4" poster="../assets/effects/clips/symbol-matrix.webp" width="1200" height="584" autoplay muted loop playsinline preload="none" aria-label="The dancer turning on a dark stage, original left and with Symbol Matrix right: she is rebuilt from small signs in a grid, dense @ and # in her bright dress and faint dots and crosses on the dark stage, and every cell keeps swapping its sign for a neighbouring one at its own moment while its brightness slowly breathes, so the picture twinkles"></video>
<figcaption>Left: original. Right: Symbol Matrix at its default settings.</figcaption>
</figure>

**Use it for:** a night sky or a field of stars on stage · a figure that glitters or smoulders · a picture alive with restless data.

- **Cell Size** – how big the signs are.
- **Roll** – how far a sign may swap: a quiet twinkle among its neighbours, or any sign at random.
- **Speed** – how often the signs swap and how fast they breathe.

**Tip:** on a dark stage set **Background** to 0: only the signs stay, the dark parts turn into a quiet field of dots and crosses, and the figure sparkles in front of it.

## Presets

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/symbol-matrix-presets.mp4" poster="../assets/effects/clips/symbol-matrix-presets.webp" width="962" height="1010" autoplay muted loop playsinline preload="none" aria-label="The dancer four times in a grid, moving in sync, each with one preset: Night Sky top left with her figure as a constellation of warm white stars on a night-blue ground of faint dots, Shape Shift top right with large circles, diamonds, triangles and squares in her colours, Number Storm bottom left with digits that change quickly, Embers bottom right with glowing orange signs on dark red"></video>
<figcaption>The four presets on the moving dancer, in sync.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Night Sky** – the figure becomes a constellation of warm white stars on a night-blue ground of faint dots, twinkling slowly. Calm and quiet; for night scenes, dreams and wonder.

**Shape Shift** – large circles, diamonds, triangles and squares in the picture's colours that keep turning into one another. Playful and graphic, and it reads from far away on a projection.

**Number Storm** – digits and gaps that change quickly in every cell, drawn at random; the figure shows in their colours. Restless, like a counter running wild: data, chance, pressure.

**Embers** – glowing orange signs on a dark red ground that flare up and fade slowly, like sparks over a fire. Warm and dramatic.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Symbol Matrix card: Style menu, Preset menu showing Shape Shift, Cell Size, Amount, Background and Invert Ramp, then Ramp, Custom Ramp with a row of shapes, Font and Weight, then Color Source, Dark and Light, then Speed and Roll, beside a strip of the preview where the dancer is built from circles, diamonds, triangles and squares](../assets/effects/editor/symbol-matrix-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1247" aria-hidden="true" focusable="false">
<defs><marker id="symbol-matrix-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 319 L649 319" marker-end="url(#symbol-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="319" r="18" /><text x="565" y="319" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M583 425 L667 425" marker-end="url(#symbol-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="583" cy="425" r="18" /><text x="583" y="425" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M541 769 L625 769" marker-end="url(#symbol-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="541" cy="769" r="18" /><text x="541" y="769" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M601 1150 L685 1150" marker-end="url(#symbol-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="601" cy="1150" r="18" /><text x="601" y="1150" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M622 1188 L706 1188" marker-end="url(#symbol-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="622" cy="1188" r="18" /><text x="622" y="1188" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Symbol Matrix with the Shape Shift preset. 1 — Preset: pick a starting point. 2 — Cell Size. 3 — Custom Ramp: the signs, here shapes. 4 — Speed: how often they swap. 5 — Roll: how far they may swap.</figcaption>
</figure>

**Style** – switches to another look of the same engine and keeps your values and keyframes, for example [Glyph Matrix](./glyph-matrix.md), [Matrix Rain](./matrix.md) or [Retro Matrix](./retro-matrix.md).

### Grid

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/symbol-matrix-cell-size.mp4" poster="../assets/effects/clips/symbol-matrix-cell-size.webp" width="720" height="700" autoplay muted loop playsinline preload="none" aria-label="The dancer with Symbol Matrix while Cell Size runs from 8 to 40 px and back: fine twinkling print grows into a few large signs and shrinks again; the current value is shown at the bottom left"></video>
<figcaption>Cell Size from 8 to 40 px and back.</figcaption>
</figure>

**Cell Size** – how big one sign is. 8–10 gives fine glitter, 14 small but clear signs, 24 and more large signs that read on a projection; at 72 the frame holds only 15 rows of large signs. It counts pixels of a 1080p picture, so the preview, the thumbnails and a 4K export show the same grid. 4 to 72 px, default 14 px.

<div class="docs-float-end"></div>

### Style

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/symbol-matrix-amount.mp4" poster="../assets/effects/clips/symbol-matrix-amount.webp" width="720" height="700" autoplay muted loop playsinline preload="none" aria-label="The dancer with Symbol Matrix while Amount runs from 0 to 1 and back: the plain picture fades into twinkling signs and back; the current value is shown at the bottom left"></video>
<figcaption>Amount from 0 to 1 and back.</figcaption>
</figure>

**Amount** – how much of the effect you see. At 0 the original picture, unchanged; in between, the twinkling signs fade in over it. Keyframe it to let a picture dissolve into stars on a cue. 0 to 1, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/symbol-matrix-background.mp4" poster="../assets/effects/clips/symbol-matrix-background.webp" width="720" height="700" autoplay muted loop playsinline preload="none" aria-label="The dancer with Symbol Matrix while Background runs from 0 to 1 and back: the signs stand on black, then the picture's colour fills the cells until the signs vanish into a coloured mosaic, and back; the current value is shown at the bottom left"></video>
<figcaption>Background from 0 to 1 and back.</figcaption>
</figure>

**Background** – how much of the picture fills each cell behind its sign. At 0 the signs stand on a near-black ground and only they glitter; 0.2–0.4 lets the picture glow through, so the figure stays readable; towards 1 the cells take the full colour and the signs disappear into a mosaic. The more Background, the less the breathing shows, because a sign fades towards its ground. 0 to 1, default 0.3.

<div class="docs-float-end"></div>

**Invert Ramp** – swaps the ends of the ramp: dark parts get the dense signs and bright parts the light ones, like a negative. The colours stay. The higher Roll, the less it shows, because every cell swaps through more of the ramp anyway. Either on or off, default off.

### Glyphs

**Ramp** – the row of signs the picture is built from, from the darkest to the brightest part; each cell swaps among the neighbours of its own sign in this row (see Roll). **Symbols** (` ·×+*#@` after a space) gives dots and crosses in the dark and dense # and @ in the light; **Standard** and **Detailed** use punctuation and letters; **Blocks** turns the twinkle into shimmering dots of shade; **Bars** into bars that jump up and down; **Binary** and **Numeric** into flickering 0 and 1 or digits. In the menu: Standard, Detailed, Blocks, Bars, Binary and 2 more, default Symbols.

**Custom Ramp** – your own signs, from dark to bright, instead of the Ramp: shapes such as ` ·○◇△□●◆■` (Shape Shift) or stars such as ` ·+*✦` (Night Sky). A single sign never swaps, but it still breathes. Spaces at the end are ignored, and a ramp longer than 256 characters is thinned to 256, spread from its first to its last (the card says so). Clear it to use the Ramp again. Any text, default empty.

**Font** – the lettering. **Monospace** draws the even signs of a terminal; **Serif** and **Sans Serif** give rounder ones, each narrowed to fit its cell. Monospace, Serif, Sans Serif, default Monospace.

**Weight** – how heavy the strokes are. Heavier signs carry more colour, so the picture gets brighter. How many steps you see depends on the font: the built-in monospace font of many systems only has regular (up to 500) and bold (600 and more). It is not keyframeable. 200 to 900, default 600.

### Color

**Color Source** – where the colour of the signs comes from. **Source** takes the colour of the picture under each cell; **Duotone** colours them between **Dark** for the dark parts and **Light** for the bright parts, as Night Sky and Embers do. Source, Duotone, default Source.

**Dark** – the colour of the darkest signs in Duotone; the ground behind them is a deep shade of it. Ignored with Source. Pick a colour, default `#081018`.

**Light** – the colour of the brightest signs in Duotone. Ignored with Source. Pick a colour, default `#e8fff5`.

### Motion

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/symbol-matrix-speed.mp4" poster="../assets/effects/clips/symbol-matrix-speed.webp" width="720" height="700" autoplay muted loop playsinline preload="none" aria-label="The dancer with Symbol Matrix at three speeds, about two seconds each: at Speed 0 the signs stand still and change only where she moves, at 1 each cell swaps a few times a second and slowly breathes, at 3 they flicker; the speed is shown at the bottom left"></video>
<figcaption>Speed 0, 1 and 3, about two seconds each.</figcaption>
</figure>

**Speed** – how often the signs swap and how fast they breathe. At 1 each cell swaps four times a second, each at its own moment, so the picture twinkles evenly instead of jumping all at once, and its brightness rises and falls about every three seconds; at 0 both stop, and signs change only where the picture changes; 3 and more flickers. It follows the playhead, so a paused picture stands still and the export matches the preview; a keyframed Speed speeds up smoothly. 0 to 5, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/symbol-matrix-roll.mp4" poster="../assets/effects/clips/symbol-matrix-roll.webp" width="720" height="700" autoplay muted loop playsinline preload="none" aria-label="The dancer with Symbol Matrix while Roll runs from 0 to 1 and back: at 0 each cell keeps the sign of its brightness and only breathes, then the signs swap among more and more of the ramp until any sign can appear anywhere and the figure shows only in the colours, and back; the current value is shown at the bottom left"></video>
<figcaption>Roll from 0 to 1 and back.</figcaption>
</figure>

**Roll** – how far a sign may swap from the sign of its own brightness. At 0 each cell keeps its sign and only breathes; 0.4 lets it swap among its nearest neighbours in the ramp (four of the seven Symbols), so the dark parts twinkle with dots and crosses and the bright parts with # and @; at 1 any sign of the ramp can appear in any cell, and the figure shows only in the colours. Any value above 0 swaps among at least two signs. 0 to 1, default 0.4.

<div class="docs-float-end"></div>

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Symbol Matrix graph in eight stages: Parameters feed Cell Grid (Cell Size), which passes the cell number to Glyph Offset and Pulse, the cell centre to Cell Sampling & Tone and the position in the cell to Atlas Alpha; Tone to Glyph turns the tone into the cell's own sign, Glyph Offset (Speed) draws each cell's random swap and passes the clock to Pulse, Roll Window (Roll) keeps the swap inside a part of the ramp and passes the glyph index to Atlas Alpha; Pulse lets the glyph coverage breathe; Ink & Appearance takes the colours, Background, Amount, the cell colour and the pulsed coverage and draws the picture](../assets/effects/graphs/symbol-matrix.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 672" aria-hidden="true" focusable="false">
<defs><marker id="symbol-matrix-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M184 650 L184 566" marker-end="url(#symbol-matrix-arrow)" />
<circle class="docs-shot-number" cx="184" cy="650" r="18" /><text x="184" y="650" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M292 93 L292 177" marker-end="url(#symbol-matrix-arrow)" />
<circle class="docs-shot-number" cx="292" cy="93" r="18" /><text x="292" y="93" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M400 448 L400 364" marker-end="url(#symbol-matrix-arrow)" />
<circle class="docs-shot-number" cx="400" cy="448" r="18" /><text x="400" y="448" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M509 650 L509 566" marker-end="url(#symbol-matrix-arrow)" />
<circle class="docs-shot-number" cx="509" cy="650" r="18" /><text x="509" y="650" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M617 22 L617 72" marker-end="url(#symbol-matrix-arrow)" />
<circle class="docs-shot-number" cx="617" cy="22" r="18" /><text x="617" y="22" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M725 122 L725 206" marker-end="url(#symbol-matrix-arrow)" />
<circle class="docs-shot-number" cx="725" cy="122" r="18" /><text x="725" y="122" class="docs-shot-number-text">6</text>
<path class="docs-shot-arrow" d="M833 187 L833 271" marker-end="url(#symbol-matrix-arrow)" />
<circle class="docs-shot-number" cx="833" cy="187" r="18" /><text x="833" y="187" class="docs-shot-number-text">7</text>
<path class="docs-shot-arrow" d="M941 599 L941 515" marker-end="url(#symbol-matrix-arrow)" />
<circle class="docs-shot-number" cx="941" cy="599" r="18" /><text x="941" y="599" class="docs-shot-number-text">8</text>
</svg>
</div>

<figcaption>Symbol Matrix opened in the Nodes tab (input frame and output left out). 1 — Cell Grid: which cell a pixel lies in. 2 — Cell Sampling & Tone: the colour and brightness of the cell. 3 — Tone to Glyph: the sign of that brightness. 4 — Glyph Offset: the cell's random swap. 5 — Roll Window: the part of the ramp it swaps in. 6 — Atlas Alpha: where the sign covers the cell. 7 — Pulse: the breathing. 8 — Ink & Appearance: colours and ground.</figcaption>
</figure>

Symbol Matrix works in eight stages, one folder each in the Nodes tab: **Cell Grid** cuts the frame into square cells, **Cell Sampling & Tone** reads the colour and brightness in the middle of each cell, **Tone to Glyph** picks the sign of that brightness, **Glyph Offset** draws each cell's random swaps at moments of its own, **Roll Window** keeps a swap inside a part of the ramp around the cell's own sign, **Atlas Alpha** looks up where the sign covers the cell, **Pulse** lets that coverage breathe, and **Ink & Appearance** colours the sign and its ground. Click a folder's header to open it. Glyph Offset and Pulse make it twinkle; Roll Window works as in [Glyph Matrix](./glyph-matrix.md#roll-window), the other five as in [ASCII](./ascii.md#node-setup). Symbol Matrix is one look of the glyph engine that the [Text & Glyph](../Effects-Glyph.md#the-shared-idea) looks share; its **Style** menu switches between them.

### Cell Grid

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Cell Grid folder: Resolution, Smallest Component, Reference Height 1080, Cell Size and Two lead through Divide, Maximum and Multiply to the cell size in pixels; inside the nested Cell Grid group, Maximum, Scalar to Vector 2 and Divide give the grid, Multiply with UV, Floor and Fraction give the cell and the position in it, and Add and Divide give the cell centre](../assets/effects/graphs/ascii-cell-grid.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 582" aria-hidden="true" focusable="false">
<defs><marker id="ascii-cell-grid-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M154 23 L154 107" marker-end="url(#ascii-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="154" cy="23" r="18" /><text x="154" y="23" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M418 58 L418 142" marker-end="url(#ascii-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="418" cy="58" r="18" /><text x="418" y="58" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M769 58 L769 142" marker-end="url(#ascii-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="769" cy="58" r="18" /><text x="769" y="58" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M769 529 L769 445" marker-end="url(#ascii-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="769" cy="529" r="18" /><text x="769" y="529" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M945 81 L945 165" marker-end="url(#ascii-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="945" cy="81" r="18" /><text x="945" y="81" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Cell Grid (Cell Size). The number cards are values from the Constants folder, shown where they plug in. 1 — Smallest Component: the shorter side of the frame. 2 — Maximum: the cell size in pixels. 3 — Floor: the cell number. 4 — Fraction: the place inside the cell. 5 — Divide: the cell centre.</figcaption>
</figure>

**Smallest Component** – the shorter side of the frame; divided by 1080 it scales Cell Size, so a 4K export, a portrait frame and a thumbnail show the same grid.

**Maximum** – the cell size in pixels of this frame, never smaller than 2.

**Floor** – which cell the pixel lies in. Glyph Offset and Pulse give each cell its own random numbers from this cell number.

**Fraction** – where the pixel lies inside its cell, from 0 to 1; Atlas Alpha draws the sign with it.

**Divide** – the middle of the cell, where the whole cell reads the picture.

### Cell Sampling & Tone

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![Inside the Cell Sampling and Tone folder: Cell Center, Tiny, Almost One and Frame feed Clamped Image Sample, which feeds Split RGB + Alpha, whose colour goes into Luminance](../assets/effects/graphs/ascii-cell-sampling.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 565" aria-hidden="true" focusable="false">
<defs><marker id="ascii-cell-sampling-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M227 316 L227 232" marker-end="url(#ascii-cell-sampling-arrow)" />
<circle class="docs-shot-number" cx="227" cy="316" r="18" /><text x="227" y="316" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M363 22 L363 81" marker-end="url(#ascii-cell-sampling-arrow)" />
<circle class="docs-shot-number" cx="363" cy="22" r="18" /><text x="363" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M500 261 L500 177" marker-end="url(#ascii-cell-sampling-arrow)" />
<circle class="docs-shot-number" cx="500" cy="261" r="18" /><text x="500" y="261" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>Inside Cell Sampling & Tone. 1 — Clamped Image Sample: reads the picture at the cell centre. 2 — Split RGB + Alpha: colour and transparency. 3 — Luminance: the brightness.</figcaption>
</figure>

**Clamped Image Sample** – reads the input picture at the cell centre, never outside the frame.

**Split RGB + Alpha** – the cell's colour, which becomes the ink, and its transparency.

**Luminance** – the brightness of the cell, weighted the way the eye sees it. It picks the sign.

<div class="docs-float-end"></div>

### Tone to Glyph

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Tone to Glyph folder: Tone and its inverse from Subtract go into Switch, chosen by Invert Ramp; Clamp keeps the result below one; Multiply by the glyph count from Maximum, and Floor gives the glyph index](../assets/effects/graphs/ascii-tone-to-glyph.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 573" aria-hidden="true" focusable="false">
<defs><marker id="ascii-tone-to-glyph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M264 296 L264 212" marker-end="url(#ascii-tone-to-glyph-arrow)" />
<circle class="docs-shot-number" cx="264" cy="296" r="18" /><text x="264" y="296" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M427 48 L427 132" marker-end="url(#ascii-tone-to-glyph-arrow)" />
<circle class="docs-shot-number" cx="427" cy="48" r="18" /><text x="427" y="48" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M589 48 L589 132" marker-end="url(#ascii-tone-to-glyph-arrow)" />
<circle class="docs-shot-number" cx="589" cy="48" r="18" /><text x="589" y="48" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M752 48 L752 132" marker-end="url(#ascii-tone-to-glyph-arrow)" />
<circle class="docs-shot-number" cx="752" cy="48" r="18" /><text x="752" y="48" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M914 335 L914 251" marker-end="url(#ascii-tone-to-glyph-arrow)" />
<circle class="docs-shot-number" cx="914" cy="335" r="18" /><text x="914" y="335" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Tone to Glyph (Invert Ramp). 1 — Subtract: the inverted tone. 2 — Switch: plain or inverted. 3 — Clamp: keeps the tone inside the ramp. 4 — Multiply: spreads it over the ramp. 5 — Floor: the Tone Glyph, the cell's own character.</figcaption>
</figure>

**Subtract** – one minus the tone, for Invert Ramp.

**Switch** – the tone as it is, or inverted when **Invert Ramp** is on.

**Clamp** – keeps the tone just under 1, so the brightest cells get the last sign and never one past it.

**Multiply** – spreads the tone over the number of signs in the ramp.

**Floor** – the number of the cell's own sign: the Tone Glyph that Roll Window swaps around.

### Glyph Offset

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Glyph Offset folder: Seconds times Speed, or Speed Travel when Greater Than finds keyframes, goes through Switch into the clock; Multiply by Index Time Scale 4 gives the ticks; Random (Cell) of the cell number is added and Floor gives the cell's own tick; Combine Vector pairs the cell's random with its tick, Random (Integer Hash) draws a number, and Multiply by the glyph count and Floor give the glyph offset](../assets/effects/graphs/symbol-matrix-glyph-offset.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 465" aria-hidden="true" focusable="false">
<defs><marker id="symbol-matrix-glyph-offset-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M265 90 L265 174" marker-end="url(#symbol-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="265" cy="90" r="18" /><text x="265" y="90" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M363 442 L363 358" marker-end="url(#symbol-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="363" cy="442" r="18" /><text x="363" y="442" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M557 71 L557 155" marker-end="url(#symbol-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="557" cy="71" r="18" /><text x="557" y="71" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M752 90 L752 174" marker-end="url(#symbol-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="752" cy="90" r="18" /><text x="752" y="90" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M946 334 L946 250" marker-end="url(#symbol-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="946" cy="334" r="18" /><text x="946" y="334" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Glyph Offset (Speed). The number cards are values from the Constants folder, shown where they plug in; cards are named by their outputs where they have one. 1 — Clock: the playhead time × Speed. 2 — Cell Random: the cell's own random number. 3 — Cell Tick: how many swaps the cell has made. 4 — Draw: a random number for this swap. 5 — Glyph Offset: how far the swap moves the sign.</figcaption>
</figure>

**Clock** – how far the clock has run: Seconds × Speed (the Multiply above it), or Speed Travel, the distance a keyframed Speed has covered, when Speed has keyframes (Greater Than checks for that). Times Index Time Scale 4 (Multiply) it counts four swaps a second at Speed 1. Pulse breathes with the same clock.

**Cell Random** – a random number from 0 to 1 for each cell (Random (Cell)), the same in every frame.

**Cell Tick** – the swaps the clock has counted plus the cell's random number, rounded down (Add, Floor): every cell counts its swaps on its own, so they fall at different moments and the picture twinkles evenly instead of jumping all at once.

**Draw** – a new random number for each swap of each cell: Random (Integer Hash) of the cell's random number and its tick (Combine Vector). Neighbouring cells and successive swaps draw unrelated numbers.

**Glyph Offset** – the draw times the number of signs, rounded down (Multiply, Floor): how many steps this swap moves the sign. Roll Window folds it into the window around the cell's own sign.

### Roll Window

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Roll Window folder, first part: Glyph Count minus One times the clamped Roll, through Ceiling and plus One, gives the window; times Half and Floor gives half the window; Tone Glyph minus that half, clamped between Zero and Glyph Count minus the window, gives the window start](../assets/effects/graphs/glyph-matrix-roll-window.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 603" aria-hidden="true" focusable="false">
<defs><marker id="glyph-matrix-roll-window-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M400 48 L400 132" marker-end="url(#glyph-matrix-roll-window-arrow)" />
<circle class="docs-shot-number" cx="400" cy="48" r="18" /><text x="400" y="48" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M509 48 L509 132" marker-end="url(#glyph-matrix-roll-window-arrow)" />
<circle class="docs-shot-number" cx="509" cy="48" r="18" /><text x="509" y="48" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M725 299 L725 215" marker-end="url(#glyph-matrix-roll-window-arrow)" />
<circle class="docs-shot-number" cx="725" cy="299" r="18" /><text x="725" y="299" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M941 394 L941 310" marker-end="url(#glyph-matrix-roll-window-arrow)" />
<circle class="docs-shot-number" cx="941" cy="394" r="18" /><text x="941" y="394" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Roll Window (Roll), the size of the window. 1 — Ceiling: the neighbours a cell rolls through. 2 — Window: how many characters. 3 — Floor: half the window. 4 — Window Start: where the window begins in the ramp.</figcaption>
</figure>

**Ceiling** – Roll times the ramp's length minus one (Subtract, Multiply), rounded up: how many neighbours a cell may swap to. Any Roll above 0 gives at least one.

**Window** – that number plus the cell's own sign (Add): from 1 at Roll 0 to the whole ramp at Roll 1.

**Floor** – half the window, as a whole number (Multiply by Half first): how far the window reaches below the cell's own sign.

**Window Start** – the Tone Glyph minus that half, kept between 0 and the ramp's length minus the window (Clamp). The window never hangs over an end of the ramp: the brightest cells swap among the densest signs and never fall back to empty ones.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Roll Window folder, second part: Tone Glyph minus Window Start plus Glyph Offset gives the step; step plus Half divided by Window, Floor and Multiply give the whole windows rolled through; the step minus them is the place in the window, and Window Start plus that place is the glyph index](../assets/effects/graphs/glyph-matrix-roll-step.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 875" aria-hidden="true" focusable="false">
<defs><marker id="glyph-matrix-roll-step-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M292 320 L292 404" marker-end="url(#glyph-matrix-roll-step-arrow)" />
<circle class="docs-shot-number" cx="292" cy="320" r="18" /><text x="292" y="320" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M617 320 L617 404" marker-end="url(#glyph-matrix-roll-step-arrow)" />
<circle class="docs-shot-number" cx="617" cy="320" r="18" /><text x="617" y="320" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M833 852 L833 768" marker-end="url(#glyph-matrix-roll-step-arrow)" />
<circle class="docs-shot-number" cx="833" cy="852" r="18" /><text x="833" y="852" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M941 600 L941 516" marker-end="url(#glyph-matrix-roll-step-arrow)" />
<circle class="docs-shot-number" cx="941" cy="600" r="18" /><text x="941" y="600" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Roll Window, the roll. 1 — Step: how far the cell has rolled from the window's start. 2 — Divide: how many windows that is. 3 — Place in Window: where it is in the window now. 4 — Glyph Index: the character it shows.</figcaption>
</figure>

**Step** – the cell's own place in its window plus the Glyph Offset (Subtract, then Add).

**Divide** – the step divided by the window (half a step added first, so the division never lands just below a whole number); Floor counts the whole windows passed.

**Place in Window** – the step minus those whole windows (Multiply, Subtract): a place in the window, picked by this swap's draw.

**Glyph Index** – Window Start plus the place in the window (Add): the sign the cell shows now. At Roll 1 the window is the whole ramp, so any sign can come up.

### Atlas Alpha

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Atlas Alpha folder, in two rows: Glyph Index divided by Atlas Columns, Floor, Multiply and Subtract give the row and column of the character in the atlas, Combine Vector joins them; Position in Cell is clamped between Tiny and Almost One; Add, Divide by the atlas size, Sample Image of the Glyph Atlas, Image to RGBA and Split Vector give the glyph coverage](../assets/effects/graphs/ascii-atlas-alpha.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1448" aria-hidden="true" focusable="false">
<defs><marker id="ascii-atlas-alpha-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M422 161 L422 245" marker-end="url(#ascii-atlas-alpha-arrow)" />
<circle class="docs-shot-number" cx="422" cy="161" r="18" /><text x="422" y="161" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M727 299 L727 215" marker-end="url(#ascii-atlas-alpha-arrow)" />
<circle class="docs-shot-number" cx="727" cy="299" r="18" /><text x="727" y="299" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M995 498 L943 498" marker-end="url(#ascii-atlas-alpha-arrow)" />
<circle class="docs-shot-number" cx="995" cy="498" r="18" /><text x="995" y="498" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M422 1091 L422 1175" marker-end="url(#ascii-atlas-alpha-arrow)" />
<circle class="docs-shot-number" cx="422" cy="1091" r="18" /><text x="422" y="1091" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M727 1426 L727 1342" marker-end="url(#ascii-atlas-alpha-arrow)" />
<circle class="docs-shot-number" cx="727" cy="1426" r="18" /><text x="727" y="1426" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Atlas Alpha. The atlas is a sheet of all characters of the ramp, drawn in the chosen Font and Weight. 1 — Floor: the row of the character on the sheet. 2 — Subtract: its column. 3 — Clamp: keeps the read inside the character's square. 4 — Sample Image: reads the sheet. 5 — Split Vector: the coverage.</figcaption>
</figure>

**Floor** – the row of the sign on the atlas, a sheet of all signs of the ramp drawn in the chosen Font and Weight.

**Subtract** – its column on the sheet.

**Clamp** – keeps the read inside the sign's own square on the sheet.

**Sample Image** – reads the sheet at the sign's square plus the place inside the cell.

**Split Vector** – the Glyph Coverage: 1 inside the strokes of the sign, 0 around them.

### Pulse

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Pulse folder: Random (Hash) of the cell number times Symbol Tau 6.2832, and the clock times Symbol Pulse Time Scale 2, are added into the phase; Sine Wave with Symbol Pulse Scale 0.35 and Symbol Pulse Base 0.65 gives the pulse; a last Multiply with the glyph coverage gives the pulsed coverage](../assets/effects/graphs/symbol-matrix-pulse.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 740" aria-hidden="true" focusable="false">
<defs><marker id="symbol-matrix-pulse-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M264 105 L264 189" marker-end="url(#symbol-matrix-pulse-arrow)" />
<circle class="docs-shot-number" cx="264" cy="105" r="18" /><text x="264" y="105" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M427 622 L427 538" marker-end="url(#symbol-matrix-pulse-arrow)" />
<circle class="docs-shot-number" cx="427" cy="622" r="18" /><text x="427" y="622" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M589 105 L589 189" marker-end="url(#symbol-matrix-pulse-arrow)" />
<circle class="docs-shot-number" cx="589" cy="105" r="18" /><text x="589" y="105" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M752 429 L752 345" marker-end="url(#symbol-matrix-pulse-arrow)" />
<circle class="docs-shot-number" cx="752" cy="429" r="18" /><text x="752" y="429" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M914 435 L914 351" marker-end="url(#symbol-matrix-pulse-arrow)" />
<circle class="docs-shot-number" cx="914" cy="435" r="18" /><text x="914" y="435" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Pulse. The number cards are values from the Constants folder, shown where they plug in. 1 — Random (Hash): the cell's own place in its breath. 2 — Multiply: the clock, twice. 3 — Add: the phase. 4 — Sine Wave: the pulse. 5 — Pulsed Coverage: the breathing sign.</figcaption>
</figure>

**Random (Hash)** – a random number for each cell, times a full turn (Symbol Tau 6.2832, the Multiply beside it): where in its breath the cell starts, so neighbours never breathe in step.

**Multiply** – the clock from Glyph Offset times Symbol Pulse Time Scale 2: at Speed 1 one breath lasts about three seconds.

**Add** – both together: where the cell is in its breath right now.

**Sine Wave** – Symbol Pulse Base 0.65 plus Symbol Pulse Scale 0.35 times the sine of that: the pulse, which rises and falls between 0.3 and 1.

**Pulsed Coverage** – the Glyph Coverage from Atlas Alpha times the pulse: the sign fades towards its ground and back. Ink & Appearance draws with it.

**Remix:** open the **Constants** folder and set **Symbol Pulse Base** and **Symbol Pulse Scale** both to **0.5**: every sign fades out completely at the bottom of its breath, and the picture sparkles like stars. Scale **0** stops the breathing.

### Ink & Appearance

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Ink and Appearance folder: Cell Color, Duotone and Source Mode go into the Mix that gives Ink; Cell Color times Source Dark Scale 0.08 and the duotone dark ground go into the Mix that gives Dark Ground; a Mix by Background lifts it towards Ink into Ground; a Mix by the Pulsed Coverage puts the Ink on its Ground into Glyph Cell; a last Mix by Amount fades from Original Color to Faded Color](../assets/effects/graphs/symbol-matrix-ink-and-appearance.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 2571" aria-hidden="true" focusable="false">
<defs><marker id="symbol-matrix-ink-and-appearance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M993 967 L909 967" marker-end="url(#symbol-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="993" cy="967" r="18" /><text x="993" y="967" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M793 263 L793 347" marker-end="url(#symbol-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="793" cy="263" r="18" /><text x="793" y="263" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M220 1504 L220 1588" marker-end="url(#symbol-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="220" cy="1504" r="18" /><text x="220" y="1504" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M507 1695 L507 1741" marker-end="url(#symbol-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="507" cy="1695" r="18" /><text x="507" y="1695" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M793 1657 L793 1741" marker-end="url(#symbol-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="793" cy="1657" r="18" /><text x="793" y="1657" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Ink & Appearance (Color Source, Dark, Light, Background, Amount). Each Mix is named by its output. 1 — Ink: the sign's colour. 2 — Dark Ground: the dark cell. 3 — Ground: lifted by Background. 4 — Glyph Cell: the sign on its ground. 5 — Faded Color: Amount.</figcaption>
</figure>

**Ink** – the colour of the sign: the cell colour with Source, between Dark and Light with Duotone.

**Dark Ground** – the cell behind it as classic character art has it: the cell colour × 0.08, or Dark × 0.15 with Duotone.

**Ground** – the dark ground lifted towards the ink by **Background**.

**Glyph Cell** – the ink on its ground, by the Pulsed Coverage from Pulse.

**Faded Color** – the untouched picture faded towards the glyph cell by **Amount**, pixel by pixel, transparency included.

## Technical details

- **Size.** Cell Size counts pixels of a frame whose shorter side is 1080: a 4K export, a portrait frame, a lower Preview Quality and the thumbnails show the same grid. A cell is never smaller than 2 pixels of the frame; below 2 px Cell Size renders as 2, and the card says so.
- **Time.** The swaps and the breathing follow the timeline time: scrubbing, playback and export give the same frame for the same moment, and a paused picture needs no extra rendering. With keyframes on Speed both move by the distance Speed has travelled, so they never jump.
- **Swaps.** Each cell swaps 4 × Speed times a second, shifted by its own random share of a swap, to a random sign of its window: 1 + Roll × (ramp − 1) signs, rounded up, around its own one and kept inside the ramp. Its coverage breathes as 0.65 + 0.35 × sin(2 × clock + its own phase). A Roll outside 0 to 1 renders as 0 or 1, and the card and the tools say so.
- **Transparency.** Each cell takes the transparency of its centre, so a cut-out figure keeps its outline in whole cells. Amount fades the transparency back to the original's, pixel by pixel.
- **Saved projects.** A Symbol Matrix stores its node setup and keeps its look. Effects saved without a stored setup now swap each cell at its own moment; before, every cell swapped on the same frame and the random signs slid diagonally across the frame, a bug. They load with Roll 1, the whole ramp they had, and those saved before Background existed with Background 0.
- **More:** [Effect system](../Effect-System.md#glyph-cell-and-compute-effects) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
