# ASCII

Rebuilds the picture from characters chosen by brightness: classic ASCII art in the picture's own colours.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![The dancer's upper body and swirling dress on a dark stage, original left and with ASCII right: the picture is rebuilt from small characters in a grid, dense signs like # and % where the dress is bright, dots and dashes in the shadows, each in the colour of the picture behind it, on dim square cells](../assets/effects/ascii.webp)

<figcaption>Left: original. Right: ASCII at its default settings.</figcaption>
</figure>

**Use it for:** a computer or screen world on stage · titles and projections with a typed, hand-made feel · a figure that dissolves into text.

- **Cell Size** – how big the characters are.
- **Background** – how much of the picture glows behind them.
- **Ramp** – which characters draw the picture.

**Tip:** keyframe **Cell Size** from 72 down to 10 to let a figure condense out of a few large signs, or **Amount** from 0 to 1 to type the picture in over the original.

## Presets

<figure class="docs-shot">

![The dancer's head and arms four times in a grid, one preset each: Green Terminal top left with green letters on black, Shade Blocks top right with fine dotted shading blocks in the picture's colours, Level Bars bottom left with a bar in every cell that rises with its brightness, LED Wall bottom right with one round coloured dot per cell](../assets/effects/presets/ascii.webp)

<figcaption>The four presets on the dancer, each named under its picture.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Green Terminal** – green letters and signs on black, like the screen of an old computer. Black Level 0.2 turns the grey stage black, so only the lit figure is typed, and its bright parts glow. For a hacker scene, a surveillance feed or a machine that thinks.

**Shade Blocks** – small cells filled with the shading blocks ░ ▒ ▓ █, in the picture's colours. The figure stays easy to read and turns into the coarse dotted mosaic of early computer art.

**Level Bars** – large cells on black, each a bar that rises with its brightness, like a wall of level meters. The tallest bar stops short of the cell, so the rows stay apart. Graphic and calm; strong on large surfaces and with music.

