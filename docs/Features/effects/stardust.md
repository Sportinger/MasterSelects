# Stardust

<!-- effect-docs: basic page sha=717498745753, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Scatters sparkling star particles in the Overlay color around the tracked landmarks, or a ring around the subject; Speed sets the drift.

Group: [Tracking & Overlays](../Effects-Tracking.md) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Stardust on the dancer on a dark stage: the whole frame twice, the original on the left, Stardust at its default settings on the right](../assets/effects/stardust.webp)

<figcaption>Left: the original. Right: Stardust at its default settings, one frame of its movement.</figcaption>
</figure>

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Style** | | |
| Amount | 0 to 1 | 0.8 |
| Overlay | a colour | `#36f59a` |
| **Motion** | | |
| Speed | 0 to 5 | 1 |
<!-- generated:controls end -->

**Styles:** the **Style** menu in the effect card switches to another look of the same engine and keeps the shared values and keyframes: [CCTV](./cctv.md), [HUD Tracker](./hud-tracker.md), [Rain Reveal](./rain-reveal.md), [Tracked Scene](./tracked-scene.md).

## Technical details

Stardust is one look of the tracking overlay engine; its looks share one node setup. It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).

Go deeper: [Effect system: landmark tracking effects](../Effect-System.md#landmark-tracking-effects)
