[Back to Features](./README.md)

# Node Workspace

The Node Workspace is a dockable graph view for the currently selected timeline clip. It follows the same primary selection rule as Properties: the last clicked selected clip is used, with a fallback to the first selected clip.

The graph is derived from existing clip state and does not introduce a second render model. Node layout state is saved on the owning clip, while node parameters still read from the normal clip fields. A plain video clip appears as:

```text
Video Source -> Clip Output
```

When clip state contains processing, the view inserts the corresponding built-in nodes in render order:

```text
Source -> Transform -> Masks -> Color Graph -> Effects -> Clip Output
```

Audio effects are shown in a separate audio lane when the source exposes audio. The canvas uses the Media Panel board interaction model: pan, wheel zoom, node dragging, fit/reset view, compact node cards, typed ports, edges, and an inspector for the selected node.

Right-clicking the canvas opens an Add Node menu. It can add AI Nodes at the clicked graph position, force field-backed built-ins such as Transform, Mask, and Color into the graph, and add existing effect types from an Effect Nodes submenu. Right-clicking a removable node also exposes Delete Node; pressing Delete or Backspace removes the selected Effect or AI node, and removes a forced built-in node when it was only shown by the graph.

Links can be edited directly on the board. Drag from any port to a compatible opposite port to connect it; selecting a link and pressing Disconnect/Delete, or right-clicking the link or port, removes the connection. Once a clip has manual links, those links are stored on the clip graph and replace the auto-generated chain until the user rewires it.

Effect and AI nodes include a compact bypass toggle in the node header. Effect bypass writes through to the existing effect enabled flag; AI node bypass is stored on the custom node and prevents that generated runtime from processing the preview signal.

The Transform node is the first write-through node. Its inspector edits opacity, position, scale, rotation, speed, blend mode, and reverse state through the same timeline store actions used by the Properties panel, so preview, export, history, and project persistence continue to see one clip model.

Effect nodes also expose write-through inspector controls. Numeric effect params use the keyframe-aware property path, while boolean/select params use the normal effect update action. The graph still does not execute effects itself; it edits the same effect stack consumed by the existing renderer.

The inspector can add existing effect types as new Effect nodes. This appends to the clip's normal effect stack, after which the graph projection creates the corresponding node.

The inspector can also add AI Nodes. These are project-local custom nodes stored in the clip graph with their prompt, generated-code draft, public ports, exposed parameter schema, runtime kind, status, and layout. The AI Node inspector can send the prompt to the configured AI provider and stores the generated JavaScript draft on the node. Ready AI Nodes run through the preview layer builder as deterministic texture processors when they can read the current source into canvas pixels; unsupported sources fall back to pass-through.

AI Node authoring now sends a compact context package with each AI request: the selected clip, source-specific text details when present, a timeline overview, all projected graph nodes and links, the current node's direct connections, saved plan, generated-code state, exposed params, and hidden node memory. The inspector uses a single Send action and renders the full node chat, including user prompts and AI replies. The authoring agent decides from the prompt whether to chat/plan or call the virtual `activate_code` tool with deterministic `defineNode(...)` code that should become live. When generated code exposes numeric params, the inspector shows them under Outputs with the same stopwatch keyframe controls used by the rest of the timeline. The runtime resolves those params through the timeline keyframe interpolator and passes them into `context.params` for each render. Clearing active code clears the exposed parameter schema and removes the node's parameter keyframes, so stale controls do not survive without code.

The current graph projection is deterministic. Runtime preview and export still use the existing layer builders and renderer. Broader graph editing should continue to write through to the owning clip fields so Properties, timeline state, history, preview, and export remain one system.
