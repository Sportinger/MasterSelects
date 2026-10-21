# Motion Trails

<!-- effect-docs: basic page, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Leaves fading light trails behind moving content that drift with the tracked motion, tinted with the Overlay color around the subject.

Group: [Time](../Effects-Keying-Time.md) · [How to add an effect](../Effects.md#add-an-effect)

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
| **General** | | |
| History Loop | Reset, Continuous | Reset |
<!-- generated:controls end -->

## Technical details

It keeps moving while the playhead stands still. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).
