# Chroma Key

Makes a green or blue screen transparent, so the performer can stand in front of any background. It finds the screen colour by itself, and hair, fine fabric and edges take on the new background instead of a green rim.

Group: [Keying & Time](../Effects-Keying-Time.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Left: a dancer leaping in front of an unevenly lit green screen, with curly hair and a chiffon scarf. Right: the same shot keyed with Chroma Key at its default settings over a dark blue background; the flyaway hair keeps its detail and no green edge remains, while the chiffon scarf turns mostly solid grey with violet patches at its lower end](../assets/effects/chroma-key.webp)

<figcaption>Left: green-screen shot. Right: Chroma Key, default settings, over dark blue.</figcaption>
</figure>

**Use it for:** a performer filmed in front of a green screen · a blue-screen insert · keying a coloured cloth or wall (pick its colour).

- **Screen** – Green, Blue, or a colour you pick from the screen. The inspector says so when the clip shows no such screen.
- **Clip Black / Clip White** – raise Clip Black until the background is gone, lower Clip White until the performer is solid. **View → Matte** shows this in black and white.
- **Shrink / Grow** and **Softness** (Edge) – pull the edge in or out and soften it, in pixels of a 1080p picture.
- **Suppression** and **Method** (Spill) – remove the green glow; Method **Gentle** keeps yellow costumes yellow.

**Tip:** curtains, stands and lights outside the screen are not screen colour, so they stay in the picture (white in the matte). Cut them away with a [mask](../Masks.md) around the performer.

<figure class="docs-shot docs-shot--detail">

![The whole green-screen frame in View → Matte at default settings: the screen is black, the leaping dancer white with grey see-through scarf; thin white curtain edges stand at the left and right and white debris sits in the lower corners](../assets/effects/chroma-key-matte.webp)

<figcaption>View → Matte, whole frame: the curtain edges stay white.</figcaption>
</figure>

