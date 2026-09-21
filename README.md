# MasterSelects

A media editor and an agent-friendly foundation for creative tools.

Edit video, mix audio, animate graphics, build 3D scenes, and work with live
visuals. MasterSelects combines these workflows in a browser-based workspace
with WebGPU rendering and a multitrack timeline.

When your project needs a tool that isn't there yet, you can have a coding agent
build it into the editor while you work. Try the new effect, panel, or workflow
in that same project, and refine it around the job in front of you.

[Open the editor](https://www.masterselects.com/) ·
[About MasterSelects](https://www.masterselects.com/about/) ·
[Documentation](https://www.masterselects.com/docs/) ·
[Discord](https://discord.com/invite/K8dApzG3XC) ·
[Report an issue](https://github.com/Sportinger/MasterSelects/issues)

![Face Cables in MasterSelects: face tracking, custom effect controls, and animated timeline keyframes](docs/images/screenshot-face-cables.png)

*Face Cables: a custom face-tracking effect with cable physics, editable controls,
and timeline keyframes. Optional AI scene depth gives hair, body and background
a textured 2.5D surface with cable collision while MediaPipe retains the face and
cable anchors. Baked depth stays in the project and can be reused for physics.*

## Why I built this

No Adobe subscription, no patience for cracks, and no template-first online
editor. I wanted a creative workspace I could make my own.

AI should be able to do the edit, and help build the tool itself, right when you
need it. A real project gives you a reason to build something and a place to
try it immediately.

<h3>I want people to contribute the useful things they build. An effect made for
one person's project can become a tool someone else already has when they need
it. As those contributions become part of MasterSelects, both people and their
agents have more to work with, and the next task gets a little easier.</h3>

Meanwhile, I'll keep a refined version available at
[masterselects.com](https://www.masterselects.com/), reviewing and polishing
contributions as I bring them together into a cohesive editor.

## Build while you create

Start the editor locally from source, open your project, and work from there:

1. **Find the missing piece.** A task in your project calls for a new effect,
   control, or workflow.
2. **Build it with your agent.** Let your coding agent add it to the codebase
   while you work on the project.
3. **Use and refine it.** Try it in the same project and adjust it to what the
   work actually needs.
4. **Contribute it back.** Share useful additions so the next person, and their
   agent, can build on them.

See [Run locally](#run-locally) to get started.

## An agent-friendly codebase

The codebase gives coding agents concrete ways to find their bearings, extend
existing systems, and check their work:

- **A map of the project.** [AGENTS.md](AGENTS.md) documents architecture,
  conventions, and verification workflows; the [feature docs](docs/Features/README.md)
  explain how each part of the editor works.
- **Reusable building blocks.** Registered effect modules, shared inspector
  controls, typed tool schemas, and store slices give new features existing
  patterns to build on.
- **Access to the running editor.** The [local MCP bridge](docs/Features/AI-Bridge-Control.md)
  lets agents inspect the timeline, operate tools, and examine results while
  working on the source.
- **Performance diagnostics.** When playback feels slow or laggy, agents can
  sample frame timings, inspect main-thread work, decoder state, cache usage,
  and audio drift, and read playback traces through the bridge. Repeatable
  playback and scrub probes help reproduce a problem and compare changes.
  See [playback debugging](docs/Features/Playback-Debugging.md).
- **9,000+ automated test definitions.** The test suite includes editor behavior,
  project state, tool policy, and architecture checks. Agents can run relevant
  tests as they change the code.

## Make the edit

| Workspace | What you can do |
| --- | --- |
| **Video** | Edit multiple tracks, nest compositions, work with proxies, sync multicam footage, and import Premiere Pro sequences. |
| **Nodes** | Kaleidoscope pilots reusable coordinate nodes with editable interiors, dynamic nested layout and a following output. Collapsed effects use regular node cards; folding and surrounding movement animate without changing the viewport. Value cards have white accents and inspector-only Float/Integer selection. One clip canvas with nested groups, executable texture/material/geometry nodes, detailed face/depth processing, synchronized effect controls and a searchable catalog. Smooth, continuous exponential wheel and trackpad zoom stays anchored to the pointer. An OffscreenCanvas worker draws the graph and directional signal animation on separate cached layers. DOM interaction targets are limited to the viewport plus a margin; effect groups have a bypass synchronized with Properties. Compact animation areas show existing keyframes directly on their target nodes; extract a keyframe node to share a curve, with its cables revealed on selection. A collapsible Stabilization group exposes landmark conversion, baked transform curves and their clip target, with its own bypass and gray inactive keys in the timeline and curve editors. Executable 3D nodes support bypass, including transforms already recorded in supported Face Cables bakes. Typed ports show accepted formats; Video Source exposes reusable tracking and saved depth alongside audio analysis. |
| **Color & effects** | Grade through Color Nodes or the synchronized Color controls, inspect curves and scopes, combine GPU effects and transitions, and animate masks and properties with keyframes. All nine color effects plus Threshold, Posterize, and Vignette expose executable groups of shared vector, math, coordinate, and color-conversion nodes, preserving alpha and using the existing render paths. Animated node parameters reuse compiled GPU pipelines. Analog Signal Lab exposes its PAL, RF, VHS, receiver, decoder, and CRT processing as an editable compute graph. |
| **Audio** | Edit waveforms and spectrograms, mix tracks with effects and sends, record audio, and separate stems. |
| **Motion & tracking** | Animate text, shapes, Lottie, and Rive assets; create captions; track faces and surfaces; bypass baked face/lip stabilization without deleting keyframes; and attach graphics to tracked motion. |
| **3D** | Combine footage with models, lights, cameras, and Gaussian splats in a shared scene. |
| **AI** | Ask the editor to change the timeline, generate media, or use local transcription, segmentation, and depth estimation. |

Arrange the dockable panels for the work at hand. The interface is optimized for
touch and iPad, with phone workflows still being refined. Multiple preview
outputs support live and installation workflows.

Explore the [feature guide](docs/Features/README.md) for workflows and examples.

Scanlines and Film Grain expose editable UV/time/math graphs with reproducible
timeline animation; Grain includes an explicit seed. Their paused preview and
export use the same clock instead of elapsed browser time.
CRT Screen likewise exposes its curvature, scanline, mask and flicker pipeline
as an editable generic graph driven by the composition timeline clock.
Ribbon Scan uses the same graph compiler for its animated ribbon mask, horizontal
displacement and blending, retaining alpha from the displaced sample.
Glitch and Film Prism expose their sampling, shared noise/hash math and
timeline-driven channel displacement as editable generic graphs.
Crystal and Glass Dispersion expose their facet/refraction sampling in the same
form, using native vector normalization, sampled alpha and timeline-driven motion.
Holo exposes interference, spectrum and luminance-edge math as an editable graph;
GPU rendering keeps native automatic derivatives while software uses explicit coarse quads.
Halftone and Pattern Halftone expose rotation, cell geometry, luminance-derived
mark size, ink colors and pattern selection as editable generic graphs.
Riso and Riso Glow expose registration sampling, subtractive inks and optional
timeline-driven glow as editable graphs while retaining source alpha.
Dithering and Dither Studio expose Bayer/checker thresholds, quantization and
catalog-owned kernel selection as editable graphs with original alpha.
Pixel Press and Pixel Poster expose their source sampling, grain/posterization
math and final amount blend as editable graphs while preserving source alpha.
All 18 glyph effects expose cell sampling, tone mapping, cached glyph atlases
and their ink, border or cell-index blends as editable graphs. Ramp text, font
choice and animated weight remain catalog-owned parameters. ASCII Ghost uses
explicit frame history; Inscribe retains native automatic derivative semantics.
Acuarela exposes its watercolor sampling, noise and explicit previous-frame input
as an editable graph using the same scoped feedback history as playback and export.
Tone Geometry and Cross Stitch expose their rotated cells and pattern masks;
Glitch Grid, Scatter Mosaic and Drift Lines expose timeline-driven sampled-alpha
displacement as editable generic graphs.
Acuarela, Rom1, glyph animations and geometry compute effects use composition timeline time rather than wall-clock time.
Feedback effects keep paused renders stable and expose a saved History Loop choice
between Reset (default) and Continuous; seeks and export starts reset history.
Memory Leak exposes its typed memory-window source, byte decoder, availability
metadata, mapping and blend as an editable image graph. Advance and Shuffle use
the actual owning composition frame rate, including nested and export renders.
Frozen artifact blocks are reproducible across sessions; the live FFmpeg heap is
intentionally session-dependent. Uploaded `r32uint` windows are immutable per
version and held in a bounded, render-scope-isolated cache without persisting GPU handles.
Wave Lines exposes its luminance-driven wave, line mask and two-color blend with
the same timeline clock and existing color parameters.
Pixelate, Mirror, RGB Split, Blockify and Block Mosaic use editable
coordinate/sampling graphs, sharing the same compiler. Block Mosaic uses timeline
time for reproducible tile changes and exposes its border color as a bound node.
Box and Gaussian Blur expose editable sampling kernels and weights while retaining
their existing single-pass rendering and alpha averaging. Sharpen reuses the
kernel foundation and preserves center-pixel alpha.
Motion, Radial and Zoom Blur expose directional sampling and weighting as editable
nodes, retaining their existing parameter ranges and single-pass execution.
Edge Detect exposes its eight shared neighbor samples, luminance conversion and
Sobel arithmetic as editable nodes, with the existing opaque output.
Glow exposes its ring blur, brightness threshold and additive blend while
preserving the original center-pixel alpha.
Wave, Twirl, Bulge and Kaleidoscope expose their UV calculations and sampling
as editable nodes, including alpha sampled at the transformed position.
Fisheye now opens as a complete editable image graph: projection, AA jitter,
edge handling, chromatic separation, vignette and lens coverage remain ordinary
connected operators while the established degree-valued controls stay bound to
their original parameter IDs. Its persisted single-pass graph also uses the
canonical CPU evaluator in software preview/export; unsupported multipass or
mixed graph/legacy stacks fail closed instead of silently using legacy math.
Effect-bound choice nodes reuse the effect's dropdown options and defaults,
without copying parameter definitions into saved graphs.
Multi-stage image graphs share intermediate texture stages between consumers;
simple graphs retain their single-pass execution.
Compile-context-declared named image sources reuse the same resource-input path
without adding an IR stage or render pass. Up to eight inputs select either the
existing hardware linear clamp or explicit manual bilinear clamp sampling while
preserving straight RGBA; undeclared inputs and the reserved `image-resource:`
materialization namespace fail closed. Analog Signal Lab's default CRT display
group now uses these sources through shared math, color, and sampling nodes,
fused into its existing final compute pass.
`Load Pixel` adds exact clamped integer access on the output pixel lattice for
GPU textures, VideoFrames, and software evaluation. Typed seed fields retain
raw coordinate/validity records rather than being treated as color images.
Voronoi exposes seed generation, Jump Flood, nearest-seed reads, borders, and
color mixing as an executable graph. Its final image program keeps the compute
storage output; disconnecting stages removes their work, and direct source output
bypasses the effect.
Pixel Sort separates bounded stable segment sorting, luminance eligibility,
mixing, and source alpha into editable nodes while retaining one compute pass.
Quadtree Zoom similarly exposes its bounded adaptive partition, center sampling,
border treatment, and color mix without intermediate compute stages.
Contour exposes integer cell coordinates, corner samples, edge interpolation,
Marching Squares topology, line distance, and color mixing in one compute pass.
Contour Map, Crosshatch, and Kilim expose their sampling, luminance, pattern,
palette, and mixing operations as editable single-pass image graphs.
Vector Engraving, Embroidery, Outline, and Bricks use the same shared image
operators; animated patterns follow timeline time. Contour Type reuses the
shared glyph atlas with explicit contour bands and derivative coverage.
Chroma Key exposes chrominance distance, matte, spill suppression, and alpha;
ROM1 exposes its four-octave displacement and shared frame-history resolve.
Conditional image branches also retain sample indices inside filter loops,
without evaluating the unused branch.
Explicit angle-conversion nodes preserve degree-valued controls while supplying
radians to optics and rotation nodes.

Node cables have visible semicircular plugs, animated attachment, and docked ghost
previews over compatible sockets while dragging. Drag either end to reconnect,
or release on empty canvas to unplug editable links.
During playback and timeline scrubbing, light pulses and direction arrows show
the flow from output to input. They fade when the timeline rests.
Graph panning reuses unchanged nodes and cables, with a bounded drawing buffer
around the viewport to prepare content before it enters at the edges. Group
backgrounds follow pan and zoom immediately, including when zooming out quickly.
Playback avoids repeated dock
layout writes, tab measurements and effect evaluation for sibling parameter rows.
Inline node previews start enabled, can be toggled individually or together, and
preserve image aspect ratios. A shared worker canvas caches visible thumbnails;
unchanged text layouts are reused during navigation, and preview computation
yields between expensive jobs using the scheduler's measured CPU budget.
preview-aware placement finds room for newly created nodes while preserving manual
positions and overlaps. Drag group headers to move their contents; unlock a source
group to transfer compatible nodes into another group or effect. Incoming nodes
find a free position and expand the target frame. Incomplete effects remain
editable and pause until repaired. Header text adapts to zoom without enlarging
frames. Image/color stages, saved
tracking/geometry, material swatches, camera/light values and scene output have
viewers without starting extra decoders or analysis jobs.

Color Nodes uses the same canvas as Nodes. Flock uses the shared compact
inspector and adds evaluated-parameter and existing-particle previews. Common
connection checks cover Color, Flock, Face Cables, Scene and manual clip links;
saved definitions and specialized rendering/simulation stay compatible.

Voxel Relief now exposes nested geometry and height calculations as editable
nodes. Math nodes offer their operation dropdown in the selected node's inspector,
editable operands, and live connected values. Numbers and text draw directly in
the canvas, with transparent DOM targets for editing. Zoom reuses cached preview
images instead of reloading them; the number being edited updates immediately
while downstream calculations catch up.

Geometry nodes can select Box, Sphere or Cylinder while retaining Box as the
default. Voxel Relief uses the selected topology in both its 2D raymarch and
native instanced render; scene primitives use the existing native mesh renderer.
Scene-graph primitives currently support solid tint and opacity, not video-texture
or UV material mapping.

Media imports report processing and save failures. Failed audio-proxy writes can
be retried; project packages follow the configured save policy.
Switching compositions keeps cached proxy audio available. Reopening split nested
clips uses the full source composition duration, and nested previews retain the
correct source timing after splits. Precise export skips unused
nested video sources when the selected range and composition timing allow it.
At nested cuts, export waits for the new frame before capture.

Find keyboard shortcuts by action or key combination in Settings. Copy and paste
automation curves to replace the destination range while keeping surrounding
keyframes and other properties intact.
Use **View > Thumbnails** in the timeline to hide or restore clip previews while
keeping clip labels and audio waveforms visible.
Timeline volume keyframe rows and inline curves show gain in dB.
Deleting timeline gaps moves the playhead with the remaining material.
Timeline snapping starts off; hold **Shift** to snap temporarily or enable the
magnet button to keep it on. Your choice is remembered.
**Export Current Frame** saves a JPG at full composition resolution with a black
background, even when the preview uses reduced quality.
Right-button scrubbing scrolls at the timeline edges. Moving clips between tracks
keeps their original timing, and reversed thumbnails follow the visible source range.
Nested audio-only compositions retain their sound; mixdowns include clip timing
and audio processing. Board-to-timeline drops restore the board view after auto-pan.
New compositions are revealed in the Media panel. Preview source menus group
composition layers and expand them on hover, keyboard focus, or a touch toggle.
Board collisions use the nearest free grid position. Reusing Text, Camera, or Mesh
media preserves the item's saved properties. Nested mixdowns refresh when source
timing, effects, automation, or child compositions change. Prompt Book updates
completed tool calls while the chat response is still running.

## Try it

Open [masterselects.com](https://www.masterselects.com/), import a clip, and drag it
onto the timeline. Use **Space** to play, **C** to cut, and **Ctrl/Cmd+S** to save.
See the [keyboard shortcuts](docs/Features/Keyboard-Shortcuts.md) for more.

Use a recent browser with WebGPU support. Chrome or Edge on desktop is a good
starting point. Available codecs, local file access, and performance depend on
your browser, operating system, and GPU.

Editing and rendering run locally. Hosted AI and media generation use external
services and may require credits; local AI features may download models on first
use. See [AI integration](docs/Features/AI-Integration.md) and
[security and privacy boundaries](docs/Features/Security.md).

MasterSelects is under active development. Keep backups of important projects.
When reporting a problem, include your browser, operating system, and steps to
reproduce it.

## Media in, media out

- **Import:** video, audio, images, Premiere Pro projects, Lottie and Rive
  animation, OBJ/glTF/GLB models, and Gaussian splats.
- **Export:** video through WebCodecs or FFmpeg, still frames, audio, and FCPXML
  for interchange with other editors.
- **Optional Native Helper:** adds local services such as downloads, additional
  storage support, and AI sidecars.

Codec support varies by platform; a file extension alone does not guarantee
decoding. Details: [media import](docs/Features/Media-Panel.md),
[export](docs/Features/Export.md), and
[Native Helper setup](tools/native-helper/README.md).

## Run locally

Install the Node.js version in [`.node-version`](.node-version), then:

```bash
git clone https://github.com/Sportinger/MasterSelects.git
cd MasterSelects
npm ci
npm run dev
```

Open **http://localhost:5173**. This starts the browser editor. Hosted login,
credits, and AI services are separate from this local setup.

Development reloads skip the browser's unsaved-work confirmation. Save explicitly
before reloading when using manual save mode.
The active composition and clip selection are restored after a refresh in the same
browser tab, including the focused clip in Properties, without an extra Save.

Maintainers with the service configuration and private kernel checkout can use
`npm run dev:full` for the complete development stack. The private hosted kernel
is maintained separately and is not included in this repository.

External agents can connect to the running development editor through the local,
authenticated MCP bridge:

```bash
npm run mcp
```

See [AI bridge control](docs/Features/AI-Bridge-Control.md) for setup and access
boundaries.

## Contribute

An effect or tool you built for your own project could be useful to others.
Send a focused pull request with a short example of what it does. For a larger
feature, open an issue first to discuss how it fits the editor. Bug reports,
reproducible examples, and documentation improvements are welcome too.

The core stack is **React, TypeScript, Zustand, WebGPU, and WebCodecs**. Start with
`src/components/` for the UI, `src/stores/` for editor state, `src/engine/` for
rendering and export, and `src/services/` for media and integrations.

Read [AGENTS.md](AGENTS.md) for repository conventions. Keep feature documentation
alongside behavior changes and run checks relevant to the files you change:

```bash
npx vitest run tests/unit/<relevant-file>.test.ts
npm run build
```

## License

MasterSelects is licensed under the **GNU Affero General Public License v3.0 only
(AGPL-3.0-only)**. Commercial use is permitted under its terms. Distribution and
network use of modified versions carry source-sharing obligations; videos and
other ordinary media you create with the editor do not inherit its license.

See [LICENSE](LICENSE) for the full terms, [LICENSING.md](LICENSING.md) for scope,
and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for component notices.
