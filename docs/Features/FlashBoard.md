[Back to Index](./README.md)

# FlashBoard

FlashBoard is the AI canvas workspace behind the AI Video panel's Board mode. It is a node-based generation surface for text-to-video, image-to-video, and image generation, with direct import into the Media Pool and optional timeline drag/drop.

> **Status:** Implemented. The board workspace is active, lazy-loaded, queued, persisted with the project, and connected to the current AI provider catalog.

---

## What It Does

FlashBoard is not a separate model backend. It is a workspace layer on top of the existing AI services:

- `piapi` for the PiAPI catalog
- `kieai` for Kie.ai Kling 3.0, Seedance 2.0, and Nano Banana 2
- `cloud` for hosted Kling 3.0 and hosted Nano Banana 2

The AI Video panel switches into FlashBoard when the user selects Board mode. If the user has no Kie.ai key and is signed in to MasterSelects Cloud, the board uses the hosted cloud service scope. Otherwise it stays on Kie.ai.

---

## Current Workspace Structure

FlashBoard is composed of:

- `FlashBoardWorkspace` - lazy-loaded shell and error boundary
- `FlashBoardToolbar` - board tabs, new board, new draft, queue counters
- `FlashBoardCanvas` - pan/zoom canvas, node selection, context menus, drag/drop
- `FlashBoardComposer` - provider selection, prompt editing, durations, aspect ratio, image size, multi-shot setup

Boards are persisted inside the project state. The active board is restored on project load, and generation metadata is serialized alongside the board state.

---

## Node Lifecycle

Nodes move through the following states:

- `draft`
- `queued`
- `processing`
- `completed`
- `failed`
- `canceled`

There are two node kinds:

- `generation` - an actual AI request
- `reference` - a media reference dropped into the canvas

Generation nodes can include:

- prompt
- provider and version
- output type (`video` or `image`)
- duration and aspect ratio
- optional start and end media
- optional reference media list
- optional multi-shot prompt sequence
- optional audio generation

---

## Provider Matrix

The board uses the shared catalog from `FlashBoardModelCatalog`:

- PiAPI video providers from the shared PiAPI catalog
- Kie.ai Kling 3.0 video
- Kie.ai Seedance 2.0 video
- Kie.ai Nano Banana 2 image generation
- Cloud Kling 3.0 video
- Cloud Nano Banana 2 image generation

Seedance 2.0 is currently exposed only in FlashBoard on the Kie.ai path. The existing Classic AI Video flow remains narrower and continues to focus on the classic Kie provider list.

The classic AI Video flow is narrower: it currently exposes only the Kie.ai Kling 3.0 provider list, while FlashBoard exposes the richer catalog.

---

## Generation Flow

1. The user creates a draft node from the composer.
2. The store captures the current request on that node.
3. `FlashBoardJobService` queues the node.
4. Jobs run with a concurrency cap of 3 overall, but only 1 Kie.ai job at a time.
5. The selected service submits the remote task and polls until completion.
6. On success, `FlashBoardMediaBridge` downloads the asset, imports it into the Media Pool, and marks the node complete.

Image generation is handled alongside video generation. The code path resolves previewable reference images from media files, including thumbnails for video sources or a captured frame when needed.

---

## Media And Timeline Integration

FlashBoard uses the same drag payload as the rest of the app:

- `application/x-media-file-id`

Completed assets are imported under:

- `AI Gen/Video`
- `AI Gen/Images`

The bridge stores generation metadata keyed by imported media file ID so project save/restore can round-trip the generated asset provenance. The imported asset can be dragged to the timeline or inserted directly at the playhead.

---

## Access Rules

Board mode is gated by the same AI access conditions as the panel:

- if a Kie.ai key is present, the board uses Kie.ai
- if there is no Kie.ai key but the user is signed in, the board uses hosted Cloud
- if neither is available, the AI Video panel shows the access overlay

Hosted board requests are credit-backed and authenticated. There is no anonymous hosted generation path.

---

## Limitations

- The board does not add a new backend provider. It delegates to the existing AI services.
- Generated URLs are temporary, so imports force a local project copy.
- The board is still bound by provider-specific feature support in the catalog.
- The lazy-loaded board chunk can fail on HMR or stale caches; the panel falls back to Classic with a retry option.

---

## Source Map

- `src/components/panels/AIVideoPanel.tsx`
- `src/components/panels/flashboard/FlashBoardWorkspace.tsx`
- `src/components/panels/flashboard/FlashBoardToolbar.tsx`
- `src/components/panels/flashboard/FlashBoardCanvas.tsx`
- `src/components/panels/flashboard/FlashBoardComposer.tsx`
- `src/services/flashboard/FlashBoardJobService.ts`
- `src/services/flashboard/FlashBoardMediaBridge.ts`
- `src/services/flashboard/FlashBoardPricing.ts`
- `src/services/flashboard/FlashBoardModelCatalog.ts`
- `src/stores/flashboardStore/*`
