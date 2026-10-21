# Mirror, Split and Pixel Effects

Six ways to fold, flip, shift or rebuild the picture: kaleidoscope patterns,
mirror images, colour-fringe glitches and mosaics.
Add one in **Properties → Effects → + Add Effect**: Kaleidoscope, Mirror and
RGB Split are under **Lens & Distort**, Pixelate, Blockify and Block Mosaic
under **Pixel & Mosaic**.

Pictures with transparency (titles, logos, keyed footage) keep clean edges
without a dark rim.

## Six mirror, split and pixel effects

### Kaleidoscope
<figure class="docs-shot docs-shot--float-right">

![The dancer twice: on top the original; below, her figure folded into sixteen mirrored slices around the middle, a symmetric flower on the dark stage](assets/effects/kaleidoscope.webp)

<figcaption>Top: original. Bottom: Segments 8.</figcaption>
</figure>

Folds a slice of the picture into mirrored wedges around a centre, like
looking through a kaleidoscope. The pattern stays round on any picture size.
- **Segments** – how many times a mirrored pair of slices repeats around the circle (8 gives 16 slices). Whole numbers give a clean pattern; animated, it dissolves from one count to the next.
- **Rotation** – spins the whole pattern, in degrees.
- **Source Angle** – picks which slice of the picture the mirrors show.
- **Zoom** – above 1 shows a smaller part of the picture, larger.

Tip: animate Source Angle slowly for the classic look of a turning kaleidoscope.

<div class="docs-float-end"></div>

### Mirror
<figure class="docs-shot docs-shot--float-left">

![The harbour twice: on top the original; below, the upper half with sky, mountain and houses reflected into the lower half like a still lake](assets/effects/mirror.webp)

<figcaption>Top: original. Bottom: Top / Bottom on, Left / Right off.</figcaption>
</figure>

Copies one half of the picture onto the other for perfect symmetry, with a
seamless mirror line.
- **Left / Right** – the left half appears again, flipped, on the right (on by default).
- **Top / Bottom** – the top half appears again, flipped, at the bottom.
- **Keep** – which side is kept and copied: Left / Top or Right / Bottom.
- **Center X / Center Y and Angle** – move and turn the mirror line.

Tip: Top / Bottom on a landscape gives a calm reflection in water.

<div class="docs-float-end"></div>

### RGB Split
<figure class="docs-shot docs-shot--float-right">

![The night street, left half as it is; right half with the red and blue colour layers shifted sideways, colour fringes along the neon signs and shop fronts](assets/effects/rgb-split.webp)

<figcaption>Left: original. Right: Amount 0.01.</figcaption>
</figure>

Shifts the red and blue colour layers apart, like a misprinted poster or a
glitching screen.
- **Amount** – how far red and blue move, each in its own direction, as a share of the picture width (of the height when vertical). 0.005 (the default) is a fine fringe, 0.01 a clear glitch.
- **Angle** – the direction, in degrees: 0° sideways, 90° up and down (Offset mode only).
- **Mode** – **Offset** shifts the whole picture; **Lens** leaves the middle clean and lets the fringes grow towards the edges, like a cheap lens.

Tip: keyframe Amount in short bursts for glitch hits on the beat.

<div class="docs-float-end"></div>

### Pixelate
<figure class="docs-shot docs-shot--float-left">

![The harbour, left half as it is; right half built from large squares, each in the average colour of the houses, boats and water it covers](assets/effects/pixelate.webp)

<figcaption>Left: original. Right: Pixel Size 24.</figcaption>
</figure>

Rebuilds the picture from squares, each in the average colour of what it
covers, for mosaic looks or to hide a face or a sign.
- **Pixel Size** – the size of the squares, measured on a full-HD picture: they stay the same part of the picture at any resolution. 12 is clearly pixelated, 30 and more hides faces.

Tip: animate Pixel Size down to 0 for a reveal; the squares shrink towards the
middle of the picture until it is clear.

<div class="docs-float-end"></div>

### Blockify
<figure class="docs-shot docs-shot--float-right">

![A detail of the night street with its neon signs, twice: on top as it is; below in large blocks, the pink spiral, the teal K and the orange sign turned into blocky shapes of a few flat colours on dark navy, grey and black, with a light block pattern where shades change](assets/effects/blockify.webp)

