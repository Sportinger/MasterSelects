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

![The dancer twice: on top the original; below, her figure repeated eight times around the middle into a symmetric flower on the dark stage](assets/effects/kaleidoscope.webp)

<figcaption>Top: original. Bottom: Segments 8.</figcaption>
</figure>

Folds a slice of the picture into mirrored wedges around a centre, like
looking through a kaleidoscope. The pattern stays round on any picture size.
- **Segments** – how many mirrored slices make up the circle. Whole numbers give a clean pattern; when animated, the pattern blends smoothly into the next count.
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
- **Amount** – how far red and blue move, each in its own direction, as a share of the picture width (of the height when vertical). 0.003 is a fine fringe, 0.01 a clear glitch.
- **Angle** – the direction, in degrees: 0° sideways, 90° up and down.
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

Tip: animate Pixel Size down to 1 for a reveal; the squares shrink towards the
middle of the picture.

<div class="docs-float-end"></div>

### Blockify
<figure class="docs-shot docs-shot--float-right">

![The harbour, left half as it is; right half in coarse blocks with a few flat colours, like an old computer game](assets/effects/blockify.webp)

<figcaption>Left: original. Right: the default settings.</figcaption>
</figure>

Pixelates and reduces the colours, for the look of an old computer game.
- **Block Size** – the size of the blocks, measured like Pixel Size.
- **Levels** – how many shades each colour keeps. 6 gives 216 colours, 2 a hard poster look.
- **Amount** – mixes the blocks with the original picture.

<div class="docs-float-end"></div>

### Block Mosaic
<figure class="docs-shot docs-shot--float-left">

![The harbour, left half as it is; right half rebuilt from small and large square tiles separated by thin dark grout lines](assets/effects/block-mosaic.webp)

<figcaption>Left: original. Right: the default settings.</figcaption>
</figure>

Rebuilds the picture as a tiled wall: small tiles mixed with larger ones,
separated by grout lines.
- **Tile Size** – the size of the small tiles, measured like Pixel Size.
- **Grout Width / Grout Color** – the lines between the tiles; 0 leaves them out.
- **Speed** – how often per second the large tiles change places; 0 keeps them still.
- **Amount** – mixes the tiles with the original picture.

<div class="docs-float-end"></div>

Known limitations: between two whole Segments counts the Kaleidoscope shows
both patterns faintly blended, and in a small preview thin grout lines look
softer than in the export.

<!-- docs agent: middle and technical levels go here -->
