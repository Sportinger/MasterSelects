[Back to Documentation](./README.md)

# Signal IR And Capability Runtime

Signal IR is the contract layer for turning any imported or generated file into typed signals before timeline, node graph, render, or export adapters decide how to use it.

## Current Slice

The current implementation is the integrated architecture slice for issue #134:

- `src/signals/` defines `SignalKind`, `SignalAsset`, `SignalRef`, `SignalArtifact`, `SignalGraph`, `SignalOperatorDescriptor`, guards, normalization helpers, and mappings from legacy media/node graph types.
- `src/runtime/capabilities/` defines fail-closed runtime capabilities such as `file.read`, `artifact.write`, `network.fetch`, `gpu.compute`, and `timeline.mutate`.
- `src/extensions/` defines provider manifests and a registry for discovering importer/analyzer/operator/renderer/exporter providers by file signature, signal kind, runtime, or capability.
- `src/importers/` defines the universal import orchestrator. CSV files become `table`/`metadata`/`binary` SignalAssets, unsupported files become binary SignalAssets, and known legacy video/audio/image/model/vector paths remain on the established media pipeline.
- `src/artifacts/` defines content-addressed SHA-256 artifact storage with project-local `Cache/artifacts/...` storage, IndexedDB manifest indexing, and an IndexedDB byte fallback for imports that happen outside an open project folder.
- `src/runtime/worker/` defines the capability-ready worker job host/client protocol for long-running runtime providers.
- `src/runtime/wasm/` defines the Wasm importer host adapter for direct and jco-style component exports.
- `src/runtime/renderers/signalTimelineRendererAdapter.ts` is the builtin timeline renderer dispatcher. It routes renderable SignalAssets to existing model or gaussian-splat clip paths when their artifacts can be materialized as files, and falls back to the text summary adapter otherwise.
- `src/runtime/renderers/signalTextRendererAdapter.ts` defines the fallback text renderer adapter. It materializes SignalAssets as timeline text clips that summarize the selected signal ref and metadata, so previews, nested compositions, save/load, and export reuse the existing text render path.
- `wit/masterselects/runtime.wit` defines the versioned Wasm Component ABI starter package for importer providers.

The universal importer is connected to the Media Panel import flow. Signal imports appear as `signal` project items, can be organized, renamed, labeled, deleted, saved, and loaded with the project. Signal assets are draggable to video tracks through builtin renderer adapters. Renderable `mesh`/`geometry` artifacts with OBJ/glTF/GLB payloads create real model clips. Renderable `point-cloud`/`geometry` artifacts with PLY/SPLAT/KSPLAT/SPZ/SOG/LCC/ZIP payloads create gaussian-splat clips. Everything else falls back to the text-summary adapter. The resulting timeline clip keeps `signalAssetId`, `signalRefId`, and `signalRenderAdapterId` metadata while rendering through established clip render paths.

## Core Model

`SignalAsset` represents an imported file, generated asset, operator result, timeline output, or node graph output.

`SignalRef` represents a typed output of an asset or operator. Its `kind` can describe concrete media (`texture`, `audio`, `mesh`, `point-cloud`, `table`, `document`, `vector`) or control/data signals (`metadata`, `event`, `time`, `number`, `boolean`, `string`).

`SignalArtifact` represents persisted content-addressed output. The artifact contract includes a hash, size, MIME type, encoding, storage location, producer, source references, and creation time.

`SignalOperatorDescriptor` describes importer, analyzer, operator, renderer-adapter, and exporter providers without binding those providers to the main thread.

## Legacy Mappings

The compatibility mappings keep current concepts bridgeable:

| Existing type | Signal kinds |
|---|---|
| Video | `texture`, `audio`, `metadata` |
| Audio | `audio`, `metadata` |
| Image / Solid | `texture`, `metadata` |
| Text | `text`, `texture`, `metadata` |
| Model | `mesh`, `geometry`, `metadata` |
| Gaussian Splat / Avatar | `point-cloud`, `geometry`, `metadata` |
| Lottie / Rive | `vector`, `texture`, `metadata` |
| Composition | `timeline`, `scene`, `metadata` |
| CSV | `table`, `metadata`, `binary` |
| Unknown file | `binary`, `metadata` |

Unknown files now become valid binary `SignalAsset`s instead of being rejected by the Media Panel import path.

## Timeline Renderer Adapters

Signal timeline placement is adapter-driven:

| Adapter | Signal refs | Timeline source |
|---|---|---|
| `masterselects.renderer.signal-model` | `mesh`, `geometry`, `scene`, `binary` with `.obj`, `.gltf`, or `.glb` artifacts | `model` |
| `masterselects.renderer.signal-gaussian-splat` | `point-cloud`, `geometry`, `scene`, `binary` with `.ply`, `.splat`, `.ksplat`, `.spz`, `.sog`, `.lcc`, or `.zip` artifacts | `gaussian-splat` |
| `masterselects.renderer.signal-text-summary` | fallback for all signal kinds | `text` |

The file-based adapters require the artifact bytes to exist in the project artifact cache or IndexedDB. `memory` or `external` artifacts that cannot be resolved still produce a usable text-summary clip instead of failing the drop/import workflow.

## Runtime Boundary

Capabilities default to denial. A provider can only run a job if its manifest grants every requested capability. Unknown providers and unknown capabilities fail closed.

No new generated-code or plugin path should execute in the main browser context. Worker and Wasm execution are the runtime boundaries for provider work; the current builtin CSV and binary importers are deliberately small host-side adapters used to connect the architecture before external providers are loaded.
