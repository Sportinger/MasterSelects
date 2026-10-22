# Flocking

A swarm of birds, fish or sparks that moves by itself in 3D, with real depth, above the clip. The clip stays visible underneath, so put it on a black clip for the swarm alone.

Group: [3D & Particles](../Effects-3D-Particles.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-clip docs-shot--float-left">
<video src="../assets/effects/clips/flocking.mp4" poster="../assets/effects/clips/flocking.webp" width="960" height="540" autoplay muted loop playsinline preload="none" aria-label="Flocking on black at its default settings: a cloud of fine pale blue points flies as one swarm, folds, splits into two lobes and gathers again in the middle of the frame"></video>
<figcaption>Flocking at its default settings (Free Swarm), on black.</figcaption>
</figure>

**Use it for:** birds, fish or insects around a performer · dust and sparks in a stage space · data sculptures and abstract swarms.

- **Preset** – the kind of swarm: points, krill, a school on a path, a network.
- **Population** – how many there are.
- **Cohesion**, **Separation** and **Alignment** – how they flock: together, apart, in step.
- **Speed** – how fast the whole swarm moves.

**Tip:** the swarm starts with the clip as a round ball that unfolds over the first two seconds. To have it formed on the first frame, set **Warm-up** to 3 s.

## Presets

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/flocking-presets.mp4" poster="../assets/effects/clips/flocking-presets.webp" width="960" height="450" autoplay muted loop playsinline preload="none" aria-label="Five Flocking swarms on black in a grid of three and two, in sync: Free Swarm, a cloud of pale blue points; Krill Cloud, orange krill swimming in clusters; Follow Path, a school tracing a figure eight with fine trails; Technical Network, points joined by blue lines in a flat band; Violet Filaments, a violet cloud with curved filaments and small wire cubes"></video>
<figcaption>The five presets on black, in sync.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card. A preset builds a whole swarm, so it replaces the swarm and every value in the card in one undo step; when you have keyframed values of the swarm, the card asks first, because those keyframes go with it. Each preset brings its own controls: Krill Cloud adds Line Density, Follow Path a Path Strength.

**Free Swarm** – fine pale blue points that flock together, fold, split and gather again, like starlings at dusk or dust in a beam of light. Where they crowd they glow brighter but stay blue. A quiet, living haze around a figure; the default.

**Krill Cloud** – thousands of small orange krill that swim in step and gather in drifting clusters, joined by faint lines. Warm and organic: under water, a shoal, a crowd.

**Follow Path** – a school that swims a figure eight and draws its path as fine trails. A loop that never ends, for a cycle, a ritual or a waiting scene.

**Technical Network** – points joined to their neighbours by blue lines, with small square markers, drifting in a flat band held by an invisible box. A data sculpture for surveillance, networks and digital space.

**Violet Filaments** – a violet cloud in clusters that fills about half the frame, with long curved filaments and small wire cubes at their tips, brightest where the points crowd. Rich and slow, for a large projection surface.

Under **More swarms** the menu offers four larger scenes, made for a big frame or a camera move rather than for the default picture: **Vortex** (a swirling shell of points), **Shrimp Pullback** (one large shrimp inside a huge swarm, made for a camera move) and two sculptures, Terracotta and Lilac, which are not swarms but a sheet of colour settling in folds inside a lit box.

## Controls

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![The Flocking card in Properties, Effects, with the default swarm: Preset menu showing Free Swarm and a sentence about it, Open Nodes, then a Population row (a slider and 4000), the sections Behavior (Cohesion, Separation, Alignment, Speed 1.00, Turbulence 18 with sliders), Appearance (Size and a pale blue Color), the folded More controls, Time & Quality (Step rate 60 Hz, Warm-up 0 s, Loop Continuous) and the folded Simulation status](../assets/effects/editor/flocking-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 1026" aria-hidden="true" focusable="false">
<defs><marker id="flocking-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M137 112 L221 112" marker-end="url(#flocking-inspector-arrow)" />
<circle class="docs-shot-number" cx="137" cy="112" r="18" /><text x="137" y="112" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M111 367 L195 367" marker-end="url(#flocking-inspector-arrow)" />
<circle class="docs-shot-number" cx="111" cy="367" r="18" /><text x="111" y="367" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M98 523 L182 523" marker-end="url(#flocking-inspector-arrow)" />
<circle class="docs-shot-number" cx="98" cy="523" r="18" /><text x="98" y="523" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M152 631 L236 631" marker-end="url(#flocking-inspector-arrow)" />
<circle class="docs-shot-number" cx="152" cy="631" r="18" /><text x="152" y="631" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M114 871 L198 871" marker-end="url(#flocking-inspector-arrow)" />
<circle class="docs-shot-number" cx="114" cy="871" r="18" /><text x="114" y="871" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>Flocking with its default swarm. 1 — Preset: pick a swarm. 2 — Cohesion. 3 — Turbulence. 4 — Size. 5 — Warm-up: the swarm formed on the first frame.</figcaption>
</figure>

The **Preset** row sets up a whole swarm, see above. It names the preset the swarm was built from, also after you changed values in the card or the Nodes tab; **Own graph** means the swarm came from elsewhere. Below the row, one sentence says what the preset is.

The rows below are those of the default swarm, Free Swarm. Other presets show other rows, each with its own range, and **Add** puts any value of the swarm into the card.

### Population

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/flocking-population.mp4" poster="../assets/effects/clips/flocking-population.webp" width="640" height="480" autoplay muted loop playsinline preload="none" aria-label="The Free Swarm with three populations, two seconds each: 500 sparse points, the default 4000, and 20000 points that read as a dense, glowing cloud; the number is shown at the bottom left"></video>
<figcaption>Population 500, 4000 and 20000, two seconds each.</figcaption>
</figure>

**Population** – how many particles fly. 500 gives a sparse flight of single points, 4000 a light haze, 20 000 a dense, glowing cloud; more costs more graphics power. Its slider runs from 100 to 100 000 on a logarithmic scale, so small and large swarms are both in reach; type a number for more. A new value restarts the swarm from the start of the clip, so it cannot be keyframed and a drag applies when you let go: to let a swarm thin out or grow, add the Emitter's **Active Fraction** with **Add** and keyframe that. 1 to 4 194 304, default 4000.

<div class="docs-float-end"></div>

### Behavior

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/flocking-cohesion.mp4" poster="../assets/effects/clips/flocking-cohesion.webp" width="840" height="268" autoplay muted loop playsinline preload="none" aria-label="The Free Swarm at three Cohesion values side by side, in sync, each fixed from the clip start: at 0 the points spread into a wide, even haze; at the default 1 they hold together as one cloud; at 10 they pull into a tight, dense core with a few loose arms"></video>
<figcaption>Cohesion 0, 1 (default) and 10, side by side.</figcaption>
</figure>

**Cohesion** – how strongly each particle steers towards the middle of its neighbours. From 0 to the default 1 the swarm stays one loose, hazy cloud; at 10 it pulls into a tight, bright core and splits off clumps that drift apart. It works against **Separation**. 0 to 10, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/flocking-separation.mp4" poster="../assets/effects/clips/flocking-separation.webp" width="840" height="268" autoplay muted loop playsinline preload="none" aria-label="The Free Swarm at three Separation values side by side, in sync, each fixed from the clip start: at 0 the points pack into bright knots; at the default 1.6 they are evenly spaced; at 10 they spread into a wide, airy cloud"></video>
<figcaption>Separation 0, 1.6 (default) and 10, side by side.</figcaption>
</figure>

**Separation** – how strongly each particle keeps its distance from its nearest neighbours. At 0 they pack into thin, bright sheets and knots; 1.6 spaces them evenly; 10 spreads them into a wide, airy cloud that fills the whole space. 0 to 10, default 1.6.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/flocking-alignment.mp4" poster="../assets/effects/clips/flocking-alignment.webp" width="840" height="268" autoplay muted loop playsinline preload="none" aria-label="The Free Swarm at three Alignment values side by side, in sync, each fixed from the clip start: at 0 the points buzz in place as a round cloud; at the default 1.2 the cloud turns and drifts; at 10 the points stream together in long, parallel bands"></video>
<figcaption>Alignment 0, 1.2 (default) and 10, side by side.</figcaption>
</figure>

**Alignment** – how strongly each particle flies the way its neighbours fly. At 0 every point keeps its own course and the swarm spreads into an even haze; 1.2 lets it turn together as one cloud; 10 draws it into one compact body with a trailing tail, like a school of fish. 0 to 10, default 1.2.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/flocking-speed.mp4" poster="../assets/effects/clips/flocking-speed.webp" width="840" height="268" autoplay muted loop playsinline preload="none" aria-label="The Free Swarm at three speeds side by side, in sync, each fixed from the clip start: at 0.3 the swarm is still a round ball that unfolds only slowly; at the default 1 it folds and drifts calmly; at 3 it has long gathered into a dense cloud that keeps turning and throwing out tails"></video>
<figcaption>Speed 0.3, 1 (default) and 3, side by side.</figcaption>
</figure>

**Speed** – how fast the whole swarm moves, as a multiple of the preset's own pace. Every particle flies, steers and turns that many times faster, so the swarm keeps its shape and character and only its tempo changes: at 0.3 the swarm stays a round ball that unfolds only slowly, 1 is the calm flight of the preset, and at 3 it gathers early into a dense cloud that keeps turning and throwing out tails. At 0 it stands still. Above 4 the steps get too large to stay smooth, so the card stops there and a tool that asks for more is refused with that reason. Keyframes ease the tempo up or down without a jump. 0 to 4, default 1.

<div class="docs-float-end"></div>

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/flocking-turbulence.mp4" poster="../assets/effects/clips/flocking-turbulence.webp" width="840" height="268" autoplay muted loop playsinline preload="none" aria-label="The Free Swarm at three Turbulence values side by side, in sync, each fixed from the clip start: at 0 the cloud moves smoothly; at the default 18 it swirls; at 80 it is torn into eddies and stringy arms"></video>
<figcaption>Turbulence 0, 18 (default) and 80, side by side.</figcaption>
</figure>

**Turbulence** – how hard a slowly changing current pushes the swarm around. At 0 only the flocking rules act and the swarm stays a calm, round ball; 18 makes it swirl and fold; 80 tears it into eddies and long, stringy arms. 0 and up, default 18.

<div class="docs-float-end"></div>

### Appearance

<figure class="docs-shot docs-clip docs-shot--float-right">
<video src="../assets/effects/clips/flocking-size.mp4" poster="../assets/effects/clips/flocking-size.webp" width="640" height="480" autoplay muted loop playsinline preload="none" aria-label="The Free Swarm while Size runs from 2 to 16 px and back: the fine dust grows into large soft dots and shrinks again; the value is shown at the bottom left"></video>
<figcaption>Size from 2 to 16 px and back.</figcaption>
</figure>

**Size** – how large each point is drawn, in pixels on the screen: a point keeps its size near and far. 2 gives fine dust, 6 soft specks, 16 and more large dots that blend into a glow. 0 to 200 px, default 6 px.

<div class="docs-float-end"></div>

**Color** – the colour of the points. The points add up where they crowd, so a saturated colour keeps its hue in the dense core while a very pale one turns white there; you can keyframe it to let the swarm change colour on a cue, and a warm colour reads well under stage light. Type a hex value into the field beside the swatch; the reset arrow returns to the preset's colour: a colour, default `#b4e2ff`.

### More controls

**Add** – lists every value of the swarm's node setup, node by node; pick one and it becomes a row in the card, in a section named after its node. A row added this way has a ×, which takes it out of the card again and leaves its value as it is; the preset's own rows have none: any value of the swarm graph, default none.

### Time & Quality

**Step rate** – how often per second the swarm is calculated. 60 Hz is smooth for most swarms; 30 Hz halves the work for a very large one; 120 Hz keeps fast swarms clean in slow motion. A new value restarts the swarm from the start of the clip. 30, 60 or 120 Hz, default 60 Hz.

**Warm-up** – seconds the swarm flies before the clip begins, so it is already formed on the first frame instead of unfolding from a ball. 2 to 3 s is enough for the presets; the preview takes that much longer to prepare. 0 to 30 s, default 0 s.

**Loop** – **Continuous** lets the swarm fly on for the whole clip. **Reset each loop** starts it again from the beginning every **Loop length** seconds (10 s unless you change it), so each round of a looping projection looks the same. Continuous, Reset each loop, default Continuous.

The folded **Simulation status** section shows how much memory the swarm needs and how far it is calculated, and has **Precompute**: it calculates a part of the clip ahead, so playback runs smoothly from the first frame.

## Node setup

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

![The Flocking swarm opened in the Nodes tab: inside the green Flocking group, Turbulence and Flock Rules feed Compose Behavior; Emitter, Compose Behavior and Boundary feed Simulation, which feeds Points and Scene Output; the clip's Source on the left and its Target on the right](../assets/effects/graphs/flocking.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 385" aria-hidden="true" focusable="false">
<defs><marker id="flocking-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M482 316 L420 224" marker-end="url(#flocking-arrow)" />
<circle class="docs-shot-number" cx="482" cy="316" r="18" /><text x="482" y="316" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M228 317 L228 274" marker-end="url(#flocking-arrow)" />
<circle class="docs-shot-number" cx="228" cy="317" r="18" /><text x="228" y="317" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M262 22 L262 50" marker-end="url(#flocking-arrow)" />
<circle class="docs-shot-number" cx="262" cy="22" r="18" /><text x="262" y="22" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M509 54 L509 138" marker-end="url(#flocking-arrow)" />
<circle class="docs-shot-number" cx="509" cy="54" r="18" /><text x="509" y="54" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M649 62 L649 146" marker-end="url(#flocking-arrow)" />
<circle class="docs-shot-number" cx="649" cy="62" r="18" /><text x="649" y="62" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>The Free Swarm in the Nodes tab (Open Nodes, then Expand all). 1 — Emitter: places the particles. 2 — Turbulence: a moving current. 3 — Flock Rules: cohesion, separation, alignment. 4 — Simulation: moves every particle, step by step. 5 — Points: draws them.</figcaption>
</figure>

The swarm is a node setup of its own: **Open Nodes** in the card shows it in the Nodes tab, as the green Flock group of the clip. Its nodes work on particles, not on pixels: the Emitter places them, Flock Rules and Turbulence steer them, the Boundary keeps them in a sphere, the Simulation moves them step by step and Points draws them. The values in the card are values of these nodes.

**Emitter** – places the particles when the clip starts: 4000 of them, at random in a ball. Its **Count** is the card's Population; it can also fill a box, a disc, a line or a grid, let particles be born in bursts and die after a lifetime.

**Turbulence** – a slowly changing current that pushes every particle; its **Strength** is the card's Turbulence. Without it a swarm settles into calm, even motion.

**Flock Rules** – the three classic rules of a flock: steer towards the neighbours (**Cohesion**), keep a distance from them (**Separation**) and fly their way (**Alignment**). Each particle looks only at neighbours within 12 units, except right behind it. **Compose Behavior** adds these forces to Turbulence, and the **Boundary** pushes particles back into a sphere, so the swarm stays in the picture.

**Simulation** – moves every particle one small step at a time, 60 times per second, never faster than its **Max Speed**; its **Pace** (the card's Speed) makes each step carry the swarm further or less far. It runs on the graphics card and keeps checkpoints, so jumping back in the timeline is quick.

**Points** – draws every particle as a soft dot that adds light, in the card's Size and Color. Other draw nodes give the presets their looks: Instances (krill, fish, arrows), Neighbor Links, Trails and Curves, Endpoint Glyphs.

**Remix:** select **Points** in the Nodes tab and set its **Sprite Motion Blur** to 0.05 s: every point draws a short streak along its flight, and the swarm turns into fast strokes.

## Technical details

- **3D.** The swarm is drawn into the shared 3D scene, with depth against other 3D layers, and moves with the clip's transform. The clip's own picture stays underneath unchanged. One swarm per clip: adding Flocking again selects the existing one.
- **Time.** The swarm is simulated from the start of the clip in fixed steps, so scrubbing, playback and export show the same swarm at the same moment. Keyframes of swarm values count in the swarm's own time and survive splits, trims and speed changes. Population, Step rate and Warm-up restart the simulation and cannot be keyframed.
- **First frames.** After adding the effect or changing a structural value, the preview shows "Preparing simulation" while it calculates up to the playhead.
- **Saved projects.** A clip stores its whole swarm. Changed presets only affect swarms built from them afterwards; a saved swarm keeps its look. Swarms made before Speed became the simulation's Pace show the Simulation's Max Speed as their Speed row, which only caps the fastest particles.
- **Reset.** The reset arrow of a row returns it to the value of the swarm's preset (Free Swarm's Turbulence 18, Technical Network's Population 1800), not to the node's general default.
- **Removing** the effect deletes the swarm and its keyframes; switching it off only hides the swarm.
- **More:** [Flock Clips](../Flock-Clips.md) (node catalogue, simulation, rendering, AI tools) · [Node Workspace](../Node-Workspace.md) · [Effect system](../Effect-System.md).
