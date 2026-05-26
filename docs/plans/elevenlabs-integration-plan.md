# ElevenLabs Integration Plan

GitHub issue: https://github.com/Sportinger/MasterSelects/issues/160
Branch: `issue-160-implement-elevenlabs`

## Goal

Add ElevenLabs as a first-class AI audio provider so generated voice output can move through the same durable media and timeline paths as imported audio files.

The integration should not create remote-only timeline clips. Once audio is generated, MasterSelects should treat the result as a normal project media asset that can be previewed, moved, saved, exported, and reloaded without requiring another ElevenLabs request.

## Product Scope

- Store an ElevenLabs API key through the existing encrypted API-key flow.
- Provide a typed ElevenLabs service layer for voice listing, text-to-speech generation, request validation, cancellation, and response normalization.
- Add an editor workflow for entering text, choosing a voice/model, generating audio, previewing it, and importing it into the media library.
- Allow generated audio to be inserted on an audio track at the playhead or kept as media-only output.
- Preserve project portability by copying/generated-audio persistence according to the existing project media rules.
- Surface missing-key, invalid-input, network, quota/rate-limit, and provider-response failures in the UI without leaking API secrets.

## Architecture Notes

### API Key Storage

Existing files:

- `src/services/apiKeyManager.ts`
- `src/stores/settingsStore.ts`
- `src/components/common/settings/ApiKeysSettings.tsx`

Planned shape:

- Add `elevenlabs` to `ApiKeyType`, `KEY_IDS`, and the `APIKeys` state interface.
- Initialize `apiKeys.elevenlabs` to an empty string and include it in `getAllKeys()`.
- Add an "AI Audio Generation" or "Voice Generation" group in the API Keys settings panel with an ElevenLabs row.
- Keep the key out of localStorage; it should follow the current IndexedDB encryption path.

### Service Layer

Planned file:

- `src/services/elevenLabsService.ts`

Responsibilities:

- Hold the active API key through `setApiKey()` and `hasApiKey()`, matching the style used by `kieAiService`.
- Fetch and normalize available voices/models when the UI needs provider metadata.
- Generate audio from text and selected provider options.
- Return a `Blob` plus metadata needed for naming, duration probing, and media import.
- Accept an `AbortSignal` so UI cancellation does not leave stale async callbacks updating state.
- Normalize provider failures into user-facing messages while logging technical details through `Logger`.

The implementation should verify the current ElevenLabs API surface against official docs during coding instead of hardcoding assumptions from this planning document.

### UI Workflow

Candidate locations:

- Extend the existing AI dock area with an AI Audio/Voice panel, or
- Add a tab inside the current AI Video/AI media generation surface if that keeps provider workflows together.

Expected controls:

- Text input for spoken content.
- Voice selector with refresh/loading/error states.
- Model/output controls only where they are supported by the provider and useful in the editor.
- Generate, cancel, preview, add-to-media, and add-to-timeline actions.

Generated audio should import through the existing media store rather than creating a bespoke timeline object.

### Media and Timeline Insertion

Relevant paths to inspect during implementation:

- `src/stores/mediaStore/`
- `src/stores/timeline/clipSlice.ts`
- `src/stores/timeline/clip/addAudioClip.ts`
- `src/components/timeline/hooks/useExternalDrop.ts`
- AI media import flow in `src/components/panels/AIVideoPanel.tsx`

Implementation preference:

- Create a `File` from the generated audio `Blob`.
- Import it through the media store.
- Insert it through the existing audio clip add path, choosing an available audio track or creating one according to existing timeline behavior.

## Test Plan

Focused tests should cover:

- API key type wiring in `apiKeyManager` and `settingsStore`.
- ElevenLabs service request validation and response/error normalization with mocked `fetch`.
- UI behavior for missing key, loading voices, generating, cancellation, preview, and import actions.
- Media/timeline insertion using the generated audio file path.

Manual smoke coverage:

- Add key, reload app, confirm key presence without localStorage plaintext.
- Generate short speech, preview it, add to media, add to timeline, save/reload project, export timeline audio.
- Exercise missing key, cancelled request, and provider failure states.

## Documentation

Update after implementation:

- `docs/Features/AI-Integration.md`
- `docs/Features/Audio.md` if timeline/audio workflow behavior changes
- `docs/Features/README.md` if a new panel or major feature entry is added

## Acceptance Checklist

- [ ] ElevenLabs key is configurable and encrypted through the existing key manager.
- [ ] Voice/model metadata loads with robust loading and error states.
- [ ] Text-to-speech generation returns durable audio media.
- [ ] Generated audio can be previewed, imported, inserted on an audio track, saved, reloaded, and exported.
- [ ] Service and UI paths have focused tests.
- [ ] Feature documentation is updated.
- [ ] `npm run build`, `npm run lint`, and `npm run test` pass before merge.
