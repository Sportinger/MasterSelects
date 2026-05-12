# Everything Node - Final Product Vision

## Core Vision

MasterSelects should have a dedicated Node tab that can show the real processing graph of whatever the user has selected. A selected timeline clip, media item, composition, effect, export target, or generated asset can be opened as a node graph. The graph is not a separate toy workspace. It is another view of the actual object and its actual signal flow.

The normal timeline and properties UI remain fast and direct. The Node tab gives the user a deeper way to inspect, rewire, extend, and author the same underlying system.

## The Basic Model

Every editable object can be represented as a graph:

```text
Source -> Processing Nodes -> Output
```

If a timeline clip is just a video file, the graph is simple:

```text
Video Source -> Clip Output
```

If the user changes transform, the graph reflects that:

```text
Video Source -> Transform -> Clip Output
```

If the user adds effects, masks, color correction, or generated behavior, the graph becomes the visible processing chain:

```text
Video Source -> Transform -> Color Grade -> Blur -> Clip Output
```

The Properties panel and the Node tab edit the same object. Changing a transform slider updates the graph. Rewiring or editing the Transform node updates the normal clip properties.

## Signals

Everything in MasterSelects becomes a signal source or signal transformer.

Common signal types:

- texture
- audio
- geometry
- curve
- mask
- text
- metadata
- event
- time
- scene
- timeline
- render target

A video file can expose texture, audio, duration, frame rate, resolution, metadata, and time-based outputs. A CSV file can expose tables, numeric columns, curves, text, events, or generated visuals. An unknown binary file can expose bytes, entropy, metadata, and any derived visual interpretation.

AI is not required for basic graph use. A plain video source already outputs video. AI is used when the user wants new signals, new transformations, new interfaces, or new node behavior.

## Node Tab Behavior

The Node tab always follows the current selection.

When the user selects:

- a clip, the tab shows that clip's internal graph
- a media item, the tab shows its source/import/interpretation graph
- a composition, the tab shows the composition graph
- an effect, the tab shows the effect's internal graph
- an export preset, the tab shows the export pipeline graph

Nodes can be opened recursively. A node can contain a local graph inside it, and from the outside it appears as a single clean node with public inputs and outputs.

```text
Composition Graph
  Clip Node
    Internal Clip Graph
      Source -> Transform -> Mask -> Color -> Output
```

This allows unlimited depth without forcing every graph to become one global unreadable graph.

## Connections

Users can freely connect compatible ports by default. MasterSelects should not hide free wiring behind an expert mode.

The system should make available signals visible and easy to discover. When a user clicks a node, they should see its inputs, outputs, parameters, internal graph, generated code, cached outputs, and runtime status.

AI should be able to inspect the same graph context:

- which nodes exist
- which signals are available
- which ports are connected
- which outputs are missing
- what code or shader powers a node
- where caching and performance boundaries are

This lets the user ask for changes in natural language while the AI operates on the actual graph structure.

## AI-Authored Nodes

Any node can enter an AI setup/editing mode. The user can talk to the node and ask it to add features, expose new ports, rewrite its behavior, or build an internal subgraph.

The AI should have freedom to write real node code. It is not limited to selecting from existing presets.

The required boundary is the node interface:

```ts
defineNode({
  inputs: {
    texture: "texture",
    audio: "audio",
    time: "number"
  },
  outputs: {
    texture: "texture",
    motionCurve: "curve"
  },
  params: {
    amount: 0.5
  },
  prepare(ctx) {
    // optional setup
  },
  process(frame, inputs, params) {
    // node implementation
  }
});
```

The code inside can be AI-written and highly custom. The interface tells MasterSelects how the node connects, caches, previews, saves, and exports.

In short:

```text
The code is the node.
The interface is how MasterSelects understands the node.
```

## Node Languages

The finished system should support multiple implementation layers:

- TypeScript for node logic, control flow, data transforms, metadata, events, and curves
- WGSL for realtime GPU texture, compute, and shader nodes
- Web Workers for heavier async analysis or preprocessing
- WASM or native helper runtimes for expensive geometry, codecs, simulation, or analysis
- Graph subnodes for behavior that is better expressed visually than as code

