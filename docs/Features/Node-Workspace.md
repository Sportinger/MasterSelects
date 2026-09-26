[Back to Features](./README.md)

# Node Workspace

The Node Workspace is a dockable, unified view of the canonical node-graph document for the currently selected timeline clip. It follows the same primary selection rule as Properties: the last clicked selected clip is used, with a fallback to the first selected clip. Linked video/audio clips resolve to one graph owner: selecting either side opens the visual clip's graph, while the linked audio clip feeds the source node's audio and analysis ports.

Each Nodes panel has its own **Node graph source** selector. **Active** is the default and follows timeline selection. Selecting a clip pins that panel to its graph even when another clip is selected or selection is cleared. Additional Nodes panels can show different clips; assignments persist with the dock layout. A missing assigned clip shows an explicit unavailable state instead of silently following another clip. Choose Active to release the assignment. Clips in other compositions become available again when their composition is active.

When an agent reads or edits a clip's node graph, the editor activates a Nodes tab in the Preview group and pins it to that clip. An existing docked Nodes tab is reused and retargeted, even if it previously showed another clip; if none exists, the editor creates one. If Preview was closed, it is restored. A maximized panel yields so the graph is visible. Detached windows remain untouched. Each subsequent node step activates the tab again, including steps inside `executeBatch`.

Graph edits animate structural changes in the canvas: added nodes scale and fade in, removed nodes fade and shrink out, and new cables draw from output to input. The same animation applies to direct edits and agent edits. Hover, parameter, layout, and playback updates do not restart it. Reduced motion settings show the final graph immediately.

Codex Direct streams graph construction as individual operations: each complete node, cable, parameter change, move or removal is applied while the next instruction is still arriving. The parser recognizes the closing brace of each JSON record, including formatted records and split text deltas; it does not wait for a newline, the whole code block or the completed response. Each operation passes the normal tool policy, undo and audit boundary. Incomplete records never execute; cancellation or failure stops later edits and leaves completed edits undoable. Other tools and legacy batches still present a frame between actions.

Agent clip selections update the timeline and inspector target without bringing Properties to the foreground. This also applies while building or focusing node graphs and adding effects. Clicking a clip manually still opens Properties.

The node inspector starts collapsed. Agent graph edits reveal the affected effect group while work proceeds, for both tool calls and streamed records. Nested groups open only when the agent edits one of their inner nodes; finished effects, compound nodes and building blocks it merely adds, uses or wires stay folded. A successfully completed chat turn collapses all groups in the clips it worked on. Failed, cancelled and planning turns do not apply that final collapse. Unrelated clips retain their group state.

Adding or removing nodes always fits the complete graph to the available canvas during its layout animation, including nodes arriving through internal or external agent tools and streamed node code. This also refits additions that already lie inside the current view. Adding, removing or reconnecting cables refits the resulting layout too, so later streamed connections do not leave outdated framing. Parameter edits do not reset manual navigation; a pointer or wheel gesture cancels a pending automatic fit. Group folding retains its own focus and restore behavior.

When an agent opens or closes groups, the viewport follows the same animated bounds as the effect and color group outlines, without a separate camera lag or final catch-up jump. New nodes are framed during their placement animation. Manual pointer or wheel navigation releases the automatic camera follow.

During construction, flow-layout groups arrange unconnected nodes side by side in a compact grid, sized from their card dimensions. Expanded child groups are arranged separately using their actual frame sizes, so a large unconnected subgroup cannot enlarge every loose card's grid cell. This separation also applies to a single loose card. Once connected, nodes return to the usual directed flow layout. Loose and connected nodes share one group origin, so old offsets or missing saved positions do not create empty space inside the group frame. Explicit manual positions inside the group stay fixed. Each addition reflows the outer chain so the growing group stays between Source on the left and Output on the right, moving Output outward as needed.

The narrow handle beside the right inspector hides or restores it, giving the graph the full panel width. Pointer interaction does not leave a blue focus ring on editor controls; keyboard Tab navigation still shows focus.

