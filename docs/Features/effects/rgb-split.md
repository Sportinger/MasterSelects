# RGB Split

Shifts the red and blue colour layers apart, like a misprinted poster or a glitching screen.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![The night street, left half as it is; right half with the red and blue colour layers shifted sideways, colour fringes along the neon signs and shop fronts](../assets/effects/rgb-split.webp)

<figcaption>Left: original. Right: Amount 0.01.</figcaption>
</figure>

**Use it for:** glitch hits on the beat · a cheap-lens or 3D-glasses look · nervous, unsettled
moments.

- **Amount** – how far red and blue move, each in its own direction, as a share of the picture width
  (of the height when vertical). 0.005 (the default) is a fine fringe, 0.01 a clear glitch.
- **Angle** – the direction, in degrees: 0° sideways, 90° up and down (Offset mode only).
- **Mode** – **Offset** shifts the whole picture; **Lens** leaves the middle clean and lets the
  fringes grow towards the edges, like a cheap lens.

**Tip:** keyframe Amount in short bursts for glitch hits on the beat.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Amount | 0 to 0.1 | 0.005 |
| Angle (Offset mode only: Lens splits outwards from the centre) | 0 to 360° | 0° |
| Mode | Offset, Lens | Offset |
| Frame Edges | Mirror, Clamp, Transparent | Mirror |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--float-right">

![RGB Split's Channel Merge folder: Blue, Green and Red Plate each feed a Split Vector; the R of the red plate, the G of the green plate, the B of the blue plate and Union Alpha feed Combine Vector](../assets/effects/graphs/rgb-split-channel-merge.webp)

<figcaption>Part of the Channel Merge & Straight Alpha folder: one colour from each plate.</figcaption>
</figure>

RGB Split reads the picture three times: the **Red Plate** shifted one way, the **Green Plate** in
place and the **Blue Plate** shifted the other way. Each **Split Vector** takes the plate apart, and
**Combine Vector** keeps red from the red plate, green from the green plate and blue from the blue
plate. The **Union Alpha** keeps the coloured fringes visible over transparency.

**Remix:** for red and cyan like 3D glasses, plug the **G** output of the Blue Plate's Split Vector
into **G** of **Combine Vector**. Green then moves with blue.

<div class="docs-float-end"></div>

## Technical details

- **Offset mode** moves red and blue Amount × |(cos × width, sin × height)| pixels along the on-screen
  Angle, in opposite directions.
- **Lens mode** offsets their reads by ∓2 × Amount × the distance from the centre: no split in the
  middle, Amount × width at the left and right edges. Angle is dimmed there.
- **Alpha** is the largest of the three reads, so a split logo on transparency shows its fringes.
- **Units.** Angle is stored in radians and shown in degrees; keyframe lanes, MIDI and tools use
  radians.
- **Saved projects** keep their look; diagonal splits point exactly along the on-screen angle.

Frame edges and transparency: [Lens & Distort](../Effect-System.md#lens--distort-notes).
Recipes: [Effect system: editable mirror, split and pixel graphs](../Effect-System.md#editable-mirror-split-and-pixel-graphs).
Nodes: [Node Catalog](../Node-Catalog.md).