<figcaption>Top: original. Bottom: the default settings (Levels 8, Dither 0.5). A detail.</figcaption>
</figure>

Pixelates and reduces the colours, for the look of an old computer game.
- **Block Size** – the size of the blocks, measured like Pixel Size.
- **Levels** – how many shades each colour keeps. 8 (the default) gives 512 colours, 4 a bold 64-colour palette, 2 a hard poster look.
- **Dither** – breaks the bands where shades change into a regular pattern of blocks. 0.5 (the default) keeps a dark stage calm, 1 is a full retro checker, 0 gives flat bands. Black and the darkest shades stay flat.
- **Amount** – mixes the blocks with the original picture.

<div class="docs-float-end"></div>

### Block Mosaic
<figure class="docs-shot docs-shot--float-left">

![A detail of the harbour houses, left half as it is; right half rebuilt from small and large square tiles separated by thin dark grout lines](assets/effects/block-mosaic.webp)

<figcaption>Left: original. Right: the default settings. A detail, enlarged.</figcaption>
</figure>

Rebuilds the picture as a tiled wall: small tiles mixed with larger ones,
separated by grout lines.
- **Tile Size** – the size of the small tiles, measured like Pixel Size.
- **Grout Width / Grout Color** – the lines between the tiles; 0 leaves them out.
- **Speed** – how many times per second the large tiles are drawn anew at random; 0 (the default) keeps them still.
- **Amount** – mixes the tiles with the original picture.

<div class="docs-float-end"></div>

Known limitations: between two whole Segments counts the Kaleidoscope dissolves
from one pattern to the next; halfway, both show at once (keyframe Segments with
hold keyframes for clean cuts). In a small preview thin grout lines look softer
than in the export.

