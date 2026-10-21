# Tracked Scene

<!-- effect-docs: basic page, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Draws tracked face landmarks as dots connected by lines in the Overlay color, like a motion-capture mesh.

Group: [Tracking & Overlays](./index.md#tracking--overlays) · [How to add an effect](../Effects.md#add-an-effect)

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

**Styles:** the **Style** menu in the effect card switches to another look with the same controls and keyframes: [CCTV](./cctv.md), [HUD Tracker](./hud-tracker.md), [Rain Reveal](./rain-reveal.md), [Stardust](./stardust.md).

## Technical details

Tracked Scene is one look of the tracking overlay engine; its looks share one node setup. It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
