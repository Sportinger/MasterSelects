# Color & Tone

Light and colour, from a quick brightness fix to a complete colour mood, flat poster tones or pure
black and white. Add one in **Properties → Effects → + Add Effect** ([Using effects](./Effects.md#add-an-effect)).

<!-- docs-gallery: color -->

## Which one?

| I want… | Use |
|---|---|
| lighter or darker mid-tones, without a grey veil | [Brightness](./effects/brightness.md) |
| more or less light, like the camera's aperture | [Exposure](./effects/exposure.md) |
| more punch | [Contrast](./effects/contrast.md) |
| exact black and white points, or a faded look | [Levels](./effects/levels.md) |
| stronger or weaker colours | [Saturation](./effects/saturation.md); on faces [Vibrance](./effects/vibrance.md) |
| warmer or cooler light | [Temperature](./effects/temperature.md) |
| different colours | [Hue Shift](./effects/hue-shift.md) |
| a negative | [Invert](./effects/invert.md) |
| a few flat tones | [Posterize](./effects/posterize.md) |
| pure black and white | [Threshold](./effects/threshold.md) |

## The shared idea

<figure class="docs-shot docs-shot--graph">

![The Brightness graph: Input Frame, Split RGB + Alpha, the Parameters folder with its Amount output, the Brightness Curve folder, Combine RGB + Alpha and Output; the Constants folder is hidden](assets/effects/graphs/brightness.webp)

<figcaption>Brightness as it opens in the Node Workspace, with the Constants folder left out. Every colour effect has this shape.</figcaption>
</figure>

Every colour effect is a small node graph of the same shape:

- **Split RGB + Alpha** separates the colour from the transparency.
- **Parameters** holds the controls. Each one passes through a limit, so a typed-in extreme value
  cannot break the picture.
- One folder does the actual work, for example **Brightness Curve**, **Exposure (Stops)** or
  **Hue Rotate (OkLCh)**. Each effect page shows its folder under *Node setup*.
- **Combine RGB + Alpha** puts the untouched transparency back.

Black stays black and white stays white unless you ask for it, and colours keep their shade when you
push them. The blocks **Brightness Curve**, **Contrast Curve**, **Exposure (Stops)**, **White
Balance**, **Saturation (Gamut-Safe)** and **Hue Rotate (OkLCh)** are also in **right-click →
Reusable Nodes** (category Color & Mask), so you can drop them into any other image effect graph.
How to open a graph: [The node setup](./Effects.md#the-node-setup).

## Technical details

Recipes: `src/services/operators/colorEffectGraphs.ts` (tuning in `COLOR_RECIPE`; Posterize and
Threshold in `pointwiseEffectGraphs.ts`). Formulas:
[Effect system: editable color effect graphs](./Effect-System.md#editable-color-effect-graphs);
blocks: [Node Catalog](./Node-Catalog.md); graph contract:
[Operator Graph Compiler](./Operator-Graph-Compiler.md).

- **Range.** The effect chain carries 8-bit, display-referred colour; the recipes limit their input
  to 0–1, so there is no HDR headroom between effects.
- **Beyond the slider.** In the number field you can type past the end of a slider, up to what the
  effect can show (each page names its range). If a keyframe, a node or the AI agent goes further,
  the effect uses the limit, and the inspector, `addEffect`/`updateEffect` warnings and
  `listEffects` (`renderRange`) report it.
- **Performance.** All recipes are per-pixel math without extra texture reads. A single colour
  effect runs inside the composite pass; in a stack each one is its own pass. The worker software
  render modes evaluate the same graphs on the CPU, once per distinct colour of the frame (about
  0.2–0.4 s for a 1080p photo); a layer that mixes them with the retired `blur` effect is skipped and
  reported (`unsupported-effects`).
- **Saved projects.** Brightness, Contrast, Exposure, Levels, Saturation, Vibrance, Temperature and
  Hue Shift keep the graph they were saved with, so projects from before the 2026-10 rebuild look as
  before (`legacyColorEffectGraphs.ts`); add the effect again for the current look. A colour effect
  saved before effect graphs existed loads with the original graph; new effects get the recipe graph
  when they are added, also on adjustment layers, where an agent's `configure` keeps the graph of
  every effect it keeps.
- **Looks.** Custom Looks saved before the 2026-10 rebuild apply their colour effects with the
  original graphs; new Looks store each colour effect's graph (Look schema 2). A stored Look graph is
  validated when the Look is applied; one that no longer validates renders the current recipe, with a
  notice. To move an old Look to the new math, rebuild it from freshly added effects and save it
  again.
- **Known gaps.** Adjustment layers in the optional worker GPU render modes still use the older 4×5
  colour matrix for Brightness, Contrast and Saturation; the `WorkerGpuAdjustment` log, and the
  adjustment inspector while such a mode is selected, name each effect that looks different there
  (`adjustment-color-recipe-unsupported`).
- **Pictures.** `scripts/effect-lab.mjs --pairs`, `scripts/effect-graph-shot.mjs` and
  `scripts/effect-editor-shot.mjs`, with the manifests in `scripts/effect-*-shots/` (`color.json`;
  Posterize and Threshold in `stylize.json`).
