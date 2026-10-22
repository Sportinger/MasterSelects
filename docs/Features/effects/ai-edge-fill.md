# AI Edge Fill

Fills the empty edges a lens or perspective correction leaves on a still photo with AI-made scenery. The frame is full again, without cropping.

Group: [Lens & Distort](../Effects-Distort.md) · [How to add an effect](../Effects.md#add-an-effect)

**Use it for:** a straightened photo of the set or the house that has to fill the whole projection · keeping every pixel of a photo after a strong correction · a background plate wider than the photo you have.

- **Prompt** – what the empty edges should show.
- **Fill** – sends the photo to the AI service once; the result is saved with the project.
- **Seam Blend** – matches the colour of the added edges to the photo beside them.

It works on stills, including Canon raw photos (CR2): put it after [Lens Correction](./lens-correction.md) and [Guided Perspective](./guided-perspective.md) and before every other effect. The empty edges are the transparent areas a correction leaves, like the blue ones in the Whole Photo picture of [Guided Perspective's presets](./guided-perspective.md#presets); the effect also fills a photo that is smaller than the frame. Generating uses the cloud AI service and its credits. Playback and the export use the saved fill and send nothing again.

**Tip:** finish the corrections and the photo's position first, then generate. When you change one of them later, the card says the fill no longer matches and asks you to generate again.

## Presets

AI Edge Fill has no presets yet. What a good fill needs is mostly the right scene in the prompt; see Prompt below for words that work on a stage or a street.

## Controls


<figure class="docs-shot docs-shot--float-right">

<div class="docs-shot-stage">

![Properties, Effects with an AI Edge Fill card: the Generate section with Resolution on 2K, the Prompt field with the request to continue a room, the Generate fill button and a note that Nano Banana Pro on Kie.ai receives the corrected photo and a mask of its empty edges, then the Blend section with Fill Opacity 100 % and Seam Blend 12 px](../assets/effects/editor/ai-edge-fill-inspector.webp)

<svg class="docs-shot-overlay" viewBox="0 0 590 739" aria-hidden="true" focusable="false">
<defs><marker id="ai-edge-fill-inspector-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#ffd54a" /></marker></defs>
<path class="docs-shot-arrow" d="M88 193 L172 193" marker-end="url(#ai-edge-fill-inspector-arrow)" />
<circle class="docs-shot-number" cx="88" cy="193" r="18" /><text x="88" y="193" class="docs-shot-number-text">1</text>
<path class="docs-shot-arrow" d="M55 222 L139 222" marker-end="url(#ai-edge-fill-inspector-arrow)" />
<circle class="docs-shot-number" cx="55" cy="222" r="18" /><text x="55" y="222" class="docs-shot-number-text">2</text>
<path class="docs-shot-arrow" d="M201 409 L285 409" marker-end="url(#ai-edge-fill-inspector-arrow)" />
<circle class="docs-shot-number" cx="201" cy="409" r="18" /><text x="201" y="409" class="docs-shot-number-text">3</text>
<path class="docs-shot-arrow" d="M84 634 L168 634" marker-end="url(#ai-edge-fill-inspector-arrow)" />
<circle class="docs-shot-number" cx="84" cy="634" r="18" /><text x="84" y="634" class="docs-shot-number-text">4</text>
<path class="docs-shot-arrow" d="M74 675 L158 675" marker-end="url(#ai-edge-fill-inspector-arrow)" />
<circle class="docs-shot-number" cx="74" cy="675" r="18" /><text x="74" y="675" class="docs-shot-number-text">5</text>
</svg>
</div>

<figcaption>AI Edge Fill before its first fill. 1 — Resolution: the size of the generated picture. 2 — Prompt: what the empty edges should show. 3 — Fill: sends the request. 4 — Fill Opacity: how strongly the fill shows. 5 — Seam Blend: matches its colour to the photo.</figcaption>
</figure>

The card has two sections. Generate prepares and sends the request; its rows are locked while a request is running. Blend decides how the saved fill meets the photo; its two sliders work at any time, need no new fill and can be keyframed.

### Generate

**Resolution** – how large the generated picture is. 2K suits most frames; 4K costs more and takes longer, but gives the added edges more detail on a 4K export. The photo itself always keeps its own resolution, and the fill is scaled to the export size. 1K, 2K or 4K, default 2K.

**Prompt** – the request the AI service receives with the photo. The default asks it to continue a room. For any other scene, change only the words about the room, for example to "this theatre stage, its floor, the black masking and the lighting rig" or "this street, the house fronts, the pavement and the sky", and keep the sentences about the magenta areas and the mask: they tell the model which pixels to replace. Any text, default a request to continue a room, its walls, ceiling and floor.

**Fill** – the button that sends the request. The card sends the corrected photo, placed as in the frame, with its empty areas marked magenta, and a black-and-white mask of them, waits for the picture and saves it with the project. While a request is open, it reads **Resume task**: that fetches the same result again after a lost connection, without paying twice. Once a fill is saved, it reads **Regenerate fill**, and a **Reset** row appears whose **Clear fill** removes the fill (one undo step). It is greyed out when the clip is no still photo or when another effect than a correction comes before AI Edge Fill, and the card says why. Generate fill, Resume task or Regenerate fill, default Generate fill.

### Blend

**Fill Opacity** – how strongly the added edges show, from 0 (the empty edges come back) to 100 (fully filled). It never touches the photo itself. Keyframe it to let the frame grow from the photo on a cue. 0 to 100 %, default 100 %.

**Seam Blend** – matches the colour of the added edges to the photo beside them. The AI service often returns the scene a little warmer, darker or more saturated than the photo; Seam Blend measures that difference along the photo's edge and shifts the fill by it, fully right beside the photo and fading out at this distance, so the fill keeps its own detail and no visible line remains. 12 hides a slight colour step, 30–64 a strong one; 0 shows the fill exactly as generated. It measures pixels of the composition. 0 to 64 px, default 12 px.

<div class="docs-float-end"></div>

## Node setup

AI Edge Fill is one fixed shader with its own card: it has no node graph to open. For every pixel it reads the photo; where the photo is opaque it keeps it, and where it is empty or partly transparent it shows the saved fill behind it, shifted towards the photo's colour near the edge (Seam Blend) and as strong as Fill Opacity.

## Technical details

- **Service.** Nano Banana Pro on Kie.ai through the editor's cloud AI service; it is no local model, and the request needs a login with cloud credits. The service receives two pictures of at most 1600 px on the long side: the photo placed in the frame with its empty areas in magenta, and a mask (white: empty). Results that change the aspect ratio are rejected.
- **Photo pixels.** Only transparent pixels take the fill; the photo keeps its resolution and colour even where the model changed it. Seam Blend reduces colour steps, not mistakes in the generated structure.
- **Frame.** The effect covers the whole composition, so margins outside the photo are filled too; bypassing it returns the photo to its own size. Tilted 3D planes and an enabled composition camera are not supported, and generating refuses masks, colour correction or keyframed geometry before it.
- **Saved fill.** The PNG is stored as a required project artifact. A started request keeps its task id, so **Resume task** never starts a second generation; **Discard pending task** in the Reset row allows a fresh request but does not cancel a job the service already started.
- **Saved projects.** Seam Blend used to replace the fill beside the photo with copies of the photo's edge pixels, in four rings; it now shifts the fill's colour and keeps its detail. Saved fills look smoother along the seam: a bug fix. The labels changed (Generation Size is now Resolution), not the stored values.
- **More:** [Effect system: AI Edge Fill](../Effect-System.md#ai-edge-fill) · [Lens Correction](./lens-correction.md) · [Guided Perspective](./guided-perspective.md).