Gaussian splat clips expose their scene nodes here. The **Splat Exploration** effect adds
editable branches for Gaussian attributes, particles and reconstructed mesh wireframes;
simulation forces and mesh materials are separate connected nodes. See
[Splat Exploration nodes](./3D-Layers.md#splat-exploration-nodes) for execution and budgets.

### Shared scene outputs in the timeline

Select a Gaussian Surface, Mesh node, or a group containing those outputs and choose
**Show output in timeline** in the toolbar or node context menu. This adds a video
track with a linked output clip. The graph moves into a composition-owned document;
each clip edits the same nodes. The original output excludes published branches,
so mesh and particles are not drawn twice. Upstream crops and uploaded scan data
continue to share the renderer caches and the same scene camera/depth buffer.

The output navigation bar links the original, mesh, and particle views. Selecting
an output focuses its group when available. Timeline labels mark `[graph]` and
`[out]` clips. Output opacity, visibility, and additional transforms are local;
the scan alignment and graph clock are shared. Moving the original clip moves its
outputs once; trimming an output changes its visibility window without restarting
the graph. Hiding the original does not hide dependent outputs. Deleting an output
returns its branch to the original; deleting the original retains the graph for
its remaining outputs. Graph documents and references participate in undo and
project persistence.

This first stage publishes Gaussian scene branches. Independent graph retiming,
cross-composition output links, and independent graph copies are not exposed.

Selecting a clip shows **all its nodes on one canvas**. Color, Flock, Face Cables and
3D Scene appear as colored groups. Drag the group header to move its entire contents,
including nested groups. The separate arrow collapses or expands the group;
**Focus** fits that group. Header text adapts to zoom and truncates when needed;
frame width and header height never grow to accommodate text. Collapse state and layout are
saved with the clip and restored when reopening the project. Collapse affects only
presentation, never rendering or a saved bake. Collapsed effects and subgroups appear as regular node cards with typed ports and an expansion arrow beside the title, without an enclosing group frame. Groups start collapsed unless an explicit saved state opens them. Expanding one group smoothly fits its changing bounds. Collapsing it restores the zoom and position from immediately before that expansion, or fits the whole graph when no previous view was recorded. A short 220 ms transition moves cards, cables and surrounding nodes together. When groups open together, they build depth first from left to right: a group and all of its subgroups finish before the next group to its right starts. Within a group, cards appear one after another from left to right, and each cable draws in once both of its nodes are visible; group frames grow with the cards already shown. The next group starts as the last card of the previous one fades in. Closing reverses that sequence, and each group glides into its proxy. A slow frame delays later groups instead of letting them stack. The camera follows as one softly damped move and settles once at the end. Each step projects and lays out the intermediate hierarchy as an individual fold would: containing frames grow or shrink and surrounding nodes move along with them. Interrupted transitions continue from their current positions. Manual dragging stays direct, and reduced-motion preferences disable the transition.

The toolbar's **Expand all / Collapse all** includes hidden and never-opened
subgroups. Each action is one undo step. Zoom and pan continuously fit the currently
displayed intermediate graph throughout the sequence, following its changing size
instead of moving directly to the final bounds. Wheel zoom or a pointer gesture immediately takes control of the
view again. Reduced motion makes the fit immediate too.

`NodeGraphDocument` retains the domain graphs behind this common canvas. Explicit
bindings route each edit to its existing owner; the UI does not maintain a second
copy of effect parameters, Flock definitions, color grades or 3D settings.

The focused **Color Nodes** view uses this same canvas, including navigation,
cable reconnection, selection and previews. Color edits in either view use one
mutation owner. Corrector and Wheels inspectors expose the same complete set of
primary and wheel-channel parameters, with playhead-interpolated values, resets
and keyframe actions. These compact numeric controls are also reused by the Color
entry in Properties' Effects tab; the dedicated Color tab keeps its wheel UI.
Flock, Color, Face Cables, Scene and manual clip links share port
compatibility, format, input replacement and cycle checks. Flock's repeated inputs
still accept multiple sources. Domain compilers and saved version-1 definitions
remain intact; existing projects need no format migration.

Flock node parameters use the shared compact inspector, with collapsible sections,
numeric fields, sliders at suitable widths, reset and supported keyframe actions.
The link icon exposes a control to Properties. The Connections section offers a
keyboard-accessible alternative to cable dragging.

## Procedural parameter sources

Color Corrector/Wheels numeric channels, Hue Shift's Shift and Gaussian Blur's
Radius support **Fixed**, existing **Keyframes**, or a connected **Node**. Their
compact Properties/Nodes controls have a **Source** selector and **Go to source**.
Nodes with optional scalar controls show a compact `+` directly below their last
visible input, including when previews are enabled. It opens a searchable input
picker; **All** exposes every remaining
supported input in one undoable edit. Only explicitly added or connected ports
occupy the card, and connected ports stay visible. **Hide unused port** removes
an unconnected input again; **Reset** hides every unconnected optional input on
that node. Fixed mode keeps saved keys inactive; switching back to local
restores them. A connected source overrides the effective value without changing
the saved basis or curve. Driven fields and target keyframe actions are read-only.
The reset button resets the local basis, not the curve or binding.

**+ Control** adds Constant, Time, sine LFO, Keyframes, Add, Multiply, Clamp and
Remap. The node inspector offers numeric inputs and connection dropdowns as an
alternative to cable dragging. A Keyframes source references a stored curve,
not the already-modulated result. Combine it with an LFO through Add/Multiply;
fan out one source through separate Remaps to control multiple parameters.
Remap makes unit conversions explicit; Clamp supplies explicit limits. Blur
Radius cannot be negative. Quality/iteration settings are not control targets.

An unwired LFO uses clip time: `offset + amplitude * sin(2π * (frequency * time + phase))`.
Frequency is Hz; phase is cycles. Connect a Time node in Timeline mode to use the
containing composition's clock instead. Nested compositions use their own clock;
generated transition clips retain the original owner's clock. Split/leading trim
preserves the clip oscillator phase. Moving a clip moves clip-time animation;
media speed and reverse do not implicitly retime it.

The clip-owned graph is saved under `nodeGraph.parameterSources`, with undoable
connection changes. Color-version copies get independent reachable sources.
Parameter ports remain available on folded groups. Preview, inspectors and export
use the same scalar resolver; export freezes authored effects, grades, bindings
and curves. Invalid connected sources report errors and stop affected exports
instead of silently substituting a local value. Unknown saved operators remain
available for diagnosis. This is a scalar, clip-local MVP, not audio-rate DSP,
cross-clip wiring or GPU pixel-field reduction.

Factory layouts that previously included Transitions now include **Nodes** in
that tab position. Existing saved layouts are unchanged; Transitions remains
available through the panel menu.

## Saved effect presets

Open **Effect presets** in the Nodes toolbar, select an effect card or a node
inside its effect graph, enter a name and choose **Save effect copy**. The local
library stores the effect parameters, enabled state, internal graph, connections,
groups and internal node positions. **Add copy** appends an independent effect to
the selected visual clip in one undo step. Editing a copy or deleting its preset
does not change other copies or the source effect.

Presets are available across projects in the same browser profile. They are not
cloud-synced or included in project files; inserted effects are saved normally with
the project. Clip keyframes and external media are not bundled. Locked clips and
exports prevent insertion. Storage failures are shown without replacing the library.

## Adding nodes, node groups and effects

The canvas context menu has three levels, each with nested category submenus:

- **Nodes**: basic building blocks by category (Inputs, Values & Time, Math, Logic &
  Switch, Vector & Convert, Color & Mask, Coordinates & Lens, Sampling & Filter, Time &
  Motion, Patterns & Fields, Text & Glyph, Geometry, Shading, Forces & Simulation,
  Tracking & Depth, Output & Render). Clip stages and controls are filed into the same
  categories: AI under Inputs, Keyframes and the controls (labelled "(Control)") under
  Values & Time or Math, Transform under Coordinates & Lens, Mask and Color Grade
  under Color & Mask.
- **Node Groups**: reusable compositions of nodes, by the same categories.
- **Effects**: complete looks by group (Color & Tone, Blur & Sharpen, Lens & Distort,
  Print & Halftone, Text & Glyph, Analog & Glitch, …).

Nodes and Node Groups list every building block of every graph kind (image,
analog signal, 3D relief, face cables, splat, particles); each submenu shows how many
entries it holds. A choice goes into the effect under the pointer or the selected
effect node when that graph accepts it, otherwise into an existing effect of the
matching kind, and otherwise into a new one: image nodes create the clip's free
**Node Graph** effect on first use, splat nodes a Splat Exploration effect, and so
on. The tooltip names the destination. Search at the top matches names, categories,
descriptions and synonyms (for example "green screen" finds Chroma Key) and shows
where each result lives. The menu supports hover, click/touch and keyboard
activation (Enter or Right opens a submenu, Escape or Left closes it). Hover is
forgiving: an open submenu stays open while the pointer crosses sibling rows on its
way into it or briefly overshoots, submenus never show a scrollbar, and the whole
menu closes on its own about a second after the pointer leaves it (or 1.5 s after
opening if it is never entered; a typed search keeps it open). Insertion is
one undo step and opens a collapsed destination effect; a locked or exporting clip
reports the reason in the menu.

Right-clicking a cable inside an effect graph also offers that graph's Nodes and
Node Groups, without type filtering. The chosen node is placed at the pointer and
wired between the cable's ends (preferring ports of the cable's type); if a side
cannot connect, the node stays unconnected there and the original cable remains.

