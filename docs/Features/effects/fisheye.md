# Fisheye Lens

The rounded look of an ultra-wide fisheye lens: the middle comes closer and straight lines bend
towards the edges. With negative Strength it flattens a fisheye picture instead.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The night street twice: on top the original; below, the walker in the middle enlarged and the house fronts at the sides curving like through a fisheye lens](../assets/effects/fisheye.webp)

<figcaption>Top: original. Bottom: the default settings.</figcaption>
</figure>

**Use it for:** a skate-video or peephole look · a porthole or crystal-ball frame · straightening
footage from a real fisheye lens.

- **Strength** – 1 is the full fisheye, 0 no change, negative values bend the other way and flatten
  a fisheye picture.
- **Field of View** – how wide the imagined lens sees, in degrees: wider looks rounder.
- **Zoom** – below 1 shows more of the picture around the middle.
- **Lens Radius** – 1 or less shows the round image circle (1 is as tall as the picture).

**Tip:** Lens Radius 0.9 with **Outside Lens: Transparent** makes a round porthole.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Lens** | | |
| Projection | Equidistant, Equisolid Angle, Stereographic, Orthographic | Equidistant |
| Strength | −1 to 1 | 1 |
| Field of View | 20 to 175 | 140 |
| Curve Bias | −1 to 1 | 0 |
| **Framing** | | |
| Lens Radius | 0.1 to 3 | 2.1 |
| Zoom | 0.25 to 4 | 1 |
| Center X | 0 to 1 | 0.5 |
| Center Y | 0 to 1 | 0.5 |
| Anamorphic Squeeze | 0.25 to 4 | 1 |
| Lens Rotation | −180 to 180 | 0 |
| Pixel-correct Aspect | on or off | on |
| **Edges** | | |
| Outside Lens | Original Image, Transparent | Original Image |
| Lens Feather | 0 to 0.5 | 0.05 |
| Frame Edges | Transparent, Clamp, Mirror, Repeat | Transparent |
| Edge Feather | 0 to 0.1 | 0.005 |
| **Optics** | | |
| Chromatic Aberration | 0 to 0.05 | 0 |
| Lens Vignette | 0 to 1 | 0 |
| Vignette Softness | 0.01 to 1 | 0.25 |
| **Quality** | | |
| Edge Sampling | 1 to 8 | 4 |
<!-- generated:controls end -->

## Node setup

Fisheye Lens is an editable graph in a single pass. **Edge Sampling** shifts each of the samples a
little for smooth edges, **Lens Projection** works out where each sample reads through the chosen
lens model, **Frame Edges** decides what shows beyond the picture and **Chromatic Aberration** reads
red, green and blue at slightly different places. **Lens Resolve** averages the samples, applies the
vignette and blends the lens circle with what shows outside it. How to open a graph:
[The node setup](../Effects.md#the-node-setup).

## Technical details

- **Sampling.** One pass with up to 8 samples per pixel (Edge Sampling 1, 4 or 8). Each sample is
  premultiplied as it is read and the average is unpremultiplied, so the lens and frame feathering
  lower coverage instead of darkening colour.
- **Colour fringes.** With Chromatic Aberration, each channel's colour is taken from its own sample
  and multiplied by the averaged alpha, so fringes across a cut-out never exceed the source colour.
  The hardware filter still mixes straight colours across a transparent edge inside the source
  (about one source pixel).
- **Software preview and export.** Without WebGPU the same recipe runs on the CPU, with the same
  premultiplied averaging.
- **Warnings.** Out-of-range values and unknown choices are named below the effect and in the tool
  results.
- **Saved projects.** Untouched graphs of the earlier recipe are recognised and load as the current
  one; edited graphs stay as saved.

More: [Effect system: Fisheye Lens](../Effect-System.md#fisheye-lens). Nodes:
[Node Catalog](../Node-Catalog.md).
