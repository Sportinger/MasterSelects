# Grid Glyph

Rebuilds the picture from characters, each in its own ruled box, like a type case or a table of figures. The lines glow in the colour of their cell, so the grid lights up with the picture.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![The dancer's upper body and swirling dress on a dark stage, original left and with Grid Glyph right: the picture is rebuilt from characters, each in its own square cell ruled by a thin line in the colour of the cell, so her dress becomes a lit table of # and % signs while the lines fade into the dark stage](../assets/effects/grid-glyph.webp)

<figcaption>Left: original. Right: Grid Glyph at its default settings.</figcaption>
</figure>

**Use it for:** letters, archives and print on stage · numbers, data and surveillance · a tiled wall or mosaic on a large projection.

- **Cell Size** – how big the boxes are.
- **Line Width** – how thick the lines are.
- **Line Glow** – how brightly they shine.
- **Background** – how much of the picture glows behind the characters.

**Tip:** on stage footage set **Black Level** to about 0.1: the dim stage no longer fills every box with a dot, and the figure stands clear in the grid. Keyframe **Line Width** from 0 to 1.5 to rule the grid over a typed picture on a cue.

## Presets

<figure class="docs-shot">

![The dancer's upper body four times in a grid, one preset each: Type Case top left with large serif letters, each in a box with a fine lit frame, Data Sheet top right with pale digits in a slate-blue table that covers the whole frame, Circuit Board bottom left with bold gold zeros and ones in a fine grid on dark board green, Mosaic Tiles bottom right with one square tile per cell in the picture's colours and dark joints between them](../assets/effects/presets/grid-glyph.webp)

<figcaption>The four presets on the dancer, each named under its picture.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Type Case** – serif letters, each in its own box with a fine lit frame, like the compartments of a printer's type case. Black Level 0.12 keeps the dark stage quiet, so the figure reads in the brightest boxes. For a world of print, archives, letters and memory.

**Data Sheet** – pale figures in a slate-blue table, like a spreadsheet of numbers. Its Dark is a slate blue instead of black, so the grid rules the whole frame, the empty stage too. For data, offices, a person reduced to numbers.

**Circuit Board** – bold gold zeros and ones in a fine grid on dark board green, like the copper traces of a circuit board. For machines, control rooms and digital worlds.

**Mosaic Tiles** – one full block per cell in the picture's colour, with dark joints between them: the picture becomes a wall of square tiles. Line Glow 0.05 turns the lines into the joints. Calm and graphic; strong on large surfaces.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Grid Glyph card: Style menu, Preset menu showing Circuit Board, then Cell Size, Line Width and Line Glow, then Amount, Background, Black Level and Invert Ramp, then Ramp set to Binary, Custom Ramp, Font and Weight, then Color Source set to Duotone with a dark board-green Dark and a gold Light, beside a strip of the preview where the dancer is drawn in gold zeros and ones in a fine grid on dark green](../assets/effects/editor/grid-glyph-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1207" aria-hidden="true" focusable="false">
<defs><marker id="grid-glyph-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 319 L649 319" marker-end="url(#grid-glyph-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="319" r="18" /><text x="565" y="319" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M583 425 L667 425" marker-end="url(#grid-glyph-inspector-arrow)" />
<circle class="docs-shot-number" cx="583" cy="425" r="18" /><text x="583" y="425" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M569 462 L653 462" marker-end="url(#grid-glyph-inspector-arrow)" />
<circle class="docs-shot-number" cx="569" cy="462" r="18" /><text x="569" y="462" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M574 500 L658 500" marker-end="url(#grid-glyph-inspector-arrow)" />
<circle class="docs-shot-number" cx="574" cy="500" r="18" /><text x="574" y="500" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M550 1072 L634 1072" marker-end="url(#grid-glyph-inspector-arrow)" />
<circle class="docs-shot-number" cx="550" cy="1072" r="18" /><text x="550" y="1072" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Grid Glyph with the Circuit Board preset. 1 — Preset: pick a starting point. 2 — Cell Size. 3 — Line Width: how thick the lines are. 4 — Line Glow: how brightly they shine. 5 — Color Source: here Duotone.</figcaption>
</figure>

**Style** – switches to another look of the same engine and keeps your values and keyframes, for example [ASCII](./ascii.md), [Number Field](./number-field.md) or [Pixel Code](./pixel-code.md). **Line Width** and **Line Glow** belong to Grid Glyph alone: other looks leave them unread, and switching back brings them back. **Undo** brings the old look back.

### Grid

**Cell Size** – how big one box, and the character in it, is. 10–14 gives a fine table that reads as a picture from afar, 18 small boxed characters with a clearly visible grid, 30 and more large letters each in a box of its own, like a type case; at 72 the frame holds only 15 rows. It counts pixels of a 1080p picture, so the preview, the thumbnails and a 4K export show the same grid. 4 to 72 px, default 18 px.

**Line Width** – how thick the ruled lines are. 1 is a hairline, one pixel of a 1080p picture; 2–3 gives the joints of a tiled wall; 6 and more broad frames that leave only a small window for each character. At 0 no lines are ruled, and the look is plain [ASCII](./ascii.md). Every box carries its line along its top and left edge, so each border is one line. A line is at most half a box wide, so the characters never disappear: with small boxes, say Cell Size 6 and Line Width 8, the line renders as 3 px, and the card says so. Like Cell Size it counts pixels of a 1080p picture: a hairline stays a hairline at every Preview Quality and export size. 0 to 8 px, default 1 px.

**Line Glow** – how brightly the lines shine, in the colour of their box. At 0.4 they glow softly, so the grid lights up with the figure and fades into a dark stage; at 1 they take the full colour of the box; at 0 they become dark joints that cut through the characters, which suits full blocks (Mosaic Tiles). With Color Source on Source a line is never brighter than its box, so the grid stays dark where the picture is black. 0 to 1, default 0.4.

### Style

**Amount** – how much of the effect you see. At 0 the original picture, unchanged; in between, the ruled characters fade in over it. Keyframe it to type a picture in. 0 to 1, default 1.

**Background** – how much of the picture fills each box behind its character. At 0 characters and lines stand on a near-black ground; 0.2–0.4 lets the picture glow through, so the figure reads as a lit table; towards 1 the boxes take the full colour of their character, and characters and lines vanish into a plain mosaic. 0 to 1, default 0.2.

**Black Level** – the brightness up to which the picture counts as black. Everything darker becomes the first character of the ramp, the space in most ramps (with Invert Ramp the last, densest one), so a grey stage drops out and only the lit figure is typed; the rest of the picture spreads over the whole ramp, so the figure gets more different characters. The lines stay. Try 0.1–0.2 on stage footage. 0 to 0.9, default 0.

**Invert Ramp** – swaps the ends of the ramp: dark parts get the dense characters and bright parts the light ones, like a negative typed on paper. The colours and the lines stay. Either on or off, default off.

### Glyphs

**Ramp** – the row of characters the picture is built from, from the darkest to the brightest part. **Standard** (`.:-=+*#%@` after a space) is classic ASCII art in boxes; **Detailed** uses about seventy letters and signs (Type Case); **Blocks** fills each box with the shading blocks ░ ▒ ▓ █; **Bars** with a bar that rises with brightness, like a table of level meters; **Binary** writes only 0 and 1 (Circuit Board); **Numeric** the digits 1 to 9 (Data Sheet); **Symbols** dots, crosses and stars. While a Custom Ramp is typed, the row rests and the card dims it. In the menu: Standard, Detailed, Blocks, Bars, Binary and 2 more, default Standard.

**Custom Ramp** – your own characters, from dark to bright, instead of the Ramp. Start with a space so the darkest boxes stay empty; a single full block `█` fills every box and lets the lines and the colour carry the picture (Mosaic Tiles). Spaces at the end are ignored, and a ramp longer than 256 characters is thinned to 256, spread from its first to its last (the card says so). Clear it to use the Ramp again. Any text, default empty.

**Font** – the lettering. **Monospace** draws the even signs of a terminal; **Serif** the bookish letters of a type case; **Sans Serif** plain modern ones; each is narrowed to fit its box. Monospace, Serif, Sans Serif, default Monospace.

**Weight** – how heavy the strokes are. Heavier letters carry more colour, so the picture gets brighter. How many steps you see depends on the font: the built-in monospace font of many systems only has regular (up to 500) and bold (600 and more). Keyframes step from one weight to the next. 200 to 900, default 600.

### Color

**Color Source** – where the colour of the characters and their lines comes from. **Source** takes the colour of the picture under each box; **Duotone** colours them between **Dark** for the dark parts and **Light** for the bright parts, for a single-colour look such as Data Sheet or Circuit Board. Source, Duotone, default Source.

**Dark** – the colour of the darkest characters and of the lines in the dark parts in Duotone; the ground behind them is a deep shade of it. A Dark that is not black lets the grid show across the whole frame. With Source it rests, and the card dims it. Pick a colour, default `#081018`.

**Light** – the colour of the brightest characters and lines in Duotone. With Source it rests, and the card dims it. Pick a colour, default `#e8fff5`.

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Grid Glyph graph in six stages: Parameters feed Cell Grid (Cell Size), which passes the cell centre to Cell Sampling & Tone and the position in the cell to Atlas Alpha and Grid Lines; Tone to Glyph turns the tone into the glyph index for Atlas Alpha; Grid Lines (Line Width, Line Glow) rules the lines into the glyph coverage; Ink & Appearance (Color Source, Dark, Light, Background, Amount) colours the character, its lines and its ground](../assets/effects/graphs/grid-glyph.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 729" aria-hidden="true" focusable="false">
<defs><marker id="grid-glyph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M230 706 L230 622" marker-end="url(#grid-glyph-arrow)" />
<circle class="docs-shot-number" cx="230" cy="706" r="18" /><text x="230" y="706" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M369 236 L369 320" marker-end="url(#grid-glyph-arrow)" />
<circle class="docs-shot-number" cx="369" cy="236" r="18" /><text x="369" y="236" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M508 279 L508 195" marker-end="url(#grid-glyph-arrow)" />
<circle class="docs-shot-number" cx="508" cy="279" r="18" /><text x="508" y="279" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M648 669 L648 585" marker-end="url(#grid-glyph-arrow)" />
<circle class="docs-shot-number" cx="648" cy="669" r="18" /><text x="648" y="669" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M787 22 L787 97" marker-end="url(#grid-glyph-arrow)" />
<circle class="docs-shot-number" cx="787" cy="22" r="18" /><text x="787" y="22" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M926 572 L926 488" marker-end="url(#grid-glyph-arrow)" />
<circle class="docs-shot-number" cx="926" cy="572" r="18" /><text x="926" y="572" class="docs-shot-number-text">6</text>
</svg>
</div>

<figcaption>Grid Glyph opened in the Nodes tab (input frame and output left out). 1 — Cell Grid: which cell a pixel lies in. 2 — Cell Sampling & Tone: the colour and brightness of the cell. 3 — Tone to Glyph: which character it gets. 4 — Atlas Alpha: where that character covers the cell. 5 — Grid Lines: where the ruled lines lie. 6 — Ink & Appearance: colours and ground.</figcaption>
</figure>

Grid Glyph works in six stages, one folder each in the Nodes tab: **Cell Grid** cuts the frame into square cells, **Cell Sampling & Tone** reads the colour and brightness in the middle of each cell, **Tone to Glyph** picks a character of the ramp for that brightness, **Atlas Alpha** looks up where the character covers the cell, **Grid Lines** rules the lines along the cell borders into that coverage, and **Ink & Appearance** colours the character, its lines and its ground. Click a folder's header to open it. Grid Lines makes the grid; the other folders work as in [ASCII](./ascii.md#node-setup). Grid Glyph is one look of the glyph engine that the [Text & Glyph](../Effects-Glyph.md#the-shared-idea) looks share; its **Style** menu switches between them.

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

**Smallest Component** – the shorter side of the frame; divided by 1080 it scales Cell Size and Line Width, so a 4K export, a portrait frame and a thumbnail show the same grid.

**Maximum** – the cell size in pixels of this frame, never smaller than 2.

**Floor** – which cell the pixel lies in, counted in columns and rows.

**Fraction** – where the pixel lies inside its cell, from 0 to 1; Atlas Alpha draws the character with it, and Grid Lines finds the borders with it.

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

**Split RGB + Alpha** – the cell's colour and its transparency. The colour becomes the ink of the character and its lines, the transparency that of the whole cell.

**Luminance** – the brightness of the cell colour, weighted the way the eye sees it (green counts most).

**Divide** – applies **Black Level**: the luminance minus Black Level (Subtract), divided by what is left above it (the other Subtract: One minus Black Level). The Clamp next to Black Level keeps it between 0 and Black Level Max 0.9.

**Clamp** – keeps the result between 0 and 1, so everything darker than Black Level becomes 0: the Tone. It picks the character.

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

**Floor** – drops the fraction: the number of the character, 0 for the first (the space of the Standard ramp) up to the last.

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

**Split Vector** – the Glyph Coverage: 1 inside the strokes of the character, 0 around them. Grid Lines rules the lines into it.

### Grid Lines

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Grid Lines folder, first part: Line Width is clamped between Zero and Line Width Max 8, Multiply by Frame Scale gives the Wanted Line; Cell Pixels times Half gives the Line Cap, and Minimum of the two gives Line Pixels; Multiply by Half gives the Half Line; Add with Half gives Line Reach, Minimum with One gives Most Coverage; Position in Cell times Cell Pixels (XY) gives the Pixel in Cell, which Split Vector splits into across and down](../assets/effects/graphs/grid-glyph-line-width.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 935" aria-hidden="true" focusable="false">
<defs><marker id="grid-glyph-line-width-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M427 217 L427 257" marker-end="url(#grid-glyph-line-width-arrow)" />
<circle class="docs-shot-number" cx="427" cy="217" r="18" /><text x="427" y="217" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M427 810 L427 726" marker-end="url(#grid-glyph-line-width-arrow)" />
<circle class="docs-shot-number" cx="427" cy="810" r="18" /><text x="427" y="810" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M589 422 L589 338" marker-end="url(#grid-glyph-line-width-arrow)" />
<circle class="docs-shot-number" cx="589" cy="422" r="18" /><text x="589" y="422" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M752 130 L752 214" marker-end="url(#grid-glyph-line-width-arrow)" />
<circle class="docs-shot-number" cx="752" cy="130" r="18" /><text x="752" y="130" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M914 173 L914 257" marker-end="url(#grid-glyph-line-width-arrow)" />
<circle class="docs-shot-number" cx="914" cy="173" r="18" /><text x="914" y="173" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M904 526 L820 526" marker-end="url(#grid-glyph-line-width-arrow)" />
<circle class="docs-shot-number" cx="904" cy="526" r="18" /><text x="904" y="526" class="docs-shot-number-text">6</text>
</svg>
</div>

<figcaption>Inside Grid Lines (Line Width), first part. 1 — Wanted Line: Line Width in pixels of this frame. 2 — Line Cap: half a cell. 3 — Line Pixels: the line as it is drawn. 4 — Half Line: half of it. 5 — Line Reach: how far from its middle a line still touches a pixel. 6 — Most Coverage: the most a line can cover of one pixel.</figcaption>
</figure>

**Wanted Line** – Line Width times Frame Scale (the shorter side of the frame divided by 1080, from Cell Grid): how many pixels of this frame the line should be wide. The Clamp before it keeps Line Width between Zero and Line Width Max 8; a larger value renders as 8, and the card says so.

**Line Cap** – Cell Pixels times Half (Multiply): half a cell, the widest a line may be, so the characters always keep part of their box.

**Line Pixels** – the smaller of the Wanted Line and the Line Cap (Minimum): the line as it is drawn. When the cap cuts it, the card says so.

**Half Line** – Line Pixels times Half: the part of the line on each side of its middle.

**Line Reach** – the Half Line plus a half (Add): a pixel whose middle lies closer than this to the middle of a line is touched by it.

**Most Coverage** – the smaller of Line Pixels and One (Minimum): a line thinner than a pixel covers a pixel at most by its own width, so it draws fainter instead of vanishing.

**Pixel in Cell** – Position in Cell times the cell size in pixels (Cell Pixels (XY)): where the pixel lies inside its cell, in pixels from its top-left corner. Split Vector passes on its two parts, across and down.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Grid Lines folder, second part, for the columns: Pixel Across minus Half Line goes through Absolute, Cell Pixels minus that gives the distance to the next cell's line, and Minimum picks the nearer; Line Reach minus it is clamped between Zero and Most Coverage into the Column Line; Maximum with the Row Line gives the Line Coverage, and Mix moves the Glyph Coverage towards Line Glow, clamped between Zero and One, by it](../assets/effects/graphs/grid-glyph-line-cover.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 733" aria-hidden="true" focusable="false">
<defs><marker id="grid-glyph-line-cover-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M292 416 L292 332" marker-end="url(#grid-glyph-line-cover-arrow)" />
<circle class="docs-shot-number" cx="292" cy="416" r="18" /><text x="292" y="416" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M509 445 L509 361" marker-end="url(#grid-glyph-line-cover-arrow)" />
<circle class="docs-shot-number" cx="509" cy="445" r="18" /><text x="509" y="445" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M725 22 L725 72" marker-end="url(#grid-glyph-line-cover-arrow)" />
<circle class="docs-shot-number" cx="725" cy="22" r="18" /><text x="725" y="22" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M736 305 L786 305" marker-end="url(#grid-glyph-line-cover-arrow)" />
<circle class="docs-shot-number" cx="736" cy="305" r="18" /><text x="736" y="305" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M941 165 L941 249" marker-end="url(#grid-glyph-line-cover-arrow)" />
<circle class="docs-shot-number" cx="941" cy="165" r="18" /><text x="941" y="165" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Grid Lines (Line Glow), second part; the rows work the same way. 1 — Absolute: how far the pixel lies from its cell's line. 2 — Distance Across: from the nearer line. 3 — Column Line: how much of the pixel the line covers. 4 — Line Coverage: column or row line. 5 — Ruled Coverage: the lines ruled into the character.</figcaption>
</figure>

**Absolute** – how far the pixel lies from the middle of its own cell's line, which runs a Half Line inside the cell's left edge: Pixel Across minus Half Line, without its sign.

**Distance Across** – the nearer of that and the distance to the next cell's line (Cell Pixels minus it): Minimum picks it.

**Column Line** – Line Reach minus Distance Across, clamped between Zero and Most Coverage: how much of the pixel the column line covers, 1 inside a line, a share at its edges, 0 beyond. Each pixel gets exactly the part of the line it holds, so a hairline weighs the same at every frame size, also where a cell is not a whole number of pixels. The rows work the same way from Pixel Down and give the Row Line.

**Line Coverage** – the larger of Column Line and Row Line (Maximum): where the grid lies.

**Ruled Coverage** – moves the Glyph Coverage towards **Line Glow** (its Clamp keeps it between 0 and 1) by the Line Coverage (Mix): inside a line the coverage is Line Glow, whatever character lies there; elsewhere the character as it is. So a low Line Glow darkens a full block along the line and a higher one lights the empty ground.

**Remix:** open **Grid Lines**, find the Clamp whose output is Row Line and drag a cable from that output onto T of the Mix at the end (Ruled Coverage): the columns drop out and only the rows stay ruled, like text on lined paper.

### Ink & Appearance

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Ink and Appearance folder: Cell Color, Duotone and Source Mode go into the Mix that gives Ink; Cell Color times Source Dark Scale 0.08 and the duotone dark ground go into the Mix that gives Dark Ground; a Mix by Background lifts it towards Ink into Ground; a Mix by the Ruled Coverage from Grid Lines puts the Ink on its Ground into Glyph Cell; Original Color and the glyph cell, each times its alpha, are mixed by Amount, and a Divide by Faded Alpha gives the Faded Color](../assets/effects/graphs/grid-glyph-ink-and-appearance.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1854" aria-hidden="true" focusable="false">
<defs><marker id="grid-glyph-ink-and-appearance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M680 631 L596 631" marker-end="url(#grid-glyph-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="680" cy="631" r="18" /><text x="680" y="631" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M519 143 L519 227" marker-end="url(#grid-glyph-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="519" cy="143" r="18" /><text x="519" y="143" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M147 889 L147 973" marker-end="url(#grid-glyph-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="147" cy="889" r="18" /><text x="147" y="889" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M333 1027 L333 1073" marker-end="url(#grid-glyph-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="333" cy="1027" r="18" /><text x="333" y="1027" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M891 1340 L891 1256" marker-end="url(#grid-glyph-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="891" cy="1340" r="18" /><text x="891" y="1340" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Ink & Appearance (Color Source, Dark, Light, Background, Amount). Each Mix is named by its output. 1 — Ink: the colour of the character and its lines. 2 — Dark Ground: the dark cell. 3 — Ground: lifted by Background. 4 — Glyph Cell: character and lines on their ground. 5 — Faded Color: Amount, back to plain colour.</figcaption>
</figure>

**Ink** – the colour of the character and its lines: the cell colour with Color Source set to Source, the Duotone colour (from Dark to Light by the tone) with Duotone.

**Dark Ground** – the cell behind the character as classic ASCII art has it: the cell colour times 0.08 with Source, Dark times 0.15 with Duotone.

**Ground** – mixes the dark ground towards the ink by **Background**: at 0.2 the cell keeps a fifth of its character's colour.

**Glyph Cell** – puts the ink on the ground by the Ruled Coverage from Grid Lines: the character in full colour, the lines at Line Glow, the ground around them.

**Faded Color** – fades the untouched picture, pixel by pixel, towards the glyph cell by **Amount** and divides by the faded alpha. Both are first multiplied by their transparency, so the colour a transparent pixel hides never shows as a fringe around a cut-out figure.

## Technical details

- **Size.** Cell Size and Line Width count pixels of a frame whose shorter side is 1080: a 4K export, a portrait 1080 × 1920 frame, a lower Preview Quality and the thumbnails show the same grid. Each pixel takes the share of it a line covers, so a line thinner than a pixel draws fainter rather than vanishing, and the grid has the same weight at every size. A cell is never smaller than 2 pixels; below 2 px Cell Size renders as 2. Line Width above 8 px or above half a cell, and Line Glow outside 0 to 1 render clamped. The card says when any of this happens.
- **Lines.** Every cell rules its top and left edge, so each border is one line; where the frame ends inside a cell, at the right or bottom, that cell stays open. Inside a line the coverage is Line Glow whatever the character, so lines cut through characters that reach the edge of their box.
- **Characters.** The characters come from an atlas, a sheet the engine draws for the Ramp, Font and Weight and keeps. Its tallest character spans 88 % of the box height; the Block Elements (█ ▀ ▄ ▌ ▐ ░ ▒ ▓ and the bars) are exact shapes that fill their box in any font. Weight is drawn in steps of 100.
- **Time.** Grid Glyph does not move by itself: on footage it changes with every frame of the clip, the grid stays put, and a paused picture needs no extra rendering.
- **Transparency.** Each cell, its character and its lines take the transparency of the cell's centre, so a cut-out figure keeps its outline in whole cells. Amount fades the transparency back to the original's, pixel by pixel, without a fringe.
- **Saved projects.** A Grid Glyph that stores its node setup keeps its look, including the earlier line, a fixed share of each cell. Effects saved without a stored setup get the new lines at 1 px and the earlier strength (Line Glow 0.28). This is a fix: the earlier line vanished at half Preview Quality and came and went where a cell was not a whole number of pixels, so preview and export differed. New effects start at Cell Size 18. Presets fully apply only to effects added in this version: a stored setup from before has no Background, Black Level, Line Width or Line Glow row, so a preset leaves those values out.
- **More:** [Effect system](../Effect-System.md#glyph-cell-and-compute-effects) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