The Fisheye node groups include Lens Projection, Chromatic Aberration, Lens Vignette
and Lens Coverage; its other processing areas are advanced building parts.
The **Color & Mask** category includes **Hue Shift**, built from the existing RGB/HSV
conversion, vector and scalar math nodes rather than a separate opaque operator.
These are also available from the inspector's **Add node** selector in other
supported image-effect graphs. The parameter and constant folders are organization
for the original effect, not separate processing blocks.

The **Sampling** section provides **Texel Offset**, **Gaussian Weight**, and
**Normalize by Weight**. These expand into existing vector, scalar and
conversion operators. Exact matching formulas in Gaussian Blur, Box Blur and
Sharpen become shared instances; edited formulas and user group boundaries are
preserved. Gaussian Blur's original graph is organized into Radius & Sample Count,
Kernel Sampling, Gaussian Weight, and Weighted Blur & Bypass, with frame input and
output outside. The radius threshold and existing sampling/alpha arithmetic are
unchanged. This is an organization/reuse upgrade, not a separable-blur optimization.

The same organization now covers Box Blur/Sharpen, Motion/Radial/Zoom Blur,
Glow/Edge Detect, Wave/Twirl/Bulge, Pixelate/Mirror/RGB Split/Blockify/Block Mosaic,
Brightness/Contrast/Saturation/Exposure/Levels/Temperature/Vibrance/Threshold/
Posterize/Invert, and all 19 ASCII/Glyph variants (including ASCII Ghost).
Untouched default graphs receive named parameter, resource and processing stages
once. Custom wiring, existing user folders and explicitly removed folders are
not replaced. Interleaved branches stay separate where a folder would make the
visible signal path cyclic.

**Node Groups** also offers bounded sample count, scale from center, luminance
saturation, contrast, bright-pass and Sobel blocks. **Glyph** contains cell-grid,
tone-to-index and atlas-alpha blocks; **Feedback** contains the stateless decay/max
blend used by ASCII Ghost. Font-atlas and history sources stay outside these
blocks, so the resource owner and processing inputs remain visible. All blocks
expand into existing operators; their insertion does not add a render pass.

CRT Screen also organizes its untouched default graph into curvature, sampling,
scanline, phosphor-mask, flicker and final color/alpha stages. **Node Groups →
Coordinates & Lens** includes Radial Curvature, **Sampling & Filter** includes Clamped
Image Sample, and the advanced building parts include Phosphor Stripes and Sine Wave.
Both CRT sine branches share one recipe; compatible Glitch clamp/sample pairs
share another. Their ports name the actual inputs (including radians, pixel
width and UV bounds), while timeline time and source images stay outside the
blocks. Existing user groups and earlier detached compositions are preserved.

Each inserted node has typed boundary inputs and outputs and an expandable
interior. Shared literal constants stay inside; effect-owned values become input
sockets, so an instance never silently binds to another effect's parameters.
Connect the required inputs to finish the graph; incomplete graphs use the existing
paused-effect behavior. Sampling blocks retain their lexical coordinate/sequence
semantics. Changing an instance's interior makes it a local editable group.

## Reusable coordinate nodes

Kaleidoscope is the first composition pilot. Its graph uses three registered,
versioned definitions: **Cartesian to Polar**, **Mirror Repeat**, and
**Polar to Cartesian**. Each behaves like one typed node when collapsed and
opens into editable primitive nodes. One public input can feed several internal
ports; connecting or disconnecting that input updates all consumers together.

Fisheye uses the same system. Its six main areas contain 20 subgroups, including
three **Restore Lens Coordinates** instances (red, green and blue), each containing
two reusable **Divide X** nodes. Both definitions are available to other image
graphs. The remaining subgroups organize constants, sample offsets, lens space,
projection, radius/zoom, frame borders, channel assembly, vignette and sample resolve.
The sample reducer sits at the end of the graph; frame input and image output sit
outside the internal folders. Opening just the effect exposes eight cards;
opening every level exposes the original 250 primitive nodes.
Collapsed local folders expose one input per incoming signal, even when several
internal nodes consume it. Reconnecting or disconnecting that socket updates all
of its original leaf endpoints; expanding still reveals the individual wires.
Value outputs carry their parameter or constant names in the folder interface.

The Fisheye upgrade preserves all primitive IDs, parameter bindings, sampling
scopes and arithmetic, generating the identical shader without additional passes.
Only the original six-folder organization is reorganized automatically; custom
folders are retained. New exact recognition rules can extract patterns within a
folder but never across its boundary. Migration revisions avoid regrouping a
previously ungrouped instance. Nested instances retain their children's identities
and positions through save/reopen and detach locally when edited.

Hue Shift uses the same expandable composition model for its RGB-to-HSV conversion,
wrapped hue addition and HSV-to-RGB conversion. Its Shift value remains outside the
shared interior as a normal effect-owned parameter, so keyframes and the original
0–1 turns contract stay intact. Existing flat Hue Shift graphs are recognized by
structure and retain their primitive IDs when the composition is opened.

The definitions can be added to other image-effect graphs. Exact structural
recognition also replaces matching, ungrouped primitive patterns when an existing
image graph is opened. It preserves parameter bindings and stable internal IDs;
changed formulas and unexpected intermediate fan-out stay local. Explicit
ungrouping is retained. Editing a shared instance's processing steps or name
detaches that instance into a local group, leaving other instances unchanged.
Saved graphs retain the definition ID, revision and internal identity/layout map.
This pilot uses bundled definitions; a project-authored definition library and
execution in audio, Flock or scene graphs are not implemented yet.

The image compiler expands compositions inline without additional render passes.
Expansion supports up to four nested levels within the existing image graph
budgets. All effect groups, including audio graphs, use the common flow layout. Color,
Flock and scene groups use it too. Groups arrange nodes by data flow, recursively measure expanded
subgroups, and move Clip Output after the effect. Added nodes and changed wiring
participate in layout. Explicitly dragged internal node positions remain anchored.
At the top level only, automatic placement wraps effect frames into additional rows
when this reduces the longest side of the layout, aiming for a compact, roughly square
arrangement. It uses the measured frame sizes and moves each effect as a whole;
the node arrangement inside effects and nested groups is unchanged. Source and Clip
Output remain at the sides. Manual group placement is preserved until **Arrange** or **Reset**.
The **Compact** toolbar toggle enables or disables this wrapping immediately. Its
state is saved per graph, supports undo, and is retained by **Arrange** and **Reset**;
turning it off restores horizontal effect flow without rearranging effect interiors.
Moving any card keeps the grouped arrangement as shown: the move anchors every
current group member, so other cards and frames do not re-flow around the moved
card. New nodes are still placed automatically, and ungrouped downstream stages
such as Clip Output still follow a resized effect. A manually placed Clip Output
that a re-flowing effect frame grows into moves right of the chain instead of
pushing the frame below it.
On either fold direction, the connected outer chain also reflows, leaving 100 graph
units between Source, complete effect frames or cards, and Clip Output. Source
stays in place; old outer anchors cannot leave expanded-sized gaps after closing.
When a group expands into unrelated nodes or sibling groups, those objects move outside the complete frame, even when their old positions were manually placed. Sibling groups move as a unit; membership stays unchanged. Collapsing restores positions displaced by expansion, so surrounding nodes move closer again. A subsequent manual move replaces that automatic return position.

