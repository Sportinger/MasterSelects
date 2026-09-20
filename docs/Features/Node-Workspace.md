[Back to Features](./README.md)

# Node Workspace

The Node Workspace is a dockable, unified view of the canonical node-graph document for the currently selected timeline clip. It follows the same primary selection rule as Properties: the last clicked selected clip is used, with a fallback to the first selected clip. Linked video/audio clips resolve to one graph owner: selecting either side opens the visual clip's graph, while the linked audio clip feeds the source node's audio and analysis ports.

Selecting a clip shows **all its nodes on one canvas**. Color, Flock, Face Cables and
3D Scene appear as colored groups. The group header collapses a group to one node
or expands its contents; **Focus** fits that group. Collapse state and layout are
saved with the clip and restored when reopening the project. Collapse affects only
presentation, never rendering or a saved bake.

`NodeGraphDocument` retains the domain graphs behind this common canvas. Explicit
bindings route each edit to its existing owner; the UI does not maintain a second
copy of effect parameters, Flock definitions, color grades or 3D settings.

The graph is derived from existing clip state and shares the normal render model. Nodes carry explicit domain and backing bindings, so edits route back to the authoritative clip, effect, custom-node, or color-grade state. Node layout state is saved on the owning clip/domain, while node parameters read from the normal clip fields. A plain video clip appears as:

```text
Video Source -> Clip Output
```

When clip state contains processing, the view inserts the corresponding built-in nodes in render order:

```text
Source -> Transform -> Masks -> Color Graph -> Effects -> Clip Output
```

For visual graph owners with audio, audio effects are shown in a separate audio lane and feed the combined `Clip Output` node's audio input. Audio-only graph owners use the main lane. The graph uses one combined `Clip Output` node for linked or audio-capable clips. The canvas uses the Media Panel board interaction model: pan, wheel zoom, node dragging, fit/reset view, compact node cards, typed ports, edges, and an inspector for the selected node.

Flock's executable definition appears inside the green Flock group. Typed ports,
add/delete/duplicate/group/ungroup, bypass, exposed parameters, keyframes and the
preset library still use the existing Flock actions. Right-click a Flock node (or
the canvas with a Flock node selected) for its operator menu. Color nodes edit the
active grade directly; select a Color node to add Primary/Wheels nodes.

Face Cables is a cyan group containing four nested groups: Tracking, Surface &
depth, Cable physics and Cable rendering. MediaPipe produces landmarks; separate
nodes smooth them, build anchors and construct the face mesh. Image depth passes
through calibration and depth-to-mesh before the two meshes meet at **Stitch
Surfaces**. Both collision nodes use the same mesh-collision operator. The shared Wind
operation remains used by both cable physics and Flock's CPU/GPU solvers.

Select nodes and press **Ctrl+G** to create a colored subgroup. Collapsed groups
expose typed boundary ports that still address the original nodes. Their inspector
renames them, changes their parent and ungroups them without changing processing.
Groups can contain groups; layout, hierarchy and collapse state persist with the
project. Grouping across different runtime owners is rejected.

The inspector can add reusable force/value and surface operators. New surface
operators copy compatible incoming connections from the existing stage; their
parameters remain independent. Single inputs can also be connected using inspector
dropdowns. Required inputs, incompatible types, cycles and unsupported executor
combinations are rejected. Physics, smoothing and surface changes require a new
bake; appearance/UV/material changes in the scene graph render immediately.
Existing artifacts remain usable until a successful bake replaces them.

Ports show **IN / OUT**, their name and their semantic signal type. Port and wire
colors distinguish image/texture, depth, geometry, landmarks, material, UV,
collider, force and curve signals. Hover or keyboard-focus a port for a compact
tooltip with its type, accepted/produced representations and connection cardinality.
It sits beside the owning node when space permits; full explanations and coordinate
constraints stay in the catalog.
Enter/Space opens the details, Escape dismisses them; tapping a port also opens
details. Keyboard focus stays visible without leaving a focus ring after a pointer
click. Folded groups retain their original ports' contracts.

The canvas, connection dropdowns and saved operator graph validator use the same
format restrictions: relative depth must pass through calibration before depth-to-mesh;
Stitch Surfaces accepts a face mesh at Primary and a depth mesh at Background.
The catalog includes these contracts and supports searching their format names.
Formats here describe intermediate data, not encoded media-file extensions.

