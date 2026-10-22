# Retro Matrix

Turns the picture into glowing text on an old computer screen that slowly scrolls upwards. For control rooms, hacker scenes and memories of early computers: the figure stays readable in the brightness of the text while the text flows past.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-clip docs-compare">
<video src="../assets/effects/clips/retro-matrix.mp4" poster="../assets/effects/clips/retro-matrix.webp" width="1280" height="608" autoplay muted loop playsinline preload="none" aria-label="The dancer turning on a dark stage, original left and with Retro Matrix right: she is rebuilt from glowing amber digits on a dark screen with fine scanlines, bright digits 5 to 9 in her dress and dim 1, 2 and 3 on the stage, and the whole text scrolls slowly upwards while the picture stays in place"></video>
<figcaption>Left: original. Right: Retro Matrix at its default settings.</figcaption>
</figure>

**Use it for:** a computer screen in a set or a control room · a figure that dissolves into data · the look of a terminal from the seventies and eighties.

- **Phosphor** – the colour of the text: amber, green, white.
- **Speed** – how fast the text scrolls.
- **Scanlines** – how strongly the lines of the screen show.

**Tip:** set **Background** to 0 for a pure black screen: only the glowing text remains, and the figure shines out of it.

## Presets

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/retro-matrix-presets.mp4" poster="../assets/effects/clips/retro-matrix-presets.webp" width="902" height="954" autoplay muted loop playsinline preload="none" aria-label="The dancer four times in a grid, moving in sync, each with one preset: Green Screen top left with fine green text, Paper White top right with crisp white text without scanlines, Teletype bottom left with large amber digits that crawl up slowly, Binary Stream bottom right with zeros and ones in cold cyan racing upwards"></video>
<figcaption>The four presets on the moving dancer, in sync.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Green Screen** – fine green text on a dark screen, the classic computer terminal. For control rooms, old films and anything that should look like a computer at work.

**Paper White** – crisp white text without scanlines, like the paper-white monitors of the eighties; Black Level 0.15 keeps the dark stage a dark screen. Cool and clean; it sits well next to black-and-white footage.

**Teletype** – large amber digits that crawl up slowly; Black Level 0.14 empties the dark stage, so the bright digits carry the figure. Reads from far away on a projection and gives a scene a calm, heavy rhythm.

**Binary Stream** – zeros and ones in cold cyan that race upwards; Black Level 0.15 keeps them to the figure. Restless and technical: data flowing, a system under load.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Retro Matrix card: Style menu, Preset menu showing Teletype, Cell Size, Amount, Background, Black Level, Invert Ramp and Scanlines, then Ramp, Custom Ramp, Font and Weight, then Phosphor with an amber swatch, then Speed and Roll, beside a strip of the preview where the dancer's arm is drawn in large amber digits](../assets/effects/editor/retro-matrix-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1247" aria-hidden="true" focusable="false">
<defs><marker id="retro-matrix-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 319 L649 319" marker-end="url(#retro-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="319" r="18" /><text x="565" y="319" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M583 425 L667 425" marker-end="url(#retro-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="583" cy="425" r="18" /><text x="583" y="425" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M576 691 L660 691" marker-end="url(#retro-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="576" cy="691" r="18" /><text x="576" y="691" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M577 1035 L661 1035" marker-end="url(#retro-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="577" cy="1035" r="18" /><text x="577" y="1035" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M601 1150 L685 1150" marker-end="url(#retro-matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="601" cy="1150" r="18" /><text x="601" y="1150" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Retro Matrix with the Teletype preset. 1 — Preset: pick a starting point. 2 — Cell Size. 3 — Scanlines: the lines of the screen. 4 — Phosphor: the colour of the text. 5 — Speed: how fast it scrolls.</figcaption>
</figure>

The Style menu at the top of the card switches to another look of the same engine and keeps your values and keyframes, for example [Glyph Matrix](./glyph-matrix.md), [Symbol Matrix](./symbol-matrix.md) or [Matrix Rain](./matrix.md). Phosphor and Scanlines belong to Retro Matrix: the other looks keep their values for when you switch back.

### Grid

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/retro-matrix-cell-size.mp4" poster="../assets/effects/clips/retro-matrix-cell-size.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Retro Matrix while Cell Size runs from 8 to 40 px and back: fine scrolling text grows into a few large digits and shrinks again; the current value is shown at the bottom left"></video>
<figcaption>Cell Size from 8 to 40 px and back.</figcaption>
</figure>

**Cell Size** – how big one character is. 8–10 gives fine print, 14 a readable terminal, 24 and more large characters that read on a projection; at 72 the frame holds only 15 rows. The text scrolls by whole rows a second, so large characters also move faster across the frame. It counts pixels of a 1080p picture, so the preview, the thumbnails and a 4K export show the same grid. 4 to 72 px, default 14 px.