**Arrange** explicitly sorts the visible group hierarchy and its connected outer
chain again. It releases manual interior anchors, includes expanded subgroup sizes,
and preserves graph connections and parameters. It is undoable and keeps the
current viewport; use **Fit** to see the complete arrangement.
Large banks of independent values use a compact grid. Staged folding reuses the
prepared effect interiors instead of recompiling the effect for each subgroup;
parameter or graph changes prepare a new subject.
The bitmap keeps a stable compositing layer when a zoom or Fit completes, so
Chromium does not leave the previous canvas scale behind the updated group frames.

## Math and Voxel Relief

Voxel Relief opens as an editable group with nested geometry and height-field
steps: frame, UV/image texture, luminance, clamp, power, multiply, add, grid,
primitive, instancing, material, mesh, camera, lighting and render. The primitive
uses one Shape dropdown for Box, Sphere or Cylinder; Box remains the saved default.
Shared texture,
material and mesh operators reuse the scene registry. Existing relief parameters
and animation bindings retain their values when opening an older project.

Math cards put A and B on the left, the operation between them, and the result
on the right. The operation dropdown is available in the selected node's
inspector, keeping the canvas card focused on ports and values. Changing modes
keeps the node identity, compatible links and numeric
bindings; inputs absent in the new mode disconnect in the same undo step.
Flock math cards offer all operations supported by the Flock registry.

Numeric **Value** cards use a white accent and show the editable number to the
left of the output connector. Their **Type** dropdown is available only in the
right inspector. Image graphs offer Float and Integer; Integer truncates toward
zero after parameter animation while retaining the shared numeric signal port.
Changing type preserves compatible connections and parameter bindings.

Numeric and text viewers, including math symbols and sampled port values, draw
directly in the worker canvas without thumbnail generation or atlas tiles.
Editable values retain transparent DOM interaction targets; their controls become
visible during editing or keyboard focus. Unconnected operands can be dragged or typed
directly; the touched number updates immediately while dependent calculations
finish independently. Numeric jobs do not wait for image-preview readbacks.
Unchanged image effects share a validated preview graph and cached scalar results
across their visible ports. Panning, folding and texture-preview retries reuse
those results; parameter, graph and animated sample changes invalidate them.
For graph-local constants, inline and inspector controls share the same saved
Min/Max/Default preference. Registry values are the fallback; typed values clamp
to the effective range and right-click resets to the effective default. A numeric Value literal may use any finite customized range, while parameters with
domain constraints retain their registry limits. The preference is editor-local;
the actual constant, graph layout and groups persist with the project graph and
participate in undo, save and load.
Relief math values use a shared 16-byte GPU sample of the center grid cell; the
tooltip identifies that sample because field values vary across the image.
The inspector shows those same live connected inputs and results. No additional
video decoder is opened. Values, operation changes and their bindings support
undo and project saves; unavailable live values are shown as a dash.

Cable sections passing behind unrelated groups draw at 30% opacity under one
frame, 15% under two, 7.5% under three, and halve again for each additional
frame. Covered regions are cached independently of pan and zoom; cable paths
are built once per paint and reused across depth layers. Wires that do not cross
any covering frame use a single normal pass, and irrelevant depth clips are skipped.
Flow signals follow the same depth fading. Covered sections cannot
be hovered or clicked there. Wires belonging to a group retain their normal
appearance and interaction inside that group.

Short forward connections use the space between their ports without a backward
loop. Obstacle routing may approach the final horizontal input stub vertically
without taking an extra lap to face right beforehand. **Avoid** first checks simple
lanes against card and group clearance before searching the grid. Backward links
also participate in obstacle routing. Repeated waypoints and retraced straight
runs are removed before corners are rounded.

The toolbar's **Lines** button cycles the cable routing: **Curved** (the default
bezier), **Angular** (orthogonal lanes with hard corners, with parallel links between
the same cards bundled into very close adjacent lanes; animated and avoided routes stay orthogonal) and **Smart** (the same
orthogonal lanes with rounded corners). Backward links in both orthogonal styles
leave and enter horizontally and loop around their ports. Painting, flow signals,
hover and click hit testing, and culling all use the same route. The choice is
an editor preference that persists across sessions, not project data.

**Avoid** is an independent toggle that routes cables around cards and unrelated
expanded group frames, in every line style: Curved and Smart detours use rounded corners,
Angular keeps hard corners. Routes run on a coarse orthogonal grid with a small
clearance around each card, prefer few bends, and bundle cables from the same
output into shared lanes. Angular parallel lanes are retained when a clear
obstacle-avoiding path exists. They are computed in a worker once the layout settles
(about 0.2 s for 700 cables), never per frame. Existing avoided routes follow
animated endpoints while the worker recalculates, so graph updates do not flash
a direct cable first. During a card drag, existing cable lanes move with their ports in real time;
the obstacle search reruns after the drop. Groups containing an endpoint remain
accessible; unrelated groups, including nested frames, are obstacles. Backward links
also detour around such groups. Links without a
clear path inside the search budget and hidden legacy DOM rendering keep direct
routes. Avoid is an editor preference like the line style.

### Cable branch points

Double-click a cable, or right-click it and choose **Add branch point here**, to
split it at that position. One trunk then runs from the output to the point, and
the connection continues from there. Drag the grip beside a point onto another
input to add a branch; every connection leaving through one point shares a single
output grip, so an output can fan out from any position instead of from the stack
of grips beside its socket. Points can be split again (a double-click on a trunk
inserts a point before the existing one) for as many levels as needed.
Drag a point to move it; Shift-click or a right-drag marquee selects several
points, which then move together. Double-click a point, press Delete, or use
**Remove branch point** in its context menu to remove it: its cables continue from
the previous point or the output. Right-clicking a cable also offers
**Disconnect**. Branch points are presentation only: every connection still runs
output to input, so rendering, export and undo of the graph itself are unchanged.
Points are stored with the canvas layout, participate in undo and project saves,
and are ignored while their connections are hidden by a collapsed group. The
accessible DOM fallback renderer draws connections without branch points.

## Canvas navigation

Mouse-wheel and trackpad scrolling zoom smoothly around the pointer. Zoom is
continuous and exponential: the scroll distance determines the proportional
change, including fine trackpad movements. Pixel, line and page wheel input are
normalized, and short frame-based smoothing softens mouse-wheel notches. The
zoom range is 5–240%, allowing a wider overview of large graphs; horizontal-only scrolling does not change zoom.

