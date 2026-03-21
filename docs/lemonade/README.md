# Lemonade Local AI Integration

**Branch:** `lemonade-support`
**Status:** PHASE 2 AUTHORIZED - CONDITIONAL GO
**Last Updated:** 2026-03-16
**Validation Lead:** Senior Developer Agent
**Phase 2 Timeline:** 2026-03-16 to 2026-03-27 (10 days)

---

## Quick Handoff Reference

**For:** Senior Developer Agent executing validation sprint

| Item | Location | Purpose |
|------|----------|---------|
| **Validation Workspace** | [`validation-results.md`](./validation-results.md) | Execute tests, record results here |
| **Technical Specs** | [`technical-analysis.md`](./technical-analysis.md) | API endpoints, code patterns |
| **Strategy Overview** | [`strategic-recommendation.md`](./strategic-recommendation.md) | Handoff notes, success criteria |
| **Quality Gates** | [`quality-review.md`](./quality-review.md) | Risk context, quality thresholds |

**Target Model:** `Gemma-3-4b-it-GGUF` (user confirmed)
**Server Location:** `c:/users/antmi/lemonade`
**API Endpoint:** `http://localhost:8000/api/v1`

---

## Overview

This document tracks the integration of **Lemonade Server** (local AI inference) into MasterSelects video editor.

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

### Sprint Overview (COMPLETED 2026-03-16)

**Status:** VALIDATION COMPLETE - PHASE 2 AUTHORIZED

| Day | Focus | Duration | Deliverable |
|-----|-------|----------|-------------|
| Day 1 | Infrastructure & Connectivity | 6 hours | CORS resolved, tool calling format confirmed |
| Day 2 | Quality Baseline | 6 hours | LLM 80% pass rate, latency documented, STT endpoint verified |

### Critical Validations

| # | Validation | Status | Result | Notes |
|---|------------|--------|--------|-------|
| 1 | CORS Support | **RESOLVED** | PASS | Native CORS headers confirmed |
| 2 | Tool/Function Calling | **CONDITIONAL PASS** | PASS | Works with explicit parameters |
| 3 | LLM Quality Baseline | **CONDITIONAL** | 80% (4/5 tested) | Latency 30-85s vs 10s target |
| 4 | STT Quality | **CONDITIONAL** | Endpoint ready | WER testing deferred to integration |
| 5 | TTS Viability | **DEFERRED** | N/A | Not MVP requirement |

### Decision: CONDITIONAL GO - Phase 2 Authorized

| Criteria | Assessment | Mitigation |
|----------|------------|------------|
| CORS | **RESOLVED** | Native support confirmed |
| Tool Calling | **PASS** | Works when parameters explicit |
| LLM Quality | **CONDITIONAL** | Fallback model for latency |
| STT Quality | **CONDITIONAL** | Integration testing required |

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

### Phase 2 Scope (AUTHORIZED)

**Timeline:** 10 days (2026-03-16 to 2026-03-27)

| Priority | Task | Duration | Status |
|----------|------|----------|--------|
| **P0** | Complete remaining 5 LLM prompts | 4 hours | Pending |
| **P0** | Implement fallback model logic | 6 hours | Pending |
| **P0** | Model availability detection | 4 hours | Pending |
| **P1** | Expand error handling | 4 hours | Pending |
| **P1** | Provider toggle UI | 6 hours | Pending |
| **P1** | Server status indicator | 4 hours | Pending |
| **P2** | Settings persistence | 3 hours | Pending |
| **P2** | Documentation updates | 2 hours | Pending |

### Phase 2 Deliverables

- [ ] `lemonadeProvider.ts` - OpenAI-compatible provider
- [ ] `lemonadeService.ts` - Server management wrapper
- [ ] Provider toggle in AIChatPanel
- [ ] Server status indicator (online/offline/model-ready)
- [ ] Fallback model auto-switching
- [ ] Error handling for all edge cases
- [ ] Test suite with >=80% coverage

### Known Risks & Mitigations

## Implementation Phases

### Phase 2: Validation Completion + Basic Integration (AUTHORIZED)

**Timeline:** 10 days (2026-03-16 to 2026-03-27)

**Files to Create:**
- `src/services/lemonadeProvider.ts` - OpenAI-compatible provider
- `src/services/lemonadeService.ts` - Server management wrapper

**Files to Modify:**
- `src/stores/settingsStore.ts` - Add lemonade settings
- `src/components/panels/AIChatPanel.tsx` - Provider toggle + status indicator

