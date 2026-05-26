[Back to Features](./README.md)

# Node Workspace

The Node Workspace is a dockable graph view for the currently selected timeline clip. It follows the same primary selection rule as Properties: the last clicked selected clip is used, with a fallback to the first selected clip. Linked video/audio clips resolve to one graph owner: selecting either side opens the visual clip's graph, while the linked audio clip feeds the source node's audio and analysis ports.

The graph is derived from existing clip state and does not introduce a second render model. Node layout state is saved on the owning clip, while node parameters still read from the normal clip fields. A plain video clip appears as:

```text
Video Source -> Clip Output
```

When clip state contains processing, the view inserts the corresponding built-in nodes in render order:

```text
Source -> Transform -> Masks -> Color Graph -> Effects -> Clip Output
```

Audio effects are shown in a separate audio lane when the source exposes audio, but they now feed the combined `Clip Output` node's audio input. The graph no longer creates a second audio output node for linked or audio-capable clips. The canvas uses the Media Panel board interaction model: pan, wheel zoom, node dragging, fit/reset view, compact node cards, typed ports, edges, and an inspector for the selected node.

Right-clicking the canvas opens an Add Node menu. It can add AI Nodes at the clicked graph position, force field-backed built-ins such as Transform, Mask, and Color into the graph, and add existing effect types from an Effect Nodes submenu. Right-clicking a removable node also exposes Delete Node; pressing Delete or Backspace removes the selected Effect or AI node, and removes a forced built-in node when it was only shown by the graph.

Links can be edited directly on the board. Drag from any port to a compatible opposite port to connect it; selecting a link and pressing Disconnect/Delete, or right-clicking the link or port, removes the connection. Once a clip has manual links, those links are stored on the clip graph and replace the auto-generated chain until the user rewires it.

Effect and AI nodes include a compact bypass toggle in the node header. Effect bypass writes through to the existing effect enabled flag; AI node bypass is stored on the custom node and prevents that generated runtime from processing the preview signal.

The Transform node is the first write-through node. Its inspector edits opacity, position, scale, rotation, speed, blend mode, and reverse state through the same timeline store actions used by the Properties panel, so preview, export, history, and project persistence continue to see one clip model.

Effect nodes also expose write-through inspector controls. Numeric effect params use the keyframe-aware property path, while boolean/select params use the normal effect update action. The graph still does not execute effects itself; it edits the same effect stack consumed by the existing renderer.

The inspector can add existing effect types as new Effect nodes. This appends to the clip's normal effect stack, after which the graph projection creates the corresponding node.

The inspector can also add AI Nodes. These are project-local custom nodes stored in the clip graph with their prompt, generated-code draft, public ports, exposed parameter schema, runtime kind, status, and layout. The AI Node inspector can send the prompt to the configured AI provider and stores the generated JavaScript draft on the node. Ready AI Nodes run through the preview layer builder as deterministic texture processors when they can read the current source into canvas pixels; unsupported sources fall back to pass-through.

For audio-capable clips, the `Source` node exposes audio analysis output ports directly. Waveform, spectrum, loudness, beat/onset, phase, transcript, frequency-summary, and audio-metadata ports expose an `AI` action in the inspector. On audio-only graph owners, it creates a custom node with the selected port's signal type and metadata, then connects that port to the node as a sidechain. On visual graph owners, including linked video/audio selections, it creates a renderable texture AI Node in the main visual chain and connects the selected audio port as a named sidechain such as `frequencyBands`, `spectrum`, or `audioMetadata`.

During preview/export rendering, ready AI Nodes receive the same bounded audio context that the source node presents in the editor. For linked video/audio clips, `context.audio`, `input.audio`, `context.signals`, and `context.graph` resolve analysis refs, source-node port metadata, waveform summaries, audio metadata, clip/link identity, and track/master routing from the linked audio clip while keeping the graph owner on the visual clip. Direct source audio-analysis links into renderable AI Nodes also arrive as bounded named inputs, for example `input.frequencyBands` for a connected frequency-band table or `input.audioMetadata` when `audio-metadata` is wired into the node's audio metadata port; the same values are available under `context.signals.connectedInputs`.

AI Node authoring now sends a compact context package with each AI request: the selected clip, source-specific text details when present, a timeline overview, all projected graph nodes and links, the current node's direct connections, saved plan, generated-code state, exposed params, and hidden node memory. The inspector uses a single Send action and renders the full node chat, including user prompts and AI replies. The authoring agent decides from the prompt whether to chat/plan or call the virtual `activate_code` tool with deterministic `defineNode(...)` code that should become live. When generated code exposes numeric params, the inspector shows them under Outputs with the same stopwatch keyframe controls used by the rest of the timeline. The runtime resolves those params through the timeline keyframe interpolator and passes them into `context.params` for each render. Clearing active code clears the exposed parameter schema and removes the node's parameter keyframes, so stale controls do not survive without code.

The current graph projection is deterministic. Runtime preview and export still use the existing layer builders and renderer. Broader graph editing should continue to write through to the owning clip fields so Properties, timeline state, history, preview, and export remain one system.