Dragging, **Fit**, **Focus** and **Reset** interrupt any pending zoom animation.
Reduced-motion preferences keep the same continuous zoom without smoothing.

Right-dragging with a mouse draws a selection marquee after a short movement
threshold and selects every intersecting node. A stationary right-click keeps the
existing node/canvas context menu; the context-menu event following a completed
marquee drag is suppressed. The gesture uses pointer capture so selection continues
outside the initial hit target. Touch and pen input do not enter this mouse-specific
gesture. Pointer activation does not leave focus styling behind, while keyboard
navigation retains the intentional `focus-visible` outline.

## Inline previews

Previews are enabled by default. The small viewer button on each card toggles that
node; **Previews** in the toolbar switches every node viewer off or on together,
including hidden nodes. Newly revealed nodes inherit the global setting.
During fold animations, existing thumbnails remain visible while new preview
requests pause; they resume at the current timeline time when the layout settles.
Intermediate fold layouts are computed as each group starts. The main thread sends
one layout per fold step; the canvas worker eases cards, cables and plugs between
steps at display rate, so motion needs no per-frame React or scene work.
Dragging a card works the same way: pointer moves only send an offset for the
dragged cards (and their cable ends and plugs) to the canvas worker, and the
canvas owns the pointer capture. React, scene building and placement run once, on
release. In the DOM fallback, and before a canvas paints, cards move in React.
Moving an effect-internal card writes only its layout: the render plan cache
ignores card positions, so a move neither recompiles the effect nor clears
cached frames. Clicking or dragging the already selected card does not reselect it.
In canvas mode each card is a single focusable hit target. Its ports, buttons,
plug grips and inline editors mount only while the card is active: under the
pointer (tracked geometrically, so it also works during a captured connection
drag), selected, or focused. Activation keeps the same card element, so focus
and pointer capture survive it. Selection changes and connection drafts reach
only the cards they affect. A top-level effect card move replaces only the
stored layout map, and previews treat such layout-only edits as presentation,
so a drop neither recompiles, re-renders previews nor clears cached frames.
Clip updates serialize the timeline for transition maintenance only when a
changed clip takes part in a transition; before, every clip edit revalidated
every effect graph. Active cards also stay mounted while other hit targets mount
in batches, so a focused or captured card never loses focus mid-batch. Moving
views keep full resolution and every detail. Node cards and repeated plug shapes
are cached as bitmaps at or above the current pixel scale and redrawn only when
their content changes or the zoom needs a sharper bitmap; overview levels keep
zoom-in headroom and zooming out reuses a card bitmap for up to one octave, so a
fast wheel zoom does not re-rasterize every card. While a wheel zoom animates,
invisible DOM hit targets keep their membership and update once it settles; cables are stroked in shared batches, and
far overviews draw them slightly thinner. Card hit targets return in small
batches after a fold. In canvas mode, cable hover, click and context menu use a
geometry index instead of per-cable DOM paths: the segment between two pointer
samples is tested, so fast sweeps highlight every cable they cross, and pressing
on a cable still pans the view. Hover highlights are drawn on the worker overlay
without rebuilding the scene. Wires behind unrelated groups stay dimmed and cannot
be selected. This affects only the node canvas, never the video preview or export quality.
After switching all viewers off, individual node viewers can be enabled again. Output
selectors switch the viewed port. Preferences are saved on the owning clip and
survive project/history round trips. Portrait, landscape and square images retain
their aspect ratio. Placement resolves collisions using the complete card size,
including the preview; this also applies when adding nodes to existing graphs.

Color viewer choices follow the saved node between Color and Nodes and remain
separate for each color version. Flock viewers show evaluated parameters, scalar
values or a bounded sample of already simulated particles. Old particle samples
are marked stale. Scene previews show the shared rendered Flock scene, not an
independent render of each branch. Opening a viewer never advances the simulation
or starts missing audio analysis; unavailable outputs are identified explicitly.
Manual internal positions remain anchored until Arrange or Reset. Automatic folding,
surrounding-node displacement, output following, staggered animation and continuous
fit are shared rules for every group, rather than per-effect implementations.

Each group has a **lock** for outgoing membership changes. Unlock the source to
drag a node into another expanded group or effect; the target may remain locked.
Unlocking an enclosing effect also releases nodes in its nested groups. Frames
stay fixed during the drag. On entry, incoming nodes find a free position using
the full card/preview bounds, and the target frame expands to enclose them.
Existing nodes retain their positions; ordinary moves within a group remain free.
Within an effect, dropping into a subgroup changes its saved membership. Between
compatible effect/scene owners, the node actually transfers to the target graph,
including parameter values and supported effect keyframes. Internal links and
unambiguous boundary connections to free inputs move with it. Existing target
nodes and occupied inputs are preserved; unmatched connections stay disconnected.
Core nodes such as Cable simulation can move too: an incomplete effect remains
editable, saves normally, and pauses processing with a warning in its group header.
Hover the warning for the missing connection. Repairing its wiring resumes it
automatically, without changing the user's enable toggle. Corrupt wiring and
incompatible runtimes are still rejected with an explanation. A transfer, its
placement and parameter/keyframe ownership changes form one undo step.

Source images borrow the current decoded frame. Color input, individual correctors,
color output, effects, masks and clip output tap the render pipeline. Neutral and
bypassed correctors display their passed-through image. The native scene supplies
its shared rendered result. Saved tracking, calibrated depth, face/depth/cable
geometry and animation curves have data viewers; scene nodes show UVs, texture,
material tint/opacity, local/world geometry, and camera/light values. Geometry
previews are wireframes, not additional scene renders. Missing data is identified
explicitly: opening a viewer never runs analysis or rebakes. Raw inference depth
is not retained by existing bakes, and the realtime color graph does not evaluate
its structural key ports; these ports report unavailable output.

Local image-operator graphs use the same fused compiler plan for rendering and
node previews. A visible viewer requests its exact node port; image, RGB, alpha,
scalar and vector intermediates are lowered through the canonical image IR and
captured by the existing GPU preview tap. Per-pixel intermediates therefore show
their real result rather than the full source or final effect output. Uniform
numeric inputs remain readable beside that image. No preview pipeline or materialized
intermediate is created while its viewer is off, and preview shaders are cached per
GPU device with bounded lifetime and device-loss/HMR handling.

Brightness, Contrast and Saturation open as real math graphs rather than opaque
effect cards. Their Amount value remains the existing effect parameter, including
its keyframes and original Min/Max/Default contract; the inline value and inspector
edit that same binding. RGB arithmetic is clamped before it is recombined with the
unchanged source alpha, and graph layout, constants and connections persist with
the effect through history and project save/load.

The same applies to Exposure, Levels, Hue Shift, Temperature and Vibrance. Their
inspectors retain the original parameter schemas and keyframes while the canvas
shows the actual scalar/RGB arithmetic, HSV conversion, channel reducers and
range/gamma stages. Rewiring those nodes changes the compiled result; source alpha
continues directly to the final combine node.

