[Back to Features](./README.md)

# Node Workspace

The Node Workspace is a dockable graph view for the currently selected timeline clip. It follows the same primary selection rule as Properties: the last clicked selected clip is used, with a fallback to the first selected clip.

The graph is derived from existing clip state and does not introduce a second render model. A plain video clip appears as:

```text
Video Source -> Clip Output
```

When clip state contains processing, the view inserts the corresponding built-in nodes in render order:

```text
Source -> Transform -> Masks -> Color Graph -> Effects -> Clip Output
```

Audio effects are shown in a separate audio lane when the source exposes audio. The canvas uses the Media Panel board interaction model: pan, wheel zoom, fit/reset view, compact node cards, typed ports, edges, and an inspector for the selected node.

The current graph projection is deterministic and read-only. Runtime preview and export still use the existing layer builders and renderer. Future graph editing should write through to the owning clip fields so Properties, timeline state, history, preview, and export remain one system.