<div class="docs-float-end"></div>

### Style

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/retro-matrix-amount.mp4" poster="../assets/effects/clips/retro-matrix-amount.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Retro Matrix while Amount runs from 0 to 1 and back: the plain picture fades into glowing amber text and back; the current value is shown at the bottom left"></video>
<figcaption>Amount from 0 to 1 and back.</figcaption>
</figure>

**Amount** – how much of the effect you see. At 0 the original picture, unchanged; in between, the screen fades in over it. Keyframe it to let a scene turn into a computer screen on a cue. 0 to 1, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/retro-matrix-background.mp4" poster="../assets/effects/clips/retro-matrix-background.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Retro Matrix while Background runs from 0 to 1 and back: the digits glow on black, then amber fills the cells until the figure is a bright amber mosaic, and back; the current value is shown at the bottom left"></video>
<figcaption>Background from 0 to 1 and back.</figcaption>
</figure>

**Background** – how much the cells glow behind their characters. At 0 the text stands on black; 0.1–0.3 lets the bright parts of the picture glow softly behind the text, so the figure reads at a glance; towards 1 the bright cells fill with the phosphor colour and the text disappears into a glowing mosaic. Dark parts of the picture stay dark at any value. 0 to 1, default 0.2.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/retro-matrix-black-level.mp4" poster="../assets/effects/clips/retro-matrix-black-level.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Retro Matrix while Black Level runs from 0 to 0.5 and back: the faint characters on the dark stage go out first, then the shadows on her, until only her bright dress is drawn, and back; the current value is shown at the bottom left"></video>
<figcaption>Black Level from 0 to 0.5 and back.</figcaption>
</figure>

**Black Level** – the brightness up to which the picture counts as black. Everything darker gets the dimmest glow and the first character of the ramp, the space in most ramps (with Invert Ramp the last, densest one), and keeps it, even at Roll 1, so a grey stage turns into an empty dark screen and the lit figure stands out; the rest of the picture spreads over the whole ramp and the glow. 0 to 0.9, default 0.

<div class="docs-float-end"></div>

**Invert Ramp** – swaps the ends of the ramp: dark parts get the dense characters and bright parts the sparse ones, like a negative. The glow still follows the picture, so bright parts stay bright. The higher Roll, the less it shows. Either on or off, default off.

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/retro-matrix-scanlines.mp4" poster="../assets/effects/clips/retro-matrix-scanlines.webp" width="600" height="600" autoplay muted loop playsinline preload="none" aria-label="A close-up of Retro Matrix at one and a quarter times the size while Scanlines runs from 0 to 1 and back: at 0 the amber characters on her dress are solid, then dark lines three pixels apart cut through every row until each character is drawn in separate strokes, and back; the current value is shown at the bottom left"></video>
<figcaption>Scanlines from 0 to 1 and back, in a close-up at one and a quarter times the size.</figcaption>
</figure>

**Scanlines** – how dark the gaps between the lines of the screen get. At 0 the text is clean; 0.5 gives the soft lines of a monitor; at 1 the gaps turn black and every character is drawn in separate strokes, like an old tube up close. There is one line every 3 pixels of a 1080p frame, and the lines move with the text. On smaller frames, such as a reduced Preview Quality or the thumbnails, they fade into an even dimming instead of flickering; a 1080p or 4K export shows them in full. 0 to 1, default 0.5.

<div class="docs-float-end"></div>

### Glyphs

**Ramp** – the row of characters the picture is built from, from the darkest to the brightest part; each character of the text is drawn from the neighbours of its own one in this row (see Roll). **Numeric** (` 123456789` after a space) gives a screen of digits, dim 1, 2 and 3 in the dark and dense 7, 8 and 9 in the light; **Standard** and **Detailed** use punctuation and letters, like text; **Binary** zeros and ones; **Blocks** and **Bars** shaded blocks and bars. While a Custom Ramp is typed, the row rests and the card dims it. In the menu: Standard, Detailed, Blocks, Bars, Binary and 2 more, default Numeric.

**Custom Ramp** – your own characters, from dark to bright, instead of the Ramp: letters such as ` ilmwMW`, or a single character that fills every cell. Spaces at the end are ignored, and a ramp longer than 256 characters is thinned to 256, spread from its first to its last (the card says so). Clear it to use the Ramp again. Any text, default empty.

**Font** – the lettering. **Monospace** draws the even characters of a terminal; **Serif** and **Sans Serif** give rounder ones, each narrowed to fit its cell. Monospace, Serif, Sans Serif, default Monospace.

**Weight** – how heavy the strokes are. Heavier characters carry more light, so the screen gets brighter. How many steps you see depends on the font: the built-in monospace font of many systems only has regular (up to 500) and bold (600 and more). Keyframes step from one weight to the next. 200 to 900, default 600.

### Color