Threshold exposes Rec.709 luminance, strict comparison and scalar selection as
separate nodes. Posterize exposes its effective level floor, multiplication,
subtraction and raw division chain, with no hidden final clamp. Their original
Level/Levels controls and keyframes remain the graph bindings, while alpha follows
the same direct split-to-combine path.

Vignette exposes its real coordinate-driven graph as well. A normalized fragment
coordinate node feeds the center, aspect, distance and smoothstep chain; it is not
the texture-transform UV node. Amount, Size, Softness and Roundness remain the
original effect-owned controls, and the graph stays on the contextual fullscreen
render path rather than the pixel-only inline stack.

Analog Signal Lab appears as its actual signal chain rather than one opaque effect
card. PAL, RF, VHS, receiver, decoder and display nodes expose the original effect
parameters through the shared inspector, including the PAL decoder and tape-speed
selects. Connections are project data: edits, layout and incomplete wiring use the
same graph owner, history and save/load path as the effect, with no parallel UI copy.

A third viewport-sized OffscreenCanvas layer draws previews without per-frame
React updates. A shared atlas has a 32 MiB ceiling and packs 128, 512 or 2048
thumbnails depending on the initial zoom and later enlargement. Atlas enlargement
copies existing tiles before releasing the old atlas (temporarily up to 64 MiB);
zooming out does not downsample cached images. Images are closed after rasterization. One scheduler
limits work to two concurrent producers, 2 million thumbnail pixels/second and a
2 ms synchronous dispatch budget. GPU copies share one same-device atlas, without
full-resolution readback or per-node canvases. Compressed geometry is sampled in
one additional lazy worker. Both worker delivery and data jobs have watchdogs.

Only visible viewers request work. Hidden panels/tabs, collapsed contents and
export pause requests. Tiny viewers below 32 screen pixels retain their last
image; larger viewers refresh at up to 12 Hz (5 Hz at overview zoom, 3 Hz in the
software fallback). Paused unchanged outputs reuse cached pixels. A viewer whose
stage produces no output retries with exponential backoff and rests
after three misses until the playhead, an edit or the graph changes, so an
unrenderable stage cannot keep the paused render loop awake. Continuous
playback accepts bounded asynchronous latency; edits and seeks discard obsolete
results. Pan and zoom reuse existing atlas pixels. Previews that scroll out of
view keep their completed or miss state, so moving them back into view neither
re-renders cached pixels nor restarts their retry budget; only images the atlas
evicted for capacity are requested again. Zooming into a higher resolution tier
(half-octave steps up to 256 px) re-renders a paused viewer once at that size;
zooming out keeps the sharper image.
These are bounded preview costs;
expensive processing in the editor's main render path still affects frame time.

Timeline playback shares the GPU process with the video preview, so the graph
yields to it while playing. Image viewers share a budget of about 24 renders per
second across all visible image previews, capped at the idle rates above. Number
readouts refresh at 10 Hz. Readouts whose value cannot change during playback
keep their last sample; that includes pure value, math, vector and conversion
nodes fed only by constants that are not keyframed. The canvas worker draws at
15 Hz during playback and sends each layer only when it changed: static cards and
cables with their overscan, then thumbnails and signal flow cropped to the
viewport. **Signals** in the toolbar hides the dots that flow along cables during
playback; scrubbing still shows them. The choice is an editor preference.

The isolated `/tests/browser/node-previews-probe.html` page exercises color stages,
portrait aspect ratio, toggles and large graphs without modifying an editor project.
Append `?software` to exercise main-thread canvas fallback. Unit regressions cover
scheduling/fairness, resource cleanup, atlas limits, stage geometry and placement.

## Connection flow

While playing or moving the timeline playhead, cables show two evenly spaced
signal points from output to input. Their speed follows playback speed and the
measured scrub speed: slow drags move them slowly, fast drags speed them up.
Static arrows keep the direction readable while paused.
Backward scrubbing and reverse playback keep that same data-flow direction.
Motion stops after scrubbing settles or playback pauses; holding the playhead
still does not keep it running. Disconnected cables and connection drafts have
no moving signal.
The points fade in within 100 ms when playback or scrubbing starts and fade out
in place when it stops. Each point also fades and shrinks near both cable ends, so it never
pops when it wraps back to the output. Their size grows with the canvas zoom
within a readable 1.4-5 screen pixel range.

Reduced-motion preferences disable the moving signal points. Hidden tabs and
offscreen graph panels pause the overlay. This visualizes graph direction,
not measured execution, cache misses or rebaking; saved/baked dependencies can
still carry a signal. It does not change node state, rendering or export.

## Source clip for time effects

A **texture** is the current frame only. Time effects (Slit Scan, Time Stack)
need other moments of a video, so they have a second input, **Source clip**
(`clip` signal, amber). On a clip with source video, a read-only `clip` cable
runs from the Source card straight to the time effect, past any preceding
effects: the time effect reads the original source video, not the processed
texture on its main input.

Generated sources (motion shapes, text, nested compositions) have no source
clip. The time effect's clip input then stays empty and its card shows
**No source clip**; the renderer skips the effect and passes its input through.
When an effect group is expanded, the cable ends at the history sampler inside it.

## Stabilization bake

Clips with baked face/lip stabilization show a separate **Stabilization** group:
**Video Source / Face landmarks → Face or Lip stabilization → Transform keyframes
→ Clip Transform**. The last connection targets the actual 2D or 3D transform;
opening the graph does not rebake, duplicate keys or change the clip.

Expand/collapse and **Focus** work like other groups. **Byp** on the group or its
nodes switches the existing stabilization bypass, preserving the keys and manual
clip transform. Group and node positions, provenance and bypass support project
storage and history. The curve node's animation area opens the same Position X,
Position Y and Rotation Z keys that appear on the timeline.

Bypass disables the generated stabilization keys at playback and removes their
recorded image mapping from saved Face Cables geometry. Tracked facial movement
and simulated cable shapes remain. This correction uses the bake's saved mapping
provenance, including existing depth bakes; older artifacts without that provenance
need a new cable bake. The saved geometry itself is never modified.
The bypassed stabilization keys turn gray in timeline rows, clip markers and
curve editors; their curve segments become dashed while remaining editable.

Executable 3D scene nodes also support **Byp**. **Clip Transform** passes the object
through without its transform or transform keyframes, which turn gray. **UV**
passes through the incoming UVs. Muting **Frame** or **Image texture** leaves the
material's solid color; muting **Geometry**, **Material**, **Mesh** or **3D render**
hides the connected object. These controls affect preview and export and preserve
connections, parameters and keyframes for re-enabling or undo.

The stabilization inspector shows the target clip, tracking availability and bake
status. New bakes record Face/Lips, center lock, smoothing, tracking revision and
sample counts. It identifies changed inputs, retracking, edited curves and removed
keys. Older projects show their existing chain with **Baked · settings not recorded** and unknown
settings; they do not guess whether Face or Lips was used.

