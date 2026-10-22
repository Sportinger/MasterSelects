# Riso Glow

A two-ink riso print whose bright ink glows and slowly breathes, like fluorescent ink. For dreamlike, pulsing pictures on a dark stage: a figure that shines from within, neon in the rain, a poster under ultraviolet light.

Group: [Print & Halftone](../Effects-Print.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-clip docs-compare docs-shot--float-left">
<video src="../assets/effects/clips/riso-glow.mp4" poster="../assets/effects/clips/riso-glow.webp" width="1200" height="430" autoplay muted loop playsinline preload="none" aria-label="The dancer turning on a dark stage, original left and with Riso Glow right: a two-ink print of fine pink and indigo dots on a deep plum ground, where her warm-lit skin, dress and the lamp at the left edge give off a soft pink glow that swells and fades about every three seconds"></video>
<figcaption>Left: original. Right: Riso Glow at its default settings, one breath of the glow.</figcaption>
</figure>

**Use it for:** a figure that seems to give off light on a dark stage · neon signs and warm lamps that glow in print · a slow, hypnotic pulse under a song or a scene.

- **Glow** – how brightly the glow ink shines.
- **Speed** – how fast the glow breathes.
- **Glow Ink** – the colour that glows.
- **Dot Size** – how large the dots of the print are.

**Tip:** the glow lives where the picture has the colour of the glow ink and spills into the dark around it. Warm light on skin glows best with a pink, red or orange glow ink; a white costume stays paper and does not glow. Set **Speed** to 0 for a steady glow, and keyframe **Glow** from 0 to bring it up on a cue.

## Presets

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/riso-glow-presets.mp4" poster="../assets/effects/clips/riso-glow-presets.webp" width="962" height="946" autoplay muted loop playsinline preload="none" aria-label="The dancer four times in a grid, moving in sync, each with one preset: Blacklight top left, violet and pink dots with a slowly breathing pink glow; Neon Sign top right, coral light on dark teal; Embers bottom left, an orange glow smouldering in a near-black print; Heartbeat bottom right, a red glow that beats fast on dark maroon"></video>
<figcaption>The four presets on the moving dancer, in sync.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets all controls at once, in one undo step, and the row then shows its name until you change something. A control with keyframes keeps them, and the card says so.

**Blacklight** – medium blue and fluorescent pink, breathing slowly: a poster under ultraviolet light. The stage turns deep violet and everything pink in the picture lights up.

**Neon Sign** – teal and fluorescent orange in fine dots, with a steady hum: warm lights and skin glow like neon tubes over a cool, dark street.

**Embers** – black and fluorescent orange in coarse dots, with a slow, strong glow: warm figures smoulder in an almost black print. Calm and heavy, good for firelight and night scenes.

**Heartbeat** – midnight and bright red, the glow beating about 76 times a minute: for tension, fear or a heart on stage.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Riso Glow card: Preset menu showing Neon Sign, Dot Size and Registration under Pattern, Glow and Speed under Glow &amp; Pulse, Shadow Ink, Glow Ink and Amount under Color, beside a strip of the preview printed in teal and coral dots with a warm glow](../assets/effects/editor/riso-glow-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 998" aria-hidden="true" focusable="false">
<defs><marker id="riso-glow-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M491 340 L575 340" marker-end="url(#riso-glow-inspector-arrow)" />
<circle class="docs-shot-number" cx="491" cy="340" r="18" /><text x="491" y="340" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M516 467 L600 467" marker-end="url(#riso-glow-inspector-arrow)" />
<circle class="docs-shot-number" cx="516" cy="467" r="18" /><text x="516" y="467" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M547 652 L631 652" marker-end="url(#riso-glow-inspector-arrow)" />
<circle class="docs-shot-number" cx="547" cy="652" r="18" /><text x="547" y="652" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M534 697 L618 697" marker-end="url(#riso-glow-inspector-arrow)" />
<circle class="docs-shot-number" cx="534" cy="697" r="18" /><text x="534" y="697" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M513 882 L597 882" marker-end="url(#riso-glow-inspector-arrow)" />
<circle class="docs-shot-number" cx="513" cy="882" r="18" /><text x="513" y="882" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Riso Glow with the Neon Sign preset. 1 — Preset: pick a starting point. 2 — Dot Size. 3 — Glow: how brightly the glow ink shines. 4 — Speed: how fast the glow breathes. 5 — Glow Ink: the colour that glows.</figcaption>
</figure>

### Pattern

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/riso-glow-dot-size.mp4" poster="../assets/effects/clips/riso-glow-dot-size.webp" width="720" height="628" autoplay muted loop playsinline preload="none" aria-label="The dancer with Riso Glow while Dot Size runs from 3 to 20 px and back: the fine print of pink and indigo dots coarsens into large round dots and the glow widens with them, then both shrink again; the current value is shown at the bottom left"></video>
<figcaption>Dot Size from 3 to 20 px and back.</figcaption>
</figure>

**Dot Size** – how large the dots of both inks are, and with them how far the glow reaches: about three dots each way. 3 to 5 px gives a fine print that still reads as a photo, 6 to 10 px the classic risograph grain, 20 and more turns a figure into big glowing dots like a lightboard. It counts pixels of a 1080p picture, so a 4K export shows the same dots and the same glow as the preview. 2 to 40 px, default 6 px.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/riso-glow-registration.mp4" poster="../assets/effects/clips/riso-glow-registration.webp" width="720" height="628" autoplay muted loop playsinline preload="none" aria-label="The dancer with Riso Glow while Registration runs from 0 to 16 px and back: the pink and indigo prints slide apart until pink fringes stand beside every edge, and come together again; the current value is shown at the bottom left"></video>
<figcaption>Registration from 0 to 16 px and back.</figcaption>
</figure>

**Registration** – how far the two inks slip apart, like two drums of the press that did not line up. At 0 they print exactly on top of each other; 2 to 4 px gives the slight misprint of a real risograph; 10 and more lets the glow ink stand beside every edge of the figure as a glowing fringe. The shadow ink moves up and to the left, the glow ink down and to the right, half the distance each. 0 to 32 px, default 3 px.

### Glow & Pulse

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/riso-glow-glow.mp4" poster="../assets/effects/clips/riso-glow-glow.webp" width="720" height="628" autoplay muted loop playsinline preload="none" aria-label="The dancer with Riso Glow while Glow runs from 0 to 2 and back at Speed 0: a plain two-ink print starts to shine pink around her skin, dress and the lamp, the glow grows strong and fades again; the current value is shown at the bottom left"></video>
<figcaption>Glow from 0 to 2 and back, at Speed 0 so the pulse holds still.</figcaption>
</figure>

**Glow** – how brightly the glow ink shines at the top of its pulse. At 0 Riso Glow is a plain two-ink print; 0.5 gives a soft sheen, 1 a clear glow that spills into the dark around the figure, 2 a strong haze. It only lights the parts of the picture the glow ink prints and the dark around them: black stays black and white paper stays paper. Keyframe it from 0 to let a picture start to glow on a cue. 0 to 2, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/riso-glow-speed.mp4" poster="../assets/effects/clips/riso-glow-speed.webp" width="720" height="628" autoplay muted loop playsinline preload="none" aria-label="The dancer with Riso Glow at three speeds, about two seconds each: at Speed 0 the glow holds steady, at 1 it swells and fades slowly, at 3 it pulses quickly; the speed is shown at the bottom left"></video>
<figcaption>Speed 0, 1 and 3, about two seconds each.</figcaption>
</figure>

**Speed** – how fast the glow breathes, from full down to a tenth of its strength and back. At 1 it breathes about every three seconds, 0.3 is a slow, sleepy swell, 3 and more a quick pulse. At 0 the glow holds still at its full strength. It follows the playhead, so a paused picture stands still and the export matches the preview, and a keyframed Speed speeds the breathing up smoothly. 0 to 5, default 1.

### Color

**Shadow Ink** – the first ink, printed through a grid of dots turned 15°. Choose the darker of the two: it carries the shadows and, where it prints over the glow ink, it covers the glow. Blues, teals, violet, midnight and black work well. It takes a colour, default `#4f46e5`.

**Glow Ink** – the second ink, printed through a grid turned 75°, and the one that glows. Each part of the picture is printed with whatever mix of the two inks comes closest to its colour, so the glow appears where the picture has this ink's colour: pick it to match what should shine. Fluorescent pink, orange and bright red glow beautifully on warm skin and lamps. It takes a colour, default `#f43f5e`.

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/riso-glow-amount.mp4" poster="../assets/effects/clips/riso-glow-amount.webp" width="720" height="628" autoplay muted loop playsinline preload="none" aria-label="The dancer with Riso Glow while Amount runs from 0 to 1 and back: the original stage picture turns into the glowing pink and indigo print and back again; the current value is shown at the bottom left"></video>
<figcaption>Amount from 0 to 1 and back.</figcaption>
</figure>

**Amount** – how much of the glowing print covers the picture. At 1 there is only ink, paper and glow; 0.5 lays it softly over the picture's own colours; 0 switches it off. 0 to 1, default 1.

<div class="docs-float-end"></div>

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Riso Glow graph in ten folders: Parameters feed Screens, Paper and Inks, Cell Colour, Separation, Tone and Dots; Dots and Tone feed Print and Glow Share; Glow Spill gathers that share; Pulse turns Glow and Speed into a strength; Glow and Mix screens the glow onto the print](../assets/effects/graphs/riso-glow.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 843" aria-hidden="true" focusable="false">
<defs><marker id="riso-glow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M617 635 L617 551" marker-end="url(#riso-glow-arrow)" />
<circle class="docs-shot-number" cx="617" cy="635" r="18" /><text x="617" y="635" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M725 50 L725 134" marker-end="url(#riso-glow-arrow)" />
<circle class="docs-shot-number" cx="725" cy="50" r="18" /><text x="725" y="50" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M833 819 L833 735" marker-end="url(#riso-glow-arrow)" />
<circle class="docs-shot-number" cx="833" cy="819" r="18" /><text x="833" y="819" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M833 272 L833 356" marker-end="url(#riso-glow-arrow)" />
<circle class="docs-shot-number" cx="833" cy="272" r="18" /><text x="833" y="272" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M941 470 L941 386" marker-end="url(#riso-glow-arrow)" />
<circle class="docs-shot-number" cx="941" cy="470" r="18" /><text x="941" y="470" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Riso Glow opened in the Nodes tab (input frame and output left out). 1 — Dots: the round dots of both inks. 2 — Print &amp; Glow Share: the print and where the glow ink shows. 3 — Glow Spill: that share gathered from around each pixel. 4 — Pulse: the breathing strength. 5 — Glow &amp; Mix: the glow screened onto the print.</figcaption>
</figure>

Riso Glow is [Riso](./riso.md)'s print with a glow on top, in ten folders. The first six print the picture in two inks of dots, exactly as Riso does: **Dots** is the last of them. **Print & Glow Share** puts the inks on the paper and works out where the glow ink shows, **Glow Spill** gathers that from around each pixel into a soft light, **Pulse** turns Glow and Speed into a breathing strength, and **Glow & Mix** screens the light onto the print. Click a folder's header to open it.

### Paper & Inks

The paper and the two inks as light, and how much of the paper's light each ink takes away. The same as in Riso: [Riso › Paper & Inks](./riso.md#paper--inks), where the Shadow Ink is called Dark Ink and the Glow Ink Warm Ink.

### Screens

Each ink's grid of dots: the paper pixel slipped by Registration, turned 15° (shadow ink) or 75° (glow ink) and cut into cells of Dot Size. The same as [Riso › Screens](./riso.md#screens).

### Cell Colour

The colour of each cell, read at four points in linear light. The same as [Riso › Cell Colour](./riso.md#cell-colour).

### Separation

How the cell's colour splits between the two inks: a fit of the light the cell takes from the paper. The same as [Riso › Separation](./riso.md#separation).

### Tone

How much of each ink the cell needs to keep its brightness: the coverage of both inks. Glow uses the glow ink's coverage and the shadow ink's beside it. The same as [Riso › Tone](./riso.md#tone).

### Dots

The round dot that covers exactly that share of each cell, one pixel soft at the edge. The same as [Riso › Dots](./riso.md#dots).

### Print & Glow Share

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Print and Glow Share folder: One minus the Shadow Coverage goes through Subtract, times the Glow Coverage in Multiply, the Glow Share; Scalar to Alpha puts it into the alpha of Combine RGB + Alpha beside the print (a Multiply of the paper through both inks), and Cache Image keeps both](../assets/effects/graphs/riso-glow-print.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 663" aria-hidden="true" focusable="false">
<defs><marker id="riso-glow-print-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M264 435 L264 351" marker-end="url(#riso-glow-print-arrow)" />
<circle class="docs-shot-number" cx="264" cy="435" r="18" /><text x="264" y="435" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M427 105 L427 189" marker-end="url(#riso-glow-print-arrow)" />
<circle class="docs-shot-number" cx="427" cy="105" r="18" /><text x="427" y="105" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M752 407 L752 323" marker-end="url(#riso-glow-print-arrow)" />
<circle class="docs-shot-number" cx="752" cy="407" r="18" /><text x="752" y="407" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M914 105 L914 189" marker-end="url(#riso-glow-print-arrow)" />
<circle class="docs-shot-number" cx="914" cy="105" r="18" /><text x="914" y="105" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Print &amp; Glow Share. 1 — Subtract: the part of the cell the shadow ink leaves open. 2 — Multiply: the Glow Share. 3 — Combine RGB + Alpha: the print with the share beside it. 4 — Cache Image: keeps both for the next folders.</figcaption>
</figure>

**Subtract** – one minus the shadow ink's coverage of the glow ink's cell: how much of the cell the shadow ink leaves open. Where both inks print in full, as in black, nothing is left.

**Multiply** – the glow ink's coverage times that open part: the Glow Share, from 0 (no glow ink, or covered) to 1 (only glow ink). It is what glows. The other Multiply is the print itself, the paper's light through the dots of both inks, as in Riso.

**Combine RGB + Alpha** – packs the print into the colour and the Glow Share into the alpha of one picture.

**Cache Image** – keeps that picture for the rest of the effect, so the print is worked out once per pixel and the next folder can read the Glow Share of its neighbours.

### Glow Spill

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Glow Spill folder: the Kernel Index, minus the Glow Centre Tap 4, gives a tap from −4 to 4 in each direction; its Length goes through Gaussian Falloff with Glow Sigma 2; the tap times the Tap Step (Dot Size times Glow Step Cells 0.75) is added to the pixel and clamped to the frame; Sample Image reads the cached picture there, Kernel Sum (Rect) adds up a Glow Window of 9 by 9 taps, Divide by the weight sum gives the gathered share, and Multiply with the Glow Ink Light gives the Glow Light](../assets/effects/graphs/riso-glow-spill.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1386" aria-hidden="true" focusable="false">
<defs><marker id="riso-glow-spill-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M99 1174 L183 1174" marker-end="url(#riso-glow-spill-arrow)" />
<circle class="docs-shot-number" cx="99" cy="1174" r="18" /><text x="99" y="1174" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M508 514 L508 430" marker-end="url(#riso-glow-spill-arrow)" />
<circle class="docs-shot-number" cx="508" cy="514" r="18" /><text x="508" y="514" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M240 868 L240 952" marker-end="url(#riso-glow-spill-arrow)" />
<circle class="docs-shot-number" cx="240" cy="868" r="18" /><text x="240" y="868" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M374 1184 L374 1100" marker-end="url(#riso-glow-spill-arrow)" />
<circle class="docs-shot-number" cx="374" cy="1184" r="18" /><text x="374" y="1184" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M642 1171 L642 1087" marker-end="url(#riso-glow-spill-arrow)" />
<circle class="docs-shot-number" cx="642" cy="1171" r="18" /><text x="642" y="1171" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Inside Glow Spill. 1 — Gaussian Falloff: how much each tap counts. 2 — Multiply: the step between taps. 3 — Sample Image: reads the cached Glow Share. 4 — Kernel Sum (Rect): adds up 9 × 9 taps. 5 — Divide: their weighted average.</figcaption>
</figure>

**Gaussian Falloff** – the weight of one tap: 1 in the middle, falling off smoothly with its distance (Glow Sigma 2 taps). Near taps count more than far ones, so the glow fades softly instead of ending in a hard edge.

**Multiply** – Dot Size times 0.75 (Glow Step Cells): the step between two taps. Four steps each way make the glow reach about three dots, so a coarser print glows wider.

**Sample Image** – reads the cached picture at one tap, kept inside the frame (Clamp). Its alpha is the Glow Share there.

**Kernel Sum (Rect)** – runs Sample Image and Gaussian Falloff for every tap of a 9 × 9 window (Glow Window) and adds them up, weighted.

**Divide** – the weighted sum divided by the sum of the weights: the Gathered Share, a soft field that spills past the edges of the glowing parts. Multiplied by the glow ink's own light it becomes the Glow Light.

**Remix:** open the **Constants** folder and set **Glow Step Cells** to **1.5**: the glow reaches twice as far, a wide, misty aura around everything that glows.

### Pulse

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Pulse folder: Seconds times Speed times Two goes into Cosine; Cosine times Pulse Swing 0.45 plus Pulse Rest 0.55 in Add is the pulse; Glow, kept at 0 or more by Maximum, times the pulse times Glow Gain 1.5 in Multiply is the Strength](../assets/effects/graphs/riso-glow-pulse.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 606" aria-hidden="true" focusable="false">
<defs><marker id="riso-glow-pulse-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M448 60 L448 144" marker-end="url(#riso-glow-pulse-arrow)" />
<circle class="docs-shot-number" cx="448" cy="60" r="18" /><text x="448" y="60" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M691 60 L691 144" marker-end="url(#riso-glow-pulse-arrow)" />
<circle class="docs-shot-number" cx="691" cy="60" r="18" /><text x="691" y="60" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M813 493 L813 409" marker-end="url(#riso-glow-pulse-arrow)" />
<circle class="docs-shot-number" cx="813" cy="493" r="18" /><text x="813" y="493" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M935 60 L935 144" marker-end="url(#riso-glow-pulse-arrow)" />
<circle class="docs-shot-number" cx="935" cy="60" r="18" /><text x="935" y="60" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Pulse (Glow, Speed). 1 — Cosine: one smooth breath. 2 — Add: the pulse, between 0.1 and 1. 3 — Maximum: Glow, at least 0. 4 — Multiply: the Strength.</figcaption>
</figure>

**Cosine** – the seconds of the timeline times Speed times two, turned into a smooth swing between 1 and −1. It starts at the top at second 0, and at Speed 0 it stays there.

**Add** – Pulse Rest 0.55 plus Pulse Swing 0.45 times that swing: the pulse, breathing between 1 and 0.1, so the glow never quite goes out.

**Maximum** – keeps Glow at 0 or more; the card says so if a keyframe or a tool asks for less.

**Multiply** – Glow times the pulse times Glow Gain 1.5: the Strength of the glow right now.

**Remix:** set **Pulse Swing** to **0.55** and **Pulse Rest** to **0.45**: at the bottom of every breath the glow goes out completely, like a sign switching off.

### Glow & Mix

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Glow and Mix folder: Zero minus the Strength through Exponential and Scalar to RGB, raised by Power to the Glow Light, gives how much of the dark is kept; the cached print, split from its share, is subtracted from One, multiplied by that and subtracted from One again: the glowing print; Linear to sRGB turns it into a colour, Mix lays it over the pixel by Amount and Combine RGB + Alpha puts back its alpha](../assets/effects/graphs/riso-glow-finish.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1389" aria-hidden="true" focusable="false">
<defs><marker id="riso-glow-finish-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M509 136 L509 220" marker-end="url(#riso-glow-finish-arrow)" />
<circle class="docs-shot-number" cx="509" cy="136" r="18" /><text x="509" y="136" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M880 136 L880 220" marker-end="url(#riso-glow-finish-arrow)" />
<circle class="docs-shot-number" cx="880" cy="136" r="18" /><text x="880" y="136" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M323 786 L323 870" marker-end="url(#riso-glow-finish-arrow)" />
<circle class="docs-shot-number" cx="323" cy="786" r="18" /><text x="323" y="786" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M694 854 L694 938" marker-end="url(#riso-glow-finish-arrow)" />
<circle class="docs-shot-number" cx="694" cy="854" r="18" /><text x="694" y="854" class="docs-shot-number-text">4</text>
</svg>
</div>

<figcaption>Inside Glow &amp; Mix (Amount). 1 — Exponential: how much of the dark one unit of light keeps. 2 — Power: how much of the dark the Glow Light keeps. 3 — Subtract: the glowing print. 4 — Mix: over the picture by Amount.</figcaption>
</figure>

**Exponential** – e to the power of minus the Strength: how much of the print's darkness a full unit of light keeps. 1 when there is no glow, smaller the stronger it is.

**Power** – raises that to the Glow Light, channel by channel: where the glow ink shines brightly, little of the dark is kept; where there is no glow light, all of it.

**Subtract** – one minus the print's darkness times what is kept: the glow is screened onto the print in linear light, so it brightens the dark parts most and never clips into a hard white.

**Mix** – turns the glowing print into a colour (Linear to sRGB) and lays it over the picture by Amount; Combine RGB + Alpha then puts each pixel's own transparency back on.

## Technical details

- **Size.** Dot Size and Registration count pixels of a frame whose shorter side is 1080, and the glow reaches a fixed number of dots: a 4K export, a portrait frame, a lower Preview Quality and the thumbnails show the same dots and the same glow. A cell is never smaller than one pixel of the frame, and the card says so on a frame that small.
- **Glow.** The print and the glow share (the glow ink's coverage × the part the shadow ink leaves open) are cached in one pass; the second pass gathers the share over 9 × 9 taps 0.75 dots apart with Gaussian weights and screens the glow ink's light onto the print in linear light: 1 − (1 − print) × e^(−strength × light). Areas of pure black or white keep the look of the plain print; the glow only spills around the parts that glow.
- **Time.** The pulse is 0.55 + 0.45 × cos(2 × seconds × Speed) of the timeline: scrubbing, playback and export give the same frame for the same moment, and a paused picture needs no extra rendering. A keyframed Speed breathes faster or slower smoothly, without a jump.
- **Transparency.** Transparent parts of the picture take no ink and give no glow, and each pixel keeps its own alpha, so the glow stays inside a cut-out figure's outline.
- **Saved projects.** A Riso Glow saved before Dot Size existed keeps its earlier look: both inks printed the same darkness, a little apart, without dots, with a pulsing tint of both inks, mixed over the picture at Amount 0.75. Its card hides Dot Size and Glow and says so; add the effect again for the print described here. An edited node setup keeps its own recipe.
- **More:** [Riso](./riso.md) · [Effect system](../Effect-System.md#riso-glow) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
