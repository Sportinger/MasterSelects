# Lens & Distort

Bend, swirl, fold or straighten the picture: playful lens looks, mirror patterns and corrections for
photos. Add one in **Properties → Effects → + Add Effect → Lens & Distort**
([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: distort -->

## Which one?

| Look | Use |
|---|---|
| a lens bump or a squeeze | [Bulge & Pinch](./effects/bulge.md) |
| a swirl | [Twirl](./effects/twirl.md) |
| ripples, heat shimmer | [Wave](./effects/wave.md) |
| an ultra-wide round lens | [Fisheye Lens](./effects/fisheye.md) |
| a symmetric pattern | [Kaleidoscope](./effects/kaleidoscope.md) |
| a mirror image | [Mirror](./effects/mirror.md) |
| colour fringes, a glitch | [RGB Split](./effects/rgb-split.md) |
| glass, prism and foil | [Film Prism](#film-prism), [Holo](#holo), [Crystal Glass](#crystal-glass), [Glass Dispersion](#glass-dispersion) |
| straight lines in a photo | [Lens Correction](./effects/lens-correction.md), then [Guided Perspective](./effects/guided-perspective.md) |
| a full frame after a correction | [AI Edge Fill](./effects/ai-edge-fill.md) |

## The shared idea

A distortion does not move pixels. Every pixel of the result asks: which spot of the original do I
show? Change that spot and the picture bends. Bulge & Pinch, Twirl, Wave, Kaleidoscope, Mirror and
RGB Split all work this way, and each is a small node graph you can open: select the clip, open the
**Nodes** tab and use the › on the effect's card, then on each folder
([The node setup](./Effects.md#the-node-setup)).

<figure class="docs-shot docs-shot--graph">

![The Twirl graph from left to right: Parameters and Input Frame, then Centre, Shape & Radius, Twirl Angle, Premultiplied Source (cached), Frame Edges & Sampling, Straight Alpha Output and Output; the Constants and Coordinates folders are hidden](assets/effects/graphs/twirl.webp)

<figcaption>Twirl as it opens in the Node Workspace, with the Constants and Coordinates & Resources folders left out of the picture and cables routed around the cards.</figcaption>
</figure>

- **Centre, Shape & Radius** measures each pixel's **Offset** from the centre and its **Distance /
  Radius**: 0 in the middle, 1 at the edge of the area.
- The middle folder is the effect itself: **Twirl Angle**, **Bulge & Pinch Curve**, **Wave
  Displacement**, Kaleidoscope's **Wedge Fold** or Mirror's **Mirror Lines**. It turns the offset into
  a **Read Position**. Each effect page shows its folder.
- **Frame Edges & Sampling** reads the picture once at that position. **Premultiplied Source** and
  **Straight Alpha Output** around it keep transparent edges clean.

### Two shared controls

<figure class="docs-shot docs-shot--float-right docs-shot--detail">

<div class="docs-shot-stage">

![The Twirl effect card in Properties → Effects: Twist 200°, Radius 0.6, Center X and Center Y 0.5, Shape Circle and Frame Edges Mirror](assets/effects/editor/twirl-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 418" aria-hidden="true" focusable="false">
<defs><marker id="twirl-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M101 132 L161 132" marker-end="url(#twirl-inspector-arrow)" />
<circle class="docs-shot-number" cx="101" cy="132" r="18" /><text x="101" y="132" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M23 359 L83 359" marker-end="url(#twirl-inspector-arrow)" />
<circle class="docs-shot-number" cx="23" cy="359" r="18" /><text x="23" y="359" class="docs-shot-number-text">2</text>
</svg>
</div>

<figcaption>The Twirl card in Properties → Effects. 1 — Twist, in degrees. 2 — Frame Edges.</figcaption>
</figure>

- **Shape**: **Circle** keeps the area round on any picture. **Stretch to Frame** stretches it to the
  shape of the frame, an oval on a wide picture. Bulge & Pinch, Twirl and Kaleidoscope have it.
- **Frame Edges** decides what appears where a read lands past the edge of the picture, for example
  in a pinch or in waves along the border: **Mirror** reflects the picture, **Clamp** repeats the
  border pixels as streaks, **Transparent** leaves those places empty. Bulge & Pinch, Twirl, Wave,
  Kaleidoscope, Mirror and RGB Split have it; Fisheye Lens has its own, with Repeat as a fourth
  choice.

<div class="docs-float-end"></div>

## Technical details

Notes for developers; each effect page adds its own formula and limits.

- **Units.** Shape Circle measures offsets and Radius in units of the shorter frame side (0.5 = half
  of it), so circles stay round and match at every resolution; Stretch to Frame measures each axis
  in its own 0–1 range. Angles are stored in radians and shown in degrees; keyframe lanes, MIDI and
  tools use radians.
- **Sampling.** The frame is premultiplied into an `rgba16float` cache, read with one bilinear sample
  at the read position (Kaleidoscope: two, crossfaded) and unpremultiplied, so transparent edges keep
  their colour without a dark rim. Transparent frame edges fade over one source pixel by lowering
  alpha only. One sample per pixel means very strong settings shimmer on fine detail.
- **Neutral settings** (Bulge & Pinch Amount 1, Twist 0, both Wave heights 0, RGB Split Amount 0,
  Mirror with both axes off) skip the built-in recipe, so the picture passes through exactly.
- **Software preview and export.** Without WebGPU (software preview, worker-first export readback)
  the untouched recipes run as a hand-written pass with the same mapping, frame edges and
  premultiplied read, within 1/255 of the graph; edited graphs run through the graph interpreter.
- **Warnings.** Clamped or degenerate values (Radius ≤ 0, negative Amount, unknown Shape or Frame
  Edges choices, out-of-range Fisheye values, Lens Correction folding at the active composition size,
  Guided Perspective limits) appear below the effect in the inspector, judged on the values at the
  playhead, and in the `addEffect` / `updateEffect` tool results.
- **Code.** The recipes live in `src/services/operators/uvDistortRecipes.ts` and
  `mirrorRecipes.ts`. More: [Effect system: editable UV distortions](./Effect-System.md#editable-uv-distortions),
  [editable mirror, split and pixel graphs](./Effect-System.md#editable-mirror-split-and-pixel-graphs),
  [Node Catalog](./Node-Catalog.md) and [Operator Graph Compiler](./Operator-Graph-Compiler.md).
- **Pictures.** The `distort.json` and `mirror-pixel.json` manifests in `scripts/effect-graph-shots/`
  and `scripts/effect-editor-shots/` regenerate the graphs and the editor excerpts;
  `scripts/effect-lab-shots/mirror-pixel.json` regenerates the Kaleidoscope, Mirror and RGB Split
  stills.