**Phosphor** – the colour the text glows in, like the phosphor of an old screen: amber (the default), green `#33ff66` (Green Screen), a cool white (Paper White) or any other colour. The brightest characters glow hotter than the colour itself, so amber turns towards yellow in the light parts. Pick a colour, default `#ff8514`.

### Motion

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/retro-matrix-speed.mp4" poster="../assets/effects/clips/retro-matrix-speed.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Retro Matrix at three speeds, about two seconds each: at Speed 0 the text stands still and changes only where she moves, at 1 it scrolls up three rows a second, at 3 it races upwards; the speed is shown at the bottom left"></video>
<figcaption>Speed 0, 1 and 3, about two seconds each.</figcaption>
</figure>

**Speed** – how fast the text scrolls up. At 1 it moves three rows a second, smoothly; at 0 it stands still and characters change only where the picture changes; 3 and more races. The picture itself stays in place: the text flows through it, and each character takes the brightness of the spot it passes. It follows the playhead, so a paused picture stands still and the export matches the preview; a keyframed Speed speeds up smoothly. 0 to 5, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/retro-matrix-roll.mp4" poster="../assets/effects/clips/retro-matrix-roll.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Retro Matrix while Roll runs from 0 to 1 and back: at 0 each digit follows the brightness, from blank on the stage to 9 in her dress, then the text gets more and more random until any digit can stand anywhere and the figure shows only in the brightness, and back; the current value is shown at the bottom left"></video>
<figcaption>Roll from 0 to 1 and back.</figcaption>
</figure>

**Roll** – how far a character of the text may stray from the character of its brightness. At 0 every cell shows exactly that character, like [ASCII](./ascii.md), and the dark stage stays empty; 0.3 picks from a window of four characters: its own and its three nearest neighbours in the ramp, so the screen fills with text while dense characters still mark the bright parts; at 1 any character can stand anywhere, and the figure shows only in the brightness. Any value above 0 draws from at least two characters. 0 to 1, default 0.3.

<div class="docs-float-end"></div>

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Retro Matrix graph in nine stages: Parameters feed Scroll (Speed), whose Scroll Offset moves Cell Grid (Cell Size); Cell Grid passes the cell centre to Cell Sampling & Tone, the line cell to Glyph Offset, the position in the cell to Atlas Alpha and the grid position to Scanlines, which also reads the Wrapped Scroll; Tone to Glyph turns the tone into the cell's own character, Glyph Offset gives each cell of the text its random character, Roll Window (Roll) keeps it near the Tone Glyph, holds cells below Black Level still and passes the glyph index to Atlas Alpha; Scanlines (Scanlines) and Ink & Appearance (Phosphor, Background, Amount) light the coverage and draw the picture](../assets/effects/graphs/retro-matrix.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 887" aria-hidden="true" focusable="false">
<defs><marker id="retro-matrix-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M184 198 L184 282" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="184" cy="198" r="18" /><text x="184" y="198" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M292 733 L292 649" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="292" cy="733" r="18" /><text x="292" y="733" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M400 666 L400 750" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="400" cy="666" r="18" /><text x="400" y="666" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M509 509 L509 425" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="509" cy="509" r="18" /><text x="509" y="509" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M617 22 L617 72" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="617" cy="22" r="18" /><text x="617" y="22" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M725 455 L725 371" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="725" cy="455" r="18" /><text x="725" y="455" class="docs-shot-number-text">6</text>
<path class="docs-shot-arrow" d="M833 248 L833 332" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="833" cy="248" r="18" /><text x="833" y="248" class="docs-shot-number-text">7</text>
<path class="docs-shot-arrow" d="M833 688 L833 604" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="833" cy="688" r="18" /><text x="833" y="688" class="docs-shot-number-text">8</text>
<path class="docs-shot-arrow" d="M941 457 L941 541" marker-end="url(#retro-matrix-arrow)" />
<circle class="docs-shot-number" cx="941" cy="457" r="18" /><text x="941" y="457" class="docs-shot-number-text">9</text>
</svg>
</div>

<figcaption>Retro Matrix opened in the Nodes tab (input frame and output left out). 1 — Scroll: how far the text has moved. 2 — Cell Grid: the cell of the moving text. 3 — Cell Sampling & Tone: the brightness under it. 4 — Tone to Glyph: the character of that brightness. 5 — Glyph Offset: the cell's random character. 6 — Roll Window: kept near its own one. 7 — Atlas Alpha: where it covers the cell. 8 — Scanlines: the lines of the screen. 9 — Ink & Appearance: phosphor, glow and ground.</figcaption>
</figure>

