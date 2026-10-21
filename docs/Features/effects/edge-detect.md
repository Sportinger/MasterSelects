# Edge Detect

Turns the picture into its outlines: bright lines where things meet, dark everywhere else. With
Invert it looks like a pencil drawing.

Group: [Light & Stylize](../Effects-Stylize.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The dancer on stage, original left and with Edge Detect right: only her outlines, her hair and the folds of the dress remain, as glowing lines in her own warm colours on black, and the stage floor becomes a fine web of lines](../assets/effects/edge-detect.webp)

<figcaption>Left: original. Right: Width 1.5, Strength 2, Color 0.7.</figcaption>
</figure>

**Use it for:** a drawn or neon-outline look · glowing contours on black for projection · an
outline around a title or a cut-out.

- **Strength** – how bright and how many lines; busy detail fades in softly instead of turning
  solid white.
- **Width** – line thickness; it stays the same at any resolution.
- **Color** – 0 draws white lines, 1 draws them in the picture's own colours.
- **Invert** – dark lines on white, like a pencil drawing.

**Tip:** on a title or cut-out on a transparent layer, the outline is drawn just outside it too, in
the full line colour. Add [Glow](./glow.md) after it for neon outlines.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Strength | 0 to 5 | 1 |
| Width | 0.5 to 6 | 1 |
| Color | 0 to 1 | 0 |
| Invert | on or off | off |

The effect card also has controls of its own that this table does not list.
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--graph">

![The Edge Detect graph: Parameters feed Line Width (sigma & window), Gradient & Edge Strength and Line Color & Alpha; Line Width feeds Window Taps (premultiplied brightness) and Line Color & Alpha; Window Taps feeds Gradient & Edge Strength, which feeds Line Color & Alpha; Input Frame feeds Window Taps and Line Color & Alpha](../assets/effects/graphs/edge-detect.webp)

<figcaption>Edge Detect with the Constants and Coordinates folders and the Output card left out.</figcaption>
</figure>

**Line Width** turns Width into a blur size (sigma) and the window of reads around each pixel.
**Window Taps** reads the brightness in that window, **Gradient & Edge Strength** works out how
strongly it changes across the pixel and turns that into a line strength, and **Line Color & Alpha**
draws the line in white or the picture's colour over the background.

**Remix:** for chalk on a slate, open **Line Color & Alpha** and find the **Switch** that gives
**Zero** while Invert is off (the background). Plug a **Value** of 0.15 into its False input, in
place of **Zero**: the background turns dark grey.

## Technical details

- **Lines.** A derivative of a Gaussian on premultiplied brightness, in one Kernel Sum (Rect),
  normalized by the window's own second moment; line strength `1 − exp(−response)`.
- **Width** is sigma in pixels of a 1080p frame (at least 0.7 px). The window reaches at most ±8 px:
  up to 289 reads per pixel, plus two for Color, which takes the colour from the brighter side of
  the edge. A Width that needs a wider window is reported. Wide lines cost more render time.
- **Transparency.** Lines are composited premultiplied (alpha = edge + source alpha × (1 − edge)),
  so transparent surroundings stay transparent and a layer's outline shows in its full line colour.
- **Saved projects.** An Edge Detect saved before 2026-10-21 keeps its earlier one-pixel look (Width
  and Color have no effect on it); its card offers **Use the new Edge Detect**.
- Shared notes: [Light & Stylize](../Effect-System.md#light--stylize-notes). Formulas:
  [Effect system](../Effect-System.md#editable-blur-kernels); blocks:
  [Node Catalog](../Node-Catalog.md).
