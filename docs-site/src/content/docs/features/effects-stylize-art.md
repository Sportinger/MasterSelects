---
title: "Painterly, Relief and Particle Effects"
---

Five looks that turn the picture into something else: a watercolour painting, flowing
smoke, a sweep of light, a 3D relief of blocks or a cloud of dust.
Add one in **Properties → Effects → + Add Effect**: Acuarela, Rom1 and Sheen are under
**Light & Stylize**, Voxel Relief and Pixel Particle Disintegrate under **3D & Particles**.

## The five painterly, relief and particle effects

### Acuarela
<figure class="docs-shot docs-shot--float-right">

<a class="docs-shot-zoom" href="/docs/assets/effects/acuarela.webp" title="Open the full-size picture"><img src="/docs/assets/effects/acuarela.webp" alt="The hillside houses of the harbour twice, close up: on the left the photo; on the right the same houses as a watercolour, with flat washes of colour, a soft band of darker paint pooled along the edges of houses, roofs and trees, simpler windows and a grainy paper texture" width="1600" height="498" decoding="async"></a>

<figcaption>Left: original. Right: Acuarela at its default settings (a close-up of a 1080p frame).</figcaption>
</figure>

Paints the picture as a watercolour: flat washes of colour, darker paint where the
washes meet, a little wet bleeding and the grain of the paper. It keeps shapes readable,
so it works on moving footage as well as on stills.
- **Wash** – how much the colour flattens into washes, in pixels: 1–2 keeps detail, 6 and more is loose and soft.
- **Bleed** – how far wet paint wobbles and runs across edges, in pixels.
- **Edges** and **Blooms** – the darker paint along every edge, and a few lighter stains with a dark rim.
- **Simplify** and **Shadow Pigment** – fewer, flatter tones, and how far black lifts to a dark indigo paint.
- **Granulation**, **Paper** and **Lift** – grainy pigment, the paper's relief (both mostly in mid-tone washes, less on dark paint and near-white), and white paper showing through.

Tip: set **Flow** to 0.1–0.3 and the wet areas drift slowly, as if the paint were still wet.

### Rom1
<figure class="docs-shot docs-shot--float-left">

<a class="docs-shot-zoom" href="/docs/assets/effects/rom1.webp" title="Open the full-size picture"><img src="/docs/assets/effects/rom1.webp" alt="The night street twice: on the left the photo; on the right the neon signs and shop lights after three seconds of Rom1, smeared into streaky, slab-like smudges of colour with hard vertical seams, while the walker in the middle stays visible" width="1600" height="448" loading="lazy" decoding="async"></a>

<figcaption>Left: original. Right: Rom1 at its default settings, after 3 seconds.</figcaption>
</figure>

Watery smoke: bright parts of the picture smear along slowly drifting currents and leave
trails that build up over time and fade. This was the original look of Acuarela.
- **Strength** – how far the picture smears.
- **Speed** – how fast the currents drift.
- **Gain** – brightens the trails; above 0.25 it eases off, so high values wash the picture out but never turn it white.
- **History Loop** and **Reset** – whether the trails start fresh when playback loops, and a manual restart.

Tip: the trails build up while the clip plays; a single paused frame shows less.

<div class="docs-float-end"></div>

### Sheen
<figure class="docs-shot docs-shot--float-right">

<a class="docs-shot-zoom" href="/docs/assets/effects/sheen.webp" title="Open the full-size picture"><img src="/docs/assets/effects/sheen.webp" alt="The dancer twice: on the left the photo; on the right a warm golden beam of light crossing the picture diagonally, brightest along its middle and fading toward its edges, strongest on her light dress while the folds of the fabric stay visible" width="1600" height="448" loading="lazy" decoding="async"></a>

