# Blockify

Pixelates the picture and reduces its colours, for the look of an old computer game.

Group: [Pixel & Mosaic](../Effects-Pixel.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![A detail of the night street with its neon signs, twice: on top as it is; below in large blocks, the pink spiral, the teal K and the orange sign turned into blocky shapes of a few flat colours on dark navy, grey and black, with a light block pattern where shades change](../assets/effects/blockify.webp)

<figcaption>Top: original. Bottom: the default settings (Levels 8, Dither 0.5). A detail.</figcaption>
</figure>

**Use it for:** retro game and 8-bit looks · a graphic, poster-like stage picture · title
backgrounds with few colours.

- **Block Size** – the size of the blocks, measured like Pixelate's Pixel Size (on a full-HD
  picture).
- **Levels** – how many shades each colour keeps. 8 (the default) gives 512 colours, 4 a bold
  64-colour palette, 2 a hard poster look.
- **Dither** – breaks the bands where shades change into a regular pattern of blocks. 0.5 (the
  default) keeps a dark stage calm, 1 is a full retro checker, 0 gives flat bands. Black and the
  darkest shades stay flat.
- **Amount** – mixes the blocks with the original picture.

**Tip:** Levels 2 with Dither 1 gives the hardest retro look; raise Block Size until the shapes still
read.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Block Size | 2 to 128 | 16 |
| Levels | 2 to 64 | 8 |
| Dither | 0 to 1 | 0.5 |
| Amount | 0 to 1 | 1 |
<!-- generated:controls end -->

## Node setup

Blockify is [Pixelate's recipe](./pixelate.md#node-setup) with two more folders: **Posterize** after
the cell average and **Mix with Original** for Amount. Posterize adds the block's dither threshold to
each colour channel and rounds it to the Levels steps.

**Remix:** delete the **Posterize** folder and connect the cell average straight to **Mix with
Original**: Blockify becomes Pixelate with an Amount control, for a mosaic that fades in.

## Technical details

- **Posterize.** Each channel is rounded to Levels steps (2–64) after adding the block's 4 × 4 Bayer
  threshold − 0.5, times Dither and a shadow guard (c / w)², where w is one level step but at most
  0.25. Black, white and dark haze stay flat.
- **Small sizes.** A Block Size below one rendered pixel is raised to 1 pixel, and the inspector says
  so.
- **Saved projects** made with the earlier Blockify open with the 1080p-based size, the centred grid
  and averaged colours, and keep 8 levels without dither.

Grid, sizes and transparency: [Pixel & Mosaic](../Effect-System.md#pixel--mosaic-notes).
Recipes: [Effect system: editable mirror, split and pixel graphs](../Effect-System.md#editable-mirror-split-and-pixel-graphs).
Nodes: [Node Catalog](../Node-Catalog.md).
