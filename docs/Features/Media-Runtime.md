# Media Runtime

[Back to Index](./README.md)

Shared source/runtime registry for video, audio, and image playback state across timeline clips, preview sessions, and slot/background layers.

---

## Overview

The media runtime layer gives the app a reusable source/session model instead of treating every clip instance as a fully isolated decoder island.

Core ideas:

- one runtime is retained per underlying source
- multiple sessions can exist per runtime (`interactive`, `background`, `export`, `ram-preview`)
- sessions can reuse a shared frame provider when that is safe
- small source-frame caches keep recently requested frames near the active time

---

## Main Pieces

| Module | Responsibility |
|--------|----------------|
| `mediaRuntime/registry.ts` | source/runtime registry, session lifecycle, frame-handle cache |
| `mediaRuntime/types.ts` | runtime/session/frame-provider contracts |
| `mediaRuntime/clipBindings.ts` | bind clips or layer owners to a runtime source/session |
| `mediaRuntime/runtimePlayback.ts` | session-key selection, shared preview/scrub sessions, frame-provider lookup |
| `layerPlaybackManager.ts` | background/slot layers that adopt runtime-backed clip sources |

---

## Runtime Identity

A runtime descriptor can be built from:

- `mediaFileId`
- `File`
- file metadata such as name, size, last-modified time
- file hash
- optional absolute file path

This lets the registry keep one logical runtime for the same underlying media source even when multiple clips reference it.

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
- optional access to the current decoded frame

The registry keeps a small per-source frame cache and clones cacheable runtime frames where possible. That cache is deliberately small and recent-time oriented; it is not a replacement for the larger scrub/RAM preview caches.

---

## Shared Preview Sessions

`runtimePlayback.ts` can derive shared session keys for preview or scrub sessions when a single active clip owns a track and the source has a full runtime-backed provider.

That allows preview consumers to reuse an existing full WebCodecs-style provider instead of spinning up another equivalent session for the same source/track path.

---

## Slot And Background Playback

The Slot Grid background playback path relies on these runtime bindings too.

- slot/background layers bind clip sources through `bindSourceRuntimeForOwner(...)`
- `layerPlaybackManager` updates runtime playback time as the slot layer runs
- optional warm-slot decks can later adopt those prepared sources onto a live layer

That is why slot playback, background layers, and main preview reuse the same runtime concepts rather than three separate media stacks.

---

## Related Features

- [Preview](./Preview.md)
- [GPU Engine](./GPU-Engine.md)
- [Slot Grid](./Slot-Grid.md)
- [Playback Debugging](./Playback-Debugging.md)
