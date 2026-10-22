# Time Stack

Shows delayed copies of a moving video clip at once, like a long-exposure photo of a dance. One performer leaves a trail, a smear or a chorus of herself.

Group: [Keying & Time](../Effects-Keying-Time.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-clip docs-compare docs-shot--float-left">
<video src="../assets/effects/clips/time-stack.mp4" poster="../assets/effects/clips/time-stack.webp" width="960" height="462" autoplay muted loop playsinline preload="none" aria-label="The dancer turning on a dark stage, original left and with Time Stack right: fainter and fainter copies of her arms, hair and dress fan out behind her as she turns, like a long-exposure photograph"></video>
<figcaption>Left: original. Right: Time Stack at its default settings, the Echo Trail preset.</figcaption>
</figure>

**Use it for:** echoes of a dancer's movement · stroboscopic photographs in motion · one performer turned into a chorus.

- **Instances** – how many copies.
- **Time offset** – the time between them.
- **Decay** – how much fainter each older copy gets.
- **Blend mode** – how the copies combine.

**Tip:** the older copies come from the original video, before the effects above Time Stack. Put colour correction and other shared effects after Time Stack, so every copy gets them.

## Presets

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/time-stack-presets.mp4" poster="../assets/effects/clips/time-stack-presets.webp" width="960" height="730" autoplay muted loop playsinline preload="none" aria-label="The dancer five times in a grid, moving in sync, each with one preset: Echo Trail with fading copies fanning out behind her, Long Exposure with a long smear of the last two and a half seconds, Stroboscope with eight equally bright copies close together, Chorus with five whole dancers half a second apart, Afterglow with a short soft glow around her on a dark stage"></video>
<figcaption>The five presets on the moving dancer, in sync.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. It sets Instances, Time offset, Decay and Blend mode in one undo step, and the row shows its name until you change one of them. Preview size and Frame cache go back to Full and 1 GiB. A Decay with keyframes keeps them, and the card says so.

**Echo Trail** – twenty copies a tenth of a second apart, each a little fainter: arms, hair and dress fan out behind the movement and fade. The default; good for most dance.

**Long Exposure** – thirty-two copies, each 0.08 s apart, that fade only slowly: the last two and a half seconds of movement melt into one long smear, like a camera with its shutter left open.

**Stroboscope** – eight equally bright copies a fifth of a second apart: the movement breaks into clear separate poses, like a strobe photograph.

**Chorus** – five whole figures half a second apart: one performer becomes a small group that repeats her steps, the older ones a little fainter. Strongest on slow, large movements.

**Afterglow** – six quickly fading copies added in Screen: a short, soft glow follows the figure, while the dark stage stays dark (more or brighter copies would lift it into haze). For a dreamlike, luminous look.

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with a Time Stack card: Preset menu showing Chorus, then Instances 5, Time offset 0.50 s, Decay 0.90, Blend mode Lighten, Preview size Full and Frame cache 1 GiB, with the summary line under them, beside a strip of the preview with the dancer and a faint copy](../assets/effects/editor/time-stack-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 768" aria-hidden="true" focusable="false">
<defs><marker id="time-stack-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M565 306 L649 306" marker-end="url(#time-stack-inspector-arrow)" />
<circle class="docs-shot-number" cx="565" cy="306" r="18" /><text x="565" y="306" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M551 400 L635 400" marker-end="url(#time-stack-inspector-arrow)" />
<circle class="docs-shot-number" cx="551" cy="400" r="18" /><text x="551" y="400" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M541 438 L625 438" marker-end="url(#time-stack-inspector-arrow)" />
<circle class="docs-shot-number" cx="541" cy="438" r="18" /><text x="541" y="438" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M576 475 L660 475" marker-end="url(#time-stack-inspector-arrow)" />
<circle class="docs-shot-number" cx="576" cy="475" r="18" /><text x="576" y="475" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M533 513 L617 513" marker-end="url(#time-stack-inspector-arrow)" />
<circle class="docs-shot-number" cx="533" cy="513" r="18" /><text x="533" y="513" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Time Stack with the Chorus preset. 1 — Preset: pick a starting point. 2 — Instances: how many copies. 3 — Time offset: the time between them. 4 — Decay: how much fainter each older copy gets. 5 — Blend mode: how the copies combine.</figcaption>
</figure>

The line under the rows sums up the stack: how long it reaches back and how much each older copy keeps. When the clip is shorter than that, the card also says how many copies it can show. Instances and Time offset cannot be keyframed: together they decide which frames Time Stack keeps ready. The presets loop above shows them at work: Long Exposure uses 32 instances 0.04 s apart, Chorus 5 instances 0.5 s apart.

**Instances** – how many copies Time Stack layers, the current picture included. 1 shows only the current picture; 4–8 give clearly separate figures, 20 a trail, 32 with a small Time offset a smooth smear. More instances reach further back and need more frames in memory. 1 to 32, default 20.

**Time offset** – the time between two copies. 0.03–0.05 s melts them into a smear, 0.1–0.2 s gives separate echoes, 0.5 s and more whole figures that follow each other. The stack reaches back (Instances − 1) × Time offset: 20 copies at 0.1 s span 1.9 s. Each copy appears once the clip has played that long, so the trail builds up over the first seconds of the clip. At 0 every copy shows the same moment and the picture stays as it is. 0 to 10 s, default 0.1 s.

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/time-stack-decay.mp4" poster="../assets/effects/clips/time-stack-decay.webp" width="720" height="692" autoplay muted loop playsinline preload="none" aria-label="The dancer with Time Stack while Decay runs from 0 to 1 and back: at 0 she is alone, then fading copies appear behind her and grow into a dense, equally bright crowd of arms and skirts at 1, and fade again; the current value is shown at the bottom left"></video>
<figcaption>Decay from 0 to 1 and back.</figcaption>
</figure>

**Decay** – how much fainter each older copy gets: every copy keeps this share of the next newer one's strength. At 0 only the current picture is left; 0.5 gives a short tail of two or three copies; at 0.8 the fifth copy keeps 41 % and the twentieth 1.4 %, a trail that fades out; at 1 all copies are equally strong, a dense crowd. It can be keyframed, for a trail that grows on a cue. 0 to 1, default 0.8.

<div class="docs-float-end"></div>

**Blend mode** – how the copies combine, with the timeline's own blend modes. **Lighten** keeps the brightest copy at every pixel: lit performers on a dark stage, the usual choice. **Screen** and **Add** add the light of all copies, so the figure glows and the stage brightens (Afterglow). **Darken** suits a dark figure in front of a bright background, **Difference** turns the stack dark and ghostly, and **Multiply** quickly sinks it into black. In **Normal** each older copy covers the newer ones, so the current picture ends up underneath; the card says so. Darken, Lighten, Multiply, Screen, Normal and 32 more, default Lighten: all 37 blend modes of the timeline.

**Preview size** – the size of the frames the preview works with. **Small** reads them at 960 px, which needs less memory and plays more smoothly; **Full** uses the original source size. The export always uses the full frames. Small (960 px), Full, default Full.

**Frame cache** – the graphics memory Time Stack keeps for the older frames. It changes how smoothly the effect plays, not how it looks. Raise it for long spans, 4K sources or many instances, when playback waits for frames. 640 MiB, 1 GiB, 2 GiB, 4 GiB, default 1 GiB.

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Time Stack graph opened in the Nodes tab: Sequence Index and Time offset feed Multiply, whose Delay feeds Sample Past Frame together with Input Frame and UV; Decay passes a Clamp between the Values 0.0001 and 1 into Power, whose Exponent is the Index; Past Frame, Opacity, Instances and Blend mode feed Sequence Blend, which feeds Output](../assets/effects/graphs/time-stack.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 867" aria-hidden="true" focusable="false">
<defs><marker id="time-stack-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M22 565 L67 565" marker-end="url(#time-stack-arrow)" />
<circle class="docs-shot-number" cx="22" cy="565" r="18" /><text x="22" y="565" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M231 709 L261 709" marker-end="url(#time-stack-arrow)" />
<circle class="docs-shot-number" cx="231" cy="709" r="18" /><text x="231" y="709" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M416 538 L456 538" marker-end="url(#time-stack-arrow)" />
<circle class="docs-shot-number" cx="416" cy="538" r="18" /><text x="416" y="538" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M416 752 L456 752" marker-end="url(#time-stack-arrow)" />
<circle class="docs-shot-number" cx="416" cy="752" r="18" /><text x="416" y="752" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M610 424 L650 424" marker-end="url(#time-stack-arrow)" />
<circle class="docs-shot-number" cx="610" cy="424" r="18" /><text x="610" y="424" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Time Stack opened in the Nodes tab. 1 — Sequence Index: counts the copies. 2 — Multiply: how far back each copy reads. 3 — Sample Past Frame: reads the clip that far back. 4 — Power: how strong each copy is. 5 — Sequence Blend: layers the copies.</figcaption>
</figure>

Time Stack is one small graph without stage folders: a loop over the copies that reads the past, gives each copy its strength and layers them. The GPU runs it once per pixel and goes through all copies there, instead of decoding the clip twenty times. How to open it: [The node setup](../Effects.md#the-node-setup).

**Sequence Index** – counts the copies. Everything after it runs once per copy: Index is 0 for the current picture, 1 for the next older copy and so on; Progress runs from 0 to 1 along the stack.

**Multiply** – Index times Time offset: how many seconds back this copy reads. At the default, copy 3 shows the clip 0.3 s ago.

**Sample Past Frame** – reads the clip at the same spot that many seconds earlier, from the original video. For Index 0 it passes the effect's own input, the current picture.

**Power** – Decay to the power of the Index: the strength of each copy, 1 for the current picture, then 0.8, 0.64 and so on at the default. The Clamp in front keeps Decay between 0.0001 and 1.

**Sequence Blend** – layers all copies with the Blend mode, each at its strength: the current picture first, every older copy over it. Its Count input, Instances, says how many.

**Remix:** for a trail that fades evenly and ends at nothing, add a **Subtract** (A = a **Value** of 1, B = **Progress** of Sequence Index) and plug it into the **Opacity** input of Sequence Blend instead of Power.

## Technical details

- **Copies.** At clip time t, copy i reads t − i × Time offset and blends with opacity Decay^i. Only copies whose start time has been reached take part, so the trail builds up over the first seconds; Time offset 0 starts them all together, and one instance passes the current picture. The effect does not lengthen the clip or repeat its audio.
- **Values.** Decay outside 0 to 1 is used at the nearest limit (0 as 0.0001), and a Decay that is not a number at 0.8; the card and tool results say so. When the clip ends before the last copy would start, the card names how many copies it can show. Instances and Time offset cannot be keyframed: they set the window of frames the effect keeps ready.
- **Normal.** Sequence Blend draws the current frame first and each older copy over it, so modes that cover what lies below bury the current frame: in Normal at Decay 0.8 with 20 instances it keeps under 1 % of the result (at Decay 1 none). The card says so when Normal is chosen with Decay below 1.
- **Blend modes.** All 37 timeline blend modes, grouped by family, with the timeline's own colour formulas. Opacity multiplies each copy's alpha; the first copy seeds the stack and the others composite in straight alpha. Stencil and Silhouette mask the alpha gathered so far; Dissolve uses the pixel position and Dancing Dissolve also the timeline time. Changing the mode keeps the frame cache and the compiled shader.
- **Source.** The copies come from the original video's own timestamps, including trims, speed changes and reverse clips, and do not depend on earlier playback. The current copy uses the effect's input. Time Stack needs a video clip, not a still image or a nested composition.
- **Memory and playback.** The frame cache reserves only the estimated window plus a lookahead, within the device limits. When the whole source interval fits it is preloaded; otherwise the free slots are spread over the delayed copies. The first playback or a distant seek can wait for frames: the preview holds the last complete picture meanwhile, and the export waits for the exact frames and reports resource failures. No real-time rate is guaranteed when the window does not fit.
- **The graph.** Fifteen nodes make the whole stack. Sequence Blend works with other image sequences too. The effect supplies the window of i × Time offset delays itself, so a graph edit that changes the delays does not widen it: use the Time offset control for that.
- **Saved projects.** A Time Stack stored without Decay (a project or effect preset from before Decay existed) renders with Decay 1, as it always looked, and saving writes that 1; its blend mode stays. Untouched saved graphs gain the Decay nodes; graphs edited before Decay existed stay as saved, the card notes that Decay has no effect there, and a preset sets only Instances, Time offset and Blend mode on them. The presets are not stored in projects, so saved Time Stacks keep their look.
- **More:** [Temporal frame access](../../architecture/Temporal-Frame-Access.md) · [Effect system](../Effect-System.md) · [Node Catalog](../Node-Catalog.md) · [Styles and presets](../Effects.md#styles-and-presets).
