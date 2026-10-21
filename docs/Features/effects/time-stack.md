# Time Stack

Shows delayed copies of a moving video clip at once, like a long-exposure photo of a dance. The trail builds up over the clip's first seconds.

Group: [Keying & Time](../Effects-Keying-Time.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Left: a dancer turning on a dark stage. Right: Time Stack at its default settings (Lighten, Decay 0.8): fainter and fainter copies of her arms, hair and dress fan out around her as she turns](../assets/effects/time-stack.webp)

<figcaption>Left: original. Right: default settings (Lighten, Decay 0.8).</figcaption>
</figure>

**Use it for:** echoes of a dancer's movement · stroboscopic trails · one performer turned into a chorus (a large Time offset).

- **Instances** – how many copies (1 to 32).
- **Time offset** – the time between copies. 20 copies at 0.1 s span 1.9 s.
- **Decay** – how much fainter each older copy gets. At 0.8 the fifth copy keeps 41 % and the twentieth 1.4 %; 1 keeps them all equal.
- **Blend mode** – Lighten for lit performers on a dark stage, Darken for a dark subject on a bright background.

**Tip:** the older copies come from the original video, before the effects above Time Stack. Put colour correction and other shared effects after Time Stack, so every copy gets them.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Instances | 1 to 32 | 20 |
| Time offset (s) | 0 to 10 | 0.1 |
| Decay | 0 to 1 | 0.8 |
| Blend mode | Darken, Lighten, Multiply, Screen, Normal and 32 more | Lighten |
| Preview size | Small (960 px), Full | Full |
| Frame cache | 640 MiB, 1 GiB, 2 GiB, 4 GiB | 1 GiB |
<!-- generated:controls end -->

**Preview size:** Full uses the original source resolution without proxies; Small renders at 960 px. **Frame cache:** the GPU memory for the delayed frames; it changes how smoothly the effect plays, not how it looks.

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The strength part of the Time Stack recipe: Decay feeds the Base and the Index of Sequence Index the Exponent of Power, whose Opacity output feeds the Opacity input of Sequence Blend; Past Frame feeds its Sample input](../assets/effects/graphs/time-stack.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 767" aria-hidden="true" focusable="false">
<defs><marker id="time-stack-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M180 279 L180 363" marker-end="url(#time-stack-arrow)" />
<circle class="docs-shot-number" cx="180" cy="279" r="18" /><text x="180" y="279" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M836 38 L836 122" marker-end="url(#time-stack-arrow)" />
<circle class="docs-shot-number" cx="836" cy="38" r="18" /><text x="836" y="38" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>Time Stack: how strong each copy is (Instances and Blend mode left out). 1 — Sequence Index. 2 — Sequence Blend.</figcaption>
</figure>

Time Stack is built around **Sample Past Frame**, which reads the clip at the same spot a number of seconds earlier. **Sequence Index** (1) counts the copies (Index 0, 1, 2 …; Progress runs from 0 to 1). A **Multiply** turns the index into a delay (index × Time offset), so copy 3 shows the clip 0.3 s ago (**Past Frame** in the picture). **Power** gives each copy its **Opacity** (Decay to the power of the index), and **Sequence Blend** (2) layers all copies with the Blend mode, the current frame first. How to open it: [The node setup](../Effects.md#the-node-setup).

**Remix:** for a trail that fades evenly and ends at nothing, add a **Subtract** (A = a **Value** of 1, B = **Progress** of Sequence Index) and plug it into **Opacity** of Sequence Blend instead of Power.

## Technical details

- **Copies.** At clip time t, copy i reads t − i × Time offset and blends with opacity Decay^i. Only copies whose start time has been reached take part, so the trail builds up over the first seconds; Time offset 0 starts them all together, and one instance passes the current picture. The effect does not lengthen the clip or repeat its audio.
- **Values.** Decay outside 0 to 1 is used at the nearest limit (0 as 0.0001), and a Decay that is not a number at 0.8; the inspector and tool results say so.
- **Normal.** Sequence Blend draws the current frame first and each older copy over it, so modes that cover what lies below bury the current frame: in Normal at Decay 0.8 with 20 instances it keeps under 1 % of the result (at Decay 1 none). The inspector says so when Normal is chosen with Decay below 1. Decay fades the copies in the modes that combine them, such as Lighten, Darken, Screen or Add.
- **Blend modes.** All 37 timeline blend modes, grouped by family, with the timeline's own colour formulas. Opacity multiplies each copy's alpha; the first copy seeds the stack and the others composite in straight alpha. Stencil and Silhouette mask the alpha gathered so far; Dissolve uses the pixel position and Dancing Dissolve also the timeline time. Changing the mode keeps the frame cache and the compiled shader.
- **Source.** The copies come from the original video's own timestamps, including trims, speed changes and reverse clips, and do not depend on earlier playback. The current copy uses the effect's input. Time Stack needs a video clip, not a still image or a nested composition.
- **Memory and playback.** The frame cache (640 MiB to 4 GiB, 1 GiB by default) reserves only the estimated window plus a lookahead, within the device limits. When the whole source interval fits it is preloaded; otherwise the free slots are spread over the delayed copies. The first playback or a distant seek can wait for frames: the preview holds the last complete picture meanwhile, and the export waits for the exact frames and reports resource failures. Long spans, large sources or many copies can need a larger cache for smooth playback; no real-time rate is guaranteed when the window does not fit.
- **The graph.** Fifteen nodes make the whole stack; the GPU loops over the copies instead of running twenty decoders. Sequence Blend works with other image sequences too. The effect supplies the window of i × Time offset delays itself, so a graph edit that changes the delays does not widen it: use the Time offset control for that.
- **Saved projects.** A Time Stack stored without Decay (a project or effect preset from before Decay existed) renders with Decay 1, as it always looked, and saving writes that 1; its blend mode stays. Untouched saved graphs gain the Decay nodes; graphs edited before Decay existed stay as saved, and the inspector notes that Decay has no effect there.

Sampling past frames: [Temporal frame access](../../architecture/Temporal-Frame-Access.md). The registry and graphs: [Effect system](../Effect-System.md). Nodes: [Node Catalog](../Node-Catalog.md).
