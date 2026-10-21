# AI Edge Fill

Fills the empty borders left by lens and perspective corrections on a still photo with AI-made
scenery. The frame is full again, without cropping.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

**Use it for:** a full frame after [Lens Correction](./lens-correction.md) or
[Guided Perspective](./guided-perspective.md) without cropping · keeping the whole photo after a
strong straightening.

Add it after the corrections and before other effects. In the effect card choose a generation size
(1K, 2K or 4K), adjust the prompt for the scene if needed and click **Generate fill**. Generation uses
the cloud AI service and its credits; the result is saved with the project, so playback and the
export use it without new requests.

- **Fill Opacity** – how strongly the added areas show.
- **Seam Blend** – softly matches the colour of the added areas to the photo next to them, in
  composition pixels (default 12; 0 switches it off).

**Tip:** generate before masks and colour grading. When you change a correction afterwards, the card
asks you to generate again.

## Controls

<!-- generated:controls start -->
| Control | Range | Default |
|---|---|---|
| Generation Size | 1K, 2K, 4K | 2K |
| Prompt | text | a description of the scene to continue (editable) |
| Generate fill | button | – |
| Fill Opacity | 0 to 100 | 100 |
| Seam Blend | 0 to 64 | 12 |
<!-- generated:controls end -->

## Node setup

AI Edge Fill is a fixed shader with its own controls: it has no node graph to open.

## Technical details

- Only transparent pixels take the generated image; the photo itself keeps its resolution and colour,
  even where the model changed it. Seam Blend reduces colour seams, not mistakes in the generated
  structure. Results that change the aspect ratio are rejected.
- The effect covers the whole composition, so outer margins are filled too. Bypass returns to the
  photo's own footprint. Tilted 3D planes and an enabled composition camera are not supported.
- A started request can be resumed (**Resume task**) without starting a new generation. **Discard
  pending task** allows a fresh request; it does not cancel a job that has already started.
- Missing or non-numeric placements fall back to finite values, and a zero-area placement is handled
  without dividing by zero.

More, including what is sent to the AI service: [Effect system: AI Edge Fill](../Effect-System.md#ai-edge-fill).
