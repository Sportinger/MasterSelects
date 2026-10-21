# Text & Glyph

Rebuild the picture from characters: ASCII art, digital rain, terminal text and typographic
patterns. They share one set of controls, and all but ASCII Ghost are styles of one glyph engine. Add one in
**Properties → Effects → + Add Effect → Text & Glyph** ([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: text -->

## Which one?

What each style changes; everything else works the same.

| Look | Style |
|---|---|
| plain characters chosen by brightness | [ASCII](./effects/ascii.md) |
| characters that cycle and leave fading ghosts | [ASCII Ghost](./effects/ascii-ghost.md) |
| a diagonal wave sweeping through the characters | [Glyph Matrix](./effects/glyph-matrix.md) |
| symbols that swap and pulse at random | [Symbol Matrix](./effects/symbol-matrix.md) |
| amber terminal text scrolling with scanlines | [Retro Matrix](./effects/retro-matrix.md) |
| falling green code with bright heads | [Matrix Rain](./effects/matrix.md) |
| characters inside a faint grid | [Grid Glyph](./effects/grid-glyph.md) |
| digits in five colour steps | [Number Field](./effects/number-field.md) |
| random code from deep blue to mint | [Pixel Code](./effects/pixel-code.md) |
| rows of characters joined like words | [Word Mosaic](./effects/word-mosaic.md) |
| characters only along the edges | [Inscribe](./effects/inscribe.md) |
| characters in a flickering dither | [Dither Text](./effects/dither-text.md) |
| characters mixed with diagonal hatching | [Data Hatching](./effects/data-hatch.md) |
| glowing neon characters with halos | [Dither Glow](./effects/pixel-dither.md) |
| digits along the brightness contours | [Contour Type](./effects/contour-type.md) |
| block characters in rings inside a frame, like a logo | [Brand Generator](./effects/brand-generator.md) |
| characters in rounded tag pills | [Tag Pills](./effects/capsule-cloud.md) |
| boxed interface cells with cursors | [Creative UI Collage](./effects/ui-collage.md) |

## The shared idea

The engine cuts the picture into a grid of cells. Each cell's brightness picks a character from a
**ramp**, a row of characters from light to dense, and the style decides how the character is
drawn and coloured.

- **Cell Size** – the size of one character, in pixels. At the default 14 the characters are small on
  a 1080p frame; 24 or more reads well on a projection.
- **Ramp** – the set of characters (standard, detailed, blocks, binary, numeric, symbols), or your own
  in **Custom Ramp**. **Font** and **Weight** change the lettering.
- **Color Source** – **Source** takes the picture's colours; **Duotone** draws between **Dark** and
  **Light**.
- **Invert Ramp** swaps light and dense characters; **Amount** mixes back towards the original;
  **Speed** sets how fast the moving styles change.

**Tip:** the styles draw characters on a dark ground, so bright, contrasty footage reads best; for a
projection, raise **Cell Size** to 24 or more. The **Style** menu in the card switches to another look
of the engine and keeps your values and keyframes.

## Technical details

The characters are drawn from a font atlas the engine builds for the chosen Ramp, Font and Weight.
More: [Effect system: glyph, cell and compute effects](./Effect-System.md#glyph-cell-and-compute-effects).
