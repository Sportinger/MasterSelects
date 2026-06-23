# Kie.ai Generation Chatbox Expansion

Status: active implementation
Updated: 2026-06-24

## Goal

Expand the FlashBoard generation chatbox with the useful current Kie.ai
services, fix the existing Suno music tuning controls first, and give the
prompt-refiner magic-wand model-specific guidance before more model families
ship.

The implementation should stay inside the current FlashBoard generation model:
one chatbox, one model catalog, provider runners per backend, and lightweight
option popovers. Do not create a second Kie-only UI.

## Current Implementation Status

Implemented first wave:

- Suno tuning sliders normalize to stable two-decimal values and expose range
  labels.
- Magic-wand research ledger exists at
  `docs/ongoing/Kie-AI-Magic-Wand-Research-Ledger.md`.
- Prompt refiner has model-family guidance for Suno, Nano Banana, GPT Image,
  Flux, Seedream, Imagen, Kling, Seedance, Veo, and Runway.
- Kie.ai FlashBoard image catalog exposes Nano Banana 2/Pro, Imagen 4
  Fast/Ultra, GPT Image 2, Flux 2 Pro, and Seedream 5 Lite.
- GPT Image 2 Edit, Flux 2 Pro Edit, and Seedream 5 Lite Edit require a
  reference before generation is enabled.

Still open:

- Dedicated endpoint implementations for Flux Kontext, Recraft, Topaz, Veo,
  Runway, and Suno Sounds.
- Hosted/cloud mirrors and pricing for newly added BYO Kie image models.

## Current Local Findings

- `src/services/kieAi/catalog.ts` currently exposes Kie video providers only:
  Kling 3.0, Seedance 2.0, and Seedance 2.0 Fast.
- `src/services/kieAi/imageCommands.ts` already has a generic
  `/api/v1/jobs/createTask` image path, but the visible catalog only exposes
  the current Nano Banana path through FlashBoard.
- `src/services/flashboard/FlashBoardModelCatalog.ts` keeps the user-visible
  FlashBoard catalog; this is the right place to add model entries and labels.
- `src/services/flashboard/FlashBoardProviderRunners.ts` owns the dispatch from
  a FlashBoard request to Suno, speech, image, and video runners.
- `src/stores/flashboardStore/types.ts` only has output types `video`, `image`,
  and `audio`; add capability metadata before adding utility tasks such as
  background removal or upscaling.
- `src/services/flashboard/FlashBoardPromptRefinerPrompt.ts` currently has
  special guidance for Suno, Nano Banana, Kling, and Seedance, with a generic
  fallback for everything else.

## Add Now

| Area | Kie service/model | Why | Required options |
|---|---|---|---|
| Image generation | Nano Banana Pro / latest Nano Banana family | Strong reference-aware image generation; already aligns with the current UX. | aspect ratio, resolution/quality where supported, reference images, output format where supported |
| Image generation | Imagen 4 Fast / Imagen 4 Ultra | Clear Google image alternatives with fast/premium tradeoff. | aspect ratio, model variant, resolution where supported |
| Image generation | GPT Image 2 text-to-image | Current high-quality general image model in Kie Market. | aspect ratio |
| Image generation | Flux 2 Pro text-to-image | Useful design/photoreal alternative and shares Kie Market job API. | aspect ratio, resolution, NSFW checker toggle only if policy/product wants it |
| Image generation | Seedream 5 Lite text-to-image | Cheap/fast current model family. | aspect ratio, quality |
| Image editing | Flux Kontext Pro/Max | Best first image-edit target because it explicitly supports text-to-image and image editing. | input image, model Pro/Max, aspect ratio, output format, prompt upsampling |
| Image editing | GPT Image 2 image-to-image | Complements text-to-image with one or more input URLs. | input images, aspect ratio |
| Image editing | Seedream 5 Lite image-to-image | Cheap image-to-image route. | input images, aspect ratio, quality |
| Image editing | Flux 2 Pro image-to-image | High-quality edit/variation route through Market jobs. | input images, aspect ratio, resolution |
| Image utility | Recraft Remove Background | Useful one-click asset prep for editing. | input image; prompt optional/disabled |
| Image utility | Recraft Crisp Upscale | Useful for imported/generated still assets. | input image; prompt optional/disabled |
| Image utility | Topaz Image Upscale | Premium image enhancement. | input image, upscale factor |
| Video generation | Veo 3.1 | Premium video model with text, first/last-frame, and reference modes. | generation type, model quality/fast/lite, aspect ratio, resolution, audio on/off where applicable, watermark |
| Video generation | Runway | Useful premium video alternative with simple constraints. | image input optional, aspect ratio, duration 5/10, quality 720p/1080p, watermark |
| Video utility | Topaz Video Upscale | Direct value for generated/imported clips. | input video, upscale factor |
| Audio/SFX | Suno Sounds | Adds short sound design and loops without overloading Suno Music. | prompt, loop toggle, tempo, key, grab lyrics |