The **Next bake** controls run the existing stabilization calculation on an
unlocked, supported 2D clip with tracking available. Baking replaces its Position
X/Y and Rotation Z channels; Undo restores the previous keys and provenance.
Dashed cables show recorded bake dependencies, remain visible without selection,
and have no live flow animation or cable-editing actions. Playback reads the saved
curves; changing the landmarks or bake settings requires another bake.

Nodes, cables, plugs and animation curves are drawn on two viewport-sized
Canvas 2D layers. Supported browsers transfer these to an OffscreenCanvas worker.
The static layer changes only after graph/view changes; a separate animation
layer updates at 30 Hz without per-frame React renders. Pointer changes reach the
worker immediately and do not wait behind the decorative animation timer.
Fitted system-font labels use a bounded, per-context cache, so pan/zoom frames
reuse unchanged text clipping rather than repeatedly measuring every prefix.
Group backgrounds remain full-size DOM rectangles behind these layers and follow
the immediate visual transform. Zooming out exposes the complete background
without waiting for a worker frame or revealing the edge of a cached bitmap.
All canvas layers include a 256 CSS-pixel buffer on every side. Nearby nodes,
cables and previews are prepared before they enter the viewport, covering newly
exposed edges while the previous frame follows a pan or zoom gesture. The fixed
workspace clips this buffer; each presented frame retains its logical viewport
for accurate alignment with the interaction targets.
Geometry outside the buffer is culled and backing stores are bounded to 4096 pixels per
dimension and 8 million pixels per layer. Canvas dimensions never follow the
full graph bounds.
The worker rasterizes its 2D layers and preview atlas in software before handing
one composed bitmap to the browser. This avoids GPU-backed Canvas 2D stalls on
large, zoomed views, observed on Windows/AMD. Pointer movement still transforms
the last complete bitmap immediately while the worker prepares the next frame;
this changes only graph drawing, not the GPU effect renderer.

The original DOM retains hit targets, tooltips and keyboard navigation only in
the viewport plus a 256 CSS-pixel margin. Node cards, cable hit paths and port
grips outside that area are unmounted; crossing cables remain interactive even
when both endpoint nodes are offscreen. The canvas still receives the complete
graph. Visibility lists retain their identity until membership changes, avoiding
DOM subtree reconciliation on every pan frame. Node/connection drags and focused
node controls temporarily retain all targets to preserve pointer capture and
keyboard navigation. A focused node exposes its keyboard focus styling; the
inspector stays a regular DOM UI.
Canvas mode omits duplicate SVG artwork and port-label DOM. Cable grips use flat
HTML hit targets with the same reconnect, delete and keyboard actions; the SVG
renderer remains the fallback. Port descriptions remain accessible and tooltips
work with pointer, keyboard and touch. The background grid moves on a separate
cached layer: pan offsets no longer propagate through inherited CSS variables
and trigger descendant style recalculation.
Worker startup/runtime failure replaces the transferred canvases with a main-thread
software renderer; if Canvas 2D is unavailable, the DOM graph remains usable.
Panning and zooming keep unchanged node-card props and connection callbacks
stable, while spatial culling limits the canvas geometry that is drawn.
Repeated pointer movement within one dock pane does not publish another layout
update or write the persisted layout. This separates graph drawing from the editor's main thread;
expensive video/effect rendering can still delay mouse event delivery.
Preview sources remain lazy-loaded, but once available their synchronous work
runs directly inside the scheduler's 2 ms tick budget. A single expensive job can
exceed that cooperative budget; the scheduler then yields before starting another.
Promise-based GPU readback stays asynchronous. Moving drawing to the worker does
not move graph compilation or preview-value evaluation off the main thread.

For development profiling, `measure-node-graph-interaction` on the authenticated
debug bridge performs a bounded pan and restores the viewport. It reports main-thread
frame gaps alongside worker drawing time, so a smooth worker is not mistaken for
smooth mouse handling. It does not edit nodes or timeline data.
The result includes mounted node, cable, plug and edge-layer DOM counts.
With the canvas renderer active, `hideEdgeDom: true` temporarily hides the SVG
cable/plug interaction layers while keeping canvas cables visible; their inline
display styles are restored after the run. `measureHitTesting: true` additionally
times `elementFromPoint` after each pan step, including any style/layout flush.
This is a synthetic isolation probe, not a native pointer-latency measurement;
hidden SVG elements remain mounted. Compare repeated runs at the same zoom,
viewport, effect, playback state and preview setting.
`hideNodeDom: true` similarly isolates the transparent node-card layer (separate
value controls remain mounted). The probe records viewport size/transform and
the profiled React child-subtree's render time and commit count. This excludes
the parent canvas component's own work, other panels, and commit/layout costs.
Worker samples expose base, animation and preview paint timings; composition and
bitmap-transfer overhead remains in the total worker paint time. Preview producer
samples separately count synchronous calls, cumulative CPU time and maximum job
time, including work that previously escaped the scheduler through microtasks.

The local development page `/tests/browser/node-effect-performance.html` compares
Exposure, Chroma Key and Holo against their original registered shaders using
synthetic pixels at 1080p and 4K. It warms pipelines, alternates execution order,
uses GPU timestamp queries when available, and checks output pixels. A separate
CPU measurement exercises the real fullscreen `EffectsPipeline.applyEffects`
for Chroma Key and Holo with stable graphs and no preview requests. Exposure is
excluded from that CPU test because the editor normally fuses it into the
compositor. Downloadable JSON keeps GPU execution and CPU preparation separate;
these measurements do not represent whole-editor playback or decode performance.

## Keyframe nodes

Independent animation appears directly on its owning node in a compact
**Animation · N curves** area. Twelve cable-slack curves therefore occupy one
area on **Cable simulation**, while Wind and Transform show their own curves.
Existing projects and previously saved independent keyframe nodes use this
presentation automatically, without moving or changing their keys.

The area previews its first curve and follows the playhead. Changes to any of
its parameter values briefly highlight it. Click the area to open the animation
inspector, select a curve, and edit its keys. **Back to parameters** restores the
normal node inspector. Collapsed groups retain an animation area for their
contained nodes. **Extract as keyframe node** makes the chosen channel a separate
node while preserving its keys; extraction and removal support undo/redo.

Shared or explicitly extracted nodes remain visible on the canvas. Their
animation cables and target sockets appear when the animation node or a receiving
node is selected. Ordinary processing connections remain visible throughout.

Use **+ Keyframes** or **right-click → Keyframe Node**, then select a parameter
under **Add channel** in the inspector. Existing timeline keys are adopted;
an unanimated parameter starts with its current value at the playhead. Search
filters the clip's supported numeric and boolean parameters, including numeric
vector/color components and reusable Face Cables operator parameters.

