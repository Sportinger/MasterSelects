# Color & Tone

Light and colour, from a quick brightness fix to a complete colour mood, flat poster tones or pure
black and white. Add one in **Properties → Effects → + Add Effect** ([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: color -->

## Which one?

| I want… | Use |
|---|---|
| lighter or darker mid-tones, without a grey veil | [Brightness](./effects/brightness.md) |
| more or less light, like the camera's aperture | [Exposure](./effects/exposure.md) |
| more punch | [Contrast](./effects/contrast.md) |
| exact black and white points, or a faded look | [Levels](./effects/levels.md) |
| stronger or weaker colours | [Saturation](./effects/saturation.md); on faces [Vibrance](./effects/vibrance.md) |
| warmer or cooler light | [Temperature](./effects/temperature.md) |
| different colours | [Hue Shift](./effects/hue-shift.md) |
| a negative | [Invert](./effects/invert.md) |
| a few flat tones | [Posterize](./effects/posterize.md) |
| pure black and white | [Threshold](./effects/threshold.md) |

## The shared idea

<figure class="docs-shot docs-shot--graph">

![The Brightness graph: Input Frame, Split RGB + Alpha, the Parameters folder with its Amount output, the Brightness Curve folder, Combine RGB + Alpha and Output; the Constants folder is hidden](assets/effects/graphs/brightness.webp)

<figcaption>Brightness as it opens in the Node Workspace, with the Constants folder left out. Every colour effect has this shape.</figcaption>
</figure>

Every colour effect is a small node graph of the same shape:

- **Split RGB + Alpha** separates the colour from the transparency.
- **Parameters** holds the controls. Each one passes through a limit, so a typed-in extreme value
  cannot break the picture.
- One folder does the actual work, for example **Brightness Curve**, **Exposure (Stops)** or
  **Hue Rotate (OkLCh)**. Each effect page shows its folder under *Node setup*.
- **Combine RGB + Alpha** puts the untouched transparency back.

Black stays black and white stays white unless you ask for it, and colours keep their shade when you
push them. The blocks **Brightness Curve**, **Contrast Curve**, **Exposure (Stops)**, **White
Balance**, **Saturation (Gamut-Safe)** and **Hue Rotate (OkLCh)** are also in **right-click →
Reusable Nodes** (category Color & Mask), so you can drop them into any other image effect graph.
How to open a graph: [The node setup](./Effects.md#the-node-setup).

## Technical details

Colour effects work on the 8-bit picture, from black to white, with no extra headroom between effects. You can type a value past the end of a slider up to what the effect can show; beyond that the card says which value it uses. Colour effects in projects saved before October 2026 keep the look they were saved with; add the effect again for the current one.

Developer notes: [Effect system: Color & Tone notes](./Effect-System.md#color--tone-notes).
