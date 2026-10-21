# Motion Blur

Smears the picture in one direction, as if the camera or the subject moved fast during the
exposure.

Group: [Blur & Sharpen](../Effects-Blur.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Original left, Motion Blur (Length 0.03, horizontal) right, on the dancer](../assets/effects/motion-blur.webp)

<figcaption>Left: original. Right: Length 0.03, horizontal.</figcaption>
</figure>

**Use it for:** a sense of speed · a whip pan between two shots · streaking lights and flowing
fabric.

- **Length** – how far the streak reaches to each side, as a share of the picture width (of the
  height for vertical streaks). 0.03 is a quick move, 0.1 a fast pan.
- **Angle** – the direction: 0 is horizontal, 1.57 vertical (a quarter turn), 0.79 diagonal (45°).

**Tip:** keep Length small on faces; long streaks work best on lights and fabric.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Length | 0 to 0.3 | 0.05 |
| Angle | 0 to 6.28 | 0 |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--graph">

![The Motion Blur graph: Parameters feed Blur Range; Blur Range feeds Tap Counts & Box Length, Stage A and Stage B; Input Frame feeds Premultiplied Source, which feeds Stage A; Stage A feeds Stage B and then Straight Alpha Output](../assets/effects/graphs/motion-blur.webp)

<figcaption>Motion Blur (Constants, Coordinates and the Output card left out). Radial and Zoom Blur have the same stages.</figcaption>
</figure>

The blur smears every pixel along a line. **Blur Range** works out the line from the
**Parameters**, and **Tap Counts & Box Length** decides how many short pieces it is cut into.
**Stage A** averages one short piece and caches it; **Stage B** reads the cache once per piece along
the whole line, so a long streak needs dozens of reads, not hundreds.

### A soft taper

<figure class="docs-shot docs-shot--graph">

![Motion Blur's taper inside Stage B: Position t times Two, minus One, squared, times Taper Gain (−2), then Exponential; the last Multiply weighs that with the Box Weight into Tap Weight](../assets/effects/graphs/motion-blur-taper.webp)

<figcaption>exp(−2 · (2t − 1)²): Exponential fades both ends of the streak; the last Multiply weighs each read with it.</figcaption>
</figure>

The white value cards (**Two**, **One**, **Taper Gain**) live in the effect's **Constants** folder.

**Remix:** for an even streak, open **Stage B**, unplug **Exponential** from input A of the last
**Multiply** and plug a **Value** of 1 into A. Leave input B alone: it carries the Box Weight. Or
select **Taper Gain** and set its value from −2 to −6 in the node inspector for a shorter, harder
streak.

## Technical details

- **Units.** The streak reaches Length × |(cos × width, sin × height)| to each side; Angle is the
  on-screen direction in radians (0–6.28).
- **Two stages.** About 2 × √(2 × streak length in pixels) reads per pixel (Stage A up to 256,
  Stage B up to 64); longer streaks are reported. At the frame edge the picture is mirrored.
- **Below 0.** A negative Length leaves the picture unchanged, and the inspector and the tool
  result say so.
- Shared blur notes (transparency, saved projects, software preview):
  [Blur & Sharpen](../Effects-Blur.md#technical-details). Formulas:
  [Effect system](../Effect-System.md#editable-blur-kernels); blocks:
  [Node Catalog](../Node-Catalog.md).
