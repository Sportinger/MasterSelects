[Back to Project](../../README.md)

# MasterSelects Documentation

What MasterSelects can do, with a link to the page for each part. The sidebar of the
documentation site lists every page by topic.

---

## Overview

MasterSelects is a browser-based WebGPU compositor and media editor with timeline editing, nested compositions, AI-assisted workflows, project-local media management, and an optional native helper for the browser gaps that still matter.

### Current Highlights

| Capability | Description |
|---|---|
| **Notebook** | [Write project notes, mark scenes and link passages](Documents.md), with document import, original views and screenplay layout |
| **Time Stack** | [Blend delayed video instances](Time-Stack.md) in a compact editable node group with deterministic source sampling |
| **AI Depth Map** | [Local depth estimation](Depth-Estimation.md), live source preview and reusable depth-video baking |
| **WebGPU Rendering** | Shared render path for main preview, independent targets, output windows, and export |
| **Timeline Editing** | Multi-track editing, nested compositions, markers, transitions, shortcuts, and keyframes |
| **Editable Motion Graphics** | FlashBoard can compile animated lower thirds into native text, Motion shapes, and keyframes with temporal review and one-step undo |
| **Node Workspace** | One clip canvas with collapsible Color, Flock, Face Cables and 3D groups |
| **AI Control** | Private hosted-agent kernel with a public atomic-tool execution boundary, plus authenticated bridge and MCP access for external agents |
| **AI Generation Workspaces** | The compact Media generator remains available, while AI Studio adds parallel tabs, Media-drop references, local prompt dictation, fitted result tiles, Source Monitor opening, and timeline drag-out |
| **3D Layers** | Shared-scene 3D layers, camera clips, Gaussian splats, splat effectors, and local browser training |
| **Flock Clips** | Node-graph-defined GPU swarms with instanced animals, neighbor links, curved trails and technical glyphs in the shared 3D scene |
| **Weave** | Woven fabric, yarns, ropes and knots from general curve nodes, drawn as lit fibers in the shared 3D scene |
| **Vector Animation** | Lottie and Rive clips with canvas playback, bounce modes, render resolution overrides, keyframed state/data inputs, and export |
| **Audio** | Timeline-native workstation audio with artifact-backed analysis, spectral editing, local music-to-MIDI, mixer, recording, and export parity |
| **Screen Capture** | Browser-picker screen/window/tab recording with audio mixing, durable recovery, and optional timeline placement; the WebCodecs crop/scale tier is currently disabled |
| **Image Mode** | [Still-image workspace](Image-Mode.md) with a layers panel, canvas edit mode, new-image presets, frame-to-image, and PNG save on the shared composition model |
| **Live Inputs** | Parallel screen, camera/capture-device, and composition-feedback sources as timeline clips |
| **Storyboard And MIDI** | Timeline storyboard scene cards and MIDI tracks/clips with tempo-aware editing and export support |
| **Multicam And Batch Export** | Audio-synced multicam assembly and queued source-media batch export |
| **Project Storage** | Continuous repository saves, durable branching history, immutable artifacts, relink and independent backups |
| **Native Helper** | Firefox storage backend, yt-dlp download flow, and local media-analysis jobs |
| **Security And Debugging** | Token-gated bridges, allowed-root file policy, playback monitors, logger tooling |

---

## Documentation Index

