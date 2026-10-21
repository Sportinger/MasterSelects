# Hand Particles

<!-- effect-docs: basic page sha=97bb344557c6, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Adds drifting glowing particles around tracked hands in the Overlay color; Particle Source picks fingertips, all landmarks or hand centers.

Group: [Tracking & Overlays](../Effects-Tracking.md) · [How to add an effect](../Effects.md#add-an-effect)

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
| **Tracking** | | |
| Particle Source | Fingertips / Joints, All Landmarks, Centroid | Fingertips / Joints |
<!-- generated:controls end -->

## Technical details

It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).

Go deeper: [Effect system: landmark tracking effects](../Effect-System.md#landmark-tracking-effects)
