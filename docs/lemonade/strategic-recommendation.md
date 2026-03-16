# Strategic Recommendation: Lemonade Server Integration

**Document Type:** Technical Strategy Recommendation
**Author:** Dr. Sarah Kim, Technical Product Strategist & Engineering Lead
**Date:** 2026-03-16
**Status:** PHASE 2 AUTHORIZED - CONDITIONAL GO
**Version:** 2.0 - Phase 2 Authorization
**Quality Confidence:** 75%

---

## 1. Executive Summary

### Final Recommendation: **CONDITIONAL GO - PROCEED TO PHASE 2**

Following comprehensive validation sprint analysis, this document authorizes **Phase 2: Validation Completion + Basic Integration** with specific required mitigations.

### Validation Results Summary

| Validation | Status | Result | Notes |
|------------|--------|--------|-------|
| CORS Support | **RESOLVED** | LOW RISK | Native CORS headers confirmed (`Access-Control-Allow-Origin: *`) |
| Tool Calling | **CONDITIONAL PASS** | LOW RISK | Works with explicit parameters; model asks for clarification when missing |
| LLM Quality | **CONDITIONAL** | MEDIUM RISK | 80% pass rate (4/5 tested); latency 30-85s vs 10s target |
| STT Quality | **CONDITIONAL** | MEDIUM RISK | Endpoint verified; WER testing deferred to integration |
| TTS Viability | **DEFERRED** | N/A | Not required for MVP |

**Overall Assessment:** CONDITIONAL GO - Proceed with documented mitigations

### Quality Review Summary

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Valid JSON output | >=90% | 100% | **PASS** |
| Correct tool selection | >=80% | 100% (tested) | **PASS** |
| Correct parameter extraction | >=80% | 100% (tested) | **PASS** |
| Response time < 10s | >=90% | 0% (avg ~45s) | **FAIL** |
| Prefill (TTFT) < 2s | >=90% | ~1.1s | **PASS** |
| Decoding speed > 10 tps | >=90% | ~15 tps | **PASS** |

---

## 2. Phase 2 Authorization

### Decision Framework Application

| Criteria | Assessment | Rationale |
|----------|------------|-----------|
| **Technical Feasibility** | **HIGH** | CORS native, tool calling works, OpenAI-compatible format |
| **Risk Profile** | **MEDIUM-LOW** | Critical risks mitigated; latency is UX concern not blocker |
| **Development Effort** | **MODERATE** | 2-3 weeks for validation completion + basic integration |
| **Strategic Value** | **HIGH** | Enables offline AI, user model choice, cost control |
| **Model Availability** | **CONFIRMED** | `qwen3-4b-FLM` supports tool calling natively |

### Go/No-Go Determination

**GO Criteria Met:**
- [x] CORS validated (native support confirmed)
- [x] Tool calling format confirmed (OpenAI-compatible `tool_calls`)
- [x] Model quality baseline established (80% on explicit parameter prompts)
- [x] Error handling documented (model asks for clarification when params missing)
- [x] Fallback strategy defined (smaller model for simple commands)

**Conditional Items (require mitigation):**
- [!] Response latency 3-8x target (mitigation: fallback model)
- [!] Model availability detection needed (mitigation: startup health check)
- [!] 5 LLM prompts remaining untested (mitigation: complete in Phase 2)
- [!] STT WER not validated (mitigation: defer to integration testing)

**NO-GO Criteria NOT Triggered:**
- [x] CORS is working (not blocked)
- [x] Tool calling functional (not failing)
- [x] Model handles basic commands (not incompetent)
- [x] No unhandled crashes (stable)

---

## 3. Phase 2 Scope: Validation Completion + Basic Integration

### Phase 2 Objectives

1. **Complete LLM Prompt Suite** - Test remaining 5 prompts from 10-prompt baseline
2. **Implement Latency Mitigation** - Add fallback model selection for simple commands
3. **Add Model Availability Detection** - Health check and model status indicator
4. **Expand Error Handling** - Handle edge cases identified in quality review
5. **Basic UI Integration** - Provider toggle with status indicator

### Prioritized Task List

| Priority | Task | Owner | Duration | Dependencies |
|----------|------|-------|----------|--------------|
| **P0** | Complete remaining 5 LLM prompts | Senior Dev | 4 hours | None |
| **P0** | Implement fallback model logic | Senior Dev | 6 hours | P0 prompt completion |
| **P0** | Model availability detection | Senior Dev | 4 hours | None |
| **P1** | Expand error handling | Senior Dev | 4 hours | None |
| **P1** | Provider toggle UI | Senior Dev | 6 hours | None |
| **P1** | Server status indicator | Senior Dev | 4 hours | P0 detection |
| **P2** | Settings persistence | Senior Dev | 3 hours | P1 UI |
| **P2** | Documentation updates | Senior Dev | 2 hours | All above |

### Phase 2 Timeline

