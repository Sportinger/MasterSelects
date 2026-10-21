# Zoom Blur

Streaks the picture outward from a centre point, as if zooming in during the exposure. A burst of
speed.

Group: [Blur & Sharpen](../Effects-Blur.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Original left, Zoom Blur (Amount 0.3) right, on the night street](../assets/effects/zoom-blur.webp)

<figcaption>Left: original. Right: Amount 0.3.</figcaption>
</figure>

**Use it for:** an impact or a sudden reveal · a rush into the picture between two scenes · a
tunnel of light around a performer.

- **Amount** – the length of the streaks. 0.1 is subtle, 0.3 a clear zoom burst, 1 is extreme.
- **Center X / Center Y** – where the burst starts.

**Tip:** animate Amount from 0 to 0.3 and back over a few frames for a punch on a beat. For a
gentler zoom that fades outward, use [Radial Blur](./radial-blur.md)'s Zoom type.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Amount | 0 to 1 | 0.3 |
| Center X | 0 to 1 | 0.5 |
| Center Y | 0 to 1 | 0.5 |
<!-- generated:controls end -->

## Node setup

Zoom Blur has the two stages of [Motion Blur](./motion-blur.md#node-setup), along a ray from the
centre and without a Type: **Blur Range** works out the ray, **Stage A** averages short pieces of
it and **Stage B** adds them up. Every read along the ray counts the same.

**Remix:** to let the burst fade outward, open **Stage B** and find the **Multiply** whose output is
Tap Weight (its input A is fed by **One**). **Multiply** Position t by a **Value** of 0.5,
**Subtract** that from a **Value** of 1 (A = the Value 1, B = the Multiply) and plug the result into
that input A. This is exactly Radial Blur's Zoom fade (1 − t/2).

## Technical details

- **Units.** Center is relative to the frame. The streak reaches 0.5 × Amount of each pixel's
  distance from the centre, so it grows towards the edges.
- **Two stages.** The same read budget as Motion Blur (Stage A up to 256, Stage B up to 64 reads);
  longer streaks are reported. At the frame edge the picture is clamped.
- **Below 0.** A negative Amount streaks inward.
- Shared blur notes (transparency, saved projects, software preview):
  [Blur & Sharpen](../Effect-System.md#blur--sharpen-notes). Formulas:
  [Effect system](../Effect-System.md#editable-blur-kernels); blocks:
  [Node Catalog](../Node-Catalog.md).