<figcaption>Left: original. Right: a warm Sheen (Color #ffcc66, Angle −60°, Width 0.16, Intensity 1.2).</figcaption>
</figure>

A band of light that sweeps across the layer, the classic shine over a logo or a title.
It stays inside the layer's shape, and the picture underneath stays visible in the light.
- **Position** – where the band is; keyframe it from 0 to 1 for the sweep.
- **Angle** – the direction of the band, in degrees.
- **Width** and **Softness** – how far the light reaches from the middle of the band, and how gently it fades (1 fades all the way, 0 is a hard-edged band).
- **Intensity** and **Color** – how bright it is and its tint.
- **Highlights** – how much more the light catches bright parts than dark ones.

Tip: on a title, a narrow, soft band (Width 0.08) sweeping in half a second reads as a glint.

### Voxel Relief
<figure class="docs-shot docs-shot--float-left">

<a class="docs-shot-zoom" href="/docs/assets/effects/voxel-relief.webp" title="Open the full-size picture"><img src="/docs/assets/effects/voxel-relief.webp" alt="The dancer twice: on the left the photo; on the right the stage turned into a wall of small blocks seen from a slight angle, with the bright dancer standing out from it as a relief of taller blocks" width="1600" height="448" loading="lazy" decoding="async"></a>

<figcaption>Left: original. Right: Voxel Relief seen from the side (Tilt 70°, Yaw −18°, Distance 1.05, Columns 120, Height 0.35, Height Contrast 2). The defaults (Height 1.2, Height Contrast 3) look almost straight on and make bright parts rise much taller; from the side they become long pillars.</figcaption>
</figure>

Builds the picture out of small blocks in 3D: bright parts rise, dark parts stay low.
Press **Orbit** on the effect card, then drag in the preview to look from another angle
and scroll to move closer.
- **Columns** – how many blocks across the picture.
- **Height** – how far bright parts rise.
- **Tilt** and **Yaw** (degrees) and **Distance** – where the camera looks from.
- **Light Angle** – where the light comes from.

Tip: **Open Nodes** in the effect card shows the relief as nodes, where you can swap the block shape.

### Pixel Particle Disintegrate
<figure class="docs-shot docs-shot--float-right">

<a class="docs-shot-zoom" href="/docs/assets/effects/pixel-particle-disintegrate.webp" title="Open the full-size picture"><img src="/docs/assets/effects/pixel-particle-disintegrate.webp" alt="The dancer twice: on the left the photo; on the right the picture breaking apart into small particles that blow away in drifting, cloud-shaped patches; where the particles have already gone, a flat blue background shows through" width="1600" height="448" loading="lazy" decoding="async"></a>

<figcaption>Left: original. Right: Progress 0.4 over a flat blue background, which shows where the picture is already empty (transparent).</figcaption>
</figure>

The picture breaks into small particles that blow away, as the clip's exit. At Progress 0
the picture is untouched; at 1 it is gone.
- **Progress** – keyframe it from 0 to 1; the picture thins out at an even rate. The **Particle Out** button below + Add Effect sets this up at the end of the clip.
- **Cell Size** – the size of each particle, in pixels of a 1080p frame (it scales with the frame size).
- **Stagger** and **Wind Sweep** – how unevenly and in which order the parts let go.
- **Fade** – how much each particle fades and shrinks while it flies.

Tip: change **Seed** for a different pattern with the same settings.

<div class="docs-float-end"></div>

**Known limitations:** Sheen measures Position across the whole layer, so on a small logo
in a large transparent layer the band crosses the logo during only part of the sweep.
With a very small Cell Size, Pixel Particle Disintegrate can draw larger particles in the
preview than in the export to stay within its particle budget; the effect card says when.

## How the painterly, relief and particle effects are built

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

<a class="docs-shot-zoom" href="/docs/assets/effects/editor/acuarela-inspector.webp" title="Open the full-size picture"><img src="/docs/assets/effects/editor/acuarela-inspector.webp" alt="The Acuarela effect card in Properties → Effects, with its Paint, Paper and Motion sections, beside a strip of the preview of the harbour painted as a watercolour" width="1210" height="1116" loading="lazy" decoding="async"></a>

<svg class="docs-shot-overlay" viewBox="0 0 1017 938" aria-hidden="true" focusable="false">
<defs><marker id="acuarela-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M456 250 L540 250" marker-end="url(#acuarela-inspector-arrow)" />
<circle class="docs-shot-number" cx="456" cy="250" r="18" /><text x="456" y="250" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M379 294 L539 294" marker-end="url(#acuarela-inspector-arrow)" />
<circle class="docs-shot-number" cx="379" cy="294" r="18" /><text x="379" y="294" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M449 338 L533 338" marker-end="url(#acuarela-inspector-arrow)" />
<circle class="docs-shot-number" cx="449" cy="338" r="18" /><text x="449" y="338" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>1 — Wash, how flat the colour washes are. 2 — Bleed, how far wet paint runs. 3 — Edges, the darker paint along every edge. The ◇ keyframes a control, ↺ resets it.</figcaption>
</figure>

Every control lives in the effect card. Acuarela sorts its controls into **Paint**,
**Paper** and **Motion** sections that fold away; the preview updates while you drag.

### Four different builds

These five effects do not share one recipe; each is built the way its look needs:

- **Acuarela** and **Rom1** are pixel recipes: every pixel of the result is worked out
  from reads of the picture.
- **Voxel Relief** is a small 3D scene: blocks on a grid, a camera and a light.
- **Pixel Particle Disintegrate** is a particle chain: the picture becomes particles,
  and forces move them.
- **Sheen** is one fixed shader without a graph.

To open a graph, use the **Nodes** tab, pick the clip as its source and open the folded
effect card with the › left of its title (shown on the [Blur page](/docs/features/effects-blur/#how-the-blur-effects-are-built)).
Voxel Relief also has **Open Nodes** in its effect card. Changes apply to this one effect.

### Acuarela: a watercolour in stages

<figure class="docs-shot docs-shot--graph">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/acuarela.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/acuarela.webp" alt="Acuarela opened in the Node Workspace, first half: Input Frame feeds Premultiplied Source; Premultiplied Source and Wet Patches &amp; Bleed feed Pigment Wash; Pigment Wash feeds its First Wash into Second Wash &amp; Wet Bleeding, which also reads the Wet Patches; the second wash's Pigment Wash feeds Edge Pooling" width="1344" height="924" loading="lazy" decoding="async"></a>

<figcaption>Acuarela, first half: from the frame to the two washes and Edge Pooling.</figcaption>
</figure>

The picture is painted in the order a painter would work. **Wet Patches & Bleed** decides
where the paint is still wet and how far each spot wobbles. **Pigment Wash** flattens the
colour inside shapes but stops at their borders, and **Second Wash & Wet Bleeding** goes
over the first wash once more: that makes the washes flatter, and in wet patches it lets
colour run across the borders. **Edge Pooling** finds the darker side of every border.

<figure class="docs-shot docs-shot--graph">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/acuarela-paint.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/acuarela-paint.webp" alt="Acuarela opened in the Node Workspace, second half: the second wash feeds Edge Pooling; Edge Pooling feeds Paper &amp; Granulation, Blooms, Simplify, Pigment Density and Paper Light, Lift &amp; Mix; Simplify, Blooms and Paper &amp; Granulation feed Pigment Density; Pigment Density feeds Shadow Pigment; Shadow Pigment and Paper &amp; Granulation feed Paper Light, Lift &amp; Mix" width="1506" height="1494" loading="lazy" decoding="async"></a>

<figcaption>Acuarela, second half: from Edge Pooling to the finished paint.</figcaption>
</figure>

**Simplify** groups the wash into a few tones, like layered glazes. **Paper & Granulation**
makes the paper's grain and **Blooms** the few stains. **Pigment Density** turns all of that
into more or less paint, **Shadow Pigment** lifts black (also in the pooled edges) to a dark
indigo paint, and **Paper Light, Lift & Mix** adds the paper's relief and blends with the original.

### Acuarela: more or less pigment

<figure class="docs-shot docs-shot--graph">

<div class="docs-shot-stage">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/acuarela-pigment-density.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/acuarela-pigment-density.webp" alt="Inside Pigment Density: Edge Pooling and Granulation are added, Blooms is added to that in a second Add, which outputs the Pigment Excess; the eased More Pigment and Less Pigment are added into the Eased Excess; a Multiply joins C − C² and the Eased Excess, and the last Subtract takes it from Colour C and outputs the Painted Colour" width="1346" height="1436" loading="lazy" decoding="async"></a>

<svg class="docs-shot-overlay" viewBox="0 0 1017 1085" aria-hidden="true" focusable="false">
<defs><marker id="acuarela-pigment-density-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M813 218 L729 218" marker-end="url(#acuarela-pigment-density-arrow)" />
<circle class="docs-shot-number" cx="813" cy="218" r="18" /><text x="813" y="218" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M873 701 L873 617" marker-end="url(#acuarela-pigment-density-arrow)" />
<circle class="docs-shot-number" cx="873" cy="701" r="18" /><text x="873" y="701" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>The core of Pigment Density. 1 — the second Add, where Blooms joins the Pigment Excess. 2 — the last Subtract, the Painted Colour. The two easing branches (More and Less Pigment) and the colour inputs come from the rest of the folder.</figcaption>
</figure>

One formula from watercolour research does the painting: new colour = C − (C − C²) × e.
The first two **Add** cards sum the extra pigment: edge pooling + granulation + blooms
(Blooms joins at the second **Add**, 1). Before it is used, that sum eases: more pigment
can at most square a colour (C², a deeper tint of the same paint), less pigment can at most
brighten it to 2C − C², so no colour is pushed to black or past white. White paper and black
stay as they are. **Multiply** scales C − C² by the eased amount, and the last **Subtract** (2)
gives the painted colour.

Remix: drag the cable from **Blooms** off the second **Add** (1). The stains disappear while
the pooled edges and the grain stay; the difference shows most in flat areas such as the sky.
Plug it back in to restore them.

### Voxel Relief: blocks, camera, light

<figure class="docs-shot docs-shot--graph">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/voxel-relief.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/voxel-relief.webp" alt="Voxel Relief opened in the Node Workspace: Input Frame and UV Transform feed Image Texture; the texture feeds the folded Height field and the Surface Material; inside Column geometry, Height field, Primitive and Grid Points feed Instance on Points; Instance on Points and Surface Material feed Mesh Object; Mesh Object, Orbit Camera and Relief Light feed Relief Render" width="1506" height="1032" loading="lazy" decoding="async"></a>

<figcaption>Voxel Relief with Column geometry open; Height field stays folded.</figcaption>
</figure>

**Column geometry** builds the blocks: **Grid Points** places one point per column,
**Primitive** is the block, **Height field** turns brightness into height (Height Contrast,
Height and Base are its controls) and **Instance on Points** puts a block on every point.
**Mesh Object** dresses the blocks in the picture's colours (**Surface Material**), and
**Relief Render** films them with the **Orbit Camera** and the **Relief Light**.

Remix: select **Primitive** and switch its **Shape** from Box to Sphere or Cylinder: the
relief turns into beads or round pillars. The effect card shows the same Shape under Primitive.

### Pixel Particle Disintegrate: a particle chain

<figure class="docs-shot docs-shot--graph">

<a class="docs-shot-zoom" href="/docs/assets/effects/graphs/pixel-particle-disintegrate.webp" title="Open the full-size picture"><img src="/docs/assets/effects/graphs/pixel-particle-disintegrate.webp" alt="Pixel Particle Disintegrate opened in the Node Workspace: Input Frame feeds Image to Particles, then Particle Release, then Particle Motion and Particle Render; inside the Forces folder Curl Noise, Gravity, Scatter and Wind Gusts all feed the Forces input of Particle Motion" width="1506" height="890" loading="lazy" decoding="async"></a>

<figcaption>Pixel Particle Disintegrate with its Forces folder open.</figcaption>
</figure>

**Image to Particles** cuts the picture into one particle per cell, **Particle Release**
decides when each one lets go (Progress, Stagger, Wind Sweep), **Particle Motion** moves the
released ones and **Particle Render** draws them. The four forces add up: **Curl Noise**
swirls, **Gravity** pulls down, **Scatter** pushes apart and **Wind Gusts** blows along a
direction. The cards hold the same settings as the effect card; there is no per-pixel math here.

Remix: unplug **Gravity** from Particle Motion and the dust floats instead of sinking. An
unplugged or muted force adds nothing; plug it back in to restore it.

## Technical details

Notes for developers. Formulas and history are in [Effects](/docs/features/effects/), nodes in
[Node Catalog](/docs/features/node-catalog/), compilation in [Operator Graph Compiler](/docs/features/operator-graph-compiler/).

- **Acuarela passes.** Four passes: a premultiplied source cache, two edge-aware washes, and
  one pass for tones, eased Bousseau pigment density, paper and a premultiplied Mix. Recipe:
  `src/services/operators/acuarelaWatercolorGraph.ts`; kernels, sigmas and the wobble cap are in
  [Effects: glyph, cell and compute effects](/docs/features/effects/#glyph-cell-and-compute-effects).
- **Units and cost.** Wash and Bleed are pixels of a 1080p frame (its shorter side), so preview,
  export and 4K match; Grain Size is a scale factor of the paper grain (1 = standard). Flow is
  cycles per second. Acuarela takes about 3–4 ms per 1080p frame after a first frame of
  about 250–350 ms with the graph compile (desktop Vulkan).
- **Rom1 Gain.** The lift equals Gain up to 0.25, then eases toward 0.5, so the frame never
  turns white. Rom1 builds every frame on the previous result (History Loop and Reset control
  it); see [Effects: editable keying and feedback graphs](/docs/features/effects/#editable-keying-and-feedback-graphs).
- **Sheen light.** The band's light falls off from its middle as exp(−4.5 t^(2 / Softness)) (t = 0
  in the middle, 1 at Width; one pixel of anti-aliasing at the edge), is weighted by the colour's
  luminance through Highlights, and lifts each colour with a soft shoulder,
  1 − (1 − c) · exp(−light / (1 − c)), so it never clips to flat white. Position spans the whole layer.
- **Voxel Relief.** The 2D relief is raymarched (Ray Steps); as a 3D scene object it uses
  instancing. Block sides keep at least 55 % of the column colour. The default Distance 0.8
  fills the layer at the default Tilt. Values its shader clamps are named in the effect card
  and tool results; see [Effects: editable Voxel Relief nodes](/docs/features/effects/#editable-voxel-relief-nodes).
- **Particles.** One particle per Cell Size cell, up to the Preview (60,000) and Export (180,000)
  Particle Budget and the Hard Particle Limit (220,000); over budget the cells grow until the grid
  fits, and the effect card says so. The release pockets come from gradient Fractal Noise, and
  each cell's release time is its rank among all cells, spread evenly over Progress 0 to about
  0.84 at the defaults. See [Effects: particle render effects](/docs/features/effects/#particle-render-effects).
- **Saved projects.** Acuarela effects saved with the earlier smoke look keep it (their Gain is
  clamped to 0–1). Sheen saved before keeps its flat-topped band and even light, Voxel Relief its
  darker sides (and Distance 1 if it was saved before Distance existed), particles their
  output-pixel Cell Size and Fade 0; the effect card names the first and the last. Rom1 looks
  with Gain up to 0.25 stay the same; higher Gain now washes out instead of turning white. Saved
  particle effects release in new pockets and at an even rate (a deliberate fix of the
  straight-edged pockets and the burst around Progress 0.4).
- **Software preview.** The worker software preview runs Rom1 and the smoke-look Acuarela on the
  CPU; the watercolour Acuarela falls back to the main-thread GPU renderer.
