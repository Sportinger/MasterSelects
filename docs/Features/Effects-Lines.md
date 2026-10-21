# Lines & Engraving

Redraw the picture with lines: pen hatching, banknote engraving, contour maps and edge drawings.
Add one in **Properties → Effects → + Add Effect → Lines & Engraving**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: lines -->

## Which one?

| Look | Use |
|---|---|
| pen hatching, more directions where it is darker | [Crosshatch](./effects/crosshatch.md) |
| rows of engraved wavy lines, like a banknote | [Vector Engraving](./effects/vector-tiling.md) |
| clean lines where the brightness crosses one level | [Contour](./effects/contour.md) |
| banded zones with a line at each band, like a map | [Contour Map](./effects/contour-map.md) |
| an edge drawing | [Outline](./effects/outline.md) |
| wavy line art on a plain background | [Wave Lines](./effects/wave-lines.md) |
| bands of the picture drifting sideways | [Drift Lines](./effects/drift-lines.md) |

## The shared idea

They all read the brightness of the picture and turn it into lines, in one of three ways:

- **Lines across the tones**: Crosshatch, Vector Engraving and Wave Lines draw a line pattern whose
  density or waviness follows how dark the picture is.
- **Lines along the tones**: Contour and Contour Map draw where the brightness crosses a level, like
  height lines on a map.
- **Lines along edges**: Outline draws where the brightness changes quickly.

**Ink** and **Paper** (Contour: **Line** and **Paper**) are the two colours of the drawing, **Scale**
sets the line spacing and **Amount** mixes back towards the original. Drift Lines, Outline and Wave
Lines move over time.

## Technical details

Line spacing is measured in pixels. Contour runs as a GPU compute effect (marching squares);
the others are node setups of the pattern engine. More: [Effect system](./Effect-System.md).