Video/image Source also exposes **Face landmarks** and each Face Cables effect's
**Saved scene depth**, alongside the existing audio-analysis outputs. Tooltips mark
saved, missing or stale data. Precise tracking is restored from its existing local
sidecar when the workspace opens. Connect landmarks to smoothing, anchors or a
compatible face-mesh input; connect calibrated saved depth directly to Depth to
mesh. The references persist in the executable effect graph without copying the
tracking series or depth payload. Wires still originate at Source when nested or
effect groups are collapsed, and can be disconnected/reconnected there. The
inspector's Connections dropdown also offers compatible Video Source artifacts;
missing or stale entries are disabled.

A connected saved-depth reference makes Bake cables reuse that depth without
model inference. Its original calibration is retained; source, timing, tracked pose
and mapping checks reject stale data before replacing the previous bake. At present
saved scene depth can feed consumers inside its owning cable effect; its calibrated
coordinates are not a general interchangeable depth asset across effects. A missing
tracking cache requires precise tracking again. Raw depth-video media files and
general pose/hand-tracking series are not yet Source artifact outputs.

A gold **3D Scene** group exposes an executable surface graph for video/image
planes and baked Face Cables:

```text
Decoded frame + UV transform -> Image texture -> Surface material
Plane geometry / Source geometry + Material -> Mesh -> 3D transform -> 3D render
```

Rewiring changes rendering: a material without a texture uses its solid color;
a mesh without geometry/material or a disconnected render output produces no
object. UV scale/offset, tint, opacity and plane size are independent parameters.
Source geometry reuses the saved face/depth/cable bake. Removing the transform
from the connected path bypasses the clip matrix without deleting its keyframes.
The same saved definition reaches preview, nested compositions and export. No GPU
objects or media handles are serialized. A saved explicit graph takes precedence
over the generated default when effects change.

Camera/light references still follow their clips' timing and visibility and expose
their original settings. Models, splats, voxel relief and Flock retain their
specialized geometry renderers and field-backed scene projections. The image
surface executor currently renders one connected mesh per clip, not an arbitrary
multi-object scene or shader program.

**Catalog** opens a searchable live inventory of registered operators, Flock nodes
and effects, including signal types, parameters and supported contexts. See the
[Node Catalog](./Node-Catalog.md) for implementation ownership and extension rules.

Right-clicking the canvas opens an Add Node menu. It can add AI Nodes at the clicked graph position, force field-backed built-ins such as Transform, Mask, and Color into the graph, and add existing effect types from an Effect Nodes submenu. Right-clicking a removable node also exposes Delete Node; pressing Delete or Backspace removes the selected Effect or AI node, and removes a forced built-in node when it was only shown by the graph.

Links can be edited directly on the board. Drag from any port to a compatible opposite port to connect it; selecting a link and pressing Disconnect/Delete, or right-clicking the link or port, removes the connection. The visual effect chain always follows the canonical effect stack, including after
adding/removing effects in Properties. Connecting effect A's output to effect B's
input inserts A directly before B and reconnects the remaining chain. The node
inspector also provides **Move effect earlier/later** controls. Properties reorder
and node reorder update the same array and renderer. Saved custom-node sidechains
remain independent. Required processing-chain links cannot be left dangling; use
bypass to skip an effect.

Effect and AI nodes include a compact bypass toggle in the node header. Effect bypass writes through to the existing effect enabled flag; AI node bypass is stored on the custom node and prevents that generated runtime from processing the preview signal.

Cable ends have colored semicircular **plugs** around their sockets, with grips
outside the node card. They remain visible above cards, including collapsed groups;
multiple links on a port have separate grips. Hover or keyboard-focus a free port
to preview its plug, which can also start a new connection. Existing grips highlight
on port hover. Plugs slide in and out on attachment and detachment, respecting the
system's reduced-motion preference.

Hovering an individual grip or its wire softly highlights only that cable and its
two plugs, making fan-out links easy to distinguish. The highlight fades out on leave.

While holding a cable over a compatible socket, a translucent docked plug previews
the connection and the draft wire snaps to it. Moving away or over an incompatible
port returns the plug to the pointer. The preview does not change the graph until
the cable is released.

Drag either end of an existing cable to a compatible port to reconnect it. Releasing
on empty canvas disconnects that cable; clicking without dragging does not.
Dropping back on the original socket keeps the link, while Escape, interrupted
pointer gestures and incompatible targets restore it. Required or locked links
retain their existing domain restrictions. Keyboard-focus a connected plug and
press Delete/Backspace to remove its cable; Enter/Space selects the link.