Retro Matrix works in nine stages, one folder each in the Nodes tab: **Scroll** counts how many rows the text has moved, **Cell Grid** cuts the frame into cells that move up with it, **Cell Sampling & Tone** reads the colour and brightness under each cell, **Tone to Glyph** picks the character of that brightness, **Glyph Offset** gives every cell of the text a fixed random character of its own, **Roll Window** keeps it near the character of its brightness, **Atlas Alpha** looks up where the character covers the cell, **Scanlines** draws the lines of the screen, and **Ink & Appearance** lights the character in the phosphor colour on its ground. Click a folder's header to open it. Scroll, Glyph Offset and Scanlines make the screen; Roll Window works as in [Glyph Matrix](./glyph-matrix.md#roll-window), the other four as in [ASCII](./ascii.md#node-setup). Retro Matrix is one look of the glyph engine that the [Text & Glyph](../Effects-Glyph.md#the-shared-idea) looks share; its **Style** menu switches between them.

### Scroll

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Scroll folder in two rows: Seconds times Speed, or Speed Travel when Greater Than finds keyframes, goes through Switch into the clock; Multiply by Scroll Rate 3 gives the scroll in rows; below, Divide by Scroll Period 12288 and Floor give the Turns, Multiply by the period and Subtract give the Wrapped Scroll; Combine Vector with Zero sideways gives the Scroll Offset](../assets/effects/graphs/retro-matrix-scroll.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1289" aria-hidden="true" focusable="false">
<defs><marker id="retro-matrix-scroll-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M518 242 L518 326" marker-end="url(#retro-matrix-scroll-arrow)" />
<circle class="docs-shot-number" cx="518" cy="242" r="18" /><text x="518" y="242" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M709 242 L709 326" marker-end="url(#retro-matrix-scroll-arrow)" />
<circle class="docs-shot-number" cx="709" cy="242" r="18" /><text x="709" y="242" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M327 1139 L327 1055" marker-end="url(#retro-matrix-scroll-arrow)" />
<circle class="docs-shot-number" cx="327" cy="1139" r="18" /><text x="327" y="1139" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M709 980 L709 1064" marker-end="url(#retro-matrix-scroll-arrow)" />
<circle class="docs-shot-number" cx="709" cy="980" r="18" /><text x="709" y="980" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M900 1157 L900 1073" marker-end="url(#retro-matrix-scroll-arrow)" />
<circle class="docs-shot-number" cx="900" cy="1157" r="18" /><text x="900" y="1157" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Scroll (Speed). The number cards are values from the Constants folder, shown where they plug in. 1 — Clock: the playhead time × Speed. 2 — Scroll: the rows the text has moved. 3 — Turns: whole periods of 12 288 rows. 4 — Wrapped Scroll: the scroll within one period. 5 — Scroll Offset: the scroll as an upward shift.</figcaption>
</figure>

**Clock** – how far the clock has run: Seconds × Speed (the Multiply above it), or Speed Travel, the distance a keyframed Speed has covered, when Speed has keyframes (Greater Than checks for that).

**Scroll** – the clock times Scroll Rate 3: how many rows the text has moved up, three a second at Speed 1.

**Turns** – how many whole periods of Scroll Period 12 288 rows the text has passed (Divide, Floor): one every 68 minutes at Speed 1.

**Wrapped Scroll** – the scroll minus the whole periods (Multiply, Subtract), so it starts again at 0 after each period. The text repeats with the same period (Glyph Offset), so you never see the jump; it keeps the numbers small, so the characters stay sharp even hours into a show.

**Scroll Offset** – the wrapped scroll as a shift of the grid, upwards only (Combine Vector with 0 sideways). Cell Grid adds it.

### Cell Grid

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Cell Grid folder, the part that scrolls: Resolution divided by the Cell Pixels gives the grid, Multiply with UV the place on it; Add with the Scroll Offset gives the scrolled grid; Floor and Fraction give the cell and the place inside it; Add Half, Subtract the Scroll Offset and Divide by the grid give the cell centre on the picture](../assets/effects/graphs/retro-matrix-cell-grid.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 637" aria-hidden="true" focusable="false">
<defs><marker id="retro-matrix-cell-grid-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M326 154 L326 238" marker-end="url(#retro-matrix-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="326" cy="154" r="18" /><text x="326" y="154" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M448 458 L448 374" marker-end="url(#retro-matrix-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="448" cy="458" r="18" /><text x="448" y="458" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M569 210 L569 294" marker-end="url(#retro-matrix-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="569" cy="210" r="18" /><text x="569" y="210" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M569 579 L569 495" marker-end="url(#retro-matrix-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="569" cy="579" r="18" /><text x="569" y="579" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M813 210 L813 294" marker-end="url(#retro-matrix-cell-grid-arrow)" />
<circle class="docs-shot-number" cx="813" cy="210" r="18" /><text x="813" y="210" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Cell Grid (Cell Size), the part that scrolls. 1 — Multiply: the place on the grid. 2 — Scrolled Grid: moved up by the scroll. 3 — Floor: the cell, in lines of text. 4 — Fraction: the place inside the cell. 5 — Subtract: back onto the picture.</figcaption>
</figure>

**Multiply** – the pixel's place on the grid, counted in cells: its position (UV) times the number of cells across and down. The Cell Pixels come from Cell Size in 1080p steps, as in [ASCII](./ascii.md#cell-grid).

**Scrolled Grid** – that place plus the Scroll Offset (Add): the grid moves up, and the rows of text with it.

**Floor** – which cell of the moving text the pixel lies in, counted in lines of text since the start. Glyph Offset draws the cell's character from this number, so a character stays the same while it travels up.

**Fraction** – where the pixel lies inside its cell; Atlas Alpha draws the character with it, so every character stays whole, wherever the scroll is.

**Subtract** – the middle of the cell minus the Scroll Offset: back to the place on the picture where the cell is right now. Cell Sampling & Tone reads the picture there, so each character takes the brightness of the spot it passes.

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

**Split RGB + Alpha** – the cell's colour and its transparency. Retro Matrix uses only the brightness and the transparency: the colour comes from Phosphor.

**Luminance** – the brightness of the cell colour, weighted the way the eye sees it (green counts most).

**Divide** – applies **Black Level**: the luminance minus Black Level (Subtract), divided by what is left above it (the other Subtract: One minus Black Level). The Clamp next to Black Level keeps it between 0 and Black Level Max 0.9.

**Clamp** – keeps the result between 0 and 1, so everything darker than Black Level becomes 0: the Tone. It picks the character and sets how strongly it glows.


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

**Clamp** – keeps the tone just under 1, so the brightest cells get the last character and never one past it.

**Multiply** – spreads the tone over the number of characters in the ramp.

**Floor** – the number of the cell's own character: the Tone Glyph that Roll Window keeps the text near.

### Glyph Offset

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Glyph Offset folder in two rows: Split Vector takes the line of the Line Cell; Add Half, Divide by Text Period 12288 and Floor give the Text Turns, Multiply by the period and Subtract give the Text Line; Combine Vector puts the column and the Text Line back together, Random (Cell) of it gives the Text Random; Multiply by the Glyph Count and Floor give the Glyph Offset](../assets/effects/graphs/retro-matrix-glyph-offset.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 941" aria-hidden="true" focusable="false">
<defs><marker id="retro-matrix-glyph-offset-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M744 23 L744 107" marker-end="url(#retro-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="744" cy="23" r="18" /><text x="744" y="23" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M115 918 L115 834" marker-end="url(#retro-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="115" cy="918" r="18" /><text x="115" y="918" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M430 399 L430 483" marker-end="url(#retro-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="430" cy="399" r="18" /><text x="430" y="399" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M744 683 L744 599" marker-end="url(#retro-matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="744" cy="683" r="18" /><text x="744" y="683" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Glyph Offset. The number cards are values from the Constants folder, shown where they plug in. 1 — Text Turns: whole periods of lines. 2 — Text Line: the line within one period. 3 — Text Random: the cell's own random number. 4 — Glyph Offset: how far its character sits from the one of its brightness.</figcaption>
</figure>

**Text Turns** – how many whole periods of Text Period 12 288 lines lie above this line of text (Split Vector takes the line from the Line Cell; Add Half, Divide, Floor). The half keeps the count exact at the border of a period.

**Text Line** – the line within its period (Multiply, Subtract): the same number the line had one period earlier, so the text repeats exactly when Scroll wraps.

**Text Random** – a random number from 0 to 1 for each cell of the moving text (Random (Cell) of the column and the Text Line, put together by Combine Vector). It belongs to the cell's column and line of text, so it travels up with the scroll and never changes on the way: that is what makes it read as text, not as noise.

**Glyph Offset** – the random number times the number of characters, rounded down (Multiply, Floor): how far this character of the text sits from the character of its brightness. Roll Window folds it into the window around it.

### Roll Window

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Roll Window folder, the dark hold: Greater Than asks whether Black Level is above Zero and feeds a Switch that gives Zero instead of Roll as the Dark Roll; a second Greater Than asks whether the Tone is above Zero (Lit) and feeds a Switch that gives Roll for lit cells and the Dark Roll for the others, the Cell Roll](../assets/effects/graphs/glyph-matrix-roll-hold.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 724" aria-hidden="true" focusable="false">
<defs><marker id="glyph-matrix-roll-hold-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M363 234 L363 318" marker-end="url(#glyph-matrix-roll-hold-arrow)" />
<circle class="docs-shot-number" cx="363" cy="234" r="18" /><text x="363" y="234" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M363 81 L363 165" marker-end="url(#glyph-matrix-roll-hold-arrow)" />
<circle class="docs-shot-number" cx="363" cy="81" r="18" /><text x="363" y="81" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M500 300 L500 216" marker-end="url(#glyph-matrix-roll-hold-arrow)" />
<circle class="docs-shot-number" cx="500" cy="300" r="18" /><text x="500" y="300" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>Inside Roll Window (Roll, Black Level), the dark hold. 1 — Lit: the cell is brighter than Black Level. 2 — Dark Roll: the roll of a dark cell. 3 — Cell Roll: the roll this cell gets.</figcaption>
</figure>

**Lit** – Greater Than: is the cell's Tone above 0, so brighter than Black Level? The other Greater Than asks whether Black Level is set at all (above 0).

**Dark Roll** – a Switch: 0 while Black Level is above 0, otherwise Roll. At Black Level 0, also in effects saved before this hold existed, every cell rolls as before.

**Cell Roll** – the second Switch: Roll for a lit cell, the Dark Roll for a dark one. The window below is built from it, so with Black Level set a dark cell keeps its character, even at Roll 1, and the dark stage stays empty.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Roll Window folder, first part: Glyph Count minus One times the Cell Roll, through Ceiling and plus One, gives the window; times Half and Floor gives half the window; Tone Glyph minus that half, clamped between Zero and Glyph Count minus the window, gives the window start](../assets/effects/graphs/glyph-matrix-roll-window.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 398" aria-hidden="true" focusable="false">
<defs><marker id="glyph-matrix-roll-window-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M400 48 L400 132" marker-end="url(#glyph-matrix-roll-window-arrow)" />
<circle class="docs-shot-number" cx="400" cy="48" r="18" /><text x="400" y="48" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M509 48 L509 132" marker-end="url(#glyph-matrix-roll-window-arrow)" />
<circle class="docs-shot-number" cx="509" cy="48" r="18" /><text x="509" y="48" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M725 299 L725 215" marker-end="url(#glyph-matrix-roll-window-arrow)" />
<circle class="docs-shot-number" cx="725" cy="299" r="18" /><text x="725" y="299" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M941 365 L941 281" marker-end="url(#glyph-matrix-roll-window-arrow)" />
<circle class="docs-shot-number" cx="941" cy="365" r="18" /><text x="941" y="365" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Roll Window (Roll), the size of the window. 1 — Ceiling: the neighbours a cell draws from. 2 — Window: how many characters. 3 — Floor: half the window. 4 — Window Start: where the window begins in the ramp.</figcaption>
</figure>

**Ceiling** – the Cell Roll times the ramp's length minus one (Subtract, Multiply), rounded up: how many neighbours a character may be drawn from. Any Cell Roll above 0 gives at least one.

**Window** – that number plus the cell's own character (Add): from 1 at Roll 0 to the whole ramp at Roll 1.

**Floor** – half the window, as a whole number (Multiply by Half first): how far the window reaches below the cell's own character.

**Window Start** – the Tone Glyph minus that half, kept between 0 and the ramp's length minus the window (Clamp). The window never hangs over an end of the ramp: the brightest cells draw from the densest characters and never from empty ones.

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

<figcaption>Inside Roll Window, the roll. 1 — Step: how far the character sits from the window's start. 2 — Divide: how many windows that is. 3 — Place in Window: where it lands in the window. 4 — Glyph Index: the character it shows.</figcaption>
</figure>

**Step** – the cell's own place in its window plus the Glyph Offset (Subtract, then Add).

**Divide** – the step divided by the window (half a step added first, so the division never lands just below a whole number); Floor counts the whole windows passed.

**Place in Window** – the step minus those whole windows (Multiply, Subtract): a place in the window, picked by the cell's Text Random.

**Glyph Index** – Window Start plus the place in the window (Add): the character the cell shows. At Roll 1 the window is the whole ramp, so any character can stand anywhere.

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

**Clamp** – keeps the place inside the cell half a pixel of the sheet away from the edges of the character's square (Half Texel, 0.5 of the 64 pixels of a square, and One Minus Half Texel). The sheet is read with smoothing, so a read any closer would mix in a little of the neighbouring character: blocks and bars would show thin seams wherever a cell is not a whole number of pixels.

**Sample Image** – reads the sheet at the character's square plus the place inside the cell.

**Split Vector** – the Glyph Coverage: 1 inside the strokes of the character, 0 around them.

### Scanlines

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Scanlines folder in two rows: the Frame Scale times Line Spacing 3 gives the Line Pitch; the Cell Pixels divided by it give the Lines per Row; the grid position's row times that gives the Lines, the Wrapped Scroll times it the Scroll Lines, whose Fraction is the Scroll Phase; Add and Fraction give the Line Phase, times Pi through Sine and Power with Two the Line Dip; Smoothstep from Fade From 1.5 to Fade To 3 over the Line Pitch gives the Line Fade, and a Mix with Half fades the dip; the clamped Scanlines times it, subtracted from One, gives the Scanline](../assets/effects/graphs/retro-matrix-scanlines.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1654" aria-hidden="true" focusable="false">
<defs><marker id="retro-matrix-scanlines-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M244 387 L244 303" marker-end="url(#retro-matrix-scanlines-arrow)" />
<circle class="docs-shot-number" cx="244" cy="387" r="18" /><text x="244" y="387" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M641 203 L641 287" marker-end="url(#retro-matrix-scanlines-arrow)" />
<circle class="docs-shot-number" cx="641" cy="203" r="18" /><text x="641" y="203" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M641 352 L641 268" marker-end="url(#retro-matrix-scanlines-arrow)" />
<circle class="docs-shot-number" cx="641" cy="352" r="18" /><text x="641" y="352" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M905 85 L905 169" marker-end="url(#retro-matrix-scanlines-arrow)" />
<circle class="docs-shot-number" cx="905" cy="85" r="18" /><text x="905" y="85" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M376 1061 L376 1145" marker-end="url(#retro-matrix-scanlines-arrow)" />
<circle class="docs-shot-number" cx="376" cy="1061" r="18" /><text x="376" y="1061" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M376 787 L376 703" marker-end="url(#retro-matrix-scanlines-arrow)" />
<circle class="docs-shot-number" cx="376" cy="787" r="18" /><text x="376" y="787" class="docs-shot-number-text">6</text>
<path class="docs-shot-arrow" d="M773 924 L773 1008" marker-end="url(#retro-matrix-scanlines-arrow)" />
<circle class="docs-shot-number" cx="773" cy="924" r="18" /><text x="773" y="924" class="docs-shot-number-text">7</text>
</svg>
</div>

<figcaption>Inside Scanlines (Scanlines). The number cards are values from the Constants folder, shown where they plug in. 1 — Line Pitch: the distance of two lines. 2 — Lines: lines above the pixel on the screen. 3 — Scroll Phase: how far the scroll has moved the lines. 4 — Line Phase: where the pixel sits between two lines. 5 — Line Dip: dark between lines. 6 — Line Fade: fades lines that are too fine. 7 — Scanline: the factor the text is lit with.</figcaption>
</figure>

**Line Pitch** – how far apart the lines are on this frame: Line Spacing 3 times the Frame Scale (the shorter side of the frame divided by 1080, from Cell Grid). 3 pixels at 1080p, 6 at 4K.

**Lines** – how many lines lie above the pixel on the screen: its row in the grid (Split Vector of the Grid Position) times the Lines per Row, the Cell Pixels divided by the Line Pitch (Divide, Multiply).

**Scroll Phase** – the Wrapped Scroll times the Lines per Row (Multiply), and only its Fraction: how far between two lines the scroll has moved them. It moves the lines with the text.

**Line Phase** – Lines plus Scroll Phase, and again only the Fraction (Add, Fraction): where the pixel sits between two lines, 0 on a line. Only this small number goes on to the sine, so the lines stay even hours into a show.

**Line Dip** – the sine of Line Phase × Pi, squared (Sine, Power with Two): 0 on a line, 1 halfway between two lines.

**Line Fade** – a Smoothstep from Fade From 1.5 to Fade To 3 over the Line Pitch: 1 when the lines are at least 3 pixels apart, 0 at 1.5 and closer. A Mix with Half fades the Line Dip towards an even 0.5 there, so small frames show an even dimming instead of a flickering pattern.

**Scanline** – one minus **Scanlines** (Clamp keeps it from 0 to 1) times the faded dip (Multiply, Subtract): 1 on a line, 1 − Scanlines between the lines. Ink & Appearance multiplies the glowing text by it.

**Remix:** open the **Constants** folder and set **Line Spacing** to **6**: half as many, broader lines, like a big old television seen from close by.

### Ink & Appearance

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Ink and Appearance folder: Background, One and the Glyph Coverage go into the Mix that gives the Coverage; the Phosphor through Vector 4 to RGB times the Coverage gives the Ink; Tone Base 0.15 plus Tone Factor 1.6 times the Tone gives the Brightness; Ink times Brightness gives the Lit Ink, times the Scanline the Glyph Cell; Original Color and the glyph cell, each times its alpha, are mixed by Amount into Faded Premultiplied, and a Divide by Faded Alpha gives the Faded Color](../assets/effects/graphs/retro-matrix-ink-and-appearance.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 761" aria-hidden="true" focusable="false">
<defs><marker id="retro-matrix-ink-and-appearance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M326 58 L326 142" marker-end="url(#retro-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="326" cy="58" r="18" /><text x="326" y="58" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M204 392 L204 308" marker-end="url(#retro-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="204" cy="392" r="18" /><text x="204" y="392" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M326 344 L326 428" marker-end="url(#retro-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="326" cy="344" r="18" /><text x="326" y="344" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M569 58 L569 142" marker-end="url(#retro-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="569" cy="58" r="18" /><text x="569" y="58" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M813 58 L813 142" marker-end="url(#retro-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="813" cy="58" r="18" /><text x="813" y="58" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M935 350 L935 266" marker-end="url(#retro-matrix-ink-and-appearance-arrow)" />
<circle class="docs-shot-number" cx="935" cy="350" r="18" /><text x="935" y="350" class="docs-shot-number-text">6</text>
</svg>
</div>

<figcaption>Inside Ink & Appearance (Phosphor, Background, Amount). Each card is named by its output. 1 — Ink: the phosphor colour on its ground. 2 — Coverage: the strokes, lifted by Background. 3 — Brightness: the glow of the tone. 4 — Glyph Cell: lit and scanned. 5 — Faded Premultiplied: Amount. 6 — Faded Color: back to plain colour.</figcaption>
</figure>

**Ink** – the Phosphor colour (Vector 4 to RGB) times the Coverage: the Glyph Coverage from Atlas Alpha, lifted to **Background** around the strokes (the Mix with One). The character glows at full colour, the cell around it at Background.

**Coverage** – that lifted coverage on its own: 1 in the strokes, Background between them.

**Brightness** – Tone Base 0.15 plus Tone Factor 1.6 times the Tone (Multiply, Add): dim in the dark parts, 1.75 in the brightest, where the colour overdrives and amber turns towards yellow. The Lit Ink is the Ink times this Brightness.

**Glyph Cell** – the Lit Ink times the Scanline from Scanlines: the finished screen.

**Faded Premultiplied** – fades the untouched picture, pixel by pixel, towards the screen by **Amount**. Both are first multiplied by their transparency (Original Alpha, Cell Alpha), and the transparency fades the same way (Faded Alpha).

**Faded Color** – divides by Faded Alpha (at least a millionth) to get back to plain colour. Mixed this way, the colour a transparent pixel hides never shows as a dark or green fringe around a cut-out figure while Amount fades.

## Technical details

- **Size.** Cell Size counts pixels of a frame whose shorter side is 1080: a 4K export, a portrait frame, a lower Preview Quality and the thumbnails show the same grid. A cell is never smaller than 2 pixels of the frame; below 2 px Cell Size renders as 2, and the card says so. The scanlines lie 3 pixels of a 1080p frame apart and fade into an even dimming of 1 − Scanlines / 2 where they would be closer than about 3 pixels of the output.
- **Time.** The text scrolls up 3 × Speed rows a second with the timeline time; after 12 288 rows (68 minutes at Speed 1) the scroll wraps and the text repeats, so you never see a jump and the characters and lines stay sharp hours into a show. Scrubbing, playback and export give the same frame for the same moment, and a paused picture needs no extra rendering. With keyframes on Speed it moves by the distance Speed has travelled, so it never jumps.
- **Text.** Each cell of the scrolled grid keeps one random character for its column and line of text, drawn from a window of 1 + Roll × (ramp − 1) characters, rounded up, around the character of its brightness and kept inside the ramp. It glows at Phosphor × (0.15 + 1.6 × brightness). Scanlines and Roll outside 0 to 1 render as 0 or 1, and the card and the tools say so.
- **Characters.** The whole ramp is drawn in one font size, so its tallest character spans 88 % of the cell height. Blocks and Bars are exact shapes, read half a pixel inside each character, so they join without seams at any cell size.
- **Transparency.** Each cell takes the transparency of the picture at its centre, so a cut-out figure keeps its outline in whole cells; as the text scrolls, its top and bottom edges move in steps of a cell. Amount fades the transparency back to the original's, pixel by pixel, and mixes the colours weighted by their transparency, so the hidden colour of a transparent pixel never shows as a fringe around a cut-out figure.
- **Saved projects.** A Retro Matrix stores its node setup and keeps its look. Effects saved without a stored setup now scroll their text; before, the frame was cut into bands of the ramp's length whose borders cut characters in half, the text did not scroll, and the scanlines were one pixel of the output wide, so the preview and an export at another size differed, a bug. They load with amber, Roll 1, Background 0 and Scanlines 0.36, the values they had; their text now glows more strongly with the picture's brightness. A stored setup keeps its smaller characters, which cover about half of a cell, and the way it read the character sheet, so saved Blocks or Bars can show thin seam lines on frames whose cells are not a whole number of pixels; Black Level is 0 there. A stored setup also keeps the earlier Cell Size in pixels of the output, so its preview at another quality and an export at another size show different grids; add the effect again for the 1080p grid. Presets fully apply only to effects added in this version: on a stored setup from before, the card has no Background, Black Level, Roll, Scanlines or Phosphor row, so a preset leaves those values out.
- **More:** [Effect system](../Effect-System.md#glyph-cell-and-compute-effects) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