## How the effects are built

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![The Kaleidoscope effect card in Properties → Effects: Segments 8, Rotation 0°, Source Angle 0°, Zoom 1.00, Center X and Center Y 0.50, Shape Circle and Frame Edges Mirror](assets/effects/editor/kaleidoscope-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 509" aria-hidden="true" focusable="false">
<defs><marker id="kaleidoscope-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M55 132 L115 132" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="55" cy="132" r="18" /><text x="55" y="132" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M24 223 L84 223" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="24" cy="223" r="18" /><text x="24" y="223" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M23 449 L83 449" marker-end="url(#kaleidoscope-inspector-arrow)" />
<circle class="docs-shot-number" cx="23" cy="449" r="18" /><text x="23" y="449" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>The Kaleidoscope card in Properties → Effects. 1 — Segments. 2 — Source Angle, which part of the picture the mirrors show. 3 — Frame Edges.</figcaption>
</figure>

- **Segments** (1) and **Rotation** shape the pattern; **Source Angle** (2)
  changes what is inside it. Angles show in degrees.
- **Shape**: **Circle** keeps the pattern round on any picture; **Stretch to
  Frame** stretches it to the frame, an oval on a wide picture.
- **Frame Edges** (3) decides what appears where a read lands past the edge of
  the picture: **Mirror** reflects the picture, **Clamp** repeats the border
  pixels as streaks, **Transparent** leaves those places empty. Kaleidoscope,
  Mirror and RGB Split all have it.

<div class="docs-float-end"></div>

Every effect on this page is a small node graph you can open and change: select
the clip, open the **Nodes** tab and use the › on the effect's card, then on each
folder. Changes apply to this one effect.
[Blur Effects](./Effects-Blur.md#how-the-blur-effects-are-built) shows the steps
with pictures, [Node Workspace](./Node-Workspace.md) how to add and connect nodes.

### Two ideas

**Kaleidoscope, Mirror and RGB Split move where each pixel reads.** Every pixel
of the result asks which spot of the original it shows; fold, flip or shift that
spot and the picture follows. This is the same idea as the
[distort effects](./Effects-Distort.md#one-idea-move-where-each-pixel-reads).

**Pixelate, Blockify and Block Mosaic paint each cell in its average colour.**
They share one recipe:

<figure class="docs-shot docs-shot--graph">

![The Pixelate graph from left to right: Pixel Size feeds Cell Size; Cell Size and Pixel Position feed Centred Cell Grid; Input Frame feeds Premultiplied Source; the grid and the source feed Row Average (cached), then Column Average, then Straight Alpha Output](assets/effects/graphs/pixelate.webp)

<figcaption>Pixelate as it opens in the Node Workspace, with the Constants and Coordinates folders and the Output card left out.</figcaption>
</figure>

- **Cell Size** turns Pixel Size into whole pixels of the rendered frame.
- **Centred Cell Grid** finds, for every pixel, where its cell starts and ends.
  The grid is anchored in the middle of the frame.
- **Row Average** averages each row of the cell and keeps the result;
  **Column Average** then averages those rows. Two short passes are much cheaper
  than reading the whole cell for every pixel.

Blockify adds a **Posterize** folder after the average, Block Mosaic a **Large
Tiles** folder before the grid and a **Grout** folder after it; both end with
**Mix with Original** for Amount.

### Kaleidoscope: folding the angle

<figure class="docs-shot docs-shot--graph">

![Kaleidoscope's Wedge Fold folder, one of its two paths. Offset Y and X feed Arctangent 2; an Add with Rotation makes Turned Angle; Tau divided by Fewer Segments makes Wedge; both feed Mirror Repeat, whose Folded Angle plus Source Angle makes Read Angle; Direction from Angle times Read Radius makes Read Offset](assets/effects/graphs/kaleidoscope-wedge-fold.webp)

<figcaption>Part of the Wedge Fold folder: the path for the lower whole segment count. Green cards stand for values the excerpt does not show: Offset X and Y come from Centre & Shape, while Rotation, Source Angle, Read Radius and Fewer Segments sit in this folder too, beside the zoom, segment-count and second-path nodes.</figcaption>
</figure>

**Arctangent 2** turns each pixel's offset from the centre into an angle, and
**Add** turns it by Rotation. **Divide** makes the width of one wedge (a full
turn, **Tau**, divided by the segment count). **Mirror Repeat** folds every angle
into that one wedge, back and forth, which is the whole trick. **Source Angle**
then picks the slice of the picture, and **Direction from Angle** and
**Multiply** turn angle and distance back into a place to read.

Remix, a spiral: add a **Multiply** of **Read Radius** and a **Value** of 3, and
an **Add** of **Turned Angle** and that Multiply. Plug the Add into the Value
input of both **Mirror Repeat** nodes (one per path). The pattern now twists
further the further it is from the centre.

### Block Mosaic: choosing the large tiles

<figure class="docs-shot docs-shot--graph">

![Part of Block Mosaic's Large Tiles folder: Floor of the Large Grid Position gives the Large Tile Index; Random (Hash) turns it into Group Random; Shuffle Step times Shuffle Rate, then Fraction, gives the Shuffle Seed; Combine Vector and Add mix group and seed into the Shuffled Key; a second Random (Hash) turns it into a number; Greater Than compares it with Large Threshold 0.68; a Switch picks Tile (px) or Large Tile (px)](assets/effects/graphs/block-mosaic-large-tiles.webp)

<figcaption>Part of the Large Tiles folder. Green cards stand for values the excerpt does not show: Tile (px) comes from Cell Size, the others sit in this folder too, beside the time and Speed nodes that count the Shuffle Step. Large Threshold (0.68) decides how many tile groups become one large tile.</figcaption>
</figure>

**Floor** numbers every square group of 2 × 2 tiles, and **Random (Hash)** gives
each group its own random number. The **Shuffle Step** counts up Speed times per
second; **Multiply** and **Fraction** turn it into a **Shuffle Seed** that jumps
to a new value at every step. **Combine Vector** and **Add** mix group and seed,
and the second **Random (Hash)** turns that into a number between 0 and 1, new for
every group at every step. **Greater Than** makes a large tile wherever it is
above **Large Threshold**: about one group in three. **Switch** hands the grid the
large or the small tile size.

Remix: select **Large Threshold** and lower it in the node inspector, for
example to 0.4, so more than half of the groups become large tiles; 1 turns them
off.

### RGB Split: which colour moves

<figure class="docs-shot docs-shot--float-right">

![RGB Split's Channel Merge folder: Blue, Green and Red Plate each feed a Split Vector; the R of the red plate, the G of the green plate, the B of the blue plate and Union Alpha feed Combine Vector](assets/effects/graphs/rgb-split-channel-merge.webp)

<figcaption>Part of the Channel Merge & Straight Alpha folder: one colour from each plate.</figcaption>
</figure>

RGB Split reads the picture three times: the **Red Plate** shifted one way, the
**Green Plate** in place and the **Blue Plate** shifted the other way. Each
**Split Vector** takes the plate apart, and **Combine Vector** keeps red from the
red plate, green from the green plate and blue from the blue plate. The **Union
Alpha** keeps the coloured fringes visible over transparency.

Remix, red and cyan like 3D glasses: plug the **G** output of the Blue Plate's
Split Vector into **G** of **Combine Vector**. Green then moves with blue.

<div class="docs-float-end"></div>

## Technical details

Notes for developers. The recipes live in
`src/services/operators/mirrorRecipes.ts` and `cellGridRecipes.ts`; more in
[Effect system: editable mirror, split and pixel graphs](./Effect-System.md#editable-mirror-split-and-pixel-graphs)
(premultiplied reads, the worker CPU fallback),
[Node Catalog](./Node-Catalog.md#composed-coordinate-nodes) (Mirror Repeat) and
[Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Frame space.** Kaleidoscope and Mirror measure offsets from the centre in
  units of the shorter frame side, so angles are on-screen angles and the Circle
  shape stays round. Angles are stored in radians and shown in degrees; keyframe
  lanes, MIDI and tools use radians.
- **Kaleidoscope.** The angle is folded into one mirrored wedge of 360° / n,
  turned by Source Angle and read at distance / Zoom. A fractional Segments value
  crossfades the patterns of the two neighbouring whole counts. Segments is
  clamped to 2–64 and Zoom to at least 0.01; both clamps are reported.
- **Mirror.** Each enabled axis keeps one side (|x| with the kept side's sign) in
  the turned frame, so the reflection is continuous at the line.
- **RGB Split.** Offset mode moves red and blue Amount × |(cos × width, sin ×
  height)| pixels along the on-screen Angle. Lens mode offsets their reads by
  ∓2 × Amount × the distance from the centre: no split in the middle, Amount × width
  at the left and right edges (Angle is dimmed there). Alpha is the largest of the
  three reads.
- **Cell grid.** Pixel Size, Block Size, Tile Size and Grout Width are pixels of a
  1080p frame, rounded to whole rendered pixels, on a grid anchored at the frame
  centre. A cached row average and a column average are exact up to 128 rendered
  pixels per cell, then spread 64 pairs of taps. A Pixel Size that rounds to one
  rendered pixel or less leaves the picture unchanged (only a negative size is
  reported); Blockify and Block Mosaic raise smaller sizes to 1 and 2 pixels and say so.
  The Mosaic Glitch transition animates Pixel Size from and to 0, so its cuts stay
  clean at 4K too.
- **Blockify** rounds each channel to Levels steps (2–64) after adding the block's
  4 × 4 Bayer threshold − 0.5, times Dither and a shadow guard (c / w)², where w is
  one level step but at most 0.25: black, white and dark haze stay flat.
- **Block Mosaic** hashes each 2 × 2 group, adds a seed of fract(step × (0.618,
  0.755)) and hashes again; a group is large above 0.68. The step is
  floor(time × Speed) on the timeline clock, so seeking and export repeat it.
- **Saved projects.** Kaleidoscope, Mirror and RGB Split keep their look (diagonal
  splits now point exactly along the on-screen angle). Pixelate, Blockify and Block
  Mosaic change on purpose to 1080p-based sizes, a centred grid and averaged cell
  colours; Blockify keeps 8 levels without dither, Block Mosaic a 1-pixel grout in
  its old, darker colour.

Pictures: the `mirror-pixel.json` manifests in `scripts/effect-lab-shots/`,
`scripts/effect-editor-shots/` and `scripts/effect-graph-shots/` regenerate the
stills, the editor excerpt and the graphs.
