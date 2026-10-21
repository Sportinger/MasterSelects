# Rain Reveal

<!-- effect-docs: basic page, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Pours falling streaks of the Overlay color over the scene, with less rain over the tracked subject and a slightly dimmed background.

Group: [Tracking & Overlays](./index.md#tracking--overlays) · [How to add an effect](../Effects.md#add-an-effect)

<figure class="docs-shot">

![Rain Reveal on the dancer on a dark stage: the original on the left, Rain Reveal at its default settings on the right](../assets/effects/rain-reveal.webp)

<figcaption>Left: the original. Right: Rain Reveal at its default settings, one frame of its movement.</figcaption>
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

**Styles:** the **Style** menu in the effect card switches to another look with the same controls and keyframes: [CCTV](./cctv.md), [HUD Tracker](./hud-tracker.md), [Stardust](./stardust.md), [Tracked Scene](./tracked-scene.md).

## Technical details

Rain Reveal is one look of the tracking overlay engine; its looks share one node setup. It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
