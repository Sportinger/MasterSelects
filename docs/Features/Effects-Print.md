# Print & Halftone

Turn the picture into printed marks: newspaper dots, dither patterns and two-ink risograph prints.
Add one in **Properties → Effects → + Add Effect → Print & Halftone**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: print -->

## Which one?

| Look | Use |
|---|---|
| newspaper dots that grow in dark areas | [Halftone](./effects/halftone.md) |
| a screen of circles, diamonds or lines | [Pattern Halftone](./effects/pattern-halftone.md) |
| a few colour levels with a fine checker | [Dithering](./effects/dither.md) |
| a 1-bit picture in two inks | [Dither Studio](./effects/dither-studio.md) |
| a two-ink risograph print, slightly out of register | [Riso](./effects/riso.md) |
| the same print with a slow pulsing glow | [Riso Glow](./effects/riso-glow.md) |
| a grainy two-colour press print | [Paper Print](./effects/paper-print.md) |
| squares, circles or triangles sized by tone | [Tone Geometry](./effects/tone-geometry.md) |

## The shared idea

Each of these effects reads how light or dark the picture is and prints marks for it: dots and shapes
grow where it is dark, dither patterns decide pixel by pixel between a few tones.

- **Ink** and **Paper** are the two colours most of them print with. Riso uses two inks on cream
  paper; Dithering keeps the picture's own colours.
- **Scale** (or Dot Size, Pixel Size, Press Grain) sets the size of the marks; Riso's **Registration**
  sets how far its two inks slip apart.
- **Amount** mixes back towards the original: 1 is the full print.

Halftone, Dithering, Riso and Paper Print share one pattern engine with most
[Lines](./Effects-Lines.md) and [Textile](./Effects-Textile.md) looks: the **Style** menu in their card
switches between these looks and keeps the values and keyframes.

## Technical details

Mark sizes are measured in pixels. Riso Glow and Tone Geometry move over time, so playback
shows more than a still. How the looks are built: [Effect system](./Effect-System.md).
