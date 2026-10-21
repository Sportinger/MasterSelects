# Analog & Glitch

Effects that make a picture look as if it came through an old TV, a worn tape or a broken digital signal. Add one in **Properties → Effects → + Add Effect** ([Using effects](./Effects.md)).

<figure class="docs-shot docs-clip">
<video src="assets/effects/clips/add-glitch.mp4" poster="assets/effects/clips/add-glitch.webp" width="1280" height="716" autoplay muted loop playsinline preload="none" aria-label="Screen recording: the pointer clicks + Add Effect in Properties, Effects, types glitch and clicks the Glitch tile; the Glitch card appears, the pointer drags its Density slider to 1 and the preview of the dancer breaks up"></video>
<figcaption>Adding Glitch: + Add Effect, type glitch, click the tile, drag Density.</figcaption>
</figure>

<!-- docs-gallery: analog -->

## Which one?

| Look | Use |
|---|---|
| a broadcast or a worn VHS tape, with real faults | [Analog Signal Lab](./effects/analog-signal-lab.md) |
| an old tube TV: lines, stripes, curved glass | [CRT Screen](./effects/crt-screen.md) |
| TV lines over the picture, nothing else | [Scanlines](./effects/scanlines.md) |
| film grain | [Film Grain](./effects/grain.md) |
| a digital signal breaking up in bursts | [Glitch](./effects/glitch.md) |
| grid cells jumping sideways | [Glitch Grid](./effects/glitch-grid.md) |
| soft waves pushing the picture sideways | [Ribbon Scan](./effects/ribbon-scan.md) |
| raw leftover memory shown as pixels | [Memory Leak](./effects/memory-leak.md) |

Related looks in other groups: [Film Prism](./effects/film-prism.md), [Holo](./effects/holo.md), [Crystal Glass](./effects/crystal.md) and [Glass Dispersion](./effects/glass-dispersion.md) under Lens & Distort, [Pixel Sort](./effects/pixel-sort.md) under Pixel & Mosaic and [Wave Lines](./effects/wave-lines.md) under Lines & Engraving.

## The shared idea

<figure class="docs-shot docs-shot--graph">

![The stage folders of Glitch from left to right: Parameters feed Burst Clock; Burst Clock feeds Torn Rows and Block Copies; both feed Read Position & RGB Split, which feeds Channel Reads & Swap; Block Copies also sends Swap Channels and the Input Frame sends the frame to Channel Reads & Swap, which feeds Colour & Alpha](assets/effects/graphs/glitch-stages.svg)

<figcaption>The stage folders of Glitch and the main signals between them (a diagram; the Node Workspace also shows the Constants and Coordinates folders and each folder's ports).</figcaption>
</figure>

CRT Screen, Glitch, Film Prism, Holo and Ribbon Scan are small node graphs you can open and change; the first three open as stage folders. All of them first decide **where** to read the picture, then **what light** to show. In Glitch, **Burst Clock** decides when the signal breaks, **Torn Rows** and **Block Copies** decide where, and the last stages read the picture there and put the colours back together. CRT Screen bends the read position into a tube, Film Prism spreads it into seven reads along a rainbow.

Sizes count against the frame (lines per picture height, pixels at 1080 lines), so the export, 4K and a full-quality preview look the same. Every random choice comes from a **Random (Integer Hash)** node keyed by whole numbers, so a frame looks the same every time you play or scrub back to it.

## Technical details

- **Time.** The effects follow timeline time: the preview, scrubbing and the export match, and Speed 0 freezes them.
- **Hash keys.** Every key the recipes hash is an exact integer below 2^24 (the seed and the cycle fold into 509 keys by integer modulo, each kind of roll adds its own integer salt, grain frames move the keys by 16384 rows), so neighbouring cells share bit-identical keys and the GPU and the worker software path hash the same bits (`tests/unit/analogHashKeys.test.ts`). The older sine hash stays unchanged for other effects.
- **Values.** Values outside a control's range are clamped and reported in the inspector and in agent tool results.
- **Stage folders** are presentation only (`effectPresentationPlans.ts`) and appear on the untouched recipe; a graph with your own folders keeps them. A folded plain folder offers only the outputs that are used; a composition keeps every output it declares.
- **Saved projects.** Effects and custom Looks saved before the 2026-10 rebuild of CRT Screen, Glitch, Film Prism, Holo and Ribbon Scan keep their original graphs (`legacyCrtScreenGraph.ts`, `legacyGlitchGraph.ts`, `legacyFilmPrismGraph.ts`, `legacyHoloGraph.ts`, `legacyRibbonScanGraph.ts`, pinned by `analogLegacyGraphs.ts`), in Look thumbnails too, without the new recipes' own controls; add the effect again for the new version.
- **Experimental.** Crystal Glass, Glass Dispersion and Pixel Sort carry an `experimental` note on their definition: the effect list adds "(Experimental)", and the inspector and the `listEffects`/`addEffect` tool results give the reason.
- **Source.** The recipes live in `src/services/operators/crtScreenRecipe.ts`, `glitchRecipe.ts`, `filmPrismRecipe.ts`, `holoRecipe.ts` and `ribbonScanRecipe.ts` (shared helpers in `analogRecipeBuilder.ts`); compilation: [Operator Graph Compiler](./Operator-Graph-Compiler.md), random nodes: [Node Catalog](./Node-Catalog.md#random-nodes).
- **Pictures and clips.** `scripts/doc-clip.mjs` (the effect loops and the operation clip, `scripts/doc-clips/analog.json`; see [Documentation Website: Docs clips](./Documentation-Site.md#docs-clips-motion-and-editor-operations)), `scripts/effect-lab.mjs`, `scripts/effect-graph-shot.mjs` and `scripts/effect-editor-shot.mjs`, each with an `analog.json` manifest (`scripts/effect-*-shots/`).
