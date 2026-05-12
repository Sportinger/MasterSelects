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

The Transform node is the first write-through node. Its inspector edits opacity, position, scale, rotation, speed, blend mode, and reverse state through the same timeline store actions used by the Properties panel, so preview, export, history, and project persistence continue to see one clip model.

Effect nodes also expose write-through inspector controls. Numeric effect params use the keyframe-aware property path, while boolean/select params use the normal effect update action. The graph still does not execute effects itself; it edits the same effect stack consumed by the existing renderer.

The inspector can add existing effect types as new Effect nodes. This appends to the clip's normal effect stack, after which the graph projection creates the corresponding node.

The inspector can also add AI Nodes. These are project-local custom nodes stored in the clip graph with their prompt, generated-code draft, public ports, runtime kind, status, and layout. In this stage they are deterministic pass-through graph nodes for authoring and persistence; they do not run generated code in the renderer yet.

The current graph projection is deterministic. Runtime preview and export still use the existing layer builders and renderer. Broader graph editing should continue to write through to the owning clip fields so Properties, timeline state, history, preview, and export remain one system.
