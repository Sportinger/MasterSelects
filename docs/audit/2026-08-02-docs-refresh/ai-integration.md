# AI-Integration.md — audit 2026-08-02

## Verified (spot checks that held)

- v2.4.4 is the current package version (`package.json`).
- The cited SAM 2 implementation exists and uses the Hiera Small fp16 encoder plus decoder, totals about 103 MB, and caches the model in OPFS (`src/services/sam2/SAM2ModelManager.ts`, `src/services/sam2/SAM2Service.ts`).
- MatAnyone2 remains a Native Helper, CUDA-only workflow; the panel creates and imports its foreground result (`src/components/panels/SAM2Panel.tsx`, `src/components/common/matAnyoneSetup/WelcomeStep.tsx`, `src/services/matanyone/MatAnyoneService.ts`).
- Kie chat model names and protocols in the document are present in the hosted provider (`functions/lib/providers/kieChat.ts`); Fable is explicitly tool-less there.
- Hosted moderation and audit persistence are implemented (`functions/lib/aiModeration.ts`, `functions/lib/aiAudit.ts`, `functions/lib/chatLog.ts`). Deepgram Nova-3 and OpenAI diarization are implemented (`functions/lib/providers/deepgramTranscription.ts`, `functions/lib/providers/openaiTranscription.ts`).
- The development and Native Helper bridge endpoints/ports are implemented (`tools/devBridge/vitePlugin.ts`, `tools/native-helper/src/http_server.rs`, `src/services/aiTools/bridge.ts`).

## Outdated or wrong (claim → reality, with file evidence)

- “Kie.ai or Lemonade Local” chat, the Lemonade provider table, setup, presets, streaming behavior, and loopback configuration → Lemonade is retired. The only displayed chat provider is Kie (`src/services/flashboard/FlashBoardChatConfig.ts`); the provider union is `kernel | kie` (`src/services/flashboard/FlashBoardChatTypes.ts`), and `settingsStore.ts` only removes retired Lemonade settings during migration (`src/stores/settingsStore.ts`).
- Default model `gpt-5-6-luna` → `gpt-5-6-terra` (`src/services/flashboard/FlashBoardChatConfig.ts`).
- “133 tool definitions, of which 97 are exposed” and a 1:1 kernel-manifest assertion → `AI_TOOLS` currently contains 176 definitions; hosted chat selects policy-eligible definitions, prioritizes them, then caps the list at 128. The parity test checks definition/policy/handler coverage and enumerated allowed asymmetries, not a kernel manifest (`src/services/aiTools/definitions/index.ts`, `src/services/flashboard/FlashBoardChatTools.ts`, `src/services/flashboard/FlashBoardChatConfig.ts`, `tests/unit/aiToolRegistryParity.test.ts`).
- “Lemonade remains available for local testing outside production” → no runtime Lemonade client/provider remains under `src/`; only changelog and migration-cleanup references remain (`src/services/flashboard/FlashBoardChatConfig.ts`, `src/stores/settingsStore.ts`, `src/changelog-data.json`).
- The document omitted the shipped local Scene Description feature → selected video clips can be described by the local Qwen3-VL service, with project artifact persistence, cancellation, and clearing (`src/components/panels/SceneDescriptionPanel.tsx`, `src/components/panels/properties/AnalysisTab.tsx`, `src/services/sceneDescriber.ts`).

## Noteworthy / unusual

- `src/services/aiTools/definitions/gaussian.ts` exists but is intentionally not imported by `definitions/index.ts`; the document’s warning about Gaussian tools not reaching `AI_TOOLS` is accurate.
- The document’s Back to Index label is mojibake (`[ƒÅ? Back to Index]`), although its target `./README.md` exists.
- Scene description is a separate local service at port 5555, not the private kernel or hosted Kie route. It can upload a video to that local service when no filesystem path is available (`src/services/sceneDescriber.ts`).