Each node can contain multiple independent channels. **Link parameter** makes
another parameter follow one channel; editing either timeline lane writes back
to the shared source curve. Direct links require matching ranges, units and time
bases. **Scale + offset** explicitly maps differing continuous ranges. Linking
replaces existing target animation, as indicated on the button. Speed uses its
own channel to preserve audio-follow and retiming rules. Discrete state channels
use hold keys and cannot share continuous curves.

The card displays the first channel's current value and curve with a moving
playhead. The inspector exposes every channel, key time/value, easing or Hold,
and **Show timeline keys**. Graph mode remains available for Bezier handles.
Time is clip-local except Flock simulation parameters, which retain source time.
Face Cables simulation changes still require baking for playback and export.

Disconnecting a parameter or removing the node keeps its animation as ordinary
timeline keys, shown again at its parameter owner. Deleting a source owner also preserves surviving target curves.
Bindings and layouts participate in project persistence, copy/paste and history.

Implementation: `clip.nodeGraph.keyframeNodes` stores channel bindings, layout and
optional `presentation` (`inline` or explicitly extracted `node`). Shared channels
remain separate regardless of presentation. The graph projection groups inline
channels by actual parameter owner and never creates a second keyframe store.
Source curves live in the existing `clipKeyframes` map. The timeline revision
middleware materializes mapped targets at edit time, so playback, scrubbing,
baking and export consume ordinary keyframes. `animationSource` identifies
derived keys for inverse edits; no playback mutation or second curve store is
needed. `getKeyframes` exposes bindings to the existing AI tools, and
`addKeyframe`/`removeKeyframe` update the shared animation. Node creation and
linking are currently UI actions; there is no additional AI creation tool.

This is a visualization of parameter animation, not an execution profiler:
moving curve cursors do not claim that a cached or baked node is recomputing.

## Graph projection

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

Vector **Split** and **Combine** are each one adaptive inspector workflow backed
by explicit typed operators (`vec2`, `vec3`, or `vec4`). The Components dropdown
changes the persisted typed variant; in an image graph, component ports are labeled
R/G/B/A while retaining stable x/y/z/w port identities. Dragging a vector cable to
a Split input, or a Combine output to a vector input, can select the one matching
variant atomically with the connection. Compatible port IDs and exact signal types
retain their cables. Incompatible existing cables remain visibly invalid and pause
that graph until repaired; they are never silently reinterpreted or disconnected.
Image-to-vector and vector-to-image boundaries remain explicit conversion nodes.

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

`Primitive geometry` is another input to the same Mesh node. Its Box, Sphere and
Cylinder choices persist on the node and render through the existing native mesh
path; Box is the default. The connected material currently supplies solid tint
and opacity to these primitives. Image textures and UV transforms remain plane/
source-surface features rather than being silently projected onto a primitive.

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

Right-clicking the canvas opens an Add Node menu. It can add AI Nodes at the clicked graph position, force field-backed built-ins such as Transform, Mask, and Color into the graph, and add existing effect types from an Effect Nodes submenu. Right-clicking a removable node also exposes Delete Node; pressing Delete or Backspace removes the selected visual effect, audio effect or AI node, and removes a forced built-in node when it was only shown by the graph.

Links can be edited directly on the board. Drag from any socket to a compatible opposite socket to create a new cable, even when that socket already has a connection. Only the separate cable grip edits an existing cable. Selecting a link and pressing Disconnect/Delete, or right-clicking the link, removes the connection. Audio-effect deletion and bypass target the actual audio clip in a linked video/audio pair and participate in undo/redo. The visual effect chain always follows the canonical effect stack, including after
adding/removing effects in Properties. Connecting effect A's output to effect B's
input inserts A directly before B and reconnects the remaining chain. The node
inspector also provides **Move effect earlier/later** controls. Properties reorder
and node reorder update the same array and renderer. Saved custom-node sidechains
remain independent. Required processing-chain links cannot be left dangling; use
bypass to skip an effect.

Effect and AI nodes include a compact bypass toggle in the node header. Effect bypass writes through to the existing effect enabled flag; AI node bypass is stored on the custom node and prevents that generated runtime from processing the preview signal.
Effect groups also expose **Byp** in their group header, both expanded and
collapsed. This switches the same effect enabled flag as Properties and shows
**Bypassed** when inactive. Individual operator bypass states, graph wiring and
effect parameters remain intact; group bypass participates in undo/redo and
respects locked tracks and export protection.

Cable ends have colored semicircular **plugs** around their sockets, with grips
outside the node card. They remain visible above cards, including collapsed groups;
multiple links on a port have separate grips. Hovering a socket highlights only that
socket; hovering a grip highlights its cable. A free socket shows a docked plug
only while a new connection is being dragged. Plugs slide in and out on attachment and detachment, respecting the
system's reduced-motion preference.

Hovering an individual grip or its wire softly highlights only that cable and its
two plugs, making fan-out links easy to distinguish. The highlight fades out on leave.

While holding a cable over a compatible socket, a translucent docked plug previews
the connection and the draft wire snaps to it. Moving away or over an incompatible
port returns the plug to the pointer. The preview does not change the graph until
the cable is released.

Drag either grip of an existing cable to a compatible port to reconnect it. Releasing
on empty canvas disconnects that cable; clicking without dragging does not.
Dropping back on the original socket keeps the link, while Escape, interrupted
pointer gestures and incompatible targets restore it. Required or locked links
retain their existing domain restrictions. Keyboard-focus a connected plug and
press Delete/Backspace to remove its cable; Enter/Space selects the link.

Right-drag an input or output to empty canvas to open a searchable menu of compatible
nodes. Choosing an entry creates and connects it in one undo step; opening or
canceling the menu leaves existing cables untouched. Right-clicking a socket or
pressing Shift+F10 on a focused socket opens the same menu. Choices respect the
current graph runtime, direction, formats and adaptive Math variants. Root image
and audio sockets offer effect instances; internal sockets offer supported
operators and reusable compositions.

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

Adding an effect, including through the Effects panel, reflows its connected outer chain to make room. Removing an effect through the Effects panel or agent tools reflows the remaining chain from Source and discards the deleted group?s cached placement. Removing the last effect brings Output back beside Source. Bypassing an effect collapses its group and its Effects inspector entry; enabling it again preserves the collapsed state. **Reset** arranges node positions again, clears manual canvas anchors and group offsets, and fits the resulting graph with the same bounds and zoom rules as **Fit**.

Gaussian Splat Exploration uses the shared composition mechanism: **Reusable Nodes ? Space** contains Splat Cleanup, Splat Rays, Particle System and Mesh Overlay. Expand the Particles group to edit its simulation and connected forces.

Splat branch groups with one rendering output can be bypassed from their compact node or expanded group header. The action mutes that output and skips its upstream GPU work while retaining its controls and connections.
