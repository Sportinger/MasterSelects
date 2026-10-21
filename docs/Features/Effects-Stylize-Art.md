# Painterly, Relief and Particle Effects

Five looks that turn the picture into something else: a watercolour painting, flowing
smoke, a sweep of light, a 3D relief of blocks or a cloud of dust.
Add one in **Properties → Effects → + Add Effect**: Acuarela, Rom1 and Sheen are under
**Light & Stylize**, Voxel Relief and Pixel Particle Disintegrate under **3D & Particles**.

## The five painterly, relief and particle effects

### Acuarela
<figure class="docs-shot docs-shot--float-right">

![The houses and boats of the harbour twice: on the left the photo; on the right the same scene as a watercolour, with flat washes of colour, darker paint along the edges of roofs and walls and a grainy paper texture in the sky](assets/effects/acuarela.webp)

<figcaption>Left: original. Right: Acuarela at its default settings.</figcaption>
</figure>

Paints the picture as a watercolour: flat washes of colour, darker paint where the
washes meet, a little wet bleeding and the grain of the paper. It keeps shapes readable,
so it works on moving footage as well as on stills.
- **Wash** – how much the colour flattens into washes, in pixels: 1–2 keeps detail, 6 and more is loose and soft.
- **Bleed** – how far wet paint wobbles and runs across edges, in pixels.
- **Edges** and **Blooms** – the darker paint along every edge, and a few lighter stains with a dark rim.
- **Granulation**, **Paper** and **Lift** – grainy pigment, the paper's relief, and white paper showing through.

Tip: set **Flow** to 0.1–0.3 and the wet areas drift slowly, as if the paint were still wet.

### Rom1
<figure class="docs-shot docs-shot--float-left">

![The night street twice: on the left the photo; on the right the neon signs and shop lights after three seconds of Rom1, smeared into flowing, liquid trails of colour while the walker in the middle stays visible](assets/effects/rom1.webp)

<figcaption>Left: original. Right: Rom1 at its default settings, after 3 seconds.</figcaption>
</figure>

Watery smoke: bright parts of the picture smear along slowly drifting currents and leave
trails that build up over time and fade. This was the original look of Acuarela.
- **Strength** – how far the picture smears.
- **Speed** – how fast the currents drift.
- **Gain** – brightens the trails.
- **History Loop** and **Reset** – whether the trails start fresh when playback loops, and a manual restart.

Tip: the trails build up while the clip plays; a single paused frame shows less.

<div class="docs-float-end"></div>

### Sheen
<figure class="docs-shot docs-shot--float-right">

![The dancer twice: on the left the photo; on the right a warm golden band of light crossing the picture diagonally, brightening her dress while the folds of the fabric stay visible](assets/effects/sheen.webp)

<figcaption>Left: original. Right: a warm Sheen (Angle −60°, Intensity 1.2).</figcaption>
</figure>

A band of light that sweeps across the layer, the classic shine over a logo or a title.
It stays inside the layer's shape, and the picture underneath stays visible in the light.
- **Position** – where the band is; keyframe it from 0 to 1 for the sweep.
- **Angle** – the direction of the band, in degrees.
- **Width** and **Softness** – how broad the band is and how soft its edges are.
- **Intensity** and **Color** – how bright it is and its tint.

Tip: on a title, a narrow, soft band (Width 0.08) sweeping in half a second reads as a glint.

### Voxel Relief
<figure class="docs-shot docs-shot--float-left">

![The dancer twice: on the left the photo; on the right the stage turned into a wall of small blocks seen from a slight angle, with the bright dancer standing out from it as a relief of taller blocks](assets/effects/voxel-relief.webp)

<figcaption>Left: original. Right: Voxel Relief seen from the side (Tilt 70°, Yaw −18°, Height 0.35).</figcaption>
</figure>

Builds the picture out of small blocks in 3D: bright parts rise, dark parts stay low.
Press **Orbit** on the effect card, then drag in the preview to look from another angle
and scroll to move closer.
- **Columns** – how many blocks across the picture.
- **Height** – how far bright parts rise.
- **Tilt**, **Yaw** and **Distance** – the camera, in degrees and distance.
- **Light Angle** – where the light comes from.

Tip: **Open Nodes** in the effect card shows the relief as nodes, where you can swap the block shape.

### Pixel Particle Disintegrate
<figure class="docs-shot docs-shot--float-right">

![The dancer twice: on the left the photo; on the right the picture breaking apart into small particles that blow away, with dark gaps where parts of the dress and the stage have already gone](assets/effects/pixel-particle-disintegrate.webp)

<figcaption>Left: original. Right: Progress 0.4; the dark gaps are already empty (transparent).</figcaption>
</figure>

The picture breaks into small particles that blow away, as the clip's exit. At Progress 0
the picture is untouched; at 1 it is gone.
- **Progress** – keyframe it from 0 to 1; the **Particle Out** button below + Add Effect sets this up at the end of the clip.
- **Cell Size** – the size of each particle, in pixels.
- **Stagger** and **Wind Sweep** – how unevenly and in which order the parts let go.
- **Fade** – how much each particle fades and shrinks while it flies.

Tip: change **Seed** for a different pattern with the same settings.

<div class="docs-float-end"></div>

**Saved projects:** Acuarela effects saved with the earlier smoke look keep it. Sheen bands
now keep the picture visible instead of turning flat white, and particles now start from
the exact picture.

**Known limitations:** Sheen measures Position across the whole layer, so on a small logo
in a large transparent layer the band crosses the logo during only part of the sweep.
Pixel Particle Disintegrate draws larger particles in the preview than in the export at
very large sizes such as 4K; the effect card says when.

<!-- docs agent: middle and technical levels go here -->
