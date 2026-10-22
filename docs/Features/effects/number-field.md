# Number Field

Rebuilds the picture from figures in a few flat colours, like a picture to paint by numbers. The brighter a part, the higher its figure and the lighter its colour; **Steps** sets how many colours there are.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![The dancer's upper body and swirling dress on a dark stage, original left and with Number Field right: the picture is rebuilt from the digits 1 to 9, the brighter the part the higher the digit, coloured in five flat steps from near-black to pale mint, so her dress becomes a block of bright 7s and 8s on stepped grey ground while the dark stage holds faint 1s](../assets/effects/number-field.webp)

<figcaption>Left: original. Right: Number Field at its default settings.</figcaption>
</figure>

**Use it for:** data and statistics on stage · a person reduced to numbers · countdowns, scoreboards and departure boards.

- **Cell Size** – how big the figures are.
- **Steps** – how many colours.
- **Dark** and **Light** – the colours of the darkest and the brightest parts.
- **Background** – how much colour fills each cell behind its figure.

**Tip:** type as many figures into **Custom Ramp** as there are **Steps** (`12345` with Steps 5): every cell then carries the number of its colour. Or keyframe **Steps** from 2 up to 10 to let a stark two-tone figure open into fine shades on a cue.

## Presets

<figure class="docs-shot">

![The dancer's head and arms four times in a grid, one preset each: Countdown top left with large amber serif figures on brown-black, Paint by Numbers top right with gold and grey figures 1 to 5 on a navy field, the figure matching its colour, Signal Red bottom left with bold vermilion figures on near-black, Census bottom right with fine pale violet figures in many shades](../assets/effects/presets/number-field.webp)

<figcaption>The four presets on the dancer, each named under its picture.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Countdown** – large amber serif figures in three steps on brown-black, like a countdown, a scoreboard or an old departure board. Every lit cell glows as an amber block behind its figure. For time running out, waiting, a station at night.

**Paint by Numbers** – every cell carries the number of its colour, 1 to 5, from navy to gold: the Custom Ramp `12345` has as many figures as there are Steps. Background 0.6 fills the cells, so the picture reads as numbered flat areas. For childhood, craft, a picture still waiting for its colours.

**Signal Red** – two steps only: bold vermilion figures where the picture is lit, near-black everywhere else. Graphic and loud; for alarms, propaganda, a figure singled out.

**Census** – fine pale violet figures in ten shades. With the Numeric ramp and Steps 10 every figure names its own shade, 1 for the darkest, 9 for the brightest. For statistics, crowds, a person counted.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Number Field card: Style menu, Preset menu showing Paint by Numbers, Cell Size, then Amount, Background, Black Level and Invert Ramp, then Ramp, Custom Ramp holding 12345, Font and Weight, then Dark in navy, Light in gold and Steps at 5, beside a strip of the preview where the dancer is drawn in gold and grey figures 1 to 5 on a navy field](../assets/effects/editor/number-field-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1171" aria-hidden="true" focusable="false">
<defs><marker id="number-field-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 319 L649 319" marker-end="url(#number-field-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="319" r="18" /><text x="565" y="319" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M583 425 L667 425" marker-end="url(#number-field-inspector-arrow)" />
<circle class="docs-shot-number" cx="583" cy="425" r="18" /><text x="583" y="425" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M559 578 L643 578" marker-end="url(#number-field-inspector-arrow)" />
<circle class="docs-shot-number" cx="559" cy="578" r="18" /><text x="559" y="578" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M541 845 L625 845" marker-end="url(#number-field-inspector-arrow)" />
<circle class="docs-shot-number" cx="541" cy="845" r="18" /><text x="541" y="845" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M607 1111 L691 1111" marker-end="url(#number-field-inspector-arrow)" />
<circle class="docs-shot-number" cx="607" cy="1111" r="18" /><text x="607" y="1111" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Number Field with the Paint by Numbers preset. 1 — Preset: pick a starting point. 2 — Cell Size. 3 — Background: how much colour fills each cell. 4 — Custom Ramp: here the figures 1 to 5. 5 — Steps: how many colours.</figcaption>
</figure>


**Style** – switches to another look of the same engine and keeps your values and keyframes, for example [ASCII](./ascii.md), [Grid Glyph](./grid-glyph.md) or [Pixel Code](./pixel-code.md). **Steps** belongs to Number Field alone: other looks leave it unread, and switching back brings it back. **Undo** brings the old look back.

### Grid

**Cell Size** – how big one cell, and the figure in it, is. 8–11 gives a fine sheet of figures that reads as a picture from afar (Census), 14–22 clearly readable figures, 40 and more a few large figures, like a countdown; at 72 the frame holds only 15 rows. It counts pixels of a 1080p picture, so the preview, the thumbnails and a 4K export show the same figures. 4 to 72 px, default 14 px.

### Style

**Amount** – how much of the effect you see. At 0 the original picture, unchanged; in between, the figures fade in over it. Keyframe it to let the picture dissolve into numbers. 0 to 1, default 1.

**Background** – how much of its colour fills each cell behind the figure. At 0 the figures stand on black; 0.2 lets the colour steps show faintly as flat areas; 0.5–0.7 fills the cells, so the picture reads as numbered patches of colour (Paint by Numbers); at 1 the figures vanish into a plain mosaic of the Steps colours. 0 to 1, default 0.2.

**Black Level** – the brightness up to which the picture counts as black. Everything darker gets the first character of the ramp, the space in Numeric (with Invert Ramp the last one), and the darkest colour, so a grey stage drops out and only the lit figure is written; the rest spreads over all figures and all colours. Try 0.1–0.2 on stage footage. 0 to 0.9, default 0.

**Invert Ramp** – swaps the ends of the ramp: dark parts get the high figures, bright parts the low ones, and the brightest parts none at all. The colours stay, so the brightest parts are still the lightest. Either on or off, default off.

### Glyphs

**Ramp** – the characters the picture is built from, from the darkest to the brightest part. **Numeric** (the digits 1 to 9 after a space) makes the field of numbers; **Binary** writes only 0 and 1; **Standard**, **Detailed**, **Blocks**, **Bars** and **Symbols** turn it into ASCII art, shading blocks, level bars or signs, all in flat colours. While a Custom Ramp is typed, the row rests and the card dims it. In the menu: Standard, Detailed, Blocks, Bars, Binary and 2 more, default Numeric.

**Custom Ramp** – your own characters, from dark to bright, instead of the Ramp. With as many characters as Steps (`12345` with Steps 5) every cell carries the number of its colour (Paint by Numbers). Spaces at the end are ignored, and a ramp longer than 256 characters is thinned to 256 (the card says so). Clear it to use the Ramp again. Any text, default empty.

**Font** – the lettering. **Monospace** draws the even figures of a terminal or a ledger; **Serif** the figures of a clock face or a timetable (Countdown); **Sans Serif** plain ones for signs (Signal Red). Each is narrowed to fit its cell. Monospace, Serif, Sans Serif, default Monospace.

**Weight** – how heavy the strokes are. Heavier figures carry more colour, so the picture gets brighter. How many steps you see depends on the font: the built-in monospace font of many systems only has regular (up to 500) and bold (600 and more). Keyframes step from one weight to the next. 200 to 900, default 600.

### Color

**Dark** – the colour of the darkest step, and of the ground in the dark parts. A Dark that is not black, such as a deep navy, lets the steps show across the whole frame, the empty stage too. Pick a colour, default `#081018`.

**Light** – the colour of the brightest step: pure white takes it exactly. The steps in between are spaced evenly from Dark to Light, so two colours of one family (brown-black to amber) keep every step warm, while colours far apart on the colour wheel meet in a grey in the middle. Pick a colour, default `#e8fff5`.

**Steps** – how many flat colours the figures take, spaced evenly from Dark to Light by brightness. 2 is a hard two-tone, figure against ground (Signal Red); 3–5 reads like a poster; 10 and more gives soft shading. With the Numeric ramp at 10, every figure names its own shade (Census). Keyframes step from one count to the next; a value outside the range renders as 2 or 16, and the card says so. 2 to 16, default 5.

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Number Field graph in six stages: Parameters feed Cell Grid (Cell Size), which passes the cell centre to Cell Sampling & Tone and the position in the cell to Atlas Alpha; the Tone goes to Tone to Glyph, whose glyph index goes to Atlas Alpha, and to Color Steps (Steps), whose Step Tone goes to Ink & Appearance; Ink & Appearance (Dark, Light, Background, Amount) also takes the glyph coverage and the cell alpha and draws the picture](../assets/effects/graphs/number-field.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 939" aria-hidden="true" focusable="false">
<defs><marker id="number-field-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M264 529 L264 445" marker-end="url(#number-field-arrow)" />
<circle class="docs-shot-number" cx="264" cy="529" r="18" /><text x="264" y="529" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M427 552 L427 636" marker-end="url(#number-field-arrow)" />
<circle class="docs-shot-number" cx="427" cy="552" r="18" /><text x="427" y="552" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M589 583 L589 499" marker-end="url(#number-field-arrow)" />
<circle class="docs-shot-number" cx="589" cy="583" r="18" /><text x="589" y="583" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M904 817 L820 817" marker-end="url(#number-field-arrow)" />
<circle class="docs-shot-number" cx="904" cy="817" r="18" /><text x="904" y="817" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M752 484 L752 568" marker-end="url(#number-field-arrow)" />
<circle class="docs-shot-number" cx="752" cy="484" r="18" /><text x="752" y="484" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M914 399 L914 315" marker-end="url(#number-field-arrow)" />
<circle class="docs-shot-number" cx="914" cy="399" r="18" /><text x="914" y="399" class="docs-shot-number-text">6</text>
</svg>
</div>

<figcaption>Number Field opened in the Nodes tab (input frame and output left out). 1 — Cell Grid: which cell a pixel lies in. 2 — Cell Sampling & Tone: the brightness of the cell. 3 — Tone to Glyph: which figure it gets. 4 — Atlas Alpha: where that figure covers the cell. 5 — Color Steps: which colour step it gets. 6 — Ink & Appearance: colours and ground.</figcaption>
</figure>

Number Field works in six stages, one folder each in the Nodes tab: **Cell Grid** cuts the frame into square cells, **Cell Sampling & Tone** reads the brightness in the middle of each cell, **Tone to Glyph** picks a figure of the ramp for that brightness, **Atlas Alpha** looks up where the figure covers the cell, **Color Steps** cuts the same brightness into Steps bands, and **Ink & Appearance** colours the figure and its ground with the colour of its band. Click a folder's header to open it. Color Steps makes the flat colours; the other folders work as in [ASCII](./ascii.md#node-setup). Number Field is one look of the glyph engine that the [Text & Glyph](../Effects-Glyph.md#the-shared-idea) looks share; its **Style** menu switches between them.

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

**Smallest Component** – the shorter side of the frame; divided by 1080 it scales Cell Size, so a 4K export, a portrait frame and a thumbnail show the same figures.

**Maximum** – the cell size in pixels of this frame, never smaller than 2.

**Floor** – which cell the pixel lies in, counted in columns and rows.

**Fraction** – where the pixel lies inside its cell, from 0 to 1; Atlas Alpha draws the figure with it.

**Divide** – the middle of the cell, where the whole cell reads the picture.

### Cell Sampling & Tone

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Cell Sampling and Tone folder: Cell Center, Tiny, Almost One and Frame feed Clamped Image Sample, which feeds Split RGB + Alpha, whose colour goes into Luminance; Black Level, clamped between Zero and Black Level Max 0.9, is subtracted from the luminance and from One, a Divide stretches the rest, and a last Clamp between Zero and One gives the Tone](../assets/effects/graphs/ascii-cell-sampling.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 813" aria-hidden="true" focusable="false">
<defs><marker id="ascii-cell-sampling-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M230 558 L230 474" marker-end="url(#ascii-cell-sampling-arrow)" />
<circle class="docs-shot-number" cx="230" cy="558" r="18" /><text x="230" y="558" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M369 236 L369 320" marker-end="url(#ascii-cell-sampling-arrow)" />
<circle class="docs-shot-number" cx="369" cy="236" r="18" /><text x="369" y="236" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M508 502 L508 418" marker-end="url(#ascii-cell-sampling-arrow)" />
<circle class="docs-shot-number" cx="508" cy="502" r="18" /><text x="508" y="502" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M787 129 L787 213" marker-end="url(#ascii-cell-sampling-arrow)" />
<circle class="docs-shot-number" cx="787" cy="129" r="18" /><text x="787" y="129" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M926 593 L926 509" marker-end="url(#ascii-cell-sampling-arrow)" />
<circle class="docs-shot-number" cx="926" cy="593" r="18" /><text x="926" y="593" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Cell Sampling & Tone (Black Level). 1 — Clamped Image Sample: reads the picture at the cell centre. 2 — Split RGB + Alpha: colour and transparency. 3 — Luminance: the brightness. 4 — Divide: Black Level. 5 — Clamp: the tone.</figcaption>
</figure>

**Clamped Image Sample** – reads the input picture at the cell centre, never outside the frame.

**Split RGB + Alpha** – the cell's colour and its transparency. Number Field takes only the brightness of the colour; the transparency becomes that of the whole cell.

**Luminance** – the brightness of the cell colour, weighted the way the eye sees it (green counts most).

**Divide** – applies **Black Level**: the luminance minus Black Level (Subtract), divided by what is left above it (the other Subtract: One minus Black Level). The Clamp next to Black Level keeps it between 0 and Black Level Max 0.9.

**Clamp** – keeps the result between 0 and 1, so everything darker than Black Level becomes 0: the Tone. It picks the figure and, in Color Steps, the colour.

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

<figcaption>Inside Tone to Glyph (Invert Ramp). 1 — Subtract: the inverted tone. 2 — Switch: plain or inverted. 3 — Clamp: keeps the tone inside the ramp. 4 — Multiply: spreads it over the ramp. 5 — Floor: the character number.</figcaption>
</figure>

**Subtract** – one minus the tone, for Invert Ramp.

**Switch** – the tone as it is, or inverted when **Invert Ramp** is on.

**Clamp** – keeps the tone just under 1, so the brightest cells get the last character and never one past it.

**Multiply** – spreads the tone over the number of characters in the ramp.

**Floor** – drops the fraction: the number of the character, 0 for the first (the space of the Numeric ramp) up to the last.

### Atlas Alpha

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Atlas Alpha folder, in two rows: Glyph Index divided by Atlas Columns, Floor, Multiply and Subtract give the row and column of the character in the atlas, Combine Vector joins them; Position in Cell is clamped between Half Texel and One Minus Half Texel; Add, Divide by the atlas size, Sample Image of the Glyph Atlas, Image to RGBA and Split Vector give the glyph coverage](../assets/effects/graphs/ascii-atlas-alpha.webp)

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

<figcaption>Inside Atlas Alpha. The atlas is a sheet of all characters of the ramp, drawn in the chosen Font and Weight. 1 — Floor: the row of the character on the sheet. 2 — Subtract: its column. 3 — Clamp: keeps the read half a pixel inside the character's square. 4 — Sample Image: reads the sheet. 5 — Split Vector: the coverage.</figcaption>
</figure>

**Floor** – the row of the character on the atlas, a sheet of all characters of the ramp drawn in the chosen Font and Weight.

**Subtract** – its column on the sheet.

**Clamp** – keeps the place inside the cell half a pixel of the sheet away from the edges of the character's square (Half Texel, 0.5 of the 64 pixels of a square, and One Minus Half Texel), so the smoothed read never mixes in the neighbouring character.

**Sample Image** – reads the sheet at the character's square plus the place inside the cell.

**Split Vector** – the Glyph Coverage: 1 inside the strokes of the figure, 0 around them. Ink & Appearance colours it.

### Color Steps

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Color Steps folder: Steps plus Half (Add) and Floor give Whole Steps, a Clamp between Fewest Steps 2 and Most Steps 16 gives the Step Count, and Subtract One gives the Last Step; Tone times the Step Count (Multiply) and Floor give the Band, Minimum with the Last Step gives the Step Number, and Divide by the Last Step gives the Step Tone](../assets/effects/graphs/number-field-color-steps.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 469" aria-hidden="true" focusable="false">
<defs><marker id="number-field-color-steps-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M326 62 L326 146" marker-end="url(#number-field-color-steps-arrow)" />
<circle class="docs-shot-number" cx="326" cy="62" r="18" /><text x="326" y="62" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M448 397 L448 313" marker-end="url(#number-field-color-steps-arrow)" />
<circle class="docs-shot-number" cx="448" cy="397" r="18" /><text x="448" y="397" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M691 62 L691 146" marker-end="url(#number-field-color-steps-arrow)" />
<circle class="docs-shot-number" cx="691" cy="62" r="18" /><text x="691" y="62" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M813 326 L813 242" marker-end="url(#number-field-color-steps-arrow)" />
<circle class="docs-shot-number" cx="813" cy="326" r="18" /><text x="813" y="326" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M935 62 L935 146" marker-end="url(#number-field-color-steps-arrow)" />
<circle class="docs-shot-number" cx="935" cy="62" r="18" /><text x="935" y="62" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Color Steps (Steps). The number cards are values from the Constants folder, shown where they plug in. 1 — Whole Steps: Steps as a whole count. 2 — Step Count: kept between 2 and 16. 3 — Band: which band the tone falls in. 4 — Step Number: pure white stays in the last band. 5 — Step Tone: the band as a share from Dark to Light.</figcaption>
</figure>

**Whole Steps** – Steps plus Half (Add), without its fraction (Floor): Steps rounded to a whole count, so a keyframed Steps jumps from one count to the next instead of giving uneven bands.

**Step Count** – the Clamp keeps the count between Fewest Steps 2 and Most Steps 16; a value outside renders as 2 or 16, and the card says so. Subtract takes One from it: the Last Step.

**Band** – the Tone times the count (Multiply, Tone × Steps) without its fraction (Floor): the band the brightness falls in, 0 for the darkest.

**Step Number** – the smaller of Band and Last Step (Minimum). Pure white would fall one band past the last, so it stays in the last one and takes Light exactly.

**Step Tone** – Step Number divided by Last Step: 0 for the darkest band, 1 for the brightest, evenly spaced in between. Ink & Appearance mixes Dark and Light by it.

**Remix:** open **Color Steps** and drag a cable from the output of Multiply (Tone × Steps) onto A of Minimum, past the Floor that makes the **Band**: the colours flow smoothly from Dark to Light instead of in steps, and Steps only sets how early the brightest parts reach Light.

### Ink & Appearance

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Ink and Appearance folder: Dark, Light and the Step Tone from Color Steps go into the Mix that gives Step Color; Background, One and the Glyph Coverage go into the Mix that gives Coverage; Step Color times Coverage gives Glyph Cell; Original Color and the glyph cell, each times its alpha, are mixed by Amount, and a Divide by Faded Alpha gives the Faded Color](../assets/effects/graphs/number-field-ink-and-appearance.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 924" aria-hidden="true" focusable="false">
<defs><marker id="number-field-ink-and-appearance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M264 649 L264 565" marker-end="url(#number-field-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="264" cy="649" r="18" /><text x="264" y="649" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M264 22 L264 102" marker-end="url(#number-field-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="264" cy="22" r="18" /><text x="264" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M427 22 L427 102" marker-end="url(#number-field-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="427" cy="22" r="18" /><text x="427" y="22" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M914 348 L914 264" marker-end="url(#number-field-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="914" cy="348" r="18" /><text x="914" y="348" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Ink & Appearance (Dark, Light, Background, Amount). Each node is named by its output. 1 — Step Color: the colour of the cell's step. 2 — Coverage: figure or ground. 3 — Glyph Cell: the figure on its ground. 4 — Faded Color: Amount, back to plain colour.</figcaption>
</figure>

**Step Color** – mixes Dark and Light by the Step Tone from Color Steps: the one flat colour of the cell, for its figure and its ground.

**Coverage** – moves **Background** towards One by the Glyph Coverage (Mix): 1 inside the strokes of the figure, Background around them.

**Glyph Cell** – Step Color times Coverage (Multiply): the figure in the full colour of its step, the ground in a share of it, black at Background 0.

**Faded Color** – fades the untouched picture, pixel by pixel, towards the glyph cell by **Amount** and divides by the faded alpha. Both are first multiplied by their transparency, so the colour a transparent pixel hides never shows as a fringe around a cut-out figure.

## Technical details

- **Size.** Cell Size counts pixels of a frame whose shorter side is 1080: a 4K export, a portrait 1080 × 1920 frame, a lower Preview Quality and the thumbnails show the same figures. A cell is never smaller than 2 pixels; below that Cell Size renders as 2, and the card says so.
- **Steps.** Each cell takes one of Steps colours, spaced evenly from Dark to Light by its brightness after Black Level; pure white takes Light exactly. Steps renders as a whole count between 2 and 16; outside that range the card says so.
- **Characters.** The figures come from an atlas, a sheet the engine draws for the Ramp, Font and Weight and keeps. Its tallest character spans 88 % of the cell height. Weight is drawn in steps of 100.
- **Time.** Number Field does not move by itself: on footage it changes with every frame of the clip, and a paused picture needs no extra rendering.
- **Transparency.** Each cell, its figure and its ground take the transparency of the cell's centre, so a cut-out figure keeps its outline in whole cells. Amount fades the transparency back to the original's, pixel by pixel, without a fringe.
- **Saved projects.** A Number Field that stores its node setup keeps its look, including the earlier fixed five steps, in which pure white went a quarter step past Light: a sixth colour, brighter than Light and outside the normal range. Effects saved without a stored setup get Steps 5 with pure white on Light; this is a fix. The card of a new Number Field no longer shows Color Source, which the look never read. Presets fully apply only to effects added in this version: a stored setup from before has no Background, Black Level or Steps row, so a preset leaves those values out.
- **More:** [Effect system](../Effect-System.md#glyph-cell-and-compute-effects) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