AI can create or modify any of these, depending on what the node needs.

## Deterministic Runtime

AI is an authoring layer, not the normal playback runtime.

During setup, the user can talk to the node and the AI can rewrite code, ports, parameters, subgraphs, shaders, or UI controls. Once the node is accepted, it runs as deterministic MasterSelects runtime logic.

Playback and export should run from compiled node code, compiled graph plans, cached assets, and stable runtime interfaces. The renderer should not depend on live chat calls during frame rendering.

## Performance Model

The graph should be an authoring and inspection model, not a slow per-frame interpreter.

The system should compile graphs into fast execution plans:

```text
Node graph
  -> validated typed graph
  -> execution plan
  -> GPU passes, CPU jobs, media runtime bindings, cached assets
  -> preview/export output
```

Nodes only compute when needed:

- an input changes
- a parameter changes
- the playhead enters an active time range
- a downstream node requests an output
- export requires the result
- cached data becomes invalid

Expensive AI, analysis, import, transcription, mask generation, optical flow, and file interpretation nodes should cache their outputs. Cheap realtime nodes should compile to shader passes, existing engine operations, or direct runtime bindings.

The user should get the flexibility of a node system without paying node overhead when nothing changed.

## Nested Graphs And Public Ports

Every node can contain an internal graph. Every internal graph can expose public ports.

From the outside:

```text
Clip Node
Inputs: time, transformOverride, maskInput
Outputs: texture, audio, motionCurve, dominantColor
```

Inside:

```text
Video Source -> Scene Analysis -> Mask -> Color -> Distortion -> Output
```

Other graphs connect to the public ports:

```text
Clip A.motionCurve -> Clip B.distortionAmount
Clip A.dominantColor -> Text.color
Audio.bass -> Geometry.scale
```

This keeps the system open while preserving understandable boundaries.

## Timeline Relationship

The timeline arranges time. The graph defines signal flow.

They should be peers:

- a clip can contain a graph
- a graph can generate a clip
- a composition can expose a graph
- a graph can drive timeline parameters
- timeline keyframes can appear as curve nodes
- graph curves can drive timeline properties
- export can consume graph outputs directly

The user should be able to work normally in the timeline, then open the Node tab only when deeper control is needed.

## Properties Relationship

The Properties panel is a compact inspector for the selected graph or node.

Every normal property should map to graph state:

- transform properties map to Transform node parameters
- effect controls map to effect node parameters
- masks map to mask nodes and mask signals
- color correction maps to color graph nodes
- motion design maps to motion graph nodes
- export settings map to export graph nodes

There should not be two separate systems. Properties are the compact view. Nodes are the structural view.

## Custom Node UI

A node can expose a default inspector generated from its inputs, outputs, and params. It can also define custom UI when needed.

Examples:

- a color node can expose wheels and sliders
- a shader node can expose uniforms and preview thumbnails
- an audio analyzer can expose frequency bands
- a file interpreter can expose detected tables, pages, meshes, or metadata
- an AI-authored node can expose controls created by the AI

The custom UI is optional. The graph remains editable even with only the typed interface.

## Persistence And Reuse

Custom nodes can live inside the project so a project is self-contained. Nodes can also be promoted to a reusable global library.

Project-local nodes preserve exactly what the project needs:

- code
- shaders
- public interface
- parameters
- internal graph
- cache metadata
- generated assets
- provenance

Reusable library nodes allow the user to keep useful tools across projects.

## Finished Product Feeling

The final product should feel like this:

The user selects a clip and opens the Node tab. They see exactly how the clip is built. They can drag wires, add nodes, inspect signals, open nested graphs, or click any node and ask AI to change what it does. The AI can write new code, generate shaders, create ports, build subgraphs, and expose controls. Once accepted, the graph runs as fast deterministic MasterSelects runtime logic.

Everything can become a node, but nothing has to be a node until the user wants that depth.

