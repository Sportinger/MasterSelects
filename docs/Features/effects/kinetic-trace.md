# Motion Trails

<!-- effect-docs: basic page sha=4f076599b99d, written by scripts/effect-docs.mjs. Delete this line to write the page by hand (template B in Documentation-Site.md). -->

Leaves fading light trails behind moving content that drift with the tracked motion, tinted with the Overlay color around the subject.

Group: [Keying & Time](../Effects-Keying-Time.md) · [How to add an effect](../Effects.md#add-an-effect)

*A short page made from the editor’s effect catalog: what the effect does and its controls. Tips and its node setup will follow.*

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| **Mix** | | |
| Amount | 0 to 1 | 0.8 |
| **Color** | | |
| Overlay | a colour | `#36f59a` |
| **General** | | |
| History Loop | Reset, Continuous | Reset |
<!-- generated:controls end -->

## Technical details

It builds on its own earlier frames, so its trails grow during playback; **History Loop** sets whether they start again when playback jumps back to the loop start. How effects are stored, rendered and exported: [Effect system](../Effect-System.md). Its building blocks: [Node Catalog](../Node-Catalog.md).

Go deeper: [Effect system: landmark tracking effects](../Effect-System.md#landmark-tracking-effects)