```
Week 1 (Days 1-5):
├── Day 1: Complete LLM prompt suite (P0)
├── Day 2: Fallback model implementation (P0)
├── Day 3: Model availability detection (P0)
├── Day 4: Error handling expansion (P1)
└── Day 5: Provider toggle + status UI (P1)

Week 2 (Days 6-10):
├── Day 6: Settings persistence (P2)
├── Day 7: Integration testing
├── Day 8: Bug fixes and polish
├── Day 9: Documentation updates (P2)
└── Day 10: Phase 2 review + Phase 3 planning
```

### Phase 2 Deliverables

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| `lemonadeProvider.ts` | OpenAI-compatible provider | Compiles, passes lint, handles all error types |
| `lemonadeService.ts` | Server management wrapper | Health check working, model detection accurate |
| Provider Toggle | UI for switching providers | Renders correctly, state persists |
| Status Indicator | Shows server/model status | Green/Yellow/Red states accurate |
| Fallback Logic | Auto-switch for simple commands | Configurable threshold, user notified |
| Test Suite | Unit + integration tests | >=80% coverage, all tests pass |
| Documentation | Updated README + usage guide | Clear setup instructions |

---

## 4. Success Criteria for Phase 2

### Technical KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Tool call accuracy | >=85% | Test suite (10 prompts) |
| Simple edit success rate | >=70% | Baseline test |
| Error recovery rate | 100% | All errors handled gracefully |
| Model detection accuracy | 100% | Correct status reported |
| Settings persistence | 100% | Cross-session testing |

### User Experience KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Status indicator accuracy | 100% | Matches actual server state |
| Fallback transparency | User notified | Audit fallback events |
| Error message clarity | >=4/5 rating | User testing |
| No crashes | 0% crash rate | Integration testing |

### Quality Gates (Must ALL Pass)

| Gate ID | Validation | Expected Result | Status |
|---------|------------|-----------------|--------|
| G2.1 | Tool calling capability | Tool calls returned OR JSON extractable | PENDING |
| G2.2 | Model quality baseline | >=70% success on 10-prompt suite | PENDING |
| G2.3 | Error handling validation | All error types handled gracefully | PENDING |
| G2.4 | Model availability detection | Accurate status reported | PENDING |
| G2.5 | Fallback model working | Auto-switch functional | PENDING |
| G2.6 | UI integration complete | Provider toggle + status indicator | PENDING |

---

## 5. Required Mitigations (Conditions for GO)

### Mitigation 1: Complete Remaining LLM Prompts

**Risk Addressed:** Only 5/10 prompts tested; quality baseline incomplete

**Implementation:**
```typescript
const REMAINING_PROMPTS = [
  {
    prompt: "Remove the silent parts",
    expectedTools: ["findSilentSections", "cutRangesFromClip"]
  },
  {
    prompt: "Add a transition",
    expectedTools: ["addTransition"]
  },
  {
    prompt: "Duplicate the clip",
    expectedTools: ["duplicateClip"]
  },
  {
    prompt: "What's in my timeline?",
    expectedTools: ["getTimelineState"]
  },
  {
    prompt: "Create a highlight reel",
    expectedTools: ["executeBatch"]
  },
];
```

**Acceptance:** All 10 prompts tested; success rate >= 70%

---

### Mitigation 2: Latency Mitigation via Fallback Model

**Risk Addressed:** Response latency 30-85s vs 10s target (3-8x over)

**Implementation:**
```typescript
const LEMONADE_CONFIG = {
  models: {
    primary: 'qwen3-4b-FLM',      // Tool calling, complex reasoning
    fallback: 'Llama-3.2-1B-Hybrid', // Simple commands, faster response
  },
  // Simple commands use fallback
  simpleCommands: [
    'getTimelineState',
    'getClipDetails',
    'getMediaItems',
    'listEffects',
    'getStats',
    'getLogs',
  ],
  // Use primary for editing operations
  editingOperations: [
    'splitClip',
    'deleteClip',
    'moveClip',
    'trimClip',
    'addEffect',
  ],
};

function selectModel(task: string, toolCalls: ToolDefinition[]): string {
  const usesComplexTools = toolCalls.some(t =>
    LEMONADE_CONFIG.editingOperations.includes(t.name)
  );
  return usesComplexTools ? 'primary' : 'fallback';
}
```

**Acceptance:** Simple commands complete in <10s; complex operations use primary model

---

### Mitigation 3: Model Availability Detection

**Risk Addressed:** Model may not be downloaded; user confusion

**Implementation:**
```typescript
interface ModelStatus {
  serverOnline: boolean;
  modelAvailable: boolean;
  modelLoading: boolean;
  error?: string;
}

async function checkModelStatus(model: string): Promise<ModelStatus> {
  try {
    // 1. Check server health
    const health = await fetch('/api/health');
    if (!health.ok) {
      return { serverOnline: false, modelAvailable: false };
    }

    // 2. Check model list
    const models = await fetch('/api/v1/models', {
      headers: { 'Authorization': 'Bearer lemonade' }
    });
    const modelList = await models.json();
    const available = modelList.data.some(m => m.id.includes(model));

    return {
      serverOnline: true,
      modelAvailable: available,
      modelLoading: false,
    };
  } catch (error) {
    return {
      serverOnline: false,
      modelAvailable: false,
      error: error.message,
    };
  }
}
```

