# Pixel Code

Writes the picture in code: zeros and ones, denser and lighter where the picture is bright. **Scramble** sets how random the characters are, **Shadow** and **Highlight** the colours of the code.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![The dancer's upper body and swirling dress on a dark stage, original left and with Pixel Code right: the picture is written in small zeros and ones, dense and mint green where her dress and arm are lit, sparse dim blue zeros on the dark stage, so the figure appears in the colour and the density of the code](../assets/effects/pixel-code.webp)

<figcaption>Left: original. Right: Pixel Code at its default settings.</figcaption>
</figure>

**Use it for:** a person turned into data · digital worlds, surveillance, a machine that sees · a picture that dissolves into code on a cue.

- **Cell Size** – how big the characters are.
- **Scramble** – how random the characters are.
- **Black Level** – clears the dark stage.
- **Shadow** and **Highlight** – the colours of the code.

**Tip:** keyframe **Scramble** from 0 up to 1: a picture you can read in its characters dissolves into a wall of code, and back. For a figure written in code on black, set **Black Level** to about 0.15 (Binary Portrait).

## Presets

<figure class="docs-shot">

![The dancer's head and arms four times in a grid, one preset each: Binary Portrait top left with ice-blue zeros and ones on a black stage, Hex Dump top right with pale grey hexadecimal figures over the whole frame, Heat Map bottom left with yellow figures where she is lit on a violet field of dim ones, Source Code bottom right with pink brackets and signs, denser on her body](../assets/effects/presets/pixel-code.webp)

<figcaption>The four presets on the dancer, each named under its picture.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Binary Portrait** – bold zeros and ones in ice blue, only where the picture is lit: Black Level 0.15 leaves the dark stage black. A person written in binary; for data, identity, a figure scanned by a machine.

**Hex Dump** – larger pale grey figures `0`–`9` and `A`–`F` over the whole frame, like the raw bytes of a file in a terminal. The picture shows in how bright and how dense they are. Calm and technical; good under text.

**Heat Map** – the digits 1 to 9 from deep violet to yellow, the brighter the part the higher its figure: a thermal camera in numbers. Scramble 0.25 keeps each figure close to the one of its brightness, so the warm figure reads at a glance.

**Source Code** – brackets, operators and signs of program code in pink, sparse dots in the shadows, dense brackets and `#` in the light. Weight 800 gives the thin signs enough light to carry the picture.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Pixel Code card: Style menu, Preset menu showing Heat Map, Cell Size, then Amount, Background, Black Level and Invert Ramp, then Ramp, an empty Custom Ramp, Font, Weight and Scramble at 0.25, then Shadow in deep violet and Highlight in yellow, beside a strip of the preview where the dancer's dress is written in yellow figures on a violet field of dim ones](../assets/effects/editor/pixel-code-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1132" aria-hidden="true" focusable="false">
<defs><marker id="pixel-code-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 319 L649 319" marker-end="url(#pixel-code-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="319" r="18" /><text x="565" y="319" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M583 425 L667 425" marker-end="url(#pixel-code-inspector-arrow)" />
<circle class="docs-shot-number" cx="583" cy="425" r="18" /><text x="583" y="425" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M563 616 L647 616" marker-end="url(#pixel-code-inspector-arrow)" />
<circle class="docs-shot-number" cx="563" cy="616" r="18" /><text x="563" y="616" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M578 919 L662 919" marker-end="url(#pixel-code-inspector-arrow)" />
<circle class="docs-shot-number" cx="578" cy="919" r="18" /><text x="578" y="919" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M589 1035 L673 1035" marker-end="url(#pixel-code-inspector-arrow)" />
<circle class="docs-shot-number" cx="589" cy="1035" r="18" /><text x="589" y="1035" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Pixel Code with the Heat Map preset. 1 — Preset: pick a starting point. 2 — Cell Size. 3 — Black Level: clears the dark stage. 4 — Scramble: how random the characters are. 5 — Shadow: the colour of the code in the dark, Highlight below it in the light.</figcaption>
</figure>


**Style** – switches to another look of the same engine and keeps your values and keyframes, for example [ASCII](./ascii.md), [Matrix Rain](./matrix.md) or [Number Field](./number-field.md). **Scramble**, **Shadow** and **Highlight** belong to Pixel Code alone: other looks leave them unread, and switching back brings them back. **Undo** brings the old look back.

### Grid

**Cell Size** – how big one cell, and the character in it, is. 6–10 gives a fine texture of code that reads as a picture from afar; 12–16 clearly readable zeros and ones (Binary Portrait, Hex Dump); 24 and more a few large characters for a projection. It counts pixels of a 1080p picture, so the preview, the thumbnails and a 4K export show the same characters. 4 to 72 px, default 10 px.

### Style

**Amount** – how much of the effect you see. At 0 the original picture, unchanged; in between, the code fades in over it. Keyframe it to let the picture dissolve into code. 0 to 1, default 1.

**Background** – how much of its colour fills each cell behind the character. At 0 the code stands on black; 0.2 lets the picture show faintly as flat squares between Shadow and Highlight; 0.3–0.5 fills the cells, so the figure glows behind its code (Heat Map); at 1 the characters vanish into a plain mosaic of the two colours. 0 to 1, default 0.2.

**Black Level** – the brightness up to which the picture counts as black. Everything darker gets the first character of the ramp, the space in Binary (with Invert Ramp the last one), in the Shadow colour, even at Scramble 1. So a grey stage drops out and only the lit figure is written in code. Try 0.1–0.2 on stage footage. 0 to 0.9, default 0.

**Invert Ramp** – swaps the ends of the ramp: dark parts get the dense characters, bright parts the sparse ones, so the code fills the shadows and thins out in the light. The colours stay. At Scramble 1 and Black Level 0 every cell draws any character anyway, so Invert Ramp only reshuffles them, and the card says so. Either on or off, default off.

### Glyphs

**Ramp** – the characters the code is made of, from the darkest to the brightest part. **Binary** (a space, 0 and 1) writes the classic zeros and ones; **Numeric** the digits 1 to 9 after a space (Heat Map); **Standard**, **Detailed**, **Blocks**, **Bars** and **Symbols** turn it into code of signs, shading blocks or level bars. While a Custom Ramp is typed, the row rests and the card dims it. In the menu: Standard, Detailed, Blocks, Bars, Binary and 2 more, default Binary.

**Custom Ramp** – your own characters, from sparse to dense, instead of the Ramp: ` 0123456789ABCDEF` writes hexadecimal (Hex Dump), ` .:;=+-*/<>(){}[]#` the signs of program code (Source Code). Start it with a space, so dark cells can stay empty. Spaces at the end are ignored, and a ramp longer than 256 characters is thinned to 256 (the card says so). Clear it to use the Ramp again. Any text, default empty.

**Font** – the lettering. **Monospace** draws the even characters of a terminal or a program listing; **Serif** and **Sans Serif** look more like print or signs. Each is narrowed to fit its cell. Monospace, Serif, Sans Serif, default Monospace.

**Weight** – how heavy the strokes are. Heavier characters carry more colour, so the code gets brighter; thin signs such as those of Source Code need 700 or more to glow. How many steps you see depends on the font: the built-in monospace font of many systems only has regular (up to 500) and bold (600 and more). Keyframes step from one weight to the next. 200 to 900, default 600.

**Scramble** – how far each cell may stray from the character of its brightness. At 0 every cell takes that character, as in [ASCII](./ascii.md), and the picture reads in the characters. At 1 every cell draws any character of the ramp, and the picture shows only in the colour: a dense wall of code, the look of effects saved before Scramble existed. In between, each cell draws from a few neighbouring characters, so the lit figure is written densely and the dark parts sparsely. With the three characters of Binary there are three steps: 0, up to 0.5 (dark parts a space or 0, bright parts 0 or 1) and above 0.5. Each cell keeps its draw, so the code stands still on a still picture. Outside the range it renders as 0 or 1, and the card says so. 0 to 1, default 0.5.

### Color

**Shadow** – the colour of the code, and of its ground, in the darkest parts. A deep, dark colour lets the stage recede, so the lit figure reads. Pick a colour, default `#0c2f52`.

**Highlight** – the colour in the brightest parts. In between, the colour runs evenly from Shadow to Highlight with the brightness: two colours of one family (navy to ice blue) stay calm, a dark violet to yellow reads like a thermal camera (Heat Map). Pick a colour, default `#5cffc4`.

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Pixel Code graph in six stages: Parameters feed Cell Grid (Cell Size), which passes the cell centre to Cell Sampling & Tone, the cell number to Scramble and the position in the cell to Atlas Alpha; the Tone goes to Tone to Glyph, whose character of that brightness goes to Scramble (Scramble, Black Level), whose glyph index goes to Atlas Alpha; Ink & Appearance (Shadow, Highlight, Background, Amount) takes the tone, the glyph coverage and the cell alpha and draws the picture](../assets/effects/graphs/pixel-code.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1101" aria-hidden="true" focusable="false">
<defs><marker id="pixel-code-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M230 265 L230 181" marker-end="url(#pixel-code-arrow)" />
<circle class="docs-shot-number" cx="230" cy="265" r="18" /><text x="230" y="265" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M369 571 L369 655" marker-end="url(#pixel-code-arrow)" />
<circle class="docs-shot-number" cx="369" cy="571" r="18" /><text x="369" y="571" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M508 525 L508 441" marker-end="url(#pixel-code-arrow)" />
<circle class="docs-shot-number" cx="508" cy="525" r="18" /><text x="508" y="525" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M648 450 L648 534" marker-end="url(#pixel-code-arrow)" />
<circle class="docs-shot-number" cx="648" cy="450" r="18" /><text x="648" y="450" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M931 402 L847 402" marker-end="url(#pixel-code-arrow)" />
<circle class="docs-shot-number" cx="931" cy="402" r="18" /><text x="931" y="402" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M926 1078 L926 994" marker-end="url(#pixel-code-arrow)" />
<circle class="docs-shot-number" cx="926" cy="1078" r="18" /><text x="926" y="1078" class="docs-shot-number-text">6</text>
</svg>
</div>

<figcaption>Pixel Code opened in the Nodes tab (input frame and output left out). 1 — Cell Grid: which cell a pixel lies in. 2 — Cell Sampling & Tone: the brightness of the cell. 3 — Tone to Glyph: the character of that brightness. 4 — Scramble: which character the cell draws instead. 5 — Atlas Alpha: where it covers the cell. 6 — Ink & Appearance: colours and ground.</figcaption>
</figure>

Pixel Code works in six stages, one folder each in the Nodes tab: **Cell Grid** cuts the frame into square cells, **Cell Sampling & Tone** reads the brightness in the middle of each cell, **Tone to Glyph** picks the character of that brightness, **Scramble** lets each cell draw another character near it at random, **Atlas Alpha** looks up where that character covers the cell, and **Ink & Appearance** colours it from Shadow to Highlight. Click a folder's header to open it. Scramble makes the code; the other folders work as in [ASCII](./ascii.md#node-setup). Pixel Code is one look of the glyph engine that the [Text & Glyph](../Effects-Glyph.md#the-shared-idea) looks share; its **Style** menu switches between them.

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

**Smallest Component** – the shorter side of the frame; divided by 1080 it scales Cell Size, so a 4K export, a portrait frame and a thumbnail show the same code.

**Maximum** – the cell size in pixels of this frame, never smaller than 2.

**Floor** – which cell the pixel lies in, counted in columns and rows. Scramble draws its random number from it, so every cell keeps its own draw.

**Fraction** – where the pixel lies inside its cell, from 0 to 1; Atlas Alpha draws the character with it.

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

**Split RGB + Alpha** – the cell's colour and its transparency. Pixel Code takes only the brightness of the colour; the transparency becomes that of the whole cell.

**Luminance** – the brightness of the cell colour, weighted the way the eye sees it (green counts most).

**Divide** – applies **Black Level**: the luminance minus Black Level (Subtract), divided by what is left above it (the other Subtract: One minus Black Level). The Clamp next to Black Level keeps it between 0 and Black Level Max 0.9.

**Clamp** – keeps the result between 0 and 1, so everything darker than Black Level becomes 0: the Tone. It picks the character and, in Ink & Appearance, the colour.

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

**Floor** – drops the fraction: the number of the character of the cell's brightness, the Tone Glyph that Scramble draws around.

### Scramble

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Scramble folder, the dark hold: Greater Than asks whether Black Level is above Zero and feeds a Switch that gives Zero instead of Scramble as the Dark Scramble; a second Greater Than asks whether the Tone is above Zero (Lit) and feeds a Switch that gives Scramble for lit cells and the Dark Scramble for the others, the Cell Scramble](../assets/effects/graphs/pixel-code-scramble-hold.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 710" aria-hidden="true" focusable="false">
<defs><marker id="pixel-code-scramble-hold-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M363 252 L363 336" marker-end="url(#pixel-code-scramble-hold-arrow)" />
<circle class="docs-shot-number" cx="363" cy="252" r="18" /><text x="363" y="252" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M363 687 L363 603" marker-end="url(#pixel-code-scramble-hold-arrow)" />
<circle class="docs-shot-number" cx="363" cy="687" r="18" /><text x="363" y="687" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M500 400 L500 316" marker-end="url(#pixel-code-scramble-hold-arrow)" />
<circle class="docs-shot-number" cx="500" cy="400" r="18" /><text x="500" y="400" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>Inside Scramble (Scramble, Black Level), the dark hold. 1 — Lit: the cell is brighter than Black Level. 2 — Dark Scramble: the scramble of a dark cell. 3 — Cell Scramble: the scramble this cell gets.</figcaption>
</figure>

**Lit** – Greater Than: is the cell's Tone above 0, so brighter than Black Level? The other Greater Than asks whether Black Level is set at all (above 0). **Scramble** comes in through a Clamp that keeps it between 0 and 1.

**Dark Scramble** – a Switch: 0 while Black Level is above 0, otherwise Scramble. At Black Level 0 every cell draws, also the darkest.

**Cell Scramble** – the second Switch: Scramble for a lit cell, the Dark Scramble for a dark one. With Black Level set, a dark cell keeps its own character, the space, even at Scramble 1, so the dark stage stays empty.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Scramble folder, the window: Glyph Count minus One times the Cell Scramble, through Ceiling and plus One, gives the window; times Half and Floor gives half the window; Tone Glyph minus that half, clamped between Zero and Glyph Count minus the window, gives the window start](../assets/effects/graphs/pixel-code-scramble-window.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 522" aria-hidden="true" focusable="false">
<defs><marker id="pixel-code-scramble-window-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M400 48 L400 132" marker-end="url(#pixel-code-scramble-window-arrow)" />
<circle class="docs-shot-number" cx="400" cy="48" r="18" /><text x="400" y="48" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M509 52 L509 136" marker-end="url(#pixel-code-scramble-window-arrow)" />
<circle class="docs-shot-number" cx="509" cy="52" r="18" /><text x="509" y="52" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M725 299 L725 215" marker-end="url(#pixel-code-scramble-window-arrow)" />
<circle class="docs-shot-number" cx="725" cy="299" r="18" /><text x="725" y="299" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M941 365 L941 281" marker-end="url(#pixel-code-scramble-window-arrow)" />
<circle class="docs-shot-number" cx="941" cy="365" r="18" /><text x="941" y="365" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Scramble (Scramble), the window. 1 — Ceiling: the neighbours a cell may draw. 2 — Window: how many characters. 3 — Floor: half the window. 4 — Window Start: where the window begins in the ramp.</figcaption>
</figure>

**Ceiling** – the Cell Scramble times the ramp's length minus one (Subtract, Multiply), rounded up: how many neighbours a cell may draw instead of its own character. Any Cell Scramble above 0 gives at least one.

**Window** – that plus One (Add): how many characters the cell draws from, its own one included. 1 at Scramble 0, the whole ramp at Scramble 1.

**Floor** – half the window (Multiply by Half), without the fraction: how far the window reaches below the cell's own character.

**Window Start** – the Tone Glyph minus that half (Subtract), kept between Zero and the last place a whole window fits in the ramp (Clamp): the first character of the window. Near the ends of the ramp the window slides inwards instead of running out.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Scramble folder, the draw: Cell Number feeds Random (Cell), which times Window and Floor gives the draw; Tone Glyph minus Window Start plus the draw gives the step; step plus Half divided by Window, Floor and Multiply give the whole windows in it; the step minus them is the place in the window, and Window Start plus that place is the glyph index](../assets/effects/graphs/pixel-code-scramble-draw.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 499" aria-hidden="true" focusable="false">
<defs><marker id="pixel-code-scramble-draw-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M155 22 L155 104" marker-end="url(#pixel-code-scramble-draw-arrow)" />
<circle class="docs-shot-number" cx="155" cy="22" r="18" /><text x="155" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M332 22 L332 104" marker-end="url(#pixel-code-scramble-draw-arrow)" />
<circle class="docs-shot-number" cx="332" cy="22" r="18" /><text x="332" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M420 22 L420 104" marker-end="url(#pixel-code-scramble-draw-arrow)" />
<circle class="docs-shot-number" cx="420" cy="22" r="18" /><text x="420" y="22" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M862 476 L862 392" marker-end="url(#pixel-code-scramble-draw-arrow)" />
<circle class="docs-shot-number" cx="862" cy="476" r="18" /><text x="862" y="476" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M951 281 L951 197" marker-end="url(#pixel-code-scramble-draw-arrow)" />
<circle class="docs-shot-number" cx="951" cy="281" r="18" /><text x="951" y="281" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Scramble, the draw. 1 — Random (Cell): one random number for each cell. 2 — Draw: how many characters the cell moves on. 3 — Step: its own place plus the draw. 4 — Place in Window: the step wrapped inside the window. 5 — Glyph Index: the character the cell draws.</figcaption>
</figure>

**Random (Cell)** – one random number from 0 to 1 for each cell, from its Cell Number: the same on every graphics card and in the export, and without the diagonal stripes the earlier random number drew across the frame.

**Draw** – the random number times the Window (Multiply), without the fraction (Floor): how many characters the cell moves on from its own one, 0 up to the window minus one.

**Step** – the cell's own place in its window (Subtract: Tone Glyph minus Window Start) plus the Draw (Add).

**Place in Window** – the step wrapped back into the window: the Divide by Window (after adding Half, so the division never lands just below a whole number), Floor and Multiply give the whole windows in it, and the Subtract takes them off.

**Glyph Index** – Window Start plus the place in the window (Add): the character the cell draws, always inside the ramp. Atlas Alpha looks it up.

**Remix:** open **Ink & Appearance** and drag a cable from **Glyph Coverage** onto T of the Mix that gives **Code Color**, in place of the Tone: every character now shines in Highlight and its ground in Shadow, so the colour no longer follows the picture and only the density of the code draws the figure. Try it with Scramble 0.5 and Background 0.3.

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

**Split Vector** – the Glyph Coverage: 1 inside the strokes of the character, 0 around them. Ink & Appearance colours it.

### Ink & Appearance

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Ink and Appearance folder: Shadow, Highlight and the Tone go into the Mix that gives Code Color; Background, One and the Glyph Coverage go into the Mix that gives Coverage; Code Color times Coverage gives Glyph Cell; Original Color and the glyph cell, each times its alpha, are mixed by Amount, and a Divide by Faded Alpha gives the Faded Color](../assets/effects/graphs/pixel-code-ink-and-appearance.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 924" aria-hidden="true" focusable="false">
<defs><marker id="pixel-code-ink-and-appearance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M264 649 L264 565" marker-end="url(#pixel-code-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="264" cy="649" r="18" /><text x="264" y="649" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M264 22 L264 102" marker-end="url(#pixel-code-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="264" cy="22" r="18" /><text x="264" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M427 22 L427 102" marker-end="url(#pixel-code-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="427" cy="22" r="18" /><text x="427" y="22" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M914 348 L914 264" marker-end="url(#pixel-code-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="914" cy="348" r="18" /><text x="914" y="348" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Ink & Appearance (Shadow, Highlight, Background, Amount). Each node is named by its output. 1 — Code Color: the colour of the cell. 2 — Coverage: character or ground. 3 — Glyph Cell: the character on its ground. 4 — Faded Color: Amount, back to plain colour.</figcaption>
</figure>

**Code Color** – mixes **Shadow** and **Highlight** by the Tone: the one colour of the cell, for its character and its ground. Pure black takes Shadow, pure white Highlight.

**Coverage** – moves **Background** towards One by the Glyph Coverage (Mix): 1 inside the strokes of the character, Background around them.

**Glyph Cell** – Code Color times Coverage (Multiply): the character in the full colour of its cell, the ground in a share of it, black at Background 0.

**Faded Color** – fades the untouched picture, pixel by pixel, towards the glyph cell by **Amount** and divides by the faded alpha. Both are first multiplied by their transparency, so the colour a transparent pixel hides never shows as a fringe around a cut-out figure.

## Technical details

- **Size.** Cell Size counts pixels of a frame whose shorter side is 1080: a 4K export, a portrait 1080 × 1920 frame, a lower Preview Quality and the thumbnails show the same code. A cell is never smaller than 2 pixels; below that Cell Size renders as 2, and the card says so.
- **Scramble.** Each cell draws one of `1 + ceil(Scramble × (ramp − 1))` characters around the one of its brightness, from Random (Cell) of the cell: the same in the preview, the export and on every graphics card. With Black Level above 0, cells at or below it keep their own character. Scramble renders between 0 and 1; outside that range the card says so.
- **Characters.** The code comes from an atlas, a sheet the engine draws for the Ramp, Font and Weight and keeps. Its tallest character spans 88 % of the cell height. Weight is drawn in steps of 100.
- **Time.** Pixel Code does not move by itself: every cell keeps its draw, so on footage the code changes only where the brightness of the picture changes, and a paused picture needs no extra rendering.
- **Transparency.** Each cell, its character and its ground take the transparency of the cell's centre, so a cut-out figure keeps its outline in whole cells. Amount fades the transparency back to the original's, pixel by pixel, without a fringe.
- **Saved projects.** A Pixel Code that stores its node setup keeps its look, including the earlier random number, whose sine drew faint diagonal stripes across the code. Effects saved without a stored setup now draw from Random (Cell), without the stripes; this is a fix. They keep Scramble 1, so every cell still draws any character, and the earlier deep blue and mint (`#144d7a` and `#47f2b8`). Presets fully apply only to effects added in this version: a stored setup from before has no Background, Black Level, Scramble, Shadow or Highlight row, so a preset leaves those values out.
- **More:** [Effect system](../Effect-System.md#glyph-cell-and-compute-effects) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