<!-- This index is the sidebar of the documentation site (docs-site/scripts/sync-features.mjs; rules in Documentation-Site.md).
     Each ### section is one sidebar group, in this order; each table row one entry, labelled with its link text.
     #### starts a collapsed subgroup. Directives on their own line under a heading:
       docs-sidebar: collapsed      start this group collapsed (expanded under ####)
       docs-sidebar: effect-groups  one collapsed subgroup per picker group of the app (EFFECT_GROUPS), with the
                                    rows below it (second cell = group id) first and effects/<id>.md pages after them
       docs-sidebar: unpublished    the pages stay in the repo but are not rendered; links to them become plain text
     Rows inside other comments are planned pages: move a row out of its comment when the page exists.
     Pages without a row: Effects-*.md join their effect group (or Effects), Transitions-*.md join Transitions,
     guides/*.md join Guides, every other page lands in a final "More" group. The sync warns for each of them. -->

### Getting Started

| Document | Description |
|---|---|
| [Welcome](../../docs-site/src/content/docs/getting-started/welcome.md) | What MasterSelects is and where to start |
| [Overview](./README.md) | What the editor can do, with a link to each feature page |

<!-- planned:
| [Your first edit](./guides/your-first-edit.md) | Create a project, import, put clips on the timeline, trim, split and export |
| [The editor at a glance](./guides/editor-at-a-glance.md) | The main areas of the editor and what each one is for |
| [System requirements and browsers](./guides/system-requirements.md) | WebGPU, Chrome/Edge/Firefox preview, Linux, iPad and Android |
-->

### Guides

| Document | Description |
|---|---|
| [Using effects](./Effects.md) | Add, adjust, reorder, compare and bypass effects; styles, parameter sources and Looks |

<!-- planned:
| [Import media](./guides/import-media.md) | Files, folders, downloads and the Media panel |
| [Put clips on the timeline](./guides/put-clips-on-the-timeline.md) | Drag media in, tracks, and the Source sizing dialog |
| [Trim, split and move clips](./guides/trim-split-move.md) | Edge trims, splits and moves with the mouse or keys |
| [Play, scrub and loop](./guides/play-scrub-loop.md) | Transport, scrubbing, loops and the preview |
| [Animate with keyframes](./guides/animate-with-keyframes.md) | Set, change and ease keyframes |
| [Draw and animate masks](./guides/draw-and-animate-masks.md) | Draw, feather and animate masks |
| [Titles and surtitles](./guides/titles-and-surtitles.md) | Text clips and timed surtitles from the Notebook libretto |
| [Using transitions](./guides/using-transitions.md) | Add, change and remove transitions |
| [Sound: levels, fades and the mixer](./guides/sound.md) | Volume, fades, mixer and audio effects |
| [Color grading with wheels and scopes](./guides/color-grading.md) | The Color workspace, wheels and scopes |
| [Export and delivery](./guides/export-and-delivery.md) | Export for the show PC, with alpha, for the web, or as stills |
| [Save, back up and move a project](./guides/save-backup-move.md) | Saving, archives, relinking and backups |
| [Edit with the AI chat](./guides/edit-with-ai-chat.md) | Ask the AI agent to edit the timeline |
| [When playback stutters](./guides/when-playback-stutters.md) | Proxies, preview quality and other fixes |
-->

### Live and Stage

| Document | Description |
|---|---|
| [Slot Grid](./Slot-Grid.md) | 12x4 live grid overlay, slot clip trimming, layer triggering, and deck warmup behavior |
| [Live Inputs](./Live-Inputs.md) | Parallel live visual sources, timeline placement, reconnection, composition feedback, and real-time export |

<!-- planned:
| [Stage output: projectors, slices and warp](./Stage-Output.md) | Output Manager slices, corner pin, mesh warp and fullscreen outputs |
| [Cues: markers, stop markers and MIDI](./Cues.md) | Markers, stop markers and MIDI learn |
| [MIDI control and mapping](./MIDI-Control.md) | Map MIDI controllers to the editor |
| [Go Live streaming](./Go-Live.md) | Go Live, Stream Chat and Stream Analytics |
-->

### Effects

| Document | Description |
|---|---|
| [Nodes basics](./Node-Workspace.md) | The Nodes canvas of a clip: nodes, cables, operators, effect order and execution boundaries |

<!-- planned:
| [Effect catalog](./effects/index.md) | Every effect of the app, by picker group |
| [How effects are built](./Effect-Nodes.md) | How to open, read and remix an effect's node setup |
-->

<!-- docs-sidebar: effect-groups keying+time -->

| Document | Effect group | Description |
|---|---|---|
| [Overview](./Effects-Color.md) | `color` | Brightness, Contrast, Exposure, Levels, Saturation, Vibrance, Temperature, Hue Shift and Invert with split-screen pictures, their controls, the colour recipes behind them, and technical notes |
| [Overview](./Effects-Blur.md) | `blur` | The five blurs with before/after pictures, their controls in the editor, the node graphs behind them, and technical notes |
| [Overview](./Effects-Stylize.md) | `stylize` | Glow, Film Grain, Vignette, Sharpen, Edge Detect, Posterize, Threshold and Scanlines with before/after pictures, their controls, the recipes behind them, and technical notes |
| [Painterly, relief and particles](./Effects-Stylize-Art.md) | `stylize` | Acuarela, Rom1, Sheen, Voxel Relief and Pixel Particle Disintegrate with before/after pictures, their controls, how they are built, and technical notes |
| [Overview](./Effects-Distort.md) | `distort` | Bulge & Pinch, Twirl, Wave, Fisheye Lens, Lens Correction, Guided Perspective and AI Edge Fill with before/after pictures, their controls, the read-position graph behind them, and technical notes |
| [Mirror, split and pixel](./Effects-Mirror-Pixel.md) | `pixel` | Kaleidoscope, Mirror, RGB Split, Pixelate, Blockify and Block Mosaic with before/after pictures, their controls, the graphs behind them, and technical notes |
| [Overview](./Effects-Analog.md) | `analog` | CRT Screen, Glitch, Film Prism, Analog Signal Lab, Crystal Glass, Glass Dispersion, Holo, Ribbon Scan, Wave Lines and Pixel Sort with before/after pictures, their controls, the recipes behind them, and technical notes |
| [Memory Leak](./Memory-Leak.md) | `analog` | Generator that shows real leftover bytes of the FFmpeg wasm heap as 8/16/32-bit pixels, with clip feeding, per-frame motion, and freezable blocks |
| [Overview](./Effects-Keying-Time.md) | `keying` | Chroma Key, Time Stack and Slit Scan with before/after pictures, inspector, graph recipes and technical notes |
| [Time Stack](./Time-Stack.md) | `time` | Delayed video instances blended in an editable node group: instance count, time offset, blend modes, and the GPU frame cache |
| [Slit Scan 3D](./Slit-Scan-3D.md) | `time` | Reference time surfaces, DIS deformation, source-pair motion bands, scene cameras and geometry settings |

<!-- planned:
| [Overview](./Effects-Generate.md) | `generate` | Color Wheel, Perspective Grid and Stick Figure |
| [Overview](./Effects-Print.md) | `print` | Print & Halftone |
| [Overview](./Effects-Lines.md) | `lines` | Lines & Engraving |
| [Overview](./Effects-Textile.md) | `textile` | Textile & Craft |
| [Overview](./Effects-Glyph.md) | `text` | Text & Glyph |
| [Overview](./Effects-Tracking.md) | `tracking` | Tracking & Overlays |
| [Overview](./Effects-3D-Particles.md) | `scene` | 3D & Particles |
-->

### Transitions
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [Dissolve](./Transitions-Dissolve.md) | Crossfade with a filmstrip: how to apply it, its controls, and how picture and sound fade |

<!-- planned: Wipe, Push, Slide, Dip, Iris, Light, Motion Blur, Glitch, Pattern, Stylize, Rotate, Zoom (Transitions-<Group>.md) -->

### Editing
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [Timeline](./Timeline.md) | Tracks, clips, nested comps, markers, selection, and editing flow |
| [Preview and playback](./Preview.md) | Main preview, source monitor, output windows, RAM preview, and target routing |
| [Keyframes](./Keyframes.md) | Animated properties, shared keyframe nodes, effect params, masks, fades, easing, and visibility rules |
| [Masks](./Masks.md) | Overlay mask editing, whole-path keyframes, feathering, and stored modes |
| [Text Clips](./Text-Clips.md) | Canvas-backed text rendering, typography controls, and timeline text items |
| [Dynamic Captions](./Captions.md) | Transcript-driven text clips, cut-aware grouping, strict line paging, highlights, direct word correction, and preview/export parity |
| [Color grading](./Color-Correction.md) | Node/list color tab, graph data model, GPU pipeline, scopes, and realtime grading workflow |
| [Shapes and replicators](./Motion-Design.md) | Motion layer schema, property registry, rectangle/ellipse shape editing, GPU renderer, and persistence/export plumbing |
| [Vector Animation](./Vector-Animation.md) | Lottie/Rive import, runtime playback, bounce modes, state-machine keyframes, Rive data binding, and export behavior |
| [Image Mode](./Image-Mode.md) | Image documents as still compositions, Image workspace layout, Layers panel, entry points, and current limitations |
| [Notebook](./Documents.md) | Project notes, scene and label marks, linked passages, document import with original views, and screenplay layout and export |
| [Annotations](./Annotations.md) | Timed notes on compositions and source media: Annotations panel, ruler bars with drag/trim/keyboard nudge, clip linking, reader popover, project persistence |

<!-- planned:
| [Timeline tools](./Timeline-Tools.md) | Ripple, roll, slip, slide, range and placement, with diagrams |
-->

### Media and Projects
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [Media Panel](./Media-Panel.md) | Import flow, RAW-copy promotion, folders, compositions, and relinking |
| [Proxies](./Proxy-System.md) | Proxy generation, on-disk frame layout, audio proxies, and warmup behavior |
| [Scene-Cut Detection](./Scene-Cut-Detection.md) | Frame-accurate hard-cut detection during proxy generation and its timeline display |
| [Media Discovery](./Media-Discovery.md) | Open-media catalogs, meme templates, source attribution, and local Native Helper web downloads |
| [Media Downloads](./Download-Panel.md) | yt-dlp-backed downloads, platform mapping, and cookie retry behavior |
| [Screen Capture](./Screen-Capture.md) | Screen/window/tab recording, audio mixing, recovery, and diagnostics; the WebCodecs crop/scale tier is currently disabled |
| [Projects and saving](./Project-Persistence.md) | Continuous saving, project handoff, storage backends, media relinking, archives and recovery |
| [Export](./Export.md) | WebCodecs fast/precise export, animated GIF, FFmpeg intermediates, image frame/sequence export, audio-only export, FCPXML, and project-persistent presets |
| [Native Helper](./Native-Helper.md) | Local HTTP/WebSocket APIs, auth startup token, and helper-backed flows |

<!-- planned:
| [Supported formats](./Supported-Formats.md) | Which files open, play and export (H.264, H.265, ProRes, MXF, audio, images) |
| [History and versions](./History-And-Versions.md) | Undo, branching history and saved versions |
-->

### Audio
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [Audio](./Audio.md) | Playback sync, clip audio state, waveform/spectral display, recording, and export |
| [Audio Intelligence](./Audio-Intelligence.md) | Persisted audio analysis as source-time evidence for the Analysis workspace, Agent Timeline, AI tools, and non-destructive audio edits |
| [Tempo and Metronome](./Tempo-And-Metronome.md) | Editable tempo track with BPM/meter flags and ramps, tempo-driven grid and snapping, MIDI content that follows tempo, and a metronome click |
| [Score Tracks](./Score-Tracks.md) | Audio-section score tracks with pencil-drawn score clips and a detached score-editor window |
| [MuScriptor Music-to-MIDI](./MuScriptor.md) | Local Native Helper audio-to-MIDI transcription, model setup, instrument mapping, and atomic timeline commit |

<!-- planned:
| [Audio effects](./Audio-Effects.md) | The audio effects in one table |
| [MIDI tracks and Piano Roll](./MIDI-Tracks.md) | MIDI tracks, clips and the Piano Roll |
-->

### 3D and Scans
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [3D Layers](./3D-Layers.md) | Shared-scene path, native Gaussian splats, cameras, and splat effectors |
| [Flock Clips](./Flock-Clips.md) | GPU particle swarms defined by an editable node graph: presets, Properties/Node Workspace editing, source-time keyframes, deterministic seek, precompute cache, links/trails/glyphs, and export |
| [Weave](./Weave.md) | Curve-node fabric, knots and threading, fiber rendering (Hashed, 4x Coverage, Analytic), shadows and cloth |
| [Path Tracing](./Path-Tracing.md) | Path traced 3D scene: fiber BVH, hair BSDF, ReSTIR, radiance cache, SVGF and upscaler preview, OIDN, export Render Quality, physical camera |
| [Browser 3D Scan](./3D-Scan.md) | Browser-local Camera Solve, FPS-aligned camera/stabilization tracks, project-backed COLMAP data, sparse previews, and capability-gated Brush WebGPU training |
| [Surface Tracking](./Surface-Tracking.md) | Reusable tracking assets, ordinary clip attachments, preview editing, sparse/dense geometry inspection, editable camera/mesh scenes, and native footprint sequences |

### AI
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [AI chat](./AI-Integration.md) | Hosted kernel chat, public editor-tool boundary, segmentation, transcription, and bridge behavior |
| [Generate media](./AI-Studio.md) | Parallel AI workspaces with Media-drop references, local dictation, fitted result tiles, Source Monitor opening, and direct timeline drag-out |
| [FlashBoard](./FlashBoard.md) | Media Panel generation plus Auto/Story prompt paths with default Codex Direct and optional hosted Fast |
| [Story Workflow](./Seedance-Preproduction.md) | Docked preproduction workflow for directions, treatment, sources, master looks, keyframes, progress, and review |
| [Editable Motion Graphics](./Editable-Motion-Graphics.md) | Native animated lower thirds compiled from chat into editable text, Motion shapes, keyframes, and six-frame temporal review |
| [AI Depth Map](./Depth-Estimation.md) | Local Depth Anything V2 depth estimation for the current frame or live playback, and reusable depth-video baking |
| [Face Analysis](./Face-Analysis.md) | Browser-local face detection and anonymous identity grouping with YuNet and SFace, without uploading frames |

<!-- planned:
| [Transcription](./Transcription.md) | Transcribe clips and edit the transcript |
| [Roto and segmentation](./Roto-And-Segmentation.md) | Cut out subjects with SAM 2 and MatAnyone2 |
| [Account, credits and plans](./Account-And-Credits.md) | Sign-in, guest access, credits, plans and claim links |
-->

### Interface and Devices
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [Editor and panels](./UI-Panels.md) | Dock layout, panel catalog, properties tabs, shared touch support, and workspace surfaces |
| [Keyboard Shortcuts](./Keyboard-Shortcuts.md) | Current shortcut registry, playback controls, and preset behavior |
| [Android App](./Android-App.md) | Bundled offline editor, Android file import and export, build/signing instructions, and device limits |

<!-- planned:
| [Workspaces and layouts](./Workspaces.md) | Workspaces, saved layouts and the dock |
| [Settings and appearance](./Settings.md) | The settings sections, themes and Input Display |
| [iPad and touch](./iPad-And-Touch.md) | Touch gestures and working on an iPad |
-->

### Help
<!-- docs-sidebar: collapsed -->

<!-- planned:
| [Troubleshooting](./Troubleshooting.md) | Black preview, offline media, slow H.265, Linux GPU, and how to reach the developer |
| [Glossary](./Glossary.md) | The words the editor and these pages use |
| [Privacy and data](./Privacy-And-Data.md) | What stays on your machine and what is collected |
-->

### Developers
<!-- docs-sidebar: collapsed -->

| Document | Description |
|---|---|
| [GPU Engine](./GPU-Engine.md) | WebGPU engine, render loop, fallback paths, caches, and export boundary |
| [Linux / Mesa GPU](./Linux-Mesa-GPU.md) | **Read before touching any canvas/GPU code** — Mesa silent-failure modes and the rules/gates that prevent "blank on Linux" regressions |
| [Media Runtime](./Media-Runtime.md) | Shared source/runtime registry, decode sessions, frame-provider reuse, and slot/background playback bindings |
| [Signal IR](./Signal-IR.md) | Contract layer for universal media signals, capability-gated runtime providers, and the Wasm/WIT ABI |
| [Operator Graph Compiler](./Operator-Graph-Compiler.md) | Initial local image DAG IR, fused Invert lowering, reuse decisions and current integration boundary |
| [Node Catalog](./Node-Catalog.md) | Registered building blocks, typed contracts, implementation ownership and reuse boundaries |
| [Inspector Performance](./Inspector-Performance.md) | Worker-prepared image graph controls, bounded drag updates, and shared undo transactions |
| [Timeline Rulers](./Timeline-Rulers.md) | Stacked multi-ruler lanes (time/timecode/frames/bars/tempo) via the **Rulers** checklist, TempoMap-driven bars+beats, and per-composition persistence |
| [Transition Compositions](./Transition-Compositions.md) | Mapped-v3 transition source layout, templates, parity, and explicit legacy upgrades |
| [Audio architecture](./Audio-Workstation.md) | Audio architecture, timeline detail mode, docked mixer, artifact refs, and analysis efficiency |
| [Project Repository and Durable History](./Project-Repository.md) | Immutable revisions, branching undo, worker publication, workspace views, journals and artifact retention |
| [H.265 / HEVC Decoding](./HEVC-Decoding.md) | Native-first H.265 playback with a local WASM fallback, shared consumers, and diagnostics |
| [ProRes Browser Decode](./ProRes-Browser-Decode.md) | Experimental TurboRes-backed progressive ProRes 422 import, preview, Source Monitor, proxy, audio, export, and lifecycle gates |
| [MXF Browser Decode](./MXF-Browser-Decode.md) | In development (flag `mxfBrowserDecode`): TypeScript MXF demux and metadata, per-essence decode via WebCodecs, TurboRes, or an LGPL libavcodec WASM build |
| [Kernel Client](./Kernel-Client.md) | Public Cloudflare routes, Hosted Agent V2 lifecycle, deterministic compile flow, authentication, and recovery behavior |
| [AI Bridge Control](./AI-Bridge-Control.md) | Authenticated session, schema, execution, replay, history, and MCP access to the live in-app AI tool surface |
| [Scene Streams](./Scene-Streams.md) | Named, re-runnable `ms-scene-v1` timeline blocks, live streaming in FlashBoard and `runEditorStream` |
| [Live Credit Burn Meter](./Credit-Burn-Meter.md) | Always-visible authoritative reserve bar, confirmed run spend, settlement motion, replay safety, and reduced-motion behavior |
| [Guest Hosted AI Access](./Guest-Hosted-AI-Access.md) | Anonymous hosted-AI sessions, 400 welcome credits, correct sign-in state, and hashed abuse limits |
| [Security](./Security.md) | Trust boundaries, bridge auth, allowed roots, secret handling, and limitations |
| [Debugging](./Debugging.md) | Logger service, runtime monitors, log sync, and AI-facing debug tools |
| [Playback Debugging](./Playback-Debugging.md) | Focused workflow for preview stalls, drift, and decode/render mismatches |
| [LAN Device Testing](./LAN-Device-Testing.md) | HTTPS dev server for real iPad/phone testing over Wi-Fi — certificate rules (Apple's 398-day limit), device trust setup, and bridge access |
| [Documentation Website](./Documentation-Site.md) | The /docs site: page sync, sidebar, page templates, media rules, build and hosting |

<!-- planned:
| [Effect system](./Effect-System.md) | Effect registry, pipelines, runtimes |
| [Timeline internals](./Timeline-Internals.md) | Timeline store, clip actions and rendering internals |
| [Media panel internals](./Media-Internals.md) | Import pipeline, media store and relinking internals |
-->

### Unpublished
<!-- docs-sidebar: unpublished -->

Internal runbooks and QA pages. They stay in the repository but the documentation site does not render them.

| Document | Description |
|---|---|
| [Agent Timeline Benchmarking](./Agent-Timeline-Benchmarking.md) | Development-bridge runner that collects local-media Agent Timeline benchmarks |
| [Codex Usage Monitoring](./Codex-Usage-Monitoring.md) | Local Codex session parser for per-turn token usage, stale-run detection, and Git commit attribution |
| [Consumer Contract](./Consumer-Contract.md) | Checkout consent (Terms, Withdrawal Policy, immediate performance), contract confirmation email, online withdrawal form, and the §312k cancellation button |
| [Credit Claims](./Credit-Claims.md) | Cloudflare-backed reward links for manually granted hosted credits |
| [Social Operations](./Social-Operations.md) | Private Fassandra console with Stats, Accounts, and Planning plus an aggregate-only server-to-server data boundary |
| [Visitor Notifier](./Visitor-Notifier.md) | Cloudflare visit feed, `/api/visits`, and the Windows tray notifier workflow |
| [Telegram Dev Chat](./Telegram-Dev-Chat.md) | BotFather, Cloudflare secrets, webhook setup, reply workflow, verification, and recovery for the two-way developer chat |
| [Product Analytics](./Product-Analytics.md) | Privacy-controlled semantic events, D1 funnels, effect/slider usage, sessions, and feature engagement |
| [Windows Beta Testing](./Windows-Beta-Testing.md) | Unattended native project dialogs, editing, exact export verification, playback and cleanup |
| [OCR Analysis](./OCR-Analysis.md) | Agent Timeline contracts and a tested local OCR pipeline that is not yet wired into the analysis job |
| [Landing Page](./Landing-Page.md) | Disabled landing chooser, direct editor routing, and the retained Chat/Medium entry routes |
| [Flex EQ Visual QA](./Flex-EQ-Visual-QA.md) | Deterministic dev-server route with seeded flexible-equalizer fixtures for visual checks |
