# Media Runtime

[Back to Index](./README.md)

Shared source/runtime registry for video, audio, and image playback state across timeline clips, preview sessions, and slot/background layers.

---

## Overview

The media runtime layer gives the app a reusable source/session model instead of treating every clip instance as a fully isolated decoder island.

Core ideas:

- one runtime is retained per resolved source ID
- multiple sessions can exist per runtime (`interactive`, `background`, `export`, `ram-preview`)
- interactive preview and scrub paths can reuse a shared session when safe
- a small source-frame cache retains recently requested cloneable frames

---

## Main Pieces

| Module | Responsibility |
|--------|----------------|
| `mediaRuntime/registry.ts` | source/runtime registry, session lifecycle, frame-handle cache |
| `mediaRuntime/types.ts` | runtime/session/frame-provider contracts |
| `mediaRuntime/contracts.ts` | media kinds, session policies, asset references, and lease contracts |
| `mediaRuntime/clipBindings.ts` | bind clips or layer owners to a runtime source/session |
| `mediaRuntime/runtimePlayback.ts` | session-key selection, shared preview/scrub sessions, frame-provider lookup |
| `mediaRuntime/objectUrlLeases.ts`, `mediaElementLeases.ts`, `scrubAudioLeases.ts` | runtime-owned object URL, media-element, and scrub-audio leases |
| `mediaRuntime/liveInputRuntime.ts` | browser live-input connections and render invalidation |
| `layerPlaybackManager.ts` and `slotDeckManager.ts` | slot-deck preparation and background-layer adoption |

---

## Runtime Identity

A runtime descriptor can be built from:

- `mediaFileId`
- `File`
- file metadata such as name, size, last-modified time
- file hash
- optional absolute file path

The registry resolves a source ID in priority order: explicit source ID, media-file ID, file hash, normalized file path, `File` metadata, then file name. It retains one runtime per resolved source ID, so clips that resolve to the same ID share a runtime.

---

## Sessions

Each runtime can host multiple decode sessions.

Current policies:

- `interactive`
- `background`
- `export`
- `ram-preview`

Sessions track:

- current playback time
- last access time
- current frame timestamp
- optional frame provider ownership

The registry also exposes release hooks so clip/layer teardown can drop sessions and runtime ownership cleanly.

---

## Frame Providers And Caching

Frame providers expose the playback-facing API used by preview/runtime consumers:

- current time
- play/pause/seek
- full-mode vs simple-mode capability
- optional debug information
- access to the current decoded frame

The registry keeps a 12-entry per-source LRU frame cache and clones cacheable runtime frames where possible. Cache reads apply timestamp tolerance based on playback state and frame rate; this cache is not a replacement for the larger scrub/RAM preview caches.

---

## Shared Preview Sessions

`runtimePlayback.ts` can derive shared interactive preview or scrub session keys when a single active clip occupies a track and the source has a full runtime-backed provider.

That lets preview consumers reuse a full WebCodecs provider through the shared session instead of creating an equivalent provider for the same source/track path. Worker WebCodecs providers are also available when the rendering host supports them and the caller requests them.

---

## Slot And Background Playback

The Slot Grid warm-deck path relies on these runtime bindings when warm decks are enabled.

- `slotDeckManager` binds prepared video, audio, and image clip sources through `bindSourceRuntimeForOwner(...)`
- `layerPlaybackManager` can adopt a prepared deck onto a live layer when `useWarmSlotDecks` is enabled
- deactivation releases the deck pin or the runtime session and owner retain

Slot playback, background layers, and main preview therefore share runtime source/session concepts while retaining separate playback coordination paths.

---

## Runtime-Owned Leases And Live Inputs

The media-runtime domain also owns object-URL, media-element, and scrub-audio lease managers. These leases track acquisition and release outside persisted timeline state.

`liveInputRuntime.ts` manages display capture, camera, and composition-feedback streams, exposes their video elements to render consumers, and releases streams when inputs are removed or disconnected.

---

## Related Features

- [Preview](./Preview.md)
- [GPU Engine](./GPU-Engine.md)
- [Slot Grid](./Slot-Grid.md)
- [Playback Debugging](./Playback-Debugging.md)