## Defer

- Full Kie chat models in FlashBoard generation. They belong in chat/provider
  settings, not media generation.
- Older or overlapping video model families such as Kling 2.x, Bytedance V1,
  Hailuo, Wan, HappyHorse, and similar duplicates until there is a specific
  quality/cost reason.
- Avatar, lip-sync, OmniHuman, Infinitalk, and motion-control tools. These need
  workflow-specific UI and should not be squeezed into the generic prompt bar.
- Full Suno music post-processing tools. Keep the first audio expansion to
  Suno Sounds.

## Suno Music Control Fix First

The current Suno tuning popover is in:

- `src/components/panels/flashboard/FlashBoardSunoPopovers.tsx`
- `src/components/panels/flashboard/FlashBoardSunoOptionsPlanner.ts`
- `src/components/panels/flashboard/useFlashBoardPromptSunoController.ts`
- `src/components/panels/flashboard/FlashBoardPopovers.css`
- `src/components/panels/flashboard/FlashBoardControls.css`

Fix plan:

1. Reproduce the problem in the browser for the Suno Music model with the
   tuning popover open: drag all three sliders, click vocal gender buttons,
   click Reset, click Done, and switch between `sunoModel`, `sunoMode`, and
   `sunoTuning`.
2. Confirm whether the fault is layout clipping, close-on-drag behavior, value
   drift, or active-button state. `sunoTuning` is not in
   `INLINE_SUBMENU_POPOVERS`, so do not assume the inline submenu is the only
   cause.
3. Normalize slider values in the UI setter path, not just in `sunoService`.
   Clamp to `0..1` and round to two decimals before storing so
   `tuningChanged` is stable.
4. Replace direct float equality in `FlashBoardSunoOptionsPlanner.ts` with
   rounded comparison or an epsilon.
5. Make the slider rows keyboard-accessible and give each range input an
   explicit label.
6. Verify the popover has enough width and no overlapping text/buttons in both
   normal and compact FlashBoard control states.

Acceptance:

- Sliders drag smoothly and the displayed values match the sent request.
- Reset returns all three values to `0.65` and clears the active tuning state.
- Done closes only the tuning popover.
- Model/mode buttons still use the compact inline submenu behavior.

## Magic-Wand Prompt Refiner

Before adding more models, replace the growing special-case block in
`FlashBoardPromptRefinerPrompt.ts` with a small model guidance registry keyed
by provider family. Keep the current transport and streaming shape intact.

Registry shape:

- `matches(providerId, entry, service)`
- `systemName`
- `successCriteria`
- `modelGuidance`
- `referenceGuidance`
- `avoidGuidance`
- optional `supportsPromptRefine`

Initial guidance profiles:

| Profile | Guidance |
|---|---|
| Suno Music | Keep current JSON contract; generate singable lyrics, style, and negative tags; respect custom/instrumental/vocal/tuning settings. |
| Suno Sounds | Generate sound-design prompts, not lyrics; mention loopability, tempo, key, texture, timing, and whether grabbed lyrics should be used. |
| Nano Banana / Nano Banana Pro | Preserve identity, layout, text, logos, materials, spatial relations, and reference order unless the user asks to change them. |
| Imagen 4 | Optimize still-image composition, subject, lighting, lens/framing, material detail, and style; avoid edit/reference claims when no reference mode is selected. |
| GPT Image 2 | Use clear image intent and exact visible elements; preserve referenced subjects where supplied; avoid unsupported parameter names. |
| Flux 2 | Write precise visual direction for photoreal/design output; for image-to-image state what changes and what stays fixed. |
| Seedream 5 Lite | Keep prompts concise and high-signal; for image-to-image preserve pose/composition unless changed. |
| Flux Kontext | Separate edit intent from preservation rules; state exactly which visual parts change and which remain. |
| Recraft / Topaz utilities | Disable magic-wand when no prompt is meaningful, or rewrite the user note into a short processing intent only. |
| Kling | Keep current physically plausible motion and temporal progression guidance. |
| Seedance | Keep current concise cinematic direction plus multimodal reference guidance. |
| Veo 3.1 | Write start/middle/end video direction; respect generation type, references, aspect, resolution, and audio expectations. |
| Runway | Keep video prompts compact; respect 5/10 second duration and the 10s/1080p constraint. |

Acceptance:

- Every visible model entry has a `promptRefinerProfile`.
- Utility models either hide the wand or use a utility-safe guidance profile.
- Prompt refiner tests cover one Suno, one image generation, one image edit,
  one image utility, one video generation, and one sound-effect target.

## Magic-Wand Research Agents

Before writing the final prompt profiles, dispatch small read-only research
agents to collect current June 2026 prompt guidance for every model family we
already offer and every family in this plan. The output is one compact source
ledger, not code.

