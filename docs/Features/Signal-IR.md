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
- `wit/masterselects/runtime.wit` defines the versioned Wasm Component ABI starter package for importer providers.

The universal importer is connected to the Media Panel import flow. Signal imports appear as `signal` project items, can be organized, renamed, labeled, deleted, saved, and loaded with the project. They are intentionally not draggable to the timeline yet; renderer adapters decide how concrete signal kinds become clips in follow-up work.

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

## Runtime Boundary

Capabilities default to denial. A provider can only run a job if its manifest grants every requested capability. Unknown providers and unknown capabilities fail closed.

No new generated-code or plugin path should execute in the main browser context. Worker and Wasm execution are the runtime boundaries for provider work; the current builtin CSV and binary importers are deliberately small host-side adapters used to connect the architecture before external providers are loaded.