## Controls

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![The Chroma Key card in Properties, Effects at its default settings, editor window 1600 px wide: Key (Screen: Green, View: Final result), Matte (Clip Black 0.30, Clip White 0.85), Edge (Shrink / Grow and Softness at 0 px) and Spill (Suppression 1.00, Method: Neutral)](../assets/effects/editor/chroma-key-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 907" aria-hidden="true" focusable="false">
<defs><marker id="chroma-key-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M50 195 L134 195" marker-end="url(#chroma-key-inspector-arrow)" />
<circle class="docs-shot-number" cx="50" cy="195" r="18" /><text x="50" y="195" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M73 296 L157 296" marker-end="url(#chroma-key-inspector-arrow)" />
<circle class="docs-shot-number" cx="73" cy="296" r="18" /><text x="73" y="296" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M22 428 L106 428" marker-end="url(#chroma-key-inspector-arrow)" />
<circle class="docs-shot-number" cx="22" cy="428" r="18" /><text x="22" y="428" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>1 — Screen. 2 — View. 3 — Clip Black.</figcaption>
</figure>

The card groups its controls in four sections: Key, Matte, Edge and Spill. A key in four steps:

1. Choose the **Screen** (1).
2. Switch **View** (2) to **Matte**: the screen should be black and the performer white.
3. Raise **Clip Black** (3) until grey specks in the background are gone, and lower **Clip White** until the body is solid.
4. Switch back to **Final result**.

<div class="docs-float-end"></div>

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Screen | Green, Blue, Picked color | Green |
| Screen color | a colour | `#4c9a55` |
| Clip Black | 0 to 1 | 0.3 |
| Clip White | 0 to 1 | 0.85 |
| Shrink / Grow | −20 to 20 | 0 |
| Edge Softness | 0 to 20 | 0 |
| Spill Suppression | 0 to 1 | 1 |
| Spill Method | Neutral, Gentle (keeps yellows) | Neutral |
| View | Final result, Matte | Final result |
<!-- generated:controls end -->

## Node setup

The key runs in stages, each a folder in the graph. **Screen Grid** and **Screen Color** find the screen colour by averaging the parts of the frame that look like screen. **Screen Matte & Clip** compares every pixel with that colour and applies Clip Black and Clip White. **Shrink / Grow** and **Edge Softness** shape the edge, **Screen Subtraction** takes the screen's share out of see-through pixels (hair, chiffon), and **Spill Suppression** removes the green glow. How to open it: [The node setup](../Effects.md#the-node-setup).

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The limit of Chroma Key's Spill Suppression as a recipe: Half (0.5) feeds the Edge and Spill Method the Value of Step, whose Is Gentle output feeds input T of Mix; Other Mean feeds input A of Mix and Stronger Other input B; Mix outputs the Limit](../assets/effects/graphs/chroma-key-spill.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 1013" aria-hidden="true" focusable="false">
<defs><marker id="chroma-key-spill-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M508 22 L508 84" marker-end="url(#chroma-key-spill-arrow)" />
<circle class="docs-shot-number" cx="508" cy="22" r="18" /><text x="508" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M836 22 L836 84" marker-end="url(#chroma-key-spill-arrow)" />
<circle class="docs-shot-number" cx="836" cy="22" r="18" /><text x="836" y="22" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M866 430 L772 430" marker-end="url(#chroma-key-spill-arrow)" />
<circle class="docs-shot-number" cx="866" cy="430" r="18" /><text x="866" y="430" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>Spill Suppression: the limit for the screen channel. 1 — Step. 2 — Mix. 3 — input T of Mix.</figcaption>
</figure>

The screen channel (green on a green screen) may be no stronger than the other two channels allow. **Step** (1) turns Spill Method into 0 (Neutral) or 1 (Gentle), and **Mix** (2) uses it at input T (3) to pick the **Limit**: A, the mean of the other two channels (**Other Mean**), or B, the stronger of them (**Stronger Other**). After this recipe a **Subtract** and a **Maximum** keep what lies above the limit, a **Multiply** scales it by Spill Suppression, and a last **Subtract** takes it out of the colour.

**Remix:** for a limit halfway between Neutral and Gentle, unplug **Step** from input T (3) of **Mix** and plug a **Value** of 0.5 into T.

## Technical details

- **Passes.** A 64 px Screen Grid (each cell averages 5 × 5 reads, weighted by how screen-like they are), a 1 px Screen Color (the mean of 33 × 33 grid reads) and the key pass. Both caches are **Cache Image** nodes with **Max size** 64 and 1. A picked colour folds both away (one pass).
- **Units.** Clip Black and Clip White are matte levels from 0 to 1 (default 0.30 and 0.85). Shrink / Grow (−20 to 20) and Edge Softness (0 to 20) are pixels of a 1080p frame (its shorter side) and scale with the render size; each adds two blur passes only while it is not 0.
- **Values.** Out-of-range values are used at their limit, values that are not a number at their default, and Clip Black at or above Clip White makes a hard cut; the inspector names each case and tool results report unusable numbers. A clip without screen colour keys nothing, and the inspector and `addEffect`/`updateEffect` say so (checked on the clip's thumbnails).
- **Limits.** Chroma Key measures one screen colour for the whole frame, so see-through fabric such as chiffon can come out greyish or blotchy.
- **Software preview and export readback.** The worker CPU keys a 1080p frame in under 0.1 s (the whole worker pixel pass, with frame copy and write-back, about 0.25 s; it skips the source-resampling and feedback stages a layer does not use instead of calling them per pixel), but only on a layer whose sole effect is one Chroma Key without Shrink / Grow or Edge Softness. A stored key graph among other effects runs on the slower graph interpreter in stack order; a graph-less key among other effects is reported as unsupported.
- **Saved projects.** Untouched older key graphs switch to the current keyer: stored Spill Suppression stays, Clip Black/White and the edge use their defaults, and the inspector lists the retired Tolerance and Edge Softness values and keyframes that no longer act. The old Custom choice keyed pure green and now keys the picked colour (#4C9A55 unless one is stored). Edited graphs keep the old key with its Tolerance and Edge Softness rows.

Keyer internals: [Effect system: editable keying and feedback graphs](../Effect-System.md#editable-keying-and-feedback-graphs). Nodes: [Node Catalog](../Node-Catalog.md).
