---
title: "Node Workspace"
---

The Node Workspace is a dockable graph view for the currently selected timeline clip. It follows the same primary selection rule as Properties: the last clicked selected clip is used, with a fallback to the first selected clip. Linked video/audio clips resolve to one graph owner: selecting either side opens the visual clip's graph, while the linked audio clip feeds the source node's audio and analysis ports.

The graph is derived from existing clip state and shares the normal render model. Node layout state is saved on the owning clip, while node parameters read from the normal clip fields. A plain video clip appears as:

```text
Video Source -> Clip Output
```

When clip state contains processing, the view inserts the corresponding built-in nodes in render order:

```text
Source -> Transform -> Masks -> Color Graph -> Effects -> Clip Output
```

For visual graph owners with audio, audio effects are shown in a separate audio lane and feed the combined `Clip Output` node's audio input. Audio-only graph owners use the main lane. The graph uses one combined `Clip Output` node for linked or audio-capable clips. The canvas uses the Media Panel board interaction model: pan, wheel zoom, node dragging, fit/reset view, compact node cards, typed ports, edges, and an inspector for the selected node.

Right-clicking the canvas opens an Add Node menu. It can add AI Nodes at the clicked graph position, force field-backed built-ins such as Transform, Mask, and Color into the graph, and add existing effect types from an Effect Nodes submenu. Right-clicking a removable node also exposes Delete Node; pressing Delete or Backspace removes the selected Effect or AI node, and removes a forced built-in node when it was only shown by the graph.

Links can be edited directly on the board. Drag from any port to a compatible opposite port to connect it; selecting a link and pressing Disconnect/Delete, or right-clicking the link or port, removes the connection. Once a clip has manual links, those links are stored on the clip graph and replace the auto-generated chain until the user rewires it.

Effect and AI nodes include a compact bypass toggle in the node header. Effect bypass writes through to the existing effect enabled flag; AI node bypass is stored on the custom node and prevents that generated runtime from processing the preview signal.

The Transform node writes through to the clip model. Its inspector edits opacity, position, scale, rotation, speed, blend mode, and reverse state through the same timeline store actions used by the Properties panel, so preview, export, history, and project persistence continue to see one clip model.

Effect nodes also expose write-through inspector controls. Numeric effect params use the keyframe-aware property path, while boolean/select params use the normal effect update action. The graph edits the same effect stack consumed by the existing renderer.

The inspector can add existing effect types as new Effect nodes. This appends to the clip's normal effect stack, after which the graph projection creates the corresponding node.

The inspector can also add AI Nodes. These are project-local custom nodes stored in the clip graph with their prompt, active generated code, public ports, exposed parameter schema, runtime kind, status, and layout. With authenticated hosted AI enabled, the AI Node inspector can send the prompt to the cloud provider and stores generated JavaScript on the node. Ready AI Nodes run through the preview layer builder as deterministic texture processors when they can read the current source into canvas pixels; unsupported sources fall back to pass-through.

For audio-capable clips, the `Source` node exposes audio analysis output ports directly. Waveform, spectrum, loudness, beat/onset, phase, transcript, frequency-summary, and audio-metadata ports expose an `AI` action in the inspector. On audio-only graph owners, it creates a custom node with the selected port's signal type and metadata, then connects that port to the node as a sidechain. On visual graph owners, including linked video/audio selections, it creates a renderable texture AI Node in the main visual chain and connects the selected audio port as a named sidechain such as `frequencyBands`, `spectrum`, or `audioMetadata`.

During preview rendering, ready AI Nodes receive the same bounded audio context that the source node presents in the editor. For linked video/audio clips, `context.audio`, `input.audio`, `context.signals`, and `context.graph` resolve analysis refs, source-node port metadata, waveform summaries, audio metadata, clip/link identity, and track/master routing from the linked audio clip while keeping the graph owner on the visual clip. Direct source audio-analysis links into renderable AI Nodes also arrive as bounded named inputs, for example `input.frequencyBands` for a connected frequency-band table or `input.audioMetadata` when `audio-metadata` is wired into the node's audio metadata port; the same values are available under `context.signals.connectedInputs`.

AI Node authoring sends a compact context package with each AI request: the selected clip, source-specific text details when present, a timeline overview, all projected graph nodes and links, the current node's direct connections, saved plan, generated-code state, exposed params, and hidden node memory. The inspector uses a single Send action and renders the full node chat, including user prompts and AI replies. The authoring agent decides from the prompt whether to chat/plan or call the virtual `activate_code` tool with deterministic `defineNode(...)` code for activation. Generated numeric parameters appear in the Parameters section with the same stopwatch keyframe controls used by the rest of the timeline; color parameters are keyframed through RGB channels, while boolean, select, and string parameters are static controls. The runtime resolves exposed parameters through the timeline keyframe interpolator and passes them into `context.params` for each preview render. Clearing active code clears the exposed parameter schema and removes the node's parameter keyframes.

The graph projection is deterministic. Runtime preview uses the existing layer builder; the export layer builder excludes the AI custom-node runtime. The AI tool registry also exposes `getNodeWorkspaceDebugState` and `sendAINodePrompt` for graph inspection and AI-node authoring. Graph editing writes through to the owning clip fields so Properties, timeline state, history, preview, and export remain one system.