**Acceptance:** Accurate status displayed before user attempts to use Lemonade

---

### Mitigation 4: Error Handling Expansion

**Risk Addressed:** Edge cases identified in quality review

**Implementation:**
```typescript
enum LemonadeErrorType {
  SERVER_OFFLINE = 'SERVER_OFFLINE',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  TOOL_CALL_FAILED = 'TOOL_CALL_FAILED',
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
  TIMEOUT = 'TIMEOUT',
  GPU_OOM = 'GPU_OOM',
}

const ERROR_MESSAGES: Record<LemonadeErrorType, string> = {
  SERVER_OFFLINE: 'Lemonade Server is not running. Start the server and try again.',
  MODEL_NOT_FOUND: 'Model not downloaded. Download the model from Lemonade Server.',
  TOOL_CALL_FAILED: 'AI could not execute the tool. Check that required parameters are provided.',
  JSON_PARSE_ERROR: 'AI response could not be parsed. Try rephrasing your request.',
  TIMEOUT: 'Request timed out. The server may be busy or the model is too large.',
  GPU_OOM: 'GPU memory exhausted. Try a smaller model or close other GPU applications.',
};

function handleLemonadeError(error: Error, context: ErrorContext) {
  const errorType = classifyError(error);
  const userMessage = ERROR_MESSAGES[errorType];

  // Log detailed error for debugging
  log.error('Lemonade error', { error, context, errorType });

  // Show user-friendly message
  showToast('error', userMessage);

  // Offer fallback if available
  if (errorType === LemonadeErrorType.TIMEOUT && hasFallback()) {
    showFallbackOffer();
  }
}
```

**Acceptance:** All error types from quality review E001-E025 handled gracefully

---

## 6. Recommended Configuration

### Production Configuration

```typescript
// src/services/lemonadeProvider.ts
export const LEMONADE_CONFIG = {
  endpoint: 'http://localhost:8000/api/v1',
  auth: 'Bearer lemonade',
  models: {
    primary: 'qwen3-4b-FLM',        // Tool calling, complex reasoning
    fallback: 'Llama-3.2-1B-Hybrid', // Simple commands, faster response
    stt: 'Whisper-Base',            // Speech-to-text (deferred)
  },
  timeouts: {
    prefill: 5000,      // 5s for first token
    completion: 120000, // 120s for full response
    healthCheck: 3000,  // 3s for health check
  },
  thresholds: {
    simpleCommandTokens: 100,  // Use fallback for responses <100 tokens
    maxWaitTime: 30000,        // 30s before offering fallback
  },
};
```

### Vite Proxy Configuration (Development)

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/lemonade': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lemonade/, '/api/v1'),
      },
    },
  },
});
```

---

## 7. Phase 3 Preview (Post-Phase 2)

Phase 3 will be authorized upon successful Phase 2 completion. Preview scope:

| Phase 3 Component | Description | Priority |
|-------------------|-------------|----------|
| STT Backend Integration | whispercpp as transcription provider | P1 |
| Context-Aware Prompts | Include timeline state in prompts | P2 |
| Batch Operations | Multi-tool AI operations | P2 |
| Model Preferences UI | User model selection + advanced settings | P2 |
| Performance Monitoring | Latency tracking + quality metrics | P2 |

---

## 8. Sign-off

### Phase 2 Authorization

| Role | Name | Date | Signature |
|------|------|------|-----------|
| **Technical Strategist** | Dr. Sarah Kim | 2026-03-16 | **APPROVED** |
| **Validation Lead** | Senior Developer Agent | 2026-03-16 | _Execution Authorized_ |
| **Quality Review** | Taylor Kim | 2026-03-16 | **CONDITIONAL APPROVAL** |

### Conditions Acceptance

By proceeding with Phase 2, the team acknowledges:

1. **Latency mitigation is required** - Fallback model must be implemented
2. **Model detection is required** - Users must see server/model status
3. **Complete testing is required** - All 10 prompts must be validated
4. **Error handling is required** - All identified edge cases handled

---

## 9. Appendix: Quality Reviewer Input Summary

### From Quality Reviewer Report

| Factor | Status | Action |
|--------|--------|--------|
| CORS | **RESOLVED** | Native support confirmed; no mitigation needed |
| Tool Calling | **CONDITIONAL PASS** | Works with explicit parameters; UI should guide users |
| LLM Quality | **CONDITIONAL** | 80% pass rate; latency 3-8x target requires fallback |
| STT Quality | **CONDITIONAL** | Endpoint ready; WER testing deferred |

### Live Telemetry (Lemonade Logs)

| Metric | Value | Assessment |
|--------|-------|------------|
| TTFT (Time to First Token) | 1.10-1.12s | **Excellent** - under 1.5s target |
| TPS (Tokens Per Second) | 15.20-15.65 | **Good** - above 10 tps target |
| Output Tokens | 137-1061 | Variable; longer responses = longer wait |

**Analysis:** Prefill performance is excellent; decoding speed is acceptable; total response time is the concern for longer outputs.

---

*This document authorizes Phase 2 implementation with the specified conditions and mitigations. Proceed to execution.*
