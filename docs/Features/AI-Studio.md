# AI Studio

AI Studio is a dockable generation workspace for running several AI image, video, and audio tasks without replacing the compact generator in the Media Panel. Each Studio tab keeps its own prompt, chat history, selected model, and generation settings, so another generation can be prepared while existing work continues in the background.

New projects and legacy projects without saved Studio workspaces start on `Chat`. Once the user selects another Studio workspace, that active selection remains part of the persisted project state and is restored on the next load.

The Chat history uses the full stage height directly below the workspace tabs. There is no floating credit banner in Chat or Generation. Generation retains its tile-size control.

## Workspace Layout

- The top tab row lists open generation workspaces. The `+` action creates another workspace without clearing the current one.
- The main canvas stays visually quiet until jobs exist. Queued, processing, completed, and failed generations then appear as tiles.
- The bottom generation bar combines the prompt, model, prompt-book, aspect-ratio, resolution, mode, and generate controls. Its menus open upward as theme-aware bubbles.
- The prompt/chat pill shares the bottom bar when there is enough room and moves above it on narrower layouts.
- Media Panel image, video, and audio items can be dropped onto Chat or Generation. Model-aware reference cards float above the prompt, wrap without a scrollbar, and expand to the source aspect ratio on hover.
- Chat and Generation prompts expose browser-local Whisper dictation that appends transcription without replacing existing text.
- The control surfaces use the normal MasterSelects theme variables and can dock to the stage edges.

AI Studio is an additional way to use FlashBoard. The Media Panel still exposes its compact `Chat`, `Generate`, `Studio`, and `Downloads` launcher, and `Generate` still opens the original compact composer.

## Generation Tiles

Tiles expose the state of each request without permanently covering the generated media:

- queued and active jobs show elapsed time, model, aspect ratio, resolution, and duration when available
- active visual jobs show the selected aspect ratio as a small frame pictogram
- completed image, video, and audio results replace the placeholder with the imported media
- settings are shown as compact overlay pills; the prompt remains below the preview as a single line and can be expanded
- visual previews stay square while portrait or landscape results are fitted completely instead of being cropped
- completed tiles can be dragged directly to the timeline through the same media drag protocol used by the Media Panel
- double-clicking a completed tile opens that generated result in the Source Monitor

Completed tiles are rebuilt from project-persistent generation metadata, not only from the transient job queue. Reloading a project therefore keeps generated results associated with the workspace that created them.

## Runtime And Persistence

`FlashBoardRuntimeHost` is mounted at the editor level so remote polling, recovery, result import, and queue callbacks continue even when neither the Media generator nor AI Studio is the active dock panel. Project save/load persists the open Studio workspaces, active workspace, per-workspace composer/chat state, active generation records, and each result's workspace identifier.

The existing FlashBoard provider and billing boundary is unchanged: hosted jobs use the signed-in Cloud routes, and provider credentials are not stored in the browser or project.

## Main Sources

- `src/components/panels/ai-studio/AIStudioPanel.tsx`
- `src/components/panels/ai-studio/AIStudioMetaballStage.tsx`
- `src/components/panels/ai-studio/AIStudioGenerationBar.tsx`
- `src/components/panels/ai-studio/AIStudioGenerationCanvas.tsx`
- `src/components/panels/ai-studio/AIStudioReferenceSurface.tsx`
- `src/components/common/PromptDictationButton.tsx`
- `src/components/panels/flashboard/FlashBoardRuntimeHost.tsx`
- `src/stores/flashboardStore/`
- `src/services/flashboard/FlashBoardMediaBridge.ts`

---

[Back to Index](./README.md)


## GPT Image 2.5

The image model picker includes **GPT Image 2.5 Flare**, **Flare Edit**,
**Sunburst** and **Sunburst Edit**, using Kie.ai's hosted API. Flare is the
faster everyday option; Sunburst targets more precise generation and editing.
Existing models and the saved/default model selection remain available.

- Resolution: 1K, 2K or 4K. Aspect ratios 27:16, 16:27, 9:8 and 8:9 are
  restricted to 1K; the parameter menus show compatible combinations.
- Background: Auto, Opaque or Transparent, saved with the generation settings.
  For transparent 2K/4K output, describe an isolated subject without backdrop,
  scenery or shadow; editing prompts should explicitly request extraction and
  preservation of transparency, as Kie.ai documents.
- Edit models require 1–16 reference images. Generation-only models reject
  references; switch to the matching Edit model. Prompts allow up to 20,000
  characters. Invalid requests are rejected before provider submission.
- At the checked Kie.ai rates of $0.03/$0.05/$0.08 per 1K/2K/4K image,
  MasterSelects' existing 6× hosted-credit multiplier gives **36/60/96 credits**.
  UI estimates and the server charge use the same model-specific rate table.
- Requests use the existing authenticated hosted generation, polling, refund,
  import and project persistence paths. No browser-side provider key is needed.

Provider contracts and pricing checked on 2026-10-09:
[Kie.ai model page](https://kie.ai/gpt-image-2-5),
[Flare API](https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-text-to-image),
[Sunburst Edit API](https://docs.kie.ai/market/gpt/gpt-image-2-5-sunburst-image-to-image).
