# Block Cloud

Solid colour blocks on a grid that gather in drifting clouds and clear away as **Progress** falls. Blocks come in three sizes (half cells, cells and 2 × 2 cells), their edges jitter and flicker, and each takes a colour from a small palette. Progress 0 shows the picture unchanged, so keying Progress from 1 to 0 dissolves a block cloud into the shot.

Group: [Analog & Glitch](../Effects-Analog.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot docs-compare">

![The rainy night street with neon signs: the original on the left; on the right Block Cloud at its default settings, with drifting clouds of pink, cyan and green square blocks in three sizes covering about half of the street, their edges breaking up into single blocks](../assets/effects/block-cloud.webp)

<figcaption>Left: the original. Right: Block Cloud at its default settings (Progress 0.7).</figcaption>
</figure>

**Use it for:** a brand-coloured pixel overlay that reveals a pack shot · glitch transitions on a design grid · title backgrounds.

**Animate it:** key **Progress** from 1 to 0. Thin Out lets the big blocks go first, then the cells, then the half cells. For a hesitant start raise **Hold** (or pick **Hesitant**); for a wave, pick **Wave**.

**Tip:** set **Cell Size** and **Offset X/Y** to the grid of the artwork underneath, so the blocks sit exactly on its cells.

## Presets

<figure class="docs-shot docs-clip">
<video src="../assets/effects/clips/block-cloud-presets.mp4" poster="../assets/effects/clips/block-cloud-presets.webp" width="960" height="430" autoplay muted loop playsinline preload="none" aria-label="The dancing figure on the stage six times in a grid, moving in sync, each covered by drifting clouds of square blocks in three sizes: Brand Base with calm clouds in pink, cyan, green, white, dark grey and blush whose edges scatter into single blocks; Nervous with fast twitching edges and blocks that keep changing colour; Breathing with slow clouds that grow and shrink; Hesitant with dense clouds that hold; Clear with large solid patches of only pink, cyan and green; Wave with dense clouds that a ragged diagonal front will sweep away"></video>
<figcaption>The six presets on the moving dancer, in sync, at Progress 0.7.</figcaption>
</figure>

Pick one in the **Preset** row of the effect card; Progress stays as it is. The first five are the motion characters of the overlay prototype, in all six brand colours.

**Brand Base** – calm clouds that wander slowly; their edges flicker a little and scatter into single blocks.

**Nervous** – fast, thinner clouds with twitching edges and speckled colours that keep changing.

**Breathing** – slow, lighter clouds whose coverage swells and shrinks about once every 1.4 seconds.

**Hesitant** – the densest clouds, holding for the first 40 % of the way, then clearing quickly.

**Clear** – only the three accent colours in large, quiet patches with few scattered single blocks.

**Wave** – the clouds stay dense and a ragged front sweeps them away along the diagonal as Progress falls.

## Controls

### Clouds

**Progress** – how much of the cloud is left: 1 is the densest, 0 is the picture without blocks. 0 to 1, default 0.7.

**Coverage** – scales the share of the frame the blocks cover (each level covers at most 95 %). 0 to 2, default 1.

**Hold** – keeps the clouds whole for this share of the way from Progress 1 to 0; they then clear in the rest. 0 to 0.9, default 0.

**Clear By** – how the clouds go as Progress falls: Thin Out lets each block size thin away, big blocks first; Wave Front keeps the clouds dense and sweeps them away behind a front. Thin Out, Wave Front, default Thin Out.

**Front Angle** – the direction the Wave Front travels in: 0° left to right, 90° top to bottom. −180 to 180°, default −35°.

**Front Roughness** – how ragged the Wave Front's edge is: 0 is a straight line, higher values let blocks lag behind or run ahead. 0 to 1, default 0.18.

**Cloud Size** – how big one cloud is, in cells: small values give many small clumps, large ones a few big clouds. 1 to 120 cells, default 30 cells.

### Grid

**Cell Size** – the size of one grid cell; the blocks are half a cell, one cell and 2 × 2 cells big. 4 to 120 px, default 18 px.

**Offset X** – moves the grid sideways, to line it up with a grid in the picture. −60 to 60 px, default 0 px.

**Offset Y** – moves the grid up or down. −60 to 60 px, default 0 px.

### Motion

**Drift** – how fast the clouds wander and change shape; 0 holds them still. 0 to 5 /s, default 1 /s.

**Jitter** – a fixed random share per block: higher values break the cloud edges into scattered single blocks. 0 to 1, default 0.35.

**Flicker** – how strongly blocks at the cloud edges switch on and off over time. 0 to 0.5, default 0.06.

**Flicker Rate** – how fast they flicker; each block has its own pace around this rate. 0 to 10 /s, default 1.3 /s.

**Recolour** – the share of blocks that briefly take another palette colour; it fades out as Progress falls. 0 to 0.5, default 0.04.

**Pulse** – lets the coverage breathe: 0 holds it steady, 1 swings it between nothing and full. 0 to 1, default 0.

**Pulse Rate** – breaths per second. 0 to 5 /s, default 0.7 /s.

### Colour

**Colour Scatter** – how much each block picks its own colour: 0 keeps whole patches in one colour, 1 mixes neighbouring blocks freely. 0 to 1, default 0.5.

**Colour Count** – how many of the six colours are used, from Colour 1 on; neighbouring blocks share colours in large patches. 1 to 6, default 3.

**Colour 1** – the first palette colour. a colour, default `#ef489d`.

**Colour 2** – the second palette colour. a colour, default `#80e9eb`.

**Colour 3** – the third palette colour. a colour, default `#a8e783`.

**Colour 4** – the fourth palette colour, used from Colour Count 4. a colour, default `#ffffff`.

**Colour 5** – the fifth palette colour. a colour, default `#313131`.

**Colour 6** – the sixth palette colour. a colour, default `#ffcdcd`.

### Mix

**Clip To** – Layer keeps the blocks inside the layer (a cut-out stays cut out); Whole Frame draws them over transparent areas too. Layer, Whole Frame, default Layer.

**Seed** – another cloud pattern and other block colours. 0 to 9999, default 0.

**Amount** – the blocks' opacity. 0 to 1, default 1.

## Node setup

The effect is built from shared nodes; open it in the Nodes tab ([The node setup](../Effects.md#the-node-setup)). For each of the three block sizes, the block's centre reads two drifting **Fractal Noise** layers, adds a seeded **Random (Integer Hash)** jitter and a **Sine** flicker, and a logistic rank of that value (**Exponential**, **Greater Than**) switches the block on, so each size covers a known share of the frame. A slower colour cloud picks the palette colour; **Mix** draws the sizes over each other, big blocks first.

**Remix:** replace the cloud value with the picture's brightness to let the blocks gather on the light parts of the shot.

## The full stack

Effect presets hold one effect each, so the textur look in full is three effects on one clip, in this order: **Flow Mosh** with the **Flow** preset (or the calmer **Stream**), then **Pixel Sort Bands** with **Fine + Wide**, then **Block Cloud** with **Brand Base** on top. Key **Progress** of all three from 1 to 0 over the same span, and the picture flows, unsorts and clears into the original together. Each effect is skipped at Progress 0, so the last frame is the original exactly.

## Technical details

- **Units.** Cell Size and Offset X/Y are pixels of a 1080p frame and scale with the frame; Cloud Size is in cells.
- **Coverage.** The share of blocks is set without a whole-frame pass: the cloud value has a known spread, so a normal-distribution rank gives each size about its share (0.22, 0.42 and 0.30 of the frame at Progress 1). One frame can hold more or less when a single big cloud fills it.
- **Motion.** The clouds follow the playhead and hold still while paused; keyframed rates move smoothly.
- **Progress 0.** At Progress 0 (or Amount 0) the renderer skips the effect, so the picture is exactly the input.
- **Values.** Values outside the rendered range render clamped; the card and agent tool results say so.

Effect pipelines: [Effect system](../Effect-System.md#pipelines-and-runtimes). Nodes: [Node Catalog](../Node-Catalog.md).
