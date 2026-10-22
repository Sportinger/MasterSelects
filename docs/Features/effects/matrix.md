# Matrix Rain

Lets glowing code rain down the picture, and the figure appears in the falling characters. For digital worlds, hacker scenes and a person who turns into data.

Group: [Text & Glyph](../Effects-Glyph.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-clip docs-compare">
<video src="../assets/effects/clips/matrix.mp4" poster="../assets/effects/clips/matrix.webp" width="1280" height="608" autoplay muted loop playsinline preload="none" aria-label="The dancer turning on a dark stage, original left and with Matrix Rain right: green digits fall down every column with bright, almost white heads and fading trails; on the dark stage the trails stay dim and only the heads flash, while on her the trails glow bright and a soft green glow fills her shape, arms included, so she turns in the falling code"></video>
<figcaption>Left: original. Right: Matrix Rain at its default settings.</figcaption>
</figure>

**Use it for:** a digital world or a computer inside the story · a figure that dissolves into data · an alarm or a system failure, in red.

- **Rain Color** – the colour of the code: green, cyan, red or any other.
- **Trail** – how long the fading tail behind each falling head is, as a share of the gap to the next drop in its column. At 0 only the heads fall, like single sparks; 0.5 gives the classic streaks; at 1 a tail fades out just as the next head arrives, so the columns are almost always lit. The tail fades from the full colour at the head to nothing at its end. 0 to 1, default 0.5.
- **Speed** – how fast the drops fall.
- **Background** – how strongly the figure glows behind the code.

**Tip:** set **Black Level** to about 0.2: the rain stops on the dark stage, and only the lit figure is drawn in falling code (the **Code Portrait** preset).

## Presets

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/matrix-presets.mp4" poster="../assets/effects/clips/matrix-presets.webp" width="902" height="954" autoplay muted loop playsinline preload="none" aria-label="The dancer four times in a grid, moving in sync, each with one preset: Digital Rain top left with green katakana and digits falling over the whole frame, Code Portrait top right where only her lit figure is drawn in green digits on an empty black stage, Binary Storm bottom left with dense, fine cyan zeros and ones racing down over the whole frame, Red Alert bottom right with large red digits and short trails"></video>
<figcaption>The four presets on the moving dancer, in sync.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Digital Rain** – green katakana and digits that rain over the whole frame, like the code of the films; a faint glow keeps the figure. The katakana come from the Japanese font of your system (see Custom Ramp). For the classic digital world.

**Code Portrait** – only the lit figure is drawn, in green digits with long trails; Black Level 0.2 leaves the dark stage empty and black. Calm and precise: a person scanned, remembered or rebuilt by a machine.

**Binary Storm** – fine zeros and ones in cold cyan that race down densely over the whole frame, with long trails; the figure glows in the storm. Restless and technical: data flowing, a system under load.

**Red Alert** – large red digits with short trails that fall fast, their heads flashing pale. For danger, an alarm or a system that breaks down.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Matrix Rain card: Style menu, Preset menu showing Code Portrait, Cell Size, Amount, Background, Black Level and Invert Ramp, then Ramp, Custom Ramp, Font and Weight, then Rain Color with a green swatch, then Speed, Roll and Trail, beside a strip of the preview where the dancer is drawn in green digits on a black stage](../assets/effects/editor/matrix-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 857" aria-hidden="true" focusable="false">
<defs><marker id="matrix-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M678 220 L762 220" marker-end="url(#matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="678" cy="220" r="18" /><text x="678" y="220" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M690 292 L774 292" marker-end="url(#matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="690" cy="292" r="18" /><text x="690" y="292" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M677 423 L761 423" marker-end="url(#matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="677" cy="423" r="18" /><text x="677" y="423" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M681 685 L765 685" marker-end="url(#matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="681" cy="685" r="18" /><text x="681" y="685" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M715 817 L799 817" marker-end="url(#matrix-inspector-arrow)" />
<circle class="docs-shot-number" cx="715" cy="817" r="18" /><text x="715" y="817" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Matrix Rain with the Code Portrait preset. 1 — Preset: pick a starting point. 2 — Cell Size. 3 — Black Level: empties the dark stage. 4 — Rain Color: the colour of the code. 5 — Trail: how long the falling tails are.</figcaption>
</figure>

**Style** – switches to another look of the glyph engine, for example [Retro Matrix](./retro-matrix.md), [Symbol Matrix](./symbol-matrix.md) or [ASCII](./ascii.md). Controls you changed keep their values and keyframes when the new look has the same control; the others start at the new look's defaults. **Rain Color** and **Trail** belong to Matrix Rain alone. **Undo** brings the old look back.

### Grid

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/matrix-cell-size.mp4" poster="../assets/effects/clips/matrix-cell-size.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Matrix Rain while Cell Size runs from 8 to 40 px and back: fine falling code grows into a few columns of large digits and shrinks again; the current value is shown at the bottom left"></video>
<figcaption>Cell Size from 8 to 40 px and back.</figcaption>
</figure>

**Cell Size** – how big one character is. 8–10 gives a fine drizzle of code, 14 the classic look, 24 and more large characters that read on a projection; at 72 the frame holds only 15 rows, so only a few drops are on screen at a time. The drops fall by whole rows, so large characters also fall faster across the frame. It counts pixels of a 1080p picture, so the preview, the thumbnails and a 4K export show the same grid. 4 to 72 px, default 14 px.

<div class="docs-float-end"></div>

### Style

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/matrix-amount.mp4" poster="../assets/effects/clips/matrix-amount.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Matrix Rain while Amount runs from 0 to 1 and back: the plain picture fades into falling green code and back; the current value is shown at the bottom left"></video>
<figcaption>Amount from 0 to 1 and back.</figcaption>
</figure>

**Amount** – how much of the effect you see. At 0 the original picture, unchanged; in between, the rain fades in over it. Keyframe it to let a scene dissolve into code on a cue. 0 to 1, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/matrix-background.mp4" poster="../assets/effects/clips/matrix-background.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Matrix Rain while Background runs from 0 to 1 and back: at 0 only the falling digits show on black, then a green glow of her figure rises behind them and brightens where the trails pass, until she glows bright green, and back; the current value is shown at the bottom left"></video>
<figcaption>Background from 0 to 1 and back.</figcaption>
</figure>

**Background** – how strongly the picture glows behind the code, in the Rain Color. At 0 only the falling characters show on black, and the figure reads in their brightness alone; 0.3 lets her shape glow softly, brighter wherever a trail passes; towards 1 she becomes a bright, solid shape in the rain. The glow is soft: a slightly blurred copy of the picture, not a square per cell. Dark parts of the picture stay dark at any value. 0 to 1, default 0.3.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/matrix-black-level.mp4" poster="../assets/effects/clips/matrix-black-level.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Matrix Rain while Black Level runs from 0 to 0.5 and back: the rain on the dark stage goes out first, then on the shadows of her body, until only her bright dress is drawn in falling code, and back; the current value is shown at the bottom left"></video>
<figcaption>Black Level from 0 to 0.5 and back.</figcaption>
</figure>

**Black Level** – the brightness up to which the picture counts as black. Everything darker gets the first character of the ramp, the space in most ramps (with Invert Ramp the last, densest one), and keeps it, even at Roll 1: the rain goes out there, so a grey stage turns black and only the lit figure is drawn in code. The rest of the picture spreads over the whole ramp and the glow. Try 0.15–0.25 on stage footage. 0 to 0.9, default 0.

<div class="docs-float-end"></div>

**Invert Ramp** – swaps the ends of the ramp: dark parts get the dense characters and bright parts the sparse ones, like a negative. The rain still glows brightest where the picture is bright. The higher Roll, the less it shows. Either on or off, default off.

### Glyphs

**Ramp** – the row of characters the rain is built from, from the darkest to the brightest part; each cell draws its character from the neighbours of its own one in this row (see Roll). **Numeric** (` 123456789` after a space) gives small digits in the dark and dense 8s and 9s in the light, so the figure also reads in the digits; **Binary** zeros and ones; **Symbols** dots, crosses and # and @; **Standard** and **Detailed** punctuation and letters; **Blocks** and **Bars** shaded blocks and bars that fall like streaks of light. While a Custom Ramp is typed, the row rests and the card dims it. In the menu: Standard, Detailed, Blocks, Bars, Binary and 2 more, default Numeric.

**Custom Ramp** – your own characters, from dark to bright, instead of the Ramp: half-width katakana and digits for the code of the films (Digital Rain), letters of a word, or a single block `█` for pure streaks of light. Characters the chosen Font lacks come from another font of your system; on a system without a Japanese font, katakana show as boxes. Spaces at the end are ignored, and a ramp longer than 256 characters is thinned to 256, spread from its first to its last (the card says so). Clear it to use the Ramp again. Any text, default empty.

**Font** – the lettering. **Monospace** draws the even characters of a terminal; **Serif** and **Sans Serif** give rounder ones, each narrowed to fit its cell. Monospace, Serif, Sans Serif, default Monospace.

**Weight** – how heavy the strokes are. Heavier characters carry more light, so the rain gets brighter. How many steps you see depends on the font: the built-in monospace font of many systems only has regular (up to 500) and bold (600 and more). Keyframes step from one weight to the next. 200 to 900, default 600.

### Color

**Rain Color** – the colour the code glows in: the green of the films (the default), cyan (Binary Storm), red (Red Alert) or any other. The head of each drop flashes almost white, on the dark stage as well as on the figure, and the brightest parts of the picture glow paler than the colour itself. Pick a colour, default `#29ff6b`.

### Motion

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/matrix-speed.mp4" poster="../assets/effects/clips/matrix-speed.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Matrix Rain at three speeds, about two seconds each: at Speed 0 the rain hangs still and changes only where she moves, at 1 the drops fall steadily, at 3 they race down and the digits flicker; the speed is shown at the bottom left"></video>
<figcaption>Speed 0, 1 and 3, about two seconds each.</figcaption>
</figure>

**Speed** – how fast the drops fall and how often the characters swap. At 1 a drop falls about 12 rows a second, each column at its own pace between 7 and 17, and every character swaps about twice a second; at 0 the rain hangs still; 3 and more races. It follows the playhead, so a paused picture stands still and the export matches the preview; a keyframed Speed speeds up smoothly. 0 to 5, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/matrix-roll.mp4" poster="../assets/effects/clips/matrix-roll.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Matrix Rain while Roll runs from 0 to 1 and back: at 0 every digit follows the brightness, small digits on the stage and 8s and 9s in her dress, then the digits get more and more random and swap as the rain falls, until any digit can stand anywhere, and back; the current value is shown at the bottom left"></video>
<figcaption>Roll from 0 to 1 and back.</figcaption>
</figure>

**Roll** – how far a character may stray from the character of its brightness when it swaps. At 0 every cell shows exactly that character and never swaps, so the figure reads in the characters; 0.5 picks from a window around it, so the code keeps changing while dense characters still mark the bright parts; at 1 any character can stand anywhere, and the figure shows only in the brightness of the rain. Any value above 0 draws from at least two characters. 0 to 1, default 0.5.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/matrix-trail.mp4" poster="../assets/effects/clips/matrix-trail.webp" width="540" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer with Matrix Rain while Trail runs from 0 to 1 and back: at 0 only single bright heads fall like sparks, then each head pulls a longer and longer fading tail, until each tail fades out just as the next head arrives and the columns are almost always lit, and back; the current value is shown at the bottom left"></video>
<figcaption>Trail from 0 to 1 and back.</figcaption>
</figure>

**Trail** – how long the fading tail behind each falling head is, as a share of the gap to the next drop in its column. At 0 only the heads fall, like single sparks; 0.5 gives the classic streaks; at 1 a tail reaches the next drop, so the columns are never dark. The tail fades from the full colour at the head to nothing at its end. 0 to 1, default 0.5.

<div class="docs-float-end"></div>

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Matrix Rain graph in nine stages: Parameters feed Cell Grid (Cell Size), which passes the cell number to Rain and Glyph Offset, the cell centre to Cell Sampling & Tone, the grid position to Glow and the position in the cell to Atlas Alpha; Tone to Glyph turns the tone into the cell's own character; Rain (Speed, Trail) passes the clock to Glyph Offset and the fade and head of the falling drops to Glow and Ink & Appearance; Roll Window (Roll) keeps each swap inside a part of the ramp and passes the glyph index to Atlas Alpha; Glow (Background) reads the picture smoothly behind the code; Ink & Appearance (Rain Color, Amount) lights the character on that glow](../assets/effects/graphs/matrix.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1095" aria-hidden="true" focusable="false">
<defs><marker id="matrix-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M204 825 L204 741" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="204" cy="825" r="18" /><text x="204" y="825" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M326 610 L326 694" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="326" cy="610" r="18" /><text x="326" y="610" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M448 557 L448 473" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="448" cy="557" r="18" /><text x="448" y="557" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M448 22 L448 75" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="448" cy="22" r="18" /><text x="448" y="22" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M569 359 L569 443" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="569" cy="359" r="18" /><text x="569" y="359" class="docs-shot-number-text">5</text>
<path class="docs-shot-arrow" d="M691 338 L691 254" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="691" cy="338" r="18" /><text x="691" y="338" class="docs-shot-number-text">6</text>
<path class="docs-shot-arrow" d="M813 286 L813 370" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="813" cy="286" r="18" /><text x="813" y="286" class="docs-shot-number-text">7</text>
<path class="docs-shot-arrow" d="M813 798 L813 714" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="813" cy="798" r="18" /><text x="813" y="798" class="docs-shot-number-text">8</text>
<path class="docs-shot-arrow" d="M935 1072 L935 988" marker-end="url(#matrix-arrow)" />
<circle class="docs-shot-number" cx="935" cy="1072" r="18" /><text x="935" y="1072" class="docs-shot-number-text">9</text>
</svg>
</div>

<figcaption>Matrix Rain opened in the Nodes tab (input frame and output left out). 1 — Cell Grid: which cell a pixel lies in. 2 — Cell Sampling & Tone: the brightness of the cell. 3 — Tone to Glyph: the character of that brightness. 4 — Rain: the falling drops. 5 — Glyph Offset: the cell's random swap. 6 — Roll Window: the part of the ramp it swaps in. 7 — Atlas Alpha: where the character covers the cell. 8 — Glow: the soft glow of the picture. 9 — Ink & Appearance: the rain's light on that glow.</figcaption>
</figure>

Matrix Rain works in nine stages, one folder each in the Nodes tab: **Cell Grid** cuts the frame into square cells, **Cell Sampling & Tone** reads the colour and brightness in the middle of each cell, **Tone to Glyph** picks the character of that brightness, **Rain** lets the drops fall down every column and works out how brightly each cell is lit right now, **Glyph Offset** draws each cell's random swaps, **Roll Window** keeps a swap inside a part of the ramp around the cell's own character, **Atlas Alpha** looks up where the character covers the cell, **Glow** reads a soft copy of the picture behind the code, and **Ink & Appearance** lights the character in the Rain Color on that glow. Click a folder's header to open it. Rain, Glow and Ink & Appearance make the rain; Glyph Offset works as in [Symbol Matrix](./symbol-matrix.md#glyph-offset), Roll Window as in [Glyph Matrix](./glyph-matrix.md#roll-window), the other four as in [ASCII](./ascii.md#node-setup). Matrix Rain is one look of the glyph engine that the [Text & Glyph](../Effects-Glyph.md#the-shared-idea) looks share; its **Style** menu switches between them.

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

**Floor** – which cell the pixel lies in, counted in columns and rows. Rain gives every column its own drops from it, Glyph Offset every cell its own swaps.

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

**Split RGB + Alpha** – the cell's colour and its transparency. Matrix Rain uses only the brightness and the transparency: the colour comes from Rain Color.

**Luminance** – the brightness of the cell colour, weighted the way the eye sees it (green counts most).

**Divide** – applies **Black Level**: the luminance minus Black Level (Subtract), divided by what is left above it (the other Subtract: One minus Black Level). The Clamp next to Black Level keeps it between 0 and Black Level Max 0.9.

**Clamp** – keeps the result between 0 and 1, so everything darker than Black Level becomes 0: the Tone. It picks the character and sets how brightly the rain glows.

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

**Floor** – the number of the cell's own character: the Tone Glyph that Roll Window swaps around.

### Rain

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Rain folder, the fall of each column: Seconds times Speed, or Speed Travel when Greater Than finds keyframes, goes through Switch into the clock; Split Vector takes the column from the Cell Number, Combine Vector pairs it with Rain Pace Seed 1, and Random (Cell) gives the Pace Random; Rain Rate Min 0.6 plus Rain Rate Span 0.8 times it, times Rain Rate Base 12, gives the Fall Rate; the clock times it is Fallen](../assets/effects/graphs/matrix-rain-fall.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 825" aria-hidden="true" focusable="false">
<defs><marker id="matrix-rain-fall-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M813 530 L813 446" marker-end="url(#matrix-rain-fall-arrow)" />
<circle class="docs-shot-number" cx="813" cy="530" r="18" /><text x="813" y="530" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M448 102 L448 186" marker-end="url(#matrix-rain-fall-arrow)" />
<circle class="docs-shot-number" cx="448" cy="102" r="18" /><text x="448" y="102" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M813 102 L813 186" marker-end="url(#matrix-rain-fall-arrow)" />
<circle class="docs-shot-number" cx="813" cy="102" r="18" /><text x="813" y="102" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M935 394 L935 310" marker-end="url(#matrix-rain-fall-arrow)" />
<circle class="docs-shot-number" cx="935" cy="394" r="18" /><text x="935" y="394" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Rain (Speed), the fall of each column. The number cards are values from the Constants folder, shown where they plug in; cards are named by their outputs where they have one. 1 — Clock: the playhead time × Speed. 2 — Pace Random: the column's own random number. 3 — Fall Rate: rows a second of this column. 4 — Fallen: how far its drops have fallen.</figcaption>
</figure>

**Clock** – how far the clock has run: Seconds × Speed (the Multiply above it), or Speed Travel, the distance a keyframed Speed has covered, when Speed has keyframes (Greater Than checks for that). Glyph Offset counts its swaps with the same clock.

**Pace Random** – a random number from 0 to 1 for each column: Random (Cell) of the column (Split Vector takes it from the Cell Number) and Rain Pace Seed 1 (Combine Vector). It never changes, so a column keeps its pace.

**Fall Rate** – how many rows a drop of this column falls per second: Rain Rate Min 0.6 plus Rain Rate Span 0.8 times the Pace Random (Multiply, Add), times Rain Rate Base 12. So the columns fall between 7 and 17 rows a second at Speed 1, never in step.

**Fallen** – the clock times the Fall Rate: how many rows the drops of this column have fallen since the start.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Rain folder, the drops: the column X with Rain Gap Seed 2 through Combine Vector and Random (Cell), times Rain Spacing Span 0.8, plus Rain Spacing Min 0.6, times Rain Spacing Base 32 gives the Drop Spacing; Fallen minus the row Y, divided by the spacing, plus the Phase Random of X and Rain Phase Seed 3 gives the Drop Phase; its Fraction times the spacing is Behind](../assets/effects/graphs/matrix-rain-drops.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 652" aria-hidden="true" focusable="false">
<defs><marker id="matrix-rain-drops-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M557 35 L557 119" marker-end="url(#matrix-rain-drops-arrow)" />
<circle class="docs-shot-number" cx="557" cy="35" r="18" /><text x="557" y="35" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M654 500 L654 416" marker-end="url(#matrix-rain-drops-arrow)" />
<circle class="docs-shot-number" cx="654" cy="500" r="18" /><text x="654" y="500" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M752 35 L752 119" marker-end="url(#matrix-rain-drops-arrow)" />
<circle class="docs-shot-number" cx="752" cy="35" r="18" /><text x="752" y="35" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M946 425 L946 341" marker-end="url(#matrix-rain-drops-arrow)" />
<circle class="docs-shot-number" cx="946" cy="425" r="18" /><text x="946" y="425" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Rain, the drops. 1 — Drop Spacing: rows between two drops of the column. 2 — Phase Random: where its drops start. 3 — Drop Phase: the drops that have passed the cell. 4 — Behind: how far the last head has fallen past it.</figcaption>
</figure>

**Drop Spacing** – how many rows lie between two drops of this column: Rain Spacing Min 0.6 plus Rain Spacing Span 0.8 times the column's Gap Random (seed 2), times Rain Spacing Base 32, so 19 to 45 rows.

**Phase Random** – a third random number of the column (seed 3): where its drops start, so neighbouring columns never fall side by side.

**Drop Phase** – Fallen minus the cell's row (Subtract, Y from the Cell Number), divided by the Drop Spacing, plus the Phase Random: how many drops have passed this cell, with the fraction telling how far the last one has fallen on.

**Behind** – only the fraction of it (Fraction), times the Drop Spacing (Multiply): how many rows the last head has fallen past this cell. 0 means the head is here right now; the cells above it count up to the Drop Spacing.

**Remix:** open the **Constants** folder and set **Rain Spacing Base** from **32** to **12**: the drops follow each other closely, and the code pours down in a dense shower.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Rain folder, the tail and the head: Trail through Clamp times Drop Spacing, at least one by Maximum, gives the Trail Rows; Behind divided by them, subtracted from one and kept at zero or above by Maximum, gives the Tail; the Tail times itself is the Fade; one minus Behind, kept at zero or above, is the Head](../assets/effects/graphs/matrix-rain-trail.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 675" aria-hidden="true" focusable="false">
<defs><marker id="matrix-rain-trail-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M448 22 L448 89" marker-end="url(#matrix-rain-trail-arrow)" />
<circle class="docs-shot-number" cx="448" cy="22" r="18" /><text x="448" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M813 22 L813 89" marker-end="url(#matrix-rain-trail-arrow)" />
<circle class="docs-shot-number" cx="813" cy="22" r="18" /><text x="813" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M935 298 L935 214" marker-end="url(#matrix-rain-trail-arrow)" />
<circle class="docs-shot-number" cx="935" cy="298" r="18" /><text x="935" y="298" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M326 481 L326 397" marker-end="url(#matrix-rain-trail-arrow)" />
<circle class="docs-shot-number" cx="326" cy="481" r="18" /><text x="326" y="481" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Rain (Trail), the tail and the head. The Clamp's 0 and 1 and the One and Zero cards are left out. 1 — Trail Rows: how far the tail reaches. 2 — Tail: from 1 at the head to 0 at its end. 3 — Fade: the light of the tail. 4 — Head: the cell the head has just reached.</figcaption>
</figure>

**Trail Rows** – how many rows the tail reaches: **Trail** (the Clamp keeps it from 0 to 1) times the Drop Spacing, and never less than 1 (Maximum).

**Tail** – one minus Behind divided by Trail Rows (Divide, Subtract), and not below 0 (Maximum): 1 at the head, falling evenly to 0 at the end of the tail.

**Fade** – the Tail times itself (Multiply): the light of the tail, bright behind the head and soon faint, like the films' trails.

**Head** – one minus Behind, and not below 0 (Subtract, Maximum): 1 in the cell the head has just reached, fading as it moves on to the next row. Ink & Appearance turns that cell towards white.

**Smooth Fade** – the same Fade worked out once more at the pixel's exact height instead of its cell's row (the Pixel Row, and Divide, Fraction, Multiply and Maximum nodes like the ones above). Glow uses it, so the glow behind the code brightens evenly down a column as a trail passes, instead of in steps of whole rows.

### Glyph Offset

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Glyph Offset folder: the Clock times Index Time Scale 2 gives the ticks; Random (Cell) of the Cell Number is added and Floor gives the cell's own tick; Combine Vector pairs the cell's random with its tick, Random (Integer Hash) draws a number, and Multiply by the Glyph Count and Floor give the glyph offset](../assets/effects/graphs/matrix-glyph-offset.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 487" aria-hidden="true" focusable="false">
<defs><marker id="matrix-glyph-offset-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M204 464 L204 380" marker-end="url(#matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="204" cy="464" r="18" /><text x="204" y="464" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M204 68 L204 152" marker-end="url(#matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="204" cy="68" r="18" /><text x="204" y="68" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M448 68 L448 152" marker-end="url(#matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="448" cy="68" r="18" /><text x="448" y="68" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M691 68 L691 152" marker-end="url(#matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="691" cy="68" r="18" /><text x="691" y="68" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M935 329 L935 245" marker-end="url(#matrix-glyph-offset-arrow)" />
<circle class="docs-shot-number" cx="935" cy="329" r="18" /><text x="935" y="329" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Glyph Offset (Speed). Cards are named by their outputs where they have one. 1 — Ticks: the swaps counted so far. 2 — Cell Random: the cell's own random number. 3 — Cell Tick: how many swaps the cell has made. 4 — Draw: a random number for this swap. 5 — Glyph Offset: how far the swap moves the character.</figcaption>
</figure>

**Ticks** – the clock (from Rain) times Index Time Scale 2: the swaps counted so far, two a second at Speed 1.

**Cell Random** – a random number from 0 to 1 for each cell (Random (Cell)), the same in every frame.

**Cell Tick** – the ticks plus the cell's random number, rounded down (Add, Floor): every cell counts its swaps on its own, so they fall at different moments instead of all at once.

**Draw** – a new random number for each swap of each cell: Random (Integer Hash) of the cell's random number and its tick (Combine Vector).

**Glyph Offset** – the draw times the number of characters, rounded down (Multiply, Floor): how many steps this swap moves the character. Roll Window folds it into the window around the cell's own character.

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

**Dark Roll** – a Switch: 0 while Black Level is above 0, otherwise Roll. At Black Level 0 every cell swaps.

**Cell Roll** – the second Switch: Roll for a lit cell, the Dark Roll for a dark one. The window below is built from it, so with Black Level set a dark cell keeps its character, the space in most ramps, and the rain stays out of the dark stage.

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

<figcaption>Inside Roll Window (Roll), the size of the window. 1 — Ceiling: the neighbours a cell rolls through. 2 — Window: how many characters. 3 — Floor: half the window. 4 — Window Start: where the window begins in the ramp.</figcaption>
</figure>

**Ceiling** – the Cell Roll times the ramp's length minus one (Subtract, Multiply), rounded up: how many neighbours a cell may swap to. Any Cell Roll above 0 gives at least one.

**Window** – that number plus the cell's own character (Add): from 1 at Roll 0 to the whole ramp at Roll 1.

**Floor** – half the window, as a whole number (Multiply by Half first): how far the window reaches below the cell's own character.

**Window Start** – the Tone Glyph minus that half, kept between 0 and the ramp's length minus the window (Clamp). The window never hangs over an end of the ramp: the brightest cells swap among the densest characters.

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

**Glyph Index** – Window Start plus the place in the window (Add): the character the cell shows now. At Roll 1 the window is the whole ramp, so any character can come up.

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

### Glow

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Glow folder, the soft tone: the Grid Position plus the Tap Offset (Ground A Dx and Dy, −0.3) gives the Tap, which divided by the cells across is read by Clamped Image Sample and turned into a Luminance; Mix blends it half and half with the Next Tap into the Upper Pair, and a second Mix blends the Upper Pair with the Lower Pair into the Soft Luminance](../assets/effects/graphs/matrix-glow-tone.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 753" aria-hidden="true" focusable="false">
<defs><marker id="matrix-glow-tone-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M326 198 L326 282" marker-end="url(#matrix-glow-tone-arrow)" />
<circle class="docs-shot-number" cx="326" cy="198" r="18" /><text x="326" y="198" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M569 198 L569 282" marker-end="url(#matrix-glow-tone-arrow)" />
<circle class="docs-shot-number" cx="569" cy="198" r="18" /><text x="569" y="198" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M813 22 L813 75" marker-end="url(#matrix-glow-tone-arrow)" />
<circle class="docs-shot-number" cx="813" cy="22" r="18" /><text x="813" y="22" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M935 198 L935 282" marker-end="url(#matrix-glow-tone-arrow)" />
<circle class="docs-shot-number" cx="935" cy="198" r="18" /><text x="935" y="198" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Glow (Black Level), the soft tone. 1 — Tap: a point a little up and left of the pixel. 2 — Tap Sample: the picture's brightness there. 3 — Upper Pair: two taps averaged. 4 — Soft Luminance: all four averaged.</figcaption>
</figure>

**Tap** – the pixel's place in the grid plus a Tap Offset (Add): a point 0.3 of a cell up and to the left of it. The folder reads four such taps, one towards each corner.

**Tap Sample** – the Tap divided by the cells across (Divide), read from the picture (Clamped Image Sample) and turned into a Luminance. The picture shows the first tap; the other three work the same way.

**Upper Pair** – the two upper taps averaged (Mix at a half); the Lower Pair does the same below.

**Soft Luminance** – the two pairs averaged (Mix): the brightness of the picture around the pixel, slightly blurred. It follows the pixel, not the cells, so the glow has no cell steps and is softer than the picture itself.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Glow folder, the glow: the Soft Luminance minus Black Level, divided by the Black Span, clamped between Zero and One, gives the Soft Tone; Background times it is the Background Glow; the Smooth Fade times Ground Trail 0.4 plus Ground Floor 0.6 gives the Ground Light; the Background Glow times the Ground Light is the Glow](../assets/effects/graphs/matrix-glow-ground.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1059" aria-hidden="true" focusable="false">
<defs><marker id="matrix-glow-ground-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M427 237 L427 321" marker-end="url(#matrix-glow-ground-arrow)" />
<circle class="docs-shot-number" cx="427" cy="237" r="18" /><text x="427" y="237" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M752 237 L752 321" marker-end="url(#matrix-glow-ground-arrow)" />
<circle class="docs-shot-number" cx="752" cy="237" r="18" /><text x="752" y="237" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M752 811 L752 727" marker-end="url(#matrix-glow-ground-arrow)" />
<circle class="docs-shot-number" cx="752" cy="811" r="18" /><text x="752" y="811" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M914 237 L914 321" marker-end="url(#matrix-glow-ground-arrow)" />
<circle class="docs-shot-number" cx="914" cy="237" r="18" /><text x="914" y="237" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Glow (Background), the glow. 1 — Divide: Black Level. 2 — Background Glow: how strongly the picture glows. 3 — Ground Light: brighter where a trail passes. 4 — Glow: the strength of the glow.</figcaption>
</figure>

**Divide** – applies **Black Level** to the Soft Luminance, as in Cell Sampling & Tone: minus Black Level (Subtract), divided by the Black Span. The Clamp after it keeps the result between 0 and 1: the Soft Tone, black below Black Level.

**Background Glow** – **Background** times the Soft Tone (Multiply): bright where the picture is bright, nothing where it is black.

**Ground Light** – Ground Floor 0.6 plus Ground Trail 0.4 times the Smooth Fade (Multiply, Add): the glow shows at 60 % between two drops and in full where a trail passes. The Smooth Fade comes from Rain (see there).

**Glow** – the Background Glow times the Ground Light (Multiply). Ink & Appearance colours it in the Rain Color.

**Remix:** open the **Constants** folder and set **Ground Floor** from **0.6** to **0**: the figure glows only where a trail passes, as if the rain lit her up.

### Ink & Appearance

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Ink and Appearance folder, the character: the Tone times itself is the Tone²; times Tone Factor 1.5, plus Tone Base 0.05, it is the Brightness; the Fade times it is the Trail Light; Maximum with the Lit Head gives the Light; the Head times Head White 0.8 mixes the Rain Color towards White into the Head Color; the Light times the Glyph Coverage, times the Head Color, gives the Lit Glyph](../assets/effects/graphs/matrix-rain-ink.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 718" aria-hidden="true" focusable="false">
<defs><marker id="matrix-rain-ink-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M204 66 L204 150" marker-end="url(#matrix-rain-ink-arrow)" />
<circle class="docs-shot-number" cx="204" cy="66" r="18" /><text x="204" y="66" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M448 358 L448 274" marker-end="url(#matrix-rain-ink-arrow)" />
<circle class="docs-shot-number" cx="448" cy="358" r="18" /><text x="448" y="358" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M569 66 L569 150" marker-end="url(#matrix-rain-ink-arrow)" />
<circle class="docs-shot-number" cx="569" cy="66" r="18" /><text x="569" y="66" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M813 541 L813 457" marker-end="url(#matrix-rain-ink-arrow)" />
<circle class="docs-shot-number" cx="813" cy="541" r="18" /><text x="813" y="541" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M935 358 L935 274" marker-end="url(#matrix-rain-ink-arrow)" />
<circle class="docs-shot-number" cx="935" cy="358" r="18" /><text x="935" y="358" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Ink & Appearance (Rain Color), the character. 1 — Tone²: the tone times itself. 2 — Brightness: the glow of the picture. 3 — Trail Light: the trail times that glow. 4 — Head Color: the Rain Color, white at the head. 5 — Lit Glyph: the lit character.</figcaption>
</figure>

**Tone²** – the Tone times itself (Multiply): a dim stage counts much less than a lit figure, so the rain in the dark drops away.

**Brightness** – Tone Base 0.05 plus Tone Factor 1.5 times the Tone² (Multiply, Add): faint rain in the dark parts, 1.55 in the brightest, where the colour overdrives and turns paler. This is what draws the figure into the rain.

**Trail Light** – the Fade from Rain times the Brightness: how brightly the tail glows here right now. Maximum takes the brighter of it and the Lit Head (below): the **Light** of the character.

**Head Color** – the Rain Color (Vector 4 to RGB) mixed towards White by the Head times Head White 0.8 (Multiply, Mix): the head of a drop glows almost white, the rest of the tail in the Rain Color.

**Lit Glyph** – the Head Color times the Light times the Glyph Coverage (Multiply): the character, lit.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Ink and Appearance folder, the head: Greater Than asks whether the Tone is above Zero and whether Black Level is above Zero; a Switch gives Zero or One from Black Level, a second Switch One for a lit cell, which is Head Shown; the Head times Head Light 0.85 is the Head Light, and times Head Shown it is the Lit Head](../assets/effects/graphs/matrix-rain-head.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1372" aria-hidden="true" focusable="false">
<defs><marker id="matrix-rain-head-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M702 326 L702 410" marker-end="url(#matrix-rain-head-arrow)" />
<circle class="docs-shot-number" cx="702" cy="326" r="18" /><text x="702" y="326" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M702 901 L702 817" marker-end="url(#matrix-rain-head-arrow)" />
<circle class="docs-shot-number" cx="702" cy="901" r="18" /><text x="702" y="901" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M896 326 L896 410" marker-end="url(#matrix-rain-head-arrow)" />
<circle class="docs-shot-number" cx="896" cy="326" r="18" /><text x="896" y="326" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>Inside Ink & Appearance (Black Level), the head. 1 — Head Shown: whether the head may flash here. 2 — Head Light: its own light. 3 — Lit Head: the head's light here.</figcaption>
</figure>

**Head Shown** – two Switches: 1 in a cell brighter than Black Level (the Greater Than with the Tone), and 1 everywhere while Black Level is 0 (the other Greater Than); 0 only in a dark cell once Black Level is set. So Black Level clears the heads from the dark stage too.

**Head Light** – the Head from Rain times Head Light 0.85 (Multiply): the head has a light of its own that does not drop with the picture, so it flashes on the dark stage as on the figure.

**Lit Head** – the Head Light times Head Shown (Multiply). The Maximum above takes it when it is brighter than the trail.


The last cards of the folder put it together, as in [ASCII](./ascii.md#ink--appearance).

**Ground** – the Rain Color times the Glow from the Glow folder (Multiply): the soft glow of the figure behind the code.

**Glyph Cell** – the Ground plus the Lit Glyph (Add): the character shines on its glowing ground, and a dim character never cuts a dark hole into it.

**Faded Premultiplied** – fades the untouched picture, pixel by pixel, towards the rain by **Amount**. Both are first multiplied by their transparency (Original Alpha, Cell Alpha), and the transparency fades the same way (Faded Alpha).

**Faded Color** – divides by Faded Alpha (at least a millionth) to get back to plain colour, so the colour a transparent pixel hides never shows as a dark or green fringe around a cut-out figure while Amount fades.

## Technical details

- **Size.** Cell Size counts pixels of a frame whose shorter side is 1080: a 4K export, a portrait frame, a lower Preview Quality and the thumbnails show the same grid. A cell is never smaller than 2 pixels of the frame; below 2 px Cell Size renders as 2, and the card says so.
- **Rain.** Each column falls at its own pace and spaces its drops in its own way, so neighbouring columns never fall in step. A tail fades with the square of its distance from the head, so it is bright just behind the head and soon faint. The head has a light of its own; the tail glows with the picture, and a dim stage counts much less than a lit figure. Trail and Roll outside 0 to 1 render as 0 or 1, and the card and the tools say so.
- **Glow.** The glow behind the code is a slightly blurred copy of the picture's brightness, read at four points around each pixel, so it has no cell steps; it brightens evenly down a column where a trail passes.
- **Time.** The rain follows the timeline time: scrubbing, playback and export give the same frame for the same moment, and a paused picture needs no extra rendering. With keyframes on Speed it moves by the distance Speed has travelled, so it never jumps. Hours into a show the drops stay in place to well under a row.
- **Characters.** The whole ramp is drawn in one font size, so its tallest character spans 88 % of the cell height. Characters the Font lacks, such as katakana, are drawn from the system's fallback font; without one they show as boxes, and the card cannot tell.
- **Transparency.** Each cell takes the transparency of the picture at its centre, so a cut-out figure keeps its outline in whole cells and the rain stays inside it. Amount fades the transparency back to the original's, pixel by pixel, and mixes the colours weighted by their transparency.
- **Saved projects.** A Matrix Rain that stores its node setup keeps its look and its card. Before, effects saved without a stored setup loaded at Roll 1 and Background 0 and did not show the picture at all; that was a bug. They now rain with heads and tails and show the figure, in the default Rain Color with Trail 0.5. Presets fully apply only to effects added in this version: on a stored setup from before, the card has no Background, Black Level, Roll, Rain Color or Trail row, so a preset leaves those values out.
- **More:** [Effect system](../Effect-System.md#glyph-cell-and-compute-effects) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
