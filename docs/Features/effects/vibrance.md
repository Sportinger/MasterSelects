# Vibrance

A gentle saturation that strengthens pale colours a lot and strong colours and skin only a little. Good for scenes with people: the colour comes alive, the faces stay natural.

Group: [Color & Tone](../Effects-Color.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![The dancer leaping in front of a green screen, original left and with Vibrance at Amount 1 right: the pale green of the screen turns a strong, bright green, while her skin, her dark hair and the white dress look almost unchanged](../assets/effects/vibrance.webp)

<figcaption>Left: original. Right: Amount 1 (the Vibrant preset).</figcaption>
</figure>

**Use it for:** livelier colour on people · reviving pale, washed-out shots · a quiet, muted look that keeps skin alive (below 0).

- **Amount** – up for livelier colour, down for a muted look; skin moves least either way.

**Tip:** for a close-up of a face, Vibrance is the safer push. The same strength of [Saturation](./saturation.md) turns skin orange, Vibrance leaves it as it is:

<figure class="docs-shot docs-shot--detail">

![The dancer's face, shoulders and arm in front of the green screen, the same crop twice: left with Saturation 1.8, where her skin turns orange-red, right with Vibrance 1, where the green is just as strong but the skin stays natural](../assets/effects/vibrance-skin.webp)

<figcaption>Left: Saturation 1.8. Right: Vibrance 1.</figcaption>
</figure>

## Presets

<figure class="docs-shot docs-shot--detail">

![The dancer in front of the green screen four times, each with one preset: Gentle top left with a slightly fuller green, Lively top right and Vibrant bottom left with a strong, bright green, Muted bottom right with a pale, greyish green; her skin looks the same in all four](../assets/effects/presets/vibrance.webp)

<figcaption>The four presets on the green-screen dancer.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets Amount in one undo step, and the row then shows its name until you change the value. A keyframed Amount keeps its keyframes, and the card says so.

**Gentle** – a small lift for pale footage (Amount 0.3). You notice it mostly next to the original.

**Lively** – fuller colour in the haze, the light and the costume (Amount 0.7), while faces stay as they were. A good first step for a dull stage recording.

**Vibrant** – the full push of the slider (Amount 1). Pale colours bloom, strong colours and skin move only a little.

**Muted** – pale colours fade toward grey (Amount −0.6), strong colours and skin keep most of theirs: a quiet, cool look that still has life in the faces.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Vibrance card: the Preset menu showing Lively and the Amount row at 0.7, beside a strip of the preview with the dancer in front of a brighter green screen](../assets/effects/editor/vibrance-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 393" aria-hidden="true" focusable="false">
<defs><marker id="vibrance-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 282 L649 282" marker-end="url(#vibrance-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="282" r="18" /><text x="565" y="282" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M555 344 L639 344" marker-end="url(#vibrance-inspector-arrow)" />
<circle class="docs-shot-number" cx="555" cy="344" r="18" /><text x="555" y="344" class="docs-shot-number-text">2</text>
</svg>

</div>

<figcaption>Vibrance with the Lively preset. 1 — Preset: pick a starting point. 2 — Amount: muted or livelier colour.</figcaption>
</figure>

**Preset** – one of the four starting points above; it sets Amount.

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/vibrance-amount.mp4" poster="../assets/effects/clips/vibrance-amount.webp" width="720" height="540" autoplay muted loop playsinline preload="none" aria-label="The dancer turning on a dark stage with Vibrance while Amount runs from −1 to 1 and back: at −1 the brown haze and the floor turn grey and the stage looks cool and quiet, then the warm haze, the floor and the blue backlight grow fuller, while her skin keeps its colour throughout; the current value is shown at the bottom left"></video>
<figcaption>Amount from −1 to 1 and back.</figcaption>
</figure>

**Amount** – how much livelier or quieter the colour gets. 0 leaves the picture as it is. Above 0 every colour grows stronger by how pale it is: a washed-out sky or a pale green screen gains a lot, a colour that is already strong gains little, and lit skin tones are spared most of it. Below 0 it works the other way round: pale colours fade toward grey first, and at −1 only the strongest colours keep much of theirs. Like [Saturation](./saturation.md), every colour stops at the strongest version the screen can show, so nothing clips and the brightness stays. Warm surfaces in bright light count as skin too, so on a stage lit in orange the push is weaker; use Saturation there. −1 to 1, default 0. In the number field you can type up to 4 for a stronger push; beyond that, and below −1, the picture uses the limit and the inspector says so.

<div class="docs-float-end"></div>

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Vibrance graph: Input Frame, Split RGB + Alpha and a Clamp on the RGB; Hue & Saturation measures the colour, Skin Protection and Muted-Colour Weight turn it into a Mix Amount together with the Amount from Parameters, and Saturation (Gamut-Safe) applies it to the RGB; the Constants folder and the final Combine RGB + Alpha and Output are left out](../assets/effects/graphs/vibrance.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 437" aria-hidden="true" focusable="false">
<defs><marker id="vibrance-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M504 332 L588 332" marker-end="url(#vibrance-arrow)" />
<circle class="docs-shot-number" cx="504" cy="332" r="18" /><text x="504" y="332" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M508 400 L508 316" marker-end="url(#vibrance-arrow)" />
<circle class="docs-shot-number" cx="508" cy="400" r="18" /><text x="508" y="400" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M504 114 L588 114" marker-end="url(#vibrance-arrow)" />
<circle class="docs-shot-number" cx="504" cy="114" r="18" /><text x="504" y="114" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M787 414 L787 330" marker-end="url(#vibrance-arrow)" />
<circle class="docs-shot-number" cx="787" cy="414" r="18" /><text x="787" y="414" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M926 326 L926 242" marker-end="url(#vibrance-arrow)" />
<circle class="docs-shot-number" cx="926" cy="326" r="18" /><text x="926" y="326" class="docs-shot-number-text">5</text>
</svg>

</div>

<figcaption>Vibrance opened in the Nodes tab (Constants, Combine RGB + Alpha and Output left out). 1 — Parameters: Amount, kept within its range. 2 — Hue & Saturation: measures each colour. 3 — Skin Protection: finds lit skin tones. 4 — Muted-Colour Weight: the strength for this pixel. 5 — Saturation (Gamut-Safe): mixes between grey and colour, never past the edge.</figcaption>
</figure>

Vibrance is [Saturation](./saturation.md) with a different strength for every pixel. **Hue & Saturation** measures each colour, **Skin Protection** finds lit skin tones, and **Muted-Colour Weight** turns both and the Amount into the **Mix Amount** of that pixel: more for pale colours, less for strong ones and for skin. **Saturation (Gamut-Safe)** is the same block as in Saturation and does the mixing. **Clamp** keeps the picture between 0 and 1 first, and **Combine RGB + Alpha** (after the block, not shown) puts the transparency back untouched. Click a folder's header to open it; the sections below show what is inside.

### Parameters

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![Inside the Parameters folder: the Amount card at 0, Amount Render Min −1 and Amount Render Max 4 feed Value, Min and Max of a Clamp, whose output is the Amount the weight reads](../assets/effects/graphs/vibrance-parameters.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 740" aria-hidden="true" focusable="false">
<defs><marker id="vibrance-parameters-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M432 521 L432 437" marker-end="url(#vibrance-parameters-arrow)" />
<circle class="docs-shot-number" cx="432" cy="521" r="18" /><text x="432" y="521" class="docs-shot-number-text">1</text>
</svg>

</div>

<figcaption>Inside Parameters. 1 — Clamp: keeps Amount between −1 and 4.</figcaption>
</figure>

**Clamp** – keeps Amount between −1 and 4, the values in **Amount Render Min** and **Amount Render Max**. At −1 the palest colours are already almost grey, and above 4 even strong colours have reached the edge of the screen. A keyframe, a node or the AI agent may send more; the graph then uses the limit, and the card and the tool result say so.

<div class="docs-float-end"></div>

### Hue & Saturation

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![Inside the Hue & Saturation folder: the RGB 0–1 goes into RGB to HSV, whose HSV output goes into Split Vector with the outputs Hue (HSV), Saturation and Value (HSV)](../assets/effects/graphs/vibrance-measure.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 313" aria-hidden="true" focusable="false">
<defs><marker id="vibrance-measure-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M279 290 L279 206" marker-end="url(#vibrance-measure-arrow)" />
<circle class="docs-shot-number" cx="279" cy="290" r="18" /><text x="279" y="290" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M482 22 L482 88" marker-end="url(#vibrance-measure-arrow)" />
<circle class="docs-shot-number" cx="482" cy="22" r="18" /><text x="482" y="22" class="docs-shot-number-text">2</text>
</svg>

</div>

<figcaption>Inside Hue & Saturation. 1 — RGB to HSV: the colour as hue, saturation and value. 2 — Split Vector: the three numbers apart.</figcaption>
</figure>

**RGB to HSV** – describes each colour as its hue (where on the colour wheel, 0 to 1), its saturation (how far from grey, 0 to 1) and its value (the brightness of its strongest channel).

**Split Vector** – hands the three numbers out on their own: **Saturation** goes to the weight, all three go to the skin test.

<div class="docs-float-end"></div>

### Muted-Colour Weight

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside the Muted-Colour Weight folder, in one row: Saturation into B of Subtract, then a Multiply with Skin Weight, a Multiply with Amount, an Add and a Maximum, whose output is the Mix Amount](../assets/effects/graphs/vibrance-weight.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 294" aria-hidden="true" focusable="false">
<defs><marker id="vibrance-weight-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M189 272 L189 188" marker-end="url(#vibrance-weight-arrow)" />
<circle class="docs-shot-number" cx="189" cy="272" r="18" /><text x="189" y="272" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M432 22 L432 73" marker-end="url(#vibrance-weight-arrow)" />
<circle class="docs-shot-number" cx="432" cy="22" r="18" /><text x="432" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M675 272 L675 188" marker-end="url(#vibrance-weight-arrow)" />
<circle class="docs-shot-number" cx="675" cy="272" r="18" /><text x="675" y="272" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M938 22 L938 73" marker-end="url(#vibrance-weight-arrow)" />
<circle class="docs-shot-number" cx="938" cy="22" r="18" /><text x="938" y="22" class="docs-shot-number-text">4</text>
</svg>

</div>

<figcaption>Inside Muted-Colour Weight (the constants 1 and 0 are left out). 1 — Subtract: how pale the colour is. 2 — Multiply: paleness, less on skin. 3 — Multiply: scaled by Amount. 4 — Maximum: the Mix Amount, never below 0.</figcaption>
</figure>

**Subtract** – 1 minus the saturation: how pale the colour is. A grey pixel gets 1, a pure colour 0.

**Multiply** (first) – the paleness times the **Skin Weight** from Skin Protection, so skin tones get only part of it.

**Multiply** (second) – that weight times **Amount**. **Add** puts 1 on top, because 1 is the mix that leaves the colour as it is.

**Maximum** – keeps the result at 0 or above, so a mix never turns a colour into its opposite. This is the **Mix Amount** that Saturation (Gamut-Safe) reads.

**Remix:** to treat skin like every other colour, connect a **Value** of 1 to input B of the first **Multiply** (2), in place of **Skin Weight**.

### Skin Protection

Skin Protection asks two questions: is the hue that of skin, and is the pixel lit like skin? The answer is the **Skin Weight**, 1 for every colour that is not skin and down to 0.3 for clear skin.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside Skin Protection, the hue test: Hue (HSV) minus Skin Hue 0.07 in Subtract, plus Skin Half 0.5 in Add, Fraction, then a second Subtract of 0.5 and Absolute give the distance from the skin hue; Gaussian Falloff with Skin Width 0.05 turns it into a match](../assets/effects/graphs/vibrance-skin-hue.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 996" aria-hidden="true" focusable="false">
<defs><marker id="vibrance-skin-hue-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M393 22 L393 106" marker-end="url(#vibrance-skin-hue-arrow)" />
<circle class="docs-shot-number" cx="393" cy="22" r="18" /><text x="393" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M854 22 L854 106" marker-end="url(#vibrance-skin-hue-arrow)" />
<circle class="docs-shot-number" cx="854" cy="22" r="18" /><text x="854" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M163 904 L163 820" marker-end="url(#vibrance-skin-hue-arrow)" />
<circle class="docs-shot-number" cx="163" cy="904" r="18" /><text x="163" y="904" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M624 512 L624 596" marker-end="url(#vibrance-skin-hue-arrow)" />
<circle class="docs-shot-number" cx="624" cy="512" r="18" /><text x="624" y="512" class="docs-shot-number-text">4</text>
</svg>

</div>

<figcaption>Inside Skin Protection, the hue test. 1 — Subtract: the hue minus the skin hue. 2 — Fraction: wraps it around the colour wheel. 3 — Subtract: back to a distance. 4 — Gaussian Falloff: how close to skin.</figcaption>
</figure>

**Subtract** (top) – the hue minus **Skin Hue**, 0.07 of the colour wheel (about 25°, the orange of skin in light). **Add** puts **Skin Half** (0.5) on top.

**Fraction** – keeps only the part after the decimal point. The colour wheel is a circle, so a red at 0.98 is close to the skin hue too; this wrap finds the short way round.

**Subtract** (bottom) – takes the 0.5 off again, and **Absolute** turns the result into a plain distance from the skin hue, 0 to 0.5.

**Gaussian Falloff** – turns the distance into a match: 1 right on the skin hue, falling off smoothly over **Skin Width** (0.05, about 18°) to nearly 0.

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![Inside Skin Protection, the light test: Saturation into a Smoothstep between Skin Pale Saturation 0.6 and Skin Vivid Saturation 0.8, Subtract from 1; Value (HSV) into a Smoothstep between Skin Dark Value 0.15 and Skin Lit Value 0.35; a Multiply joins both, a second Multiply adds the Skin Hue match, a third the Skin Protection 0.7, and a final Subtract from 1 gives the Skin Weight](../assets/effects/graphs/vibrance-skin-weight.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 882" aria-hidden="true" focusable="false">
<defs><marker id="vibrance-skin-weight-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M230 227 L230 311" marker-end="url(#vibrance-skin-weight-arrow)" />
<circle class="docs-shot-number" cx="230" cy="227" r="18" /><text x="230" y="227" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M369 745 L369 661" marker-end="url(#vibrance-skin-weight-arrow)" />
<circle class="docs-shot-number" cx="369" cy="745" r="18" /><text x="369" y="745" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M508 535 L508 451" marker-end="url(#vibrance-skin-weight-arrow)" />
<circle class="docs-shot-number" cx="508" cy="535" r="18" /><text x="508" y="535" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M787 535 L787 451" marker-end="url(#vibrance-skin-weight-arrow)" />
<circle class="docs-shot-number" cx="787" cy="535" r="18" /><text x="787" y="535" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M926 176 L926 260" marker-end="url(#vibrance-skin-weight-arrow)" />
<circle class="docs-shot-number" cx="926" cy="176" r="18" /><text x="926" y="176" class="docs-shot-number-text">5</text>
</svg>

</div>

<figcaption>Inside Skin Protection, the light test. 1 — Smoothstep: is the colour vivid? 2 — Smoothstep: is the pixel lit? 3 — Multiply: lit and not vivid. 4 — Multiply: how much skin is spared. 5 — Subtract: the Skin Weight.</figcaption>
</figure>

**Smoothstep** (top) – rises smoothly from 0 to 1 as the saturation goes from **Skin Pale Saturation** (0.6) to **Skin Vivid Saturation** (0.8). **Subtract** turns it round: 1 for colours that could be skin, 0 for strong orange light, which then gets the full push.

**Smoothstep** (bottom) – rises from 0 to 1 as the value goes from **Skin Dark Value** (0.15) to **Skin Lit Value** (0.35). A dark, warm stage floor has the hue of skin but is not lit like it, so it is not protected.

**Multiply** (first) – both tests at once: lit and not too vivid. The next **Multiply** joins it with the hue match from above (**Skin Hue**).

**Multiply** (last) – scales the match by **Skin Protection**, 0.7: clear skin is spared 70 % of the push.

**Subtract** – 1 minus that: the **Skin Weight**, which the Muted-Colour Weight multiplies with the paleness.

**Remix:** set **Skin Protection** to 1 to leave skin completely untouched, or move **Skin Hue** to 0.6 to spare a blue instead, say the sky of a scene.

### Saturation (Gamut-Safe)

The same block as in [Saturation](./saturation.md#saturation-gamut-safe), with the **Mix Amount** in place of the Amount: it mixes from grey to colour and stops every pixel at the strongest version the screen can show. The block is also in **right-click → Reusable Nodes**.

## Technical details

- **Formula.** Mix Amount `k = max(0, 1 + Amount · (1 − S) · w)` with `S` the HSV saturation and `w` the Skin Weight, then `y = L + (x − L) · min(k, limit)` as in [Saturation](./saturation.md#technical-details) (`L`: Rec.709 brightness). At Amount 1 a pale sky of (0.55, 0.7, 0.9) gets `k` = 1.61, stops at its limit 1.46 as (0.49, 0.71, 1.0); a lit skin tone of (0.85, 0.6, 0.48) gets only 1.19 and becomes (0.89, 0.59, 0.45).
- **Skin.** A bell curve around hue 0.07 (about 25°), width 0.05, sparing up to 70 %. The protection fades in over HSV value 0.15–0.35 and out over saturation 0.6–0.8, so dark warm floors and strong orange light get the full Amount.
- **Range.** The slider covers −1 to 1; typed values, keyframes and nodes render −1 to 4. Beyond that the graph uses the limit, and the inspector and the tool result say so.
- **Colour.** Brightness and hue stay; pure black, white and grey stay as they are at every value.
- **Transparency.** Only the colour is changed; the transparency passes through untouched.
- What all colour effects share (8-bit range, saved projects, adjustment layers): [Color & Tone](../Effect-System.md#color--tone-notes). Formulas: [Effect system](../Effect-System.md#editable-color-effect-graphs); blocks: [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