The Transform node writes through to the clip model. Its inspector edits opacity, position, scale, rotation, speed, blend mode, and reverse state through the same timeline store actions used by the Properties panel, so preview, export, history, and project persistence continue to see one clip model.

Effect nodes also expose write-through inspector controls. Numeric effect params use the keyframe-aware property path, while boolean/select params use the normal effect update action. The graph edits the same effect stack consumed by the existing renderer.

The inspector can add existing effect types as new Effect nodes. This appends to the clip's normal effect stack, after which the graph projection creates the corresponding node.

The inspector can also add AI Nodes. These are project-local custom nodes stored in the clip graph with their prompt, active generated code, public ports, exposed parameter schema, runtime kind, status, and layout. With authenticated hosted AI enabled, the AI Node inspector can send the prompt to the cloud provider and stores generated JavaScript on the node. Ready AI Nodes run through the preview layer builder as deterministic texture processors when they can read the current source into canvas pixels; unsupported sources fall back to pass-through.

For audio-capable clips, the `Source` node exposes audio analysis output ports directly. Waveform, spectrum, loudness, beat/onset, phase, transcript, frequency-summary, and audio-metadata ports expose an `AI` action in the inspector. On audio-only graph owners, it creates a custom node with the selected port's signal type and metadata, then connects that port to the node as a sidechain. On visual graph owners, including linked video/audio selections, it creates a renderable texture AI Node in the main visual chain and connects the selected audio port as a named sidechain such as `frequencyBands`, `spectrum`, or `audioMetadata`.

During preview rendering, ready AI Nodes receive the same bounded audio context that the source node presents in the editor. For linked video/audio clips, `context.audio`, `input.audio`, `context.signals`, and `context.graph` resolve analysis refs, source-node port metadata, waveform summaries, audio metadata, clip/link identity, and track/master routing from the linked audio clip while keeping the graph owner on the visual clip. Direct source audio-analysis links into renderable AI Nodes also arrive as bounded named inputs, for example `input.frequencyBands` for a connected frequency-band table or `input.audioMetadata` when `audio-metadata` is wired into the node's audio metadata port; the same values are available under `context.signals.connectedInputs`.

AI Node authoring sends a compact context package with each AI request: the selected clip, source-specific text details when present, a timeline overview, all projected graph nodes and links, the current node's direct connections, saved plan, generated-code state, exposed params, and hidden node memory. The inspector uses a single Send action and renders the full node chat, including user prompts and AI replies. The authoring agent decides from the prompt whether to chat/plan or call the virtual `activate_code` tool with deterministic `defineNode(...)` code for activation. Generated numeric parameters appear in the Parameters section with the same stopwatch keyframe controls used by the rest of the timeline; color parameters are keyframed through RGB channels, while boolean, select, and string parameters are static controls. The runtime resolves exposed parameters through the timeline keyframe interpolator and passes them into `context.params` for each preview render. Clearing active code clears the exposed parameter schema and removes the node's parameter keyframes.

The graph projection is deterministic. Runtime preview uses the existing layer builder; the export layer builder excludes the AI custom-node runtime. The AI tool registry also exposes `getNodeWorkspaceDebugState` and `sendAINodePrompt` for graph inspection and AI-node authoring. Graph editing writes through to the owning clip fields so Properties, timeline state, history, preview, and export remain one system.

## 3D effects and execution boundary

With one visible 3D object plus any number of lights, image effects after the 3D
render remain active. Lights no longer suppress the object's effect stack. For
Face Cables, effects before the geometry effect process its source texture;
effects after it process the rendered scene. Preview and nested/export rendering
share this routing. Multiple visible 3D objects share a depth-tested render target;
use a nested composition for scene-wide post effects so one object's effect does
not change unrelated objects. Multi-effect image stacks execute in order, including
repeated brightness/contrast operations.

The canvas combines domain runtimes; it is not an unrestricted cross-domain shader
compiler. Reusable force/value connections execute in the cable graph, Flock keeps
its typed compiler, Color keeps its grade compiler, and image surfaces use the scene executor. Camera/light dependencies remain
field-backed. New agent tools should use these validated mutations rather than UI
coordinates or a separate copy of the graph.