**LED Wall** – one round dot per cell in the picture's colour, like the LEDs of a video wall seen up close. Good for faking a screen inside the stage picture.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with an ASCII card: Style menu, Preset menu showing Shade Blocks, Cell Size, Amount, Background, Black Level and Invert Ramp, then Ramp, Custom Ramp, Font and Weight, then Color Source with Dark and Light dimmed under the note Used with Color Source Duotone, beside a strip of the preview where the dancer is built from shaded blocks](../assets/effects/editor/ascii-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1210" aria-hidden="true" focusable="false">
<defs><marker id="ascii-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 319 L649 319" marker-end="url(#ascii-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="319" r="18" /><text x="565" y="319" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M583 425 L667 425" marker-end="url(#ascii-inspector-arrow)" />
<circle class="docs-shot-number" cx="583" cy="425" r="18" /><text x="583" y="425" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M559 578 L643 578" marker-end="url(#ascii-inspector-arrow)" />
<circle class="docs-shot-number" cx="559" cy="578" r="18" /><text x="559" y="578" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M605 769 L689 769" marker-end="url(#ascii-inspector-arrow)" />
<circle class="docs-shot-number" cx="605" cy="769" r="18" /><text x="605" y="769" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M550 997 L634 997" marker-end="url(#ascii-inspector-arrow)" />
<circle class="docs-shot-number" cx="550" cy="997" r="18" /><text x="550" y="997" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>ASCII with the Shade Blocks preset. 1 — Preset: pick a starting point. 2 — Cell Size. 3 — Background. 4 — Ramp: the characters, here Blocks. 5 — Color Source.</figcaption>
</figure>

**Style** – switches to another look of the same engine and keeps your values and keyframes, for example [Word Mosaic](./word-mosaic.md), [Pixel Code](./pixel-code.md) or [Number Field](./number-field.md). The moving looks, such as [Glyph Matrix](./glyph-matrix.md), have Speed and Roll and form their own family.

### Grid

**Cell Size** – how big one character is. 6–10 gives fine print that reads as a picture from afar, 14 small but clear characters, 24 and more large signs that read on a projection; at 72 the frame holds only 15 rows of large signs. It counts pixels of a 1080p picture, so the preview, the thumbnails and a 4K export show the same grid. 4 to 72 px, default 14 px.

### Style

**Amount** – how much of the effect you see. At 0 the original picture, unchanged; in between, the characters fade in over it. Keyframe it to type a picture in. 0 to 1, default 1.

**Background** – how much of the picture fills each cell behind its character. At 0 the characters stand on a near-black ground, like classic ASCII art; 0.2–0.4 lets the picture glow through, so it stays readable; towards 1 the cells take the full colour of their character and the signs disappear into a mosaic. 0 to 1, default 0.2.

**Black Level** – the brightness up to which the picture counts as black. Everything darker becomes the first character of the ramp, the space in most ramps, so a grey stage drops out and only the lit figure is typed; the rest of the picture spreads over the whole ramp, so the figure gets more different characters. Try 0.15–0.25 on stage footage, above all with Duotone. 0 to 0.9, default 0.

**Invert Ramp** – swaps the ends of the ramp: dark parts get the dense characters and bright parts the light ones, like a negative typed on paper. The colours stay. Either on or off, default off.

### Glyphs

**Ramp** – the row of characters the picture is built from, from the darkest to the brightest part. **Standard** (`.:-=+*#%@` after a space) is classic ASCII art; **Detailed** uses about seventy letters and signs for finer tones; **Blocks** fills each cell with the shading blocks ░ ▒ ▓ █; **Bars** with a bar that rises with brightness; **Binary** writes only 0 and 1; **Numeric** the digits 1 to 9; **Symbols** dots, crosses and stars. While a Custom Ramp is typed, the row rests and the card dims it. In the menu: Standard, Detailed, Blocks, Bars, Binary and 2 more, default Standard.

**Custom Ramp** – your own characters, from dark to bright, instead of the Ramp. Start with a space so the darkest parts stay empty; a single character, such as ●, puts the same sign in every cell and lets the colour alone carry the picture. Spaces at the end are ignored, and a ramp longer than 256 characters is thinned to 256, spread from its first to its last (the card says so). Clear it to use the Ramp again. Any text, default empty.

**Font** – the lettering. **Monospace** draws the even signs of a terminal; **Serif** and **Sans Serif** give rounder, bookish letters, each narrowed to fit its cell. Monospace, Serif, Sans Serif, default Monospace.

**Weight** – how heavy the strokes are. Heavier letters carry more colour, so the picture gets brighter. How many steps you see depends on the font: the built-in monospace font of many systems only has regular (up to 500) and bold (600 and more). Keyframes step from one weight to the next. 200 to 900, default 600.

### Color

**Color Source** – where the colour of the characters comes from. **Source** takes the colour of the picture under each cell; **Duotone** colours them between **Dark** for the dark parts and **Light** for the bright parts, for a single-colour look. Source, Duotone, default Source.

**Dark** – the colour of the darkest characters in Duotone; the ground behind them is a deep shade of it. With Source it rests, and the card dims it. Pick a colour, default `#081018`.

**Light** – the colour of the brightest characters in Duotone. With Source it rests, and the card dims it. Pick a colour, default `#e8fff5`.

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The ASCII graph in five stages: Parameters feed Cell Grid (Cell Size), which passes the position in the cell to Atlas Alpha and the cell centre to Cell Sampling & Tone; its tone goes into Tone to Glyph, whose glyph index goes into Atlas Alpha; Ink & Appearance takes the colours, Background, Amount, the cell colour and the glyph coverage and draws the picture](../assets/effects/graphs/ascii.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 610" aria-hidden="true" focusable="false">
<defs><marker id="ascii-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M264 280 L264 196" marker-end="url(#ascii-arrow)" />
<circle class="docs-shot-number" cx="264" cy="280" r="18" /><text x="264" y="280" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M427 254 L427 338" marker-end="url(#ascii-arrow)" />
<circle class="docs-shot-number" cx="427" cy="254" r="18" /><text x="427" y="254" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M589 269 L589 185" marker-end="url(#ascii-arrow)" />
<circle class="docs-shot-number" cx="589" cy="269" r="18" /><text x="589" y="269" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M752 377 L752 293" marker-end="url(#ascii-arrow)" />
<circle class="docs-shot-number" cx="752" cy="377" r="18" /><text x="752" y="377" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M914 588 L914 504" marker-end="url(#ascii-arrow)" />
<circle class="docs-shot-number" cx="914" cy="588" r="18" /><text x="914" y="588" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>ASCII opened in the Nodes tab (input frame and output left out). 1 — Cell Grid: which cell a pixel lies in. 2 — Cell Sampling & Tone: the colour and brightness of the cell. 3 — Tone to Glyph: which character it gets. 4 — Atlas Alpha: where that character covers the cell. 5 — Ink & Appearance: colours and ground.</figcaption>
</figure>

ASCII works in five stages, one folder each in the Nodes tab: **Cell Grid** cuts the frame into square cells, **Cell Sampling & Tone** reads the colour and brightness in the middle of each cell, **Tone to Glyph** picks a character of the ramp for that brightness, **Atlas Alpha** looks up where the character covers the cell, and **Ink & Appearance** colours the character and its ground. Click a folder's header to open it; the sections below show what is inside. ASCII is one look of the glyph engine that the [Text & Glyph](../Effects-Glyph.md#the-shared-idea) looks share; its **Style** menu switches between them.

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

**Smallest Component** – the shorter side of the frame. Divided by 1080, it says how much larger or smaller this frame is than a 1080p one, so Cell Size looks the same on a 4K export, a portrait frame and a thumbnail.

**Maximum** – the cell size in pixels of this frame: Cell Size times that scale, and never smaller than 2 pixels. The other Maximum, to the left, first keeps Cell Size at 2 or more.

**Floor** – which cell the pixel lies in. Multiply spreads the frame over the grid (the frame size divided by the cell size), and Floor drops the fraction, so every pixel of a cell gets the same cell number.

**Fraction** – the fraction Floor dropped: where the pixel lies inside its cell, from 0 to 1 across and down. Atlas Alpha uses it to draw the character.

**Divide** – the middle of the cell, as a share of the frame: the cell number plus a half (Add), divided by the grid. Every pixel of a cell reads the picture there, so the whole cell gets one colour and one character.

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

**Clamped Image Sample** – reads the input picture at the cell centre, but never outside the frame (Tiny 0.001 and Almost One 0.999 are its nearest and farthest place). It holds a small node setup of its own; its › opens it.

**Split RGB + Alpha** – splits what it read into the cell's colour and its transparency. The colour becomes the ink of the character, the transparency the transparency of the whole cell.

**Luminance** – the brightness of the cell colour, weighted the way the eye sees it (green counts most).

**Divide** – applies **Black Level**: the luminance minus Black Level (Subtract), divided by what is left above it (the other Subtract: One minus Black Level). The Clamp next to Black Level keeps it between 0 and Black Level Max 0.9.

**Clamp** – keeps the result between 0 and 1, so everything darker than Black Level becomes 0: the Tone. This tone picks the character.


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

**Subtract** – one minus the tone: the brightness turned upside down, for Invert Ramp.

**Switch** – passes the tone as it is, or the inverted one when **Invert Ramp** is on.

**Clamp** – keeps the tone between 0 and just under 1, so the brightest cells still get the last character of the ramp and never one past it.

**Multiply** – the tone times the number of characters in the ramp (the Maximum below keeps that number at 1 or more), so the ramp covers the whole range from black to white.

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

**Floor** – the glyph index divided by the columns of the sheet, without the fraction: the row in which the character sits.

**Subtract** – the glyph index minus the row times the columns (Multiply): the column. Combine Vector joins row and column into the character's square on the sheet.

**Clamp** – keeps the place inside the cell half a pixel of the sheet away from the edges of the character's square (Half Texel, 0.5 of the 64 pixels of a square, and One Minus Half Texel). The sheet is read with smoothing, so a read any closer would mix in a little of the neighbouring character: blocks and bars would show thin seams wherever a cell is not a whole number of pixels.

**Sample Image** – reads the sheet at the character's square plus the place inside the cell (Add), divided by the size of the sheet (Divide).

**Split Vector** – takes the alpha of what it read: the Glyph Coverage, 1 inside the strokes of the character, 0 around them, soft at the edges.

### Ink & Appearance

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Ink and Appearance folder: Cell Color, Duotone and Source Mode go into the Mix that gives Ink; Cell Color times Source Dark Scale 0.08 and the duotone dark ground go into the Mix that gives Dark Ground; a Mix by Background lifts it towards Ink into Ground; a Mix by Glyph Coverage puts the Ink on its Ground into Glyph Cell; Original Color and the glyph cell, each times its alpha, are mixed by Amount into Faded Premultiplied, and a Divide by Faded Alpha gives the Faded Color](../assets/effects/graphs/ascii-ink-and-appearance.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1854" aria-hidden="true" focusable="false">
<defs><marker id="ascii-ink-and-appearance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M680 631 L596 631" marker-end="url(#ascii-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="680" cy="631" r="18" /><text x="680" y="631" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M519 143 L519 227" marker-end="url(#ascii-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="519" cy="143" r="18" /><text x="519" y="143" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M147 889 L147 973" marker-end="url(#ascii-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="147" cy="889" r="18" /><text x="147" y="889" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M333 1027 L333 1073" marker-end="url(#ascii-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="333" cy="1027" r="18" /><text x="333" y="1027" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M705 989 L705 1073" marker-end="url(#ascii-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="705" cy="989" r="18" /><text x="705" y="989" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M891 1340 L891 1256" marker-end="url(#ascii-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="891" cy="1340" r="18" /><text x="891" y="1340" class="docs-shot-number-text">6</text>
</svg>
</div>

<figcaption>Inside Ink & Appearance (Color Source, Dark, Light, Background, Amount). Each Mix is named by its output. 1 — Ink: the character colour. 2 — Dark Ground: the dark cell. 3 — Ground: lifted by Background. 4 — Glyph Cell: the character on its ground. 5 — Faded Premultiplied: Amount. 6 — Faded Color: back to plain colour.</figcaption>
</figure>

**Ink** – the colour of the character: the cell colour with Color Source set to Source, the Duotone colour (from Dark to Light by the tone) with Duotone.

**Dark Ground** – the cell behind the character as classic ASCII art has it: the cell colour times 0.08 with Source, Dark times 0.15 with Duotone.

**Ground** – mixes the dark ground towards the ink by **Background**: at 0.2 the cell keeps a fifth of its character's colour.

**Glyph Cell** – puts the ink on the ground by the glyph coverage: the character in full colour, its ground around it.

**Faded Premultiplied** – fades the untouched picture, pixel by pixel, towards the glyph cell by **Amount**. Both are first multiplied by their transparency (Original Alpha, Cell Alpha), and the transparency fades the same way (Faded Alpha).

**Faded Color** – divides by Faded Alpha (at least a millionth) to get back to plain colour. Mixed this way, the colour a transparent pixel hides never shows as a dark or green fringe around a cut-out figure while Amount fades.

**Remix:** open the **Constants** folder and set the value **0.08** (the Source Dark Scale card above) to **0.3**: with Color Source on Source, even at Background 0 the dark ground keeps almost a third of the picture, so the cells glow softly between the characters.

## Technical details

- **Size.** Cell Size counts pixels of a frame whose shorter side is 1080: a 4K export, a portrait 1080 × 1920 frame, a lower Preview Quality and the thumbnails show the same grid. A cell is never smaller than 2 pixels of the frame; below 2 px Cell Size renders as 2. The card says when either happens.
- **Characters.** The characters come from an atlas, a sheet the engine draws for the Ramp, Font and Weight and keeps. It draws the whole ramp in one font size, so its tallest character spans 88 % of the cell height and a '.' stays small next to a '#'. The Block Elements (█ ▀ ▄ ▌ ▐ ░ ▒ ▓, the bars ▁ to ▇ and the quarter blocks) are drawn as exact shapes that fill their cell in any font, and the sheet is read half a pixel inside each character, so blocks join without seams at any cell size. Weight is drawn in steps of 100. The engine keeps the 24 sheets used last, so typing a long Custom Ramp does not pile up memory.
- **Time.** ASCII does not move by itself: on footage it changes with every frame of the clip, and a paused picture needs no extra rendering.
- **Transparency.** Each cell takes the transparency of its centre, so a cut-out figure keeps its outline in whole cells and no character is cut in half. Amount fades the transparency back to the original's, pixel by pixel, and mixes the colours weighted by their transparency, so the hidden colour of a transparent pixel never shows as a fringe around a cut-out figure.
- **Saved projects.** An ASCII effect stores its node setup and keeps its look. Effects saved before Background existed show the dark ground (Background 0), and their Amount fades towards the colour of each cell instead of the original picture. A Blocks ramp, a one-character Custom Ramp and a Custom Ramp longer than 256 characters draw as described above in saved projects too. A stored setup keeps its smaller characters, which cover about half of a cell, and the way it read the character sheet, so saved Blocks or Bars can show thin seam lines on frames whose cells are not a whole number of pixels; Black Level is 0 there.
- **More:** [Effect system](../Effect-System.md#glyph-cell-and-compute-effects) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