**Deliverables:**
- [ ] Complete remaining 5 LLM prompts (validate full 10-prompt suite)
- [ ] Fallback model logic implementation
- [ ] Model availability detection
- [ ] Expanded error handling
- [ ] Provider toggle UI
- [ ] Server status indicator
- [ ] Settings persistence

### Phase 3: STT Backend Integration (Post-Phase 2)

**Files to Modify:**
- `src/services/whisperService.ts` - Add lemonade backend

**Deliverables:**
- [ ] whispercpp as transcription option
- [ ] Quality comparison with existing providers

### Phase 4: TTS + Server Management UX (Deferred)

**Deliverables:**
- [ ] TTS integration (optional)
- [ ] Auto-detection on startup
- [ ] One-click server start instructions
- [ ] Model download links

---

## Task Tracking

| Task ID | Subject | Status | Blocked By |
|---------|---------|--------|------------|
| #1 | CORS validation | **COMPLETE** | - |
| #2 | Tool calling validation | **COMPLETE** | - |
| #3 | LLM quality baseline (partial) | **COMPLETE** (4/5 prompts) | - |
| #4 | STT endpoint validation | **COMPLETE** (endpoint verified) | - |
| #5 | Complete remaining 5 LLM prompts | **PENDING** | Phase 2 |
| #6 | Implement fallback model logic | **PENDING** | Phase 2 |
| #7 | Model availability detection | **PENDING** | Phase 2 |
| #8 | Provider toggle UI | **PENDING** | Phase 2 |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-15 | Create `lemonade-support` branch | Isolate integration work |
| 2026-03-15 | CONDITIONAL GO with validation sprint | Quality review identified critical uncertainties |
| 2026-03-15 | Establish 5 validation tasks | Must confirm capabilities before implementation |
| 2026-03-16 | CORS risk downgraded to LOW | Vite proxy workaround confirmed |
| 2026-03-16 | Validation sprint completed | All critical validations complete |
| 2026-03-16 | **PHASE 2 AUTHORIZED** | CONDITIONAL GO with 4 required mitigations |

---

## Related Documents

| Document | Purpose | Status |
|----------|---------|--------|
| [`strategic-recommendation.md`](./strategic-recommendation.md) | **Phase 2 authorization + mitigations** | UPDATED v2.0 |
| [`validation-results.md`](./validation-results.md) | Validation sprint results | COMPLETE |
| [`technical-analysis.md`](./technical-analysis.md) | API specifications, code patterns | COMPLETE |
| [`quality-review.md`](./quality-review.md) | Quality gates, risk register | COMPLETE |

---

## Next Actions

### For Senior Developer Agent (Phase 2 Execution)

1. **Review Phase 2 scope** in `strategic-recommendation.md` Section 3
2. **Complete remaining 5 LLM prompts** - Test full 10-prompt suite
3. **Implement fallback model logic** - Use `Llama-3.2-1B-Hybrid` for simple commands
4. **Add model availability detection** - Health check + status indicator
5. **Expand error handling** - Handle all edge cases from quality review
6. **Build provider toggle UI** - Provider selection + status indicator
7. **Update documentation** - README + usage guide

### Phase 2 Success Criteria

| Criteria | Target | Measurement |
|----------|--------|-------------|
| Tool call accuracy | >=85% | Test suite (10 prompts) |
| Simple edit success rate | >=70% | Baseline test |
| Error recovery rate | 100% | All errors handled gracefully |
| Model detection accuracy | 100% | Correct status reported |
| Settings persistence | 100% | Cross-session testing |

---

## Senior Developer Handoff Summary

**Quick Start:**
1. Open `strategic-recommendation.md` - Phase 2 scope and mitigations
2. Review `quality-review.md` - Quality gates and edge cases
3. Check `technical-analysis.md` - API specifications and code patterns

**Environment:**
- Lemonade Server: `c:/users/antmi/lemonade`
- Target Model: `qwen3-4b-FLM` (primary), `Llama-3.2-1B-Hybrid` (fallback)
- API Endpoint: `http://localhost:8000/api/v1`

**Phase 2 Success Criteria:**
- Tool call accuracy: >=85% (10-prompt suite)
- Model detection: Accurate status displayed
- Error handling: All edge cases handled gracefully
- UI integration: Provider toggle + status indicator working

**Required Mitigations (Conditions for GO):**
1. Complete remaining 5 LLM prompts
2. Implement fallback model for latency mitigation
3. Add model availability detection
4. Expand error handling for all identified edge cases

**Questions?** See `strategic-recommendation.md` Section 5 for mitigation details.

---

*This document is the source of truth for Lemonade integration status. Update during each agent loop iteration.*
