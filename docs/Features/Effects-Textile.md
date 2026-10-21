# Textile & Craft

Lay a fabric over the picture: embroidery threads, a woven carpet, cross stitches or stitched
character art. Add one in **Properties → Effects → + Add Effect → Textile & Craft**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: textile -->

## Which one?

| Look | Use |
|---|---|
| rows of thread tinted with one colour | [Embroidery](./effects/embroidery.md) |
| a two-colour diamond-and-stripe carpet | [Kilim Carpet](./effects/kilim.md) |
| X-shaped stitches on fabric | [Cross Stitch](./effects/cross-stitch.md) |
| character art with stitched X marks | [Stitch Poster](./effects/stitch-poster.md) |

## The shared idea

Each effect repeats a small fabric pattern in a grid over the picture and lets the picture show
through it: its colours (Embroidery, Cross Stitch) or its brightness (Kilim Carpet, Stitch Poster)
decide how each cell looks.

- **Scale** (Stitch Size, Cell Size) sets the size of one stitch or pattern cell.
- **Ink** tints the threads; **Paper** is the fabric (Kilim Carpet uses both as its two yarn colours).
- **Amount** mixes back towards the original.

Embroidery's threads ripple slowly during playback. Stitch Poster is a look of the
[glyph engine](./Effects-Glyph.md); the others share the pattern engine of
[Print & Halftone](./Effects-Print.md).

## Technical details

Pattern sizes are measured in pixels. More: [Effect system](./Effect-System.md).
