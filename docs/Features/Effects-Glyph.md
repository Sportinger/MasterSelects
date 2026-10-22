# Text & Glyph

Rebuild the picture from characters: ASCII art, digital rain, terminal text and typographic
patterns. They share one set of controls, and all but ASCII Ghost are styles of one glyph engine. Add one in
**Properties → Effects → + Add Effect → Text & Glyph** ([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: text -->

## Which one?

What each style changes; everything else works the same.

| Look | Style |
|---|---|
| characters chosen by brightness, in the picture's colours | [ASCII](./effects/ascii.md) |
| characters that cycle and leave fading ghosts | [ASCII Ghost](./effects/ascii-ghost.md) |
| characters that roll on to their neighbours in diagonal waves | [Glyph Matrix](./effects/glyph-matrix.md) |
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

- **Cell Size** – the size of one character, in pixels of a 1080p frame, so the preview, the
  thumbnails and a 4K export show the same characters. At the default 14 they are small; 24 or more
  reads well on a projection.
- **Background** – how much of the picture fills each cell behind its character: 0 is the dark
  ground of classic ASCII art, 1 the full colour. New effects start at 0.3, so the picture stays
  readable; effects saved earlier keep their dark ground.
- **Ramp** – the set of characters (Standard, Detailed, Blocks, Bars, Binary, Numeric, Symbols), or your
  own in **Custom Ramp**: one character puts the same sign in every cell, more than 256 are thinned
  to 256. Blocks and Bars fill their cells edge to edge in any font. **Font** and **Weight** change the
  lettering.
- **Amount** – fades from the untouched picture (0) to the full look (1).
- **Color Source** – **Source** takes the picture's colours; **Duotone** draws between **Dark** and
  **Light**. Matrix Rain, Retro Matrix and Pixel Code use their own colours, Number Field and Dither
  Glow always draw between Dark and Light; their cards hide what they do not use.
- **Invert Ramp** swaps light and dense characters;
  **Speed** sets how fast the moving styles change; they move with the playhead and stand still
  when it stops, and a keyframed Speed speeds up smoothly.
- **Roll** – how much of the ramp the characters of a moving style roll through, around the
  character of their own brightness: 0 holds them still, 1 runs through the whole ramp. Glyph Matrix
  starts at 0.2, so its figure stays readable; the other moving styles start at 1, their look before
  Roll existed.

**Tip:** bright, contrasty footage reads best. For pure characters on black, set **Background** to 0;
for a projection, raise **Cell Size** to 24 or more. The **Style** menu in the card switches to another look
of the engine and keeps your values and keyframes.

## Technical details

The characters are drawn from a font atlas the engine builds for the chosen Ramp, Font and Weight.
More: [Effect system: glyph, cell and compute effects](./Effect-System.md#glyph-cell-and-compute-effects).
