# Light & Stylize

Looks that add light or turn the picture into something else: glowing lights, a sweep of shine,
darker edges, outlines or paint. Add one in **Properties → Effects → + Add Effect**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: stylize -->

## Which one?

| I want… | Use |
|---|---|
| lights that bloom with a soft halo | [Glow](./effects/glow.md) |
| a band of light sweeping over a logo or title | [Sheen](./effects/sheen.md) |
| darker edges that lead the eye to the middle | [Vignette](./effects/vignette.md) |
| outlines or a pencil-drawing look | [Edge Detect](./effects/edge-detect.md) |
| a watercolour painting | [Acuarela](./effects/acuarela.md) |
| watery smoke and trails of light | [Rom1](./effects/rom1.md) |

Film Grain and Scanlines are in [Analog & Glitch](./Effects-Analog.md); Posterize and Threshold in
[Color & Tone](./Effects-Color.md).

## The shared idea

These effects are built in four different ways, each the way its look needs:

- **Pixel by pixel.** Vignette changes every pixel on its own, from its colour and its place in the
  frame.
- **With the neighbours.** Glow, Edge Detect and Acuarela also read the pixels around each one. Like
  the blurs, they first weigh each colour by its transparency (**Premultiplied Source**), so
  transparent edges stay clean.
- **With the previous frame.** Rom1 builds every frame on its own last result, so its trails grow
  while the clip plays and fade by its **Trail**.
- **One fixed shader.** Sheen has no node setup to open.

Inside a graph, each stage is a folder with a plain name, such as **Bright Pass** or **Edge
Pooling**; each effect page shows them under *Node setup*. How to open a graph:
[The node setup](./Effects.md#the-node-setup).

## Technical details

Glow Radius, Edge Detect Width and Acuarela's Wash and Bleed are measured on a 1080p frame and scale with the picture, so the preview, the export and 4K match. Glow, Vignette and Edge Detect saved before 21 October 2026 keep their earlier look, and so does an Edge Detect saved with 3.2.7, whose window ends at 8 px (thinner wide lines at 4K); their card says so and offers **Use the new …** to switch.

Developer notes: [Effect system: Light & Stylize notes](./Effect-System.md#light--stylize-notes).
