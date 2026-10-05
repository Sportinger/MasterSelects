# MasterSelects

Development automation can open an authorized project folder by disk path with
the confirmed `openLocalProject` bridge operation (Native Helper required).

A browser-based video editor and a workspace you can extend while you create.
Edit video, mix audio, animate graphics, build 3D scenes, and work with AI in one multitrack timeline. The editor runs on React, TypeScript, WebGPU, and WebCodecs.

[Open the editor](https://www.masterselects.com/) · [Documentation](https://www.masterselects.com/docs/) · [Discord](https://discord.com/invite/K8dApzG3XC) · [Report an issue](https://github.com/Sportinger/MasterSelects/issues)

![Face Cables effect in MasterSelects](docs/images/screenshot-face-cables.png)

*Face Cables combines face tracking, animated controls, and optional scene depth. See the [feature guide](docs/Features/README.md) for this and other workflows.*

## What you can make

| Workspace | Highlights |
| --- | --- |
| **Video** | Multitrack editing, nested compositions, proxies, multicam, and Premiere Pro sequence import. Speed, reverse and freeze frames share one retime contract across preview, scrubbing, export and audio. |
| **Nodes** | Build and reuse effect, color, geometry, and 3D graphs with typed connections and live previews. Unconnected cards pack compactly, separately from expanded groups. Cables fade with overlapping group depth using cached coverage and reusable paths; obstacle routing prefers clear direct lanes and removes retraced segments. The composition graph shows media, tracks, transitions and beat rules as one graph, with one compact lane per clip under its track strip (source, range, speed, effects, target); each lane expands in place into its full processing graph. |
| **Color & effects** | Grade footage, combine GPU effects and transitions, and animate masks and properties. |
| **Audio** | Edit waveforms, mix tracks, record, apply effects, and separate stems. |
| **Motion & tracking** | Animate text and shapes, create captions, and attach graphics to tracked footage. |
| **3D** | Combine footage, models, lights, cameras, Gaussian splats, and particle effects. |
| **AI** | Ask the in-app agent to edit the timeline or generate media. Nodes and cables appear beside Preview as individual AI instructions arrive. AI Studio keeps Chat and Generation free of a floating credit banner. |

Waveform previews, pyramid analysis, and cache unpacking run in dedicated workers. Large timelines reuse saved source waveforms after refresh, share results across split clips, and limit background analysis updates. Decoding and waveform generation do not hold the project save barrier. See [Audio Intelligence](docs/Features/Audio-Intelligence.md).

Beat rules distribute selected clips on analyzed beats or the tempo map and keep manual corrections as offsets; the in-app agent can read the composition graph and edit these rules. See [Node Workspace](docs/Features/Node-Workspace.md#composition-workspace).

Timeline scrolling reuses prepared waveform columns and bounds dashed composition outlines to the visible canvas. Open composition tabs restore only their timeline, retain connected media, and remember independent playhead and zoom positions. See [Timeline](docs/Features/Timeline.md).

Large audio timelines prepare waveform columns within the canvas viewport and reuse source data across UI updates. Progressively loaded waveforms preserve the existing canvas display. Long WAV files decode without another complete encoded-audio copy on the UI thread. See [Audio](docs/Features/Audio.md).

Multicam camera tiles adapt their render resolution to the panel and reuse unchanged video frames. The main preview retains its selected quality and original source decoding. During scrubbing, the program camera shares the main preview's source while other cameras catch up on release. Playback clock updates stay local to the timeline's time display and playhead; inactive preview overlays do not subscribe to the running clock. See [Preview](docs/Features/Preview.md#multi-preview).

Canon CR2 photos import at full resolution through browser-local RAW development,
with the original files preserved. Source Monitor fits the complete photo and
provides Fit view to reset zoom and pan. Lens Correction includes a Canon EF
24–105 mm f/4L IS USM profile dropdown, CR2 exposure metadata, and manual
distortion, chromatic aberration, independently bypassable vignette controls,
and automatic framing to show the complete corrected photo. Guided Perspective
straightens photographed edges with up to eight guides per direction, edited
directly in Preview with zoom, pan and right-click removal.
AI Edge Fill then fills transparent borders on still images with an explicitly
started Kie.ai / Nano Banana Pro generation (1K, 2K or 4K), retaining original
opaque pixels and storing the fill in the project. See
[Media Panel](docs/Features/Media-Panel.md) and [Effects](docs/Features/Effects.md#lens-correction).

### Node graphs

Flock includes Terracotta and Lilac Sculpture presets: dense, low-gravity
APIC sheets with slow curl forces, spatial pigment colors and a lit gallery box.
They start calmly inside the box, with overlapping curl fields developing during playback.
Preview displays simulation preparation progress and loading activity for 3D models.

[Flock](docs/Features/Flock-Clips.md) point rendering adapts sub-particle density
to the scene target, scales screen point sizes from a 1080p reference, and uses
parent particles for shadows. Optional GPU timestamps expose simulation,
fluid-transfer, pressure, point-cache, shadow and drawing costs through `getStats`.
Small opaque points and bounded shadow footprints use compute rasterization,
with deterministic depth ties and a resolve into the shared 3D depth buffer.
APIC fluid transfers adapt their accumulation precision to local density and
velocity to avoid integer overflow in dense piles. They preserve local rotation
and shear with an affine matrix per
particle, using a stable GPU cell permutation and workgroup accumulation,
preserving particle identity across rendering, trails and checkpoints.
Checkpoint persistence remains valid when the GPU cache evicts a snapshot during readback.
Persistent precompute streams checkpoints to IndexedDB as they are produced;
capacity-dependent GPU budgets also apply to imported and shared snapshots.
The opt-in Worker render path groups Flock, primitive meshes and scene lights and loads their
image pigments, instance models and audio analysis in the Worker. Audio-driven
checkpoints distinguish analysis content and clip placement; export preparation pins
that identity across asynchronous work. Local development now starts with the strict
Worker GPU preview, including ordinary `/editor` reloads. Automatic main-renderer
fallback is disabled in this mode. An explicit development `?renderHost=main`
remains available for diagnostics; production startup is unchanged.
Playback health telemetry avoids synchronous GPU pixel reads, keeping those
readback stalls off the UI thread; unavailable pixel-health metrics are omitted.
Worker 3D rendering honors preview quality and retains resolution changes across
canvas registration. Small preview simulation batches leave GPU time for the UI.
Precompute, cancellation and cache clearing also run in the Worker, with progress
and optional persistent simulation checkpoints.
The Worker preview reports its own Flock simulation, memory and checkpoint status
to the inspector; nested occurrences remain separate in render-host diagnostics.
`getStats.flockGpu` identifies the active renderer and includes the Worker's own
GPU pass timestamps when supported. Worker devices request the adapter's buffer
limits for large simulations; timing readbacks stay asynchronous and bounded.
Worker frame diagnostics also separate simulation preparation, encoding and GPU
submission wait, and stay updated while playback queues subsequent frames.
The final Worker simulation block shares the compositor's GPU completion fence;
intermediate catch-up blocks remain bounded. Diagnostics distinguish CPU encoding,
completion waits and the GPU span between measured passes.
Long Worker seeks resume retained simulation progress with fresh frame deadlines;
newer requests take priority and stalled work is not retried indefinitely.
Fluid pressure uses a multigrid-preconditioned conjugate-gradient solver on both
CPU and GPU, with residual-based convergence and solid domain walls.
The fluid node exposes particle separation, spacing and deterministic position
jitter to reduce grid-aligned bands; separation bounds dense-neighborhood work
to 64 candidates per particle. It gathers neighbor positions once in cell order
using existing sort workspace, reducing GPU memory reads without changing the simulation.
Graphs without boid rules or neighbor links use tiny placeholder bindings instead
of allocating the full boid spatial index.
Simulation, neighbor sorting, trails and links distribute GPU work across two
dimensions; population increases remain subject to memory limits.

The node canvas automatically refits the full graph whenever nodes or connections are added or removed, including changes from internal and external AI agents. Deleting effects also closes the gap in the node chain, including after the last effect is removed. Agent clip selections preserve the visible panel instead of bringing Properties forward.

The **Compact** toggle wraps top-level effects into roughly square arrangements while preserving their internal node layout. Within flow-layout groups, loose and connected nodes share one origin to avoid oversized empty frames. **Avoid** routes cables around unrelated expanded effect groups as well as node cards, keeping existing routes visible while the layout and routing update. Angular cables between the same cards stay in a tight bundle, including during dragging, without diagonal Angular segments.

[Time Stack](docs/Features/Time-Stack.md) blends up to 32 delayed instances of a video in an editable node group, with shared source-frame sampling, all 37 timeline blend modes, and mouse-wheel control.

[Weave](docs/Features/Weave.md) builds woven fabric, yarns, ropes and knots from general curve nodes: threads are pulled in one by one, wobble like handmade cloth and billow on a simulated sheet, and simulated ropes collide, fall and pull knots tight. Knit Sphere circulates horizontal yarn rings through a fixed knitting/unravelling zone in a seamless loop. Strand Render draws them as lit fibers with Hashed, 4x Coverage or analytic tile-raster antialiasing and exchanges shadows with lit meshes.

Knit Sphere's band height can gather all rings into one connected knitting patch. Preview camera orbit drags follow the pointer vertically as well as horizontally.
Strand Render also accepts per-point RGB fields for gradients and alternating color bands with independent offsets per yarn.
Curve Contact separates overlapping yarn capsules after procedural deformation while preserving closed rings and their color coordinates.
Closed Curve Flow circulates yarn material along fixed stitch paths, independently of the shape animation.

[Slit Scan](docs/Features/Effects.md#slit-scan) starts with 3D geometry bypassed. It can match its time factor to the source frame rate and sample count, and optionally compensate motion between decoded frames in resident GPU history with adjustable flow strength.

Its [space-time slice](docs/Features/Slit-Scan-3D.md#space-time-slice-observed-depth) tilts and cuts baked color/depth observations from a fixed camera. A tracked 2D shape target can also solve a time field from an anchor and target stretch, with recorded-motion fit errors shown in the inspector.

| Detail view | Full graph |
| --- | --- |
| <a href="docs/images/node-graph-detail.png"><img src="docs/images/node-graph-detail.png" alt="Connected nodes with image and depth previews" width="320"></a> | <a href="docs/images/node-graph-overview.png"><img src="docs/images/node-graph-overview.png" alt="Large connected node graph" width="320"></a> |

Import video, audio, images, animations, 3D assets, and Premiere Pro projects. Export video, audio, still frames, and interchange formats. FAST export waits for the exact decoded source frame, including reordered frames that arrive after additional samples; multi-clip speed ramps prefetch at their animated source time. Browser, operating system, and GPU support affect available codecs and performance. See [media import](docs/Features/Media-Panel.md) and [export](docs/Features/Export.md).

The [Notebook](docs/Features/Documents.md) is a continuous writing surface for notes and screenplays. Passages can receive labels, scene ranges, comments and media links after writing; imported PDFs retain an original-page view.

## Build while you create

Dense [mask overlays](docs/Features/Masks.md) reuse contour transforms and interpolated paths during interaction. [Project recovery](docs/Features/Project-Persistence.md) retains recent entries when folder access fails. Development refreshes proceed without an unsaved-work browser prompt.

[Browser Roto](docs/Features/AI-Integration.md#browser-roto-sam-21) uses local SAM 2.1 video segmentation to select moving objects directly in Preview, watch tracking progress there, refine mask edges, and convert results into animated clip masks or export mask and transparent videos without the Native Helper. Roto masks and corrections survive panel and clip switches within the editor tab; converted clip masks are saved with the project.

I built MasterSelects because I wanted an editor I could shape around a project. When a tool is missing, a coding agent can add an effect, control, or workflow to the source; you can try it in the same project and contribute it for others to use.

The codebase includes [agent instructions](AGENTS.md), [feature documentation](docs/Features/README.md), reusable editor components, and an [authenticated local bridge](docs/Features/AI-Bridge-Control.md) for inspecting and operating the running editor. The hosted AI kernel is maintained separately from this repository.

## Try it

Open [masterselects.com](https://www.masterselects.com/), import a clip, and drag it onto the timeline. Press **Space** to play, **C** to cut, and **Ctrl/Cmd+S** to save. More controls are in the [keyboard shortcuts](docs/Features/Keyboard-Shortcuts.md).

Projects [save continuously](docs/Features/Project-Persistence.md), with durable branching history. **Ctrl/Cmd+S** waits for pending content, history navigation and workspace changes to reach storage; named versions are separate from Save.
Filesystem saves page through one bounded filename snapshot per fresh history-folder check, avoiding repeated physical scans as history grows.

Chrome or Edge on desktop is a good starting point. Editing and rendering run locally in the browser; hosted AI and media generation use external services and may require credits. Local AI features may download models on first use. MasterSelects is under active development, so keep backups of important projects.

## Run locally

An [Android development app](docs/Features/Android-App.md) packages the editor for offline local editing, with Android project-folder selection, media import, export saving/sharing, and online cloud services. Android beta purchases are disabled; existing account credits remain usable. Project folders require Android 17; older Android versions use app-private storage. Build it from the final web build with `node scripts/android.mjs build`; device verification and store release are separate steps.

Install the Node.js version in [`.node-version`](.node-version), then run:

```bash
git clone https://github.com/Sportinger/MasterSelects.git
cd MasterSelects
npm ci
npm run dev
```

Open **http://localhost:5173**. Hosted login, credits, and AI services need the full development stack and separate service configuration. Maintainers with the private kernel checkout can use `npm run dev:full`.

External agents can connect to the local editor with `npm run mcp`; see [AI bridge control](docs/Features/AI-Bridge-Control.md) for setup and access boundaries.

## Contribute

Focused pull requests, reproducible bug reports, and documentation improvements are welcome. For larger features, open an issue first. Read [AGENTS.md](AGENTS.md) for repository conventions and use the [feature guide](docs/Features/README.md) to find the relevant architecture and workflows.

## License

MasterSelects is licensed under **AGPL-3.0-only**. Commercial use is permitted under its terms. Videos and other ordinary media made with the editor do not inherit its license. See [LICENSE](LICENSE), [LICENSING.md](LICENSING.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

Linked clips selected together now share a contour outline in the timeline, following their outer edges instead of highlighting every clip individually.

Projects assume saved media locations are available and open sources only when needed for preview, playback, editing or export. Unused media are not scanned on reload; only failed source access requests relinking. See [project persistence](docs/Features/Project-Repository.md).
