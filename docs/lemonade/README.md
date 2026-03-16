# Lemonade Local AI Integration

**Branch:** `lemonade-support`
**Status:** Validation Sprint Pending
**Last Updated:** 2026-03-15

---

## Overview

This document tracks the integration of **Lemonade Server** (local AI inference) into MasterSelects video editor.

**Lemonade Server Location:** `c:/users/antmi/lemonade`
**API Endpoint:** `http://localhost:8000/api/v1` (OpenAI-compatible)

---

## Current Understanding

### What Lemonade Provides

| Modality | Backend | Hardware | OS Support | Priority |
|----------|---------|----------|------------|----------|
| **Text Generation (LLM)** | llamacpp | Vulkan/ROCm/CPU/Metal | Windows, Linux, macOS | **HIGH** |
| **Speech-to-Text** | whispercpp | NPU/CPU | Windows | **HIGH** |
| **Text-to-Speech** | Kokoro | CPU | Windows, Linux | LOW |
| **Image Generation** | SD-CPP | ROCm/CPU | Windows, Linux | LOW |

### What MasterSelects Needs

1. **LLM Chat** - Replace/augment OpenAI in AIChatPanel for timeline editing
2. **Transcription** - Alternative backend to existing whisper/AssemblyAI/Deepgram
3. **TTS** - New capability for narration generation (future)

### Architecture Fit

```
┌─────────────────────────────────────────────────────────┐
│                   AIChatPanel.tsx                        │
│  ┌─────────────────┐    ┌────────────────────────────┐  │
│  │ Model Selector  │    │ Provider Toggle            │  │
│  │ GPT-5.1 ▼       │    │ [OpenAI] [Lemonade]        │  │
│  └─────────────────┘    └────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              Settings Store (apiKeys)                     │
│  openai: "sk-..."                                        │
│  lemonade: "http://localhost:8000/api/v1"               │
└─────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│   OpenAI Provider        │  │   Lemonade Provider      │
│   api.openai.com/v1      │  │   localhost:8000/api/v1  │
│   Tools: Full support    │  │   Tools: VALIDATION?     │
│   CORS: N/A              │  │   CORS: VALIDATION?      │
└──────────────────────────┘  └──────────────────────────┘
```

---

## Validation Sprint Status

### Critical Validations (BEFORE Implementation)

| # | Validation | Status | Owner | Due | Notes |
|---|------------|--------|-------|-----|-------|
| 1 | CORS Support | ⏳ Pending | Engineering | TBD | `curl -X OPTIONS http://localhost:8000/api/v1/chat/completions` |
| 2 | Tool/Function Calling | ⏳ Pending | Engineering | TBD | Test with `tools[]` array payload |
| 3 | LLM Quality Baseline | ⏳ Pending | Product | TBD | 10 editing prompts, ≥80% completion |
| 4 | STT Quality | ⏳ Pending | Engineering | TBD | Transcribe sample, ≥90% accuracy |
| 5 | TTS Viability | ⏳ Pending | Product | TBD | Generate 5 samples, assess quality |

### Validation Commands

```bash
# Test 1: CORS headers
curl -X OPTIONS http://localhost:8000/api/v1/chat/completions \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -v

# Test 2: Basic connectivity
curl http://localhost:8000/api/v1/models \
  -H "Authorization: Bearer lemonade"

# Test 3: Chat completion (no tools)
curl http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{"model":"Gemma-3-4b-it-GGUF","messages":[{"role":"user","content":"Hello"}]}'

# Test 4: Tool calling
curl http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"Gemma-3-4b-it-GGUF",
    "messages":[{"role":"user","content":"Split the clip at 5 seconds"}],
    "tools":[{"type":"function","function":{"name":"splitClip","parameters":{"type":"object"}}}]
  }'
```

---

## Known Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CORS not supported | Browser cannot connect | Vite proxy (dev), browser extension (prod) |
| Tool calling unsupported | AI cannot edit timeline | JSON extraction fallback mode |
| Model quality gap (1-4B vs GPT-5) | Poor editing suggestions | Hybrid mode: complex → cloud, simple → local |
| Server management friction | User confusion | Status indicator, clear documentation |
| GPU memory exhaustion | Crashes/errors | Model size warnings, graceful degradation |

---

## Implementation Phases (Conditional on Validation)

### Phase 1: LLM Chat MVP (3-4 days)

**Files to Create:**
- `src/services/lemonadeProvider.ts` - OpenAI-compatible provider
- `src/services/lemonadeService.ts` - Server management wrapper

**Files to Modify:**
- `src/stores/settingsStore.ts` - Add lemonade settings
- `src/components/panels/AIChatPanel.tsx` - Provider toggle
- `vite.config.ts` - CORS proxy (if needed)

**Deliverables:**
- [ ] Provider toggle in AIChatPanel
- [ ] Server status indicator (online/offline)
- [ ] Model selector for local models
- [ ] Graceful fallback when server offline

### Phase 2: STT Backend (1-2 days)

**Files to Modify:**
- `src/services/whisperService.ts` - Add lemonade backend
- `src/stores/settingsStore.ts` - Transcription provider setting

**Deliverables:**
- [ ] whispercpp as transcription option
- [ ] Quality comparison with existing providers

### Phase 3: TTS (Deferred)

**Files to Create:**
- `src/components/panels/TTSPanel.tsx`

### Phase 4: Server Management UX (Deferred)

**Deliverables:**
- [ ] Auto-detection on startup
- [ ] One-click server start instructions
- [ ] Model download links

---

## Task Tracking

| Task ID | Subject | Status | Blocked By |
|---------|---------|--------|------------|
| #2 | Validate Lemonade CORS support | ⏳ Pending | - |
| #3 | Validate Lemonade tool calling support | ⏳ Pending | - |
| #4 | Validate Lemonade LLM quality baseline | ⏳ Pending | - |
| #5 | Validate Lemonade STT quality | ⏳ Pending | - |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-15 | Create `lemonade-support` branch | Isolate integration work |
| 2026-03-15 | CONDITIONAL GO with validation sprint | Quality review identified critical uncertainties |
| 2026-03-15 | Establish 5 validation tasks | Must confirm capabilities before implementation |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [`strategic-recommendation.md`](./strategic-recommendation.md) | Implementation plan with risk mitigations |
| [`validation-results.md`](./validation-results.md) | Validation test results (populated during sprint) |
| [`technical-analysis.md`](./technical-analysis.md) | Detailed technical analysis from senior developer |
| [`quality-review.md`](./quality-review.md) | Quality review findings and concerns |

---

## Next Actions

1. **Run validation sprint** (2 days)
2. **Populate `validation-results.md`** with test outcomes
3. **Final Go/No-Go decision** based on validation results
4. **Begin Phase 1 implementation** if validations pass

---

*This document is the source of truth for Lemonade integration status. Update during each agent loop iteration.*
