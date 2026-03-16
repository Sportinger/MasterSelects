# Lemonade Validation Results

**Validation Sprint Status:** ⏳ In Progress
**Started:** 2026-03-15
**Last Updated:** 2026-03-15

---

## Executive Summary

| Validation | Status | Result | Notes |
|------------|--------|--------|-------|
| CORS Support | ⏳ Pending | - | Can be worked around via Vite proxy |
| Tool Calling | ⏳ Pending | - | Supported by compatible models |
| LLM Quality | ⏳ Pending | - | Testing required |
| STT Quality | ⏳ Pending | - | Testing required |
| TTS Viability | ⏳ Pending | - | Deferred |

**Overall Status:** Conditional GO - proceeding with validation.

---

## Validation 1: CORS Support

**Risk Level:** ~~CRITICAL~~ → **LOW** (workaround confirmed)

**User Confirmation:** CORS can be spoofed/worked around.

### Test Procedure

```bash
# Test 1: Check for CORS headers
curl -X OPTIONS http://localhost:8000/api/v1/chat/completions \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

### Expected Results

| Header | Expected Value |
|--------|----------------|
| `Access-Control-Allow-Origin` | `*` or `http://localhost:5173` |
| `Access-Control-Allow-Methods` | `GET, POST, OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type, Authorization` |

### Workaround Options

1. **Vite Proxy** (Development)
   ```typescript
   // vite.config.ts
   server: {
     proxy: {
       '/lemonade': {
         target: 'http://localhost:8000',
         changeOrigin: true,
         rewrite: (path) => path.replace(/^\/lemonade/, '/api/v1'),
       },
     },
   }
   ```

2. **Server Configuration** (Production)
   - Set `LEMONADE_CORS_ORIGIN=*` environment variable (if supported)
   - Use reverse proxy (nginx) with CORS headers

3. **Browser Flags** (Testing)
   - `--disable-web-security` for local testing only

### Result

- [ ] Test executed: ___ (date)
- [ ] Headers confirmed: ___
- [ ] Workaround implemented: ___

---

## Validation 2: Tool/Function Calling

**Risk Level:** ~~HIGH~~ → **MEDIUM** (model-dependent)

**User Confirmation:** Lemonade supports tool calling for compatible models.

### Test Procedure

```bash
# Test: Tool calling with Gemma-3-4b-it-GGUF
curl http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Gemma-3-4b-it-GGUF",
    "messages": [
      {"role": "user", "content": "Split the clip at 5 seconds"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "splitClip",
        "description": "Split a clip at a specific time",
        "parameters": {
          "type": "object",
          "properties": {
            "clipId": {"type": "string"},
            "time": {"type": "number"}
          },
          "required": ["clipId", "time"]
        }
      }
    }]
  }'
```

### Expected Response Format

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "splitClip",
          "arguments": "{\"clipId\":\"clip-123\",\"time\":5.0}"
        }
      }]
    }
  }]
}
```

### Models to Test

| Model | Size | Tool Calling Support | Priority |
|-------|------|---------------------|----------|
| `Gemma-3-4b-it-GGUF` | ~4GB | To be confirmed | HIGH |
| `Llama-3.2-1B-Instruct-GGUF` | ~1GB | To be confirmed | HIGH |
| `Llama-3.2-3B-Instruct-GGUF` | ~3GB | To be confirmed | HIGH |
| `Qwen2.5-3B-Instruct-GGUF` | ~3GB | To be confirmed | MEDIUM |

### Result

- [ ] Test executed: ___ (date)
- [ ] Tool calling confirmed: ___
- [ ] Compatible models documented: ___

---

## Validation 3: LLM Quality Baseline

**Risk Level:** MEDIUM
**Pass Criteria:** ≥80% task completion rate on standard editing prompts

### Test Prompts

| # | Prompt | Expected Tool Call | Pass/Fail |
|---|--------|-------------------|-----------|
| 1 | "Split the clip at 5 seconds" | `splitClip({clipId, time: 5})` | |
| 2 | "Remove the silent parts" | `findSilentSections()` + `cutRangesFromClip()` | |
| 3 | "Add a transition" | `addTransition()` | |
| 4 | "Delete this clip" | `deleteClip({clipId})` | |
| 5 | "Move the clip to track 2" | `moveClip({clipId, trackId})` | |
| 6 | "Trim 2 seconds from the start" | `trimClip({clipId, start: 2})` | |
| 7 | "Duplicate the clip" | `duplicateClip({clipId})` | |
| 8 | "What's in my timeline?" | `getTimelineState()` | |
| 9 | "Find the best cuts for this interview" | `getTranscriptAnalysis()` + suggestions | |
| 10 | "Create a highlight reel" | `executeBatch()` with multiple ops | |

### Scoring

| Metric | Target | Actual |
|--------|--------|--------|
| Valid JSON output | ≥90% | ___% |
| Correct tool selection | ≥80% | ___% |
| Correct parameter extraction | ≥80% | ___% |
| Reasoning quality | ≥70% | ___% |

### Result

- [ ] All 10 prompts tested: ___ (date)
- [ ] Pass rate: ___%
- [ ] PASS/FAIL: ___

---

## Validation 4: STT Quality (WhisperCPP)

**Risk Level:** MEDIUM
**Pass Criteria:** ≥90% word accuracy on sample audio

### Test Procedure

1. Use existing test audio file (30 seconds, clear speech)
2. Transcribe via Lemonade whispercpp endpoint
3. Compare to reference transcript
4. Calculate word error rate (WER)

### Test Command

```bash
curl http://localhost:8000/api/v1/audio/transcriptions \
  -H "Authorization: Bearer lemonade" \
  -F "file=@test-audio.wav" \
  -F "model=whisper-1"
```

### Result

- [ ] Test executed: ___ (date)
- [ ] Word accuracy: ___%
- [ ] PASS/FAIL: ___

---

## Validation 5: TTS Viability (Kokoro)

**Risk Level:** LOW
**Status:** DEFERRED (not required for MVP)

### Test Procedure (Deferred)

```bash
curl http://localhost:8000/api/v1/audio/speech \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kokoro-v1",
    "input": "Hello, this is a test of local text-to-speech."
  }' \
  --output test-tts.mp3
```

### Result

- [ ] Status: DEFERRED

---

## Summary & Recommendation

### Validation Summary

| # | Validation | Status | Pass/Fail | Notes |
|---|------------|--------|-----------|-------|
| 1 | CORS Support | ✅ Resolved | PASS | Workaround confirmed |
| 2 | Tool Calling | ⏳ Pending | - | Awaiting model testing |
| 3 | LLM Quality | ⏳ Pending | - | Awaiting testing |
| 4 | STT Quality | ⏳ Pending | - | Awaiting testing |
| 5 | TTS Viability | ⏸️ Deferred | - | Not MVP |

### Recommendation

Based on validation results:

- [ ] **GO** - Proceed with Phase 1 implementation
- [ ] **CONDITIONAL GO** - Proceed with mitigations
- [ ] **NO-GO** - Critical validations failed

### Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineering | | | |
| Product | | | |
| Quality | | | |

---

*Update this document as each validation completes. All validations must pass (or have acceptable mitigations) before Phase 1 implementation begins.*
