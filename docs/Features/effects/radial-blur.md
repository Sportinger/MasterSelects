# Radial Blur

Blurs around a centre point: Zoom streaks the picture towards it, Spin turns it in circles. The
middle stays sharp.

Group: [Blur & Sharpen](../Effects-Blur.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Original left, Radial Blur in Spin mode (Amount 0.5) right, on the night street](../assets/effects/radial-blur.webp)

<figcaption>Left: original. Right: Spin, Amount 0.5.</figcaption>
</figure>

**Use it for:** a swirling, dizzy moment · drawing the eye to one point · a soft rush towards the
middle of the frame.

- **Type** – **Zoom** streaks towards the centre and fades outward; **Spin** turns the picture in
  circles, like a rotating camera.
- **Amount** – strength. For Spin, 0.5 is a turn of about 10 degrees, 2 about 40.
- **Center X / Center Y** – where the sharp middle sits (0.5 / 0.5 is the centre of the picture).

**Tip:** put the centre on the performer to keep them sharp while the stage swirls. For a strong,
even zoom burst use [Zoom Blur](./zoom-blur.md).

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Type | Zoom, Spin | Zoom |
| Amount | 0 to 2 | 0.5 |
| Center X | 0 to 1 | 0.5 |
| Center Y | 0 to 1 | 0.5 |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![Inside Radial Blur's Blur Range: Type and the value Half feed Greater Than; its Is Spin output and the inputs Zoom Range and Spin Arc feed a Switch that outputs Range Length](../assets/effects/graphs/radial-blur-type.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 559" aria-hidden="true" focusable="false">
<defs><marker id="radial-blur-type-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M295 22 L295 56" marker-end="url(#radial-blur-type-arrow)" />
<circle class="docs-shot-number" cx="295" cy="22" r="18" /><text x="295" y="22" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M478 22 L478 56" marker-end="url(#radial-blur-type-arrow)" />
<circle class="docs-shot-number" cx="478" cy="22" r="18" /><text x="478" y="22" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>1 — Greater Than turns Type into Is Spin. 2 — a Switch picks the Zoom or the Spin range.</figcaption>
</figure>

Radial Blur has the two stages of [Motion Blur](./motion-blur.md#node-setup), along a ray from the
centre (Zoom) or a circle around it (Spin). Inside **Blur Range**, **Greater Than** (1) turns Type
into Is Spin (Type above **Half**), and **Switch** nodes (2) pick the path.

**Remix:** to always spin, plug a **Value** of 1 into input A of **Greater Than** (1); every
Switch (2) then picks Spin.

<div class="docs-float-end"></div>

## Technical details

- **Units.** Center and Amount are relative to the frame. Spin turns by 20° per unit of Amount in
  total. Zoom streaks grow with the distance from the centre, and their reads fade along the streak
  (1 − t/2); at Amount 0.3, [Zoom Blur](./zoom-blur.md)'s streak is about five times as long.
- **Two stages.** The same read budget as Motion Blur (Stage A up to 256, Stage B up to 64 reads);
  longer streaks are reported. At the frame edge the picture is clamped.
- **Below 0.** A negative Amount leaves the picture unchanged, and the inspector and the tool
  result say so.
- Shared blur notes (transparency, saved projects, software preview):
  [Blur & Sharpen](../Effect-System.md#blur--sharpen-notes). Formulas:
  [Effect system](../Effect-System.md#editable-blur-kernels); blocks:
  [Node Catalog](../Node-Catalog.md).
