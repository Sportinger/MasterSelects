# Gaussian Blur

A smooth, even softening, like a lens out of focus. The standard choice for backgrounds,
transitions and anything that should simply look soft.

Group: [Blur & Sharpen](../Effects-Blur.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Original left, Gaussian Blur (Radius 12) right, on the harbour image](../assets/effects/gaussian-blur.webp)

<figcaption>Left: original. Right: Radius 12.</figcaption>
</figure>

**Use it for:** soft backgrounds behind titles · a focus pull · calming a busy projection.

- **Radius** – how soft. 2–5 takes the edge off, 10 is clearly out of focus, 30 and more turns
  shapes into light.

**Tip:** animate Radius from 0 for a smooth focus pull. For a graphic, square look use
[Box Blur](./box-blur.md).

## Controls

<figure class="docs-shot">

<div class="docs-shot-stage">

![Properties, Effects with + Add Effect and a Gaussian Blur card at Radius 10, beside a strip of the blurred preview](../assets/effects/editor/gaussian-blur-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 1017 497" aria-hidden="true" focusable="false">
<defs><marker id="gaussian-blur-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M664 184 L580 184" marker-end="url(#gaussian-blur-inspector-arrow)" />
<circle class="docs-shot-number" cx="664" cy="184" r="18" /><text x="664" y="184" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M436 394 L520 394" marker-end="url(#gaussian-blur-inspector-arrow)" />
<circle class="docs-shot-number" cx="436" cy="394" r="18" /><text x="436" y="394" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M882 412 L882 328" marker-end="url(#gaussian-blur-inspector-arrow)" />
<circle class="docs-shot-number" cx="882" cy="412" r="18" /><text x="882" y="412" class="docs-shot-number-text">3</text>
</svg>
</div>

<figcaption>1 — + Add Effect lists every effect. 2 — Radius. 3 — Bypass, to compare with the original.</figcaption>
</figure>

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Radius | 0 to 50 | 10 |
<!-- generated:controls end -->

## Node setup

<figure class="docs-shot docs-shot--graph">

![The Gaussian Blur graph: Radius feeds Radius & Tap Count, Input Frame feeds Premultiplied Source; both feed Horizontal Pass, which feeds Vertical Pass and then Straight Alpha Output](../assets/effects/graphs/gaussian-blur.webp)

<figcaption>Gaussian Blur opened in the Node Workspace (the Constants and Coordinates folders and the Output card left out).</figcaption>
</figure>

**Radius & Tap Count** turns Radius into the width of the bell curve (**Sigma**) and the number of
reads (**Tap Count**, split into **Pairs** and a **Stride**). **Horizontal Pass** blurs the rows of
the **Premultiplied Source**, **Vertical Pass** the columns of that result.

### Inside a pass

<figure class="docs-shot docs-shot--graph">

![The Horizontal Pass of Gaussian Blur as a recipe: Tap Index, Pairs and Stride feed Pair Tap Offsets; Sigma and Pair Tap Offsets feed two Gaussian Falloff nodes, which feed Merge Pair Weights; Premultiplied Source and Read Position feed Sample Image; Sample Image, Merge Pair Weights and Tap Count feed Sequence Reduce, then Normalize by Weight and Cache Image](../assets/effects/graphs/gaussian-blur-horizontal-pass.webp)

<figcaption>The Horizontal Pass, reduced to its recipe. Green cards come from elsewhere in the graph.</figcaption>
</figure>

1. **Pair Tap Offsets** lists where to read: the pixel and pairs of neighbours.
2. Two **Gaussian Falloff** nodes weigh each neighbour. They are the kernel.
3. **Merge Pair Weights** folds each pair into one read (a speed trick).
4. **Sample Image** reads, **Sequence Reduce** adds up, **Normalize by Weight** averages and
   **Cache Image** keeps the result for the vertical pass.

**Remix:** for a blur that stretches sideways, open **Vertical Pass**, **Multiply** Sigma by a
**Value** of 0.5 and plug the result into the Sigma input of both **Gaussian Falloff** nodes.

## Technical details

- **Units.** Radius is in pixels of a 1080p frame and scales with the rendered size, so preview,
  export and 4K match.
- **Kernel.** sigma = Radius / 2, cut at 3 sigma. A horizontal pass into an `rgba16float` cache,
  then a vertical pass: about 1.5 × Radius + 1 reads per pass at 1080p.
- **Pair-merged taps.** One filtered read covers two neighbouring pixels at their weighted centre,
  exact for any weights. Up to 127 pairs per side; beyond that the pairs spread out, and the
  inspector and the tool result say so.
- **Older projects** render with this kernel: Gaussian is stronger at small radii and about 20 %
  softer at large ones than before.
- Shared blur notes (transparency, saved projects, software preview):
  [Blur & Sharpen](../Effects-Blur.md#technical-details). Kernel and caching:
  [Effect system](../Effect-System.md#editable-blur-kernels); blocks:
  [Node Catalog](../Node-Catalog.md).