Agent rules:

- Prefer official provider documentation, Kie.ai endpoint docs, model release
  notes, and provider prompting guides.
- Record the source URL, checked date, supported inputs, hard constraints,
  prompt best practices, and "do not promise this" caveats.
- Ignore SEO prompt-blog filler unless no primary source exists.
- Summarize into guidance that can become system prompt text for the magic
  wand. Do not paste long copyrighted passages.

Research packets:

| Agent | Scope |
|---|---|
| Image generation agent | Nano Banana current family, Imagen 4, GPT Image 2, Flux 2, Seedream 5 Lite, existing Nano Banana 2. |
| Image edit/utility agent | Flux Kontext, GPT Image 2 image-to-image, Seedream image-to-image, Flux 2 image-to-image, Recraft utilities, Topaz image upscale. |
| Video agent | Existing Kling and Seedance plus Veo 3.1, Runway, and Topaz video upscale. |
| Audio agent | Existing Suno Music, Suno Sounds, and existing ElevenLabs speech guidance where the wand touches audio text. |
| Integration agent | Compare the research ledger against `FlashBoardPromptRefinerPrompt.ts` and list missing or stale guidance only. |

Artifact:

- `docs/ongoing/Kie-AI-Magic-Wand-Research-Ledger.md`

Acceptance:

- Every offered or planned service has one current guidance row.
- Each row has at least one primary source or is explicitly marked
  "no primary source found".
- The implementation packet uses the ledger to write prompt profiles, then the
  ledger can stay in `docs/ongoing/` until the profiles ship.

## Architecture Plan

1. Add model capability metadata to the FlashBoard catalog instead of hardcoding
   UI behavior per provider. Minimum fields:
   `operation`, `requiresPrompt`, `requiresInputMedia`, `acceptedMediaTypes`,
   `optionSchema`, `promptRefinerProfile`, and `pricingKey`.
2. Add Kie model specs under `src/services/kieAi/` for Market job models and
   dedicated endpoint models. Keep payload mapping near the service adapter,
   not in React components.
3. Split Kie adapters by endpoint family:
   Market jobs, Flux Kontext, 4o/GPT image dedicated routes if kept, Veo,
   Runway, Suno Sounds, and utility upscale/remove-background.
4. Extend `FlashBoardGenerationRequest` only with generic option bags that map
   to catalog metadata. Avoid adding a top-level field for every provider
   parameter unless the value is shared across multiple models.
5. Update parameter popovers so the chatbox shows only options supported by the
   selected model.
6. Update provider runners to dispatch by catalog operation and adapter family.
7. Add docs to `docs/Features/AI-Integration.md` after implementation, not
   during plan-only work.

## Implementation Packets

1. Suno tuning fix.
   Write set: Suno popover/controller/planner CSS and focused tests if present.
   Check: browser interaction plus focused unit tests.

2. Magic-wand research agents.
   Write set: `docs/ongoing/Kie-AI-Magic-Wand-Research-Ledger.md` only.
   Check: every current/planned service has a sourced guidance row.

3. Prompt refiner profiles.
   Write set: prompt refiner prompt/profile files and tests.
   Check: prompt output snapshots or explicit string assertions.

4. Catalog capability metadata.
   Write set: FlashBoard model catalog/types/options planners.
   Check: unit coverage for option visibility and request validation.

5. Low-risk Kie image generation.
   Add GPT Image 2, Flux 2 Pro, Seedream 5 Lite, Imagen 4 variants, and Nano
   Banana Pro/latest family entries.

6. Image edit and utility operations.
   Add Flux Kontext, GPT Image 2 image-to-image, Seedream image-to-image, Flux 2
   image-to-image, Recraft Remove Background, Recraft Crisp Upscale, and Topaz
   Image Upscale.

7. Premium video and sound.
   Add Veo 3.1, Runway, Topaz Video Upscale, and Suno Sounds.

8. Hosted/cloud mirror and docs.
   Mirror only the models the hosted backend actually supports, update pricing,
   and document the user-visible behavior.

## Checks

- Focused TypeScript/build check for touched modules after each packet.
- Browser QA for FlashBoard in image, video, Suno music, and utility modes.
- For bridge/browser playback tests after reload, wait 5 seconds before reading
  state per repo instructions.
- Full `npm run build`, `npm run lint`, and `npm run test` only at the normal
  readiness/commit boundary.

## Source Notes

Kie.ai documentation checked during planning:

- Kie Market quickstart and model lists.
- GPT Image 2 text-to-image and image-to-image.
- Flux 2 Pro text-to-image and image-to-image.
- Seedream 5 Lite text-to-image and image-to-image.
- Flux Kontext generation/editing.
- 4o Image generation.
- Veo 3.1 video generation.
- Runway video generation.
- Topaz image upscale and video upscale.
- Recraft remove background and crisp upscale.
- Suno Sounds generation.
