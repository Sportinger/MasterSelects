# Lemonade Server Integration - Quality Review Document

**Document Type:** Quality Assurance Review
**Status:** Ready for Quality Gate Assessment
**Review Date:** 2026-03-15
**Reviewer:** Taylor Kim, Senior Quality Management Specialist
**Branch:** `lemonade-support`

---

## 1. Review Summary

### 1.1 Scope of Review

This quality review covers the proposed Lemonade Server integration into MasterSelects as a local AI provider for video editing assistance. The review evaluates:

- Technical accuracy of claims against Lemonade documentation
- Architecture alignment with existing service patterns
- Risk identification and mitigation strategies
- Quality gates for implementation phases
- Validation procedures and acceptance criteria

### 1.2 Documents Reviewed

| Document | Version | Review Status |
|----------|---------|---------------|
| Technical Analysis (`technical-analysis.md`) | 2026-03-15 | Validated |
| Lemonade Server GitHub Repository | Latest | Referenced |
| MasterSelects AI Architecture | Current | Validated |
| OpenAI API Specification | v1 | Reference Standard |

### 1.3 Key Findings Summary

| Category | Finding | Severity | Status |
|----------|---------|----------|--------|
| **API Compatibility** | OpenAI-compatible endpoints documented but not verified | HIGH | Requires Validation |
| **CORS Support** | Not confirmed in Lemonade documentation | CRITICAL | Mitigation Required |
| **Tool Calling** | OpenAI-style tool calling not confirmed | HIGH | Requires Validation |
| **Model Quality** | 1-4B models significantly below GPT-5/Claude capability | MEDIUM | Accepted with Fallback |
| **Server Lifecycle** | User friction for server management | MEDIUM | Mitigation Planned |
| **GPU Resource** | Memory exhaustion risk on integrated GPUs | MEDIUM | Monitoring Required |

### 1.4 Overall Quality Assessment

**Pre-Implementation Rating: CONDITIONAL APPROVAL**

The integration is technically feasible but requires validation of critical assumptions before proceeding to Phase 2 implementation. The hybrid provider model (Lemonade primary, cloud fallback) is the recommended approach to mitigate model quality concerns.

---

## 2. Technical Accuracy Validation

### 2.1 API Endpoint Claims

#### Claim: OpenAI-Compatible Chat Completions Endpoint

**Technical Analysis States:**
```
POST http://localhost:8000/api/v1/chat/completions
Authorization: Bearer lemonade
```

**Validation Status:** REQUIRES VERIFICATION

**Verification Procedure:**
```bash
# Test endpoint availability
curl -X POST http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"test"}]}' \
  -w "\nHTTP Status: %{http_code}\n"
```

**Expected Result:** HTTP 200 with OpenAI-compatible JSON response

**Actual Result:** PENDING - Server not yet deployed for validation

**Quality Gate:** Must pass before Phase 2

---

#### Claim: Whisper-Compatible Transcription Endpoint

**Technical Analysis States:**
```
POST http://localhost:8000/api/v1/audio/transcriptions
Content-Type: multipart/form-data
```

**Validation Status:** REQUIRES VERIFICATION

**Verification Procedure:**
```bash
# Test transcription endpoint
curl -X POST http://localhost:8000/api/v1/audio/transcriptions \
  -H "Authorization: Bearer lemonade" \
  -F "file=@test-audio.wav" \
  -F "model=whisper-1" \
  -F "language=en"
```

**Expected Result:** JSON response with `text` and `segments` fields

**Quality Gate:** Must pass before Phase 3 (STT Integration)

---

#### Claim: Models Endpoint for Discovery

**Technical Analysis States:**
```
GET http://localhost:8000/api/v1/models
```

**Validation Status:** REQUIRES VERIFICATION

**Verification Procedure:**
```bash
curl http://localhost:8000/api/v1/models \
  -H "Authorization: Bearer lemonade"
```

**Expected Result:** JSON with `data[]` array containing model objects with `id` field

---

### 2.2 Response Format Validation

#### OpenAI Compatibility Matrix

| Field | OpenAI Spec | Lemonade Claim | Verified |
|-------|-------------|----------------|----------|
| `id` | `chatcmpl-xxx` | `chatcmpl-xxx` | No |
| `object` | `chat.completion` | `chat.completion` | No |
| `created` | Unix timestamp | Unix timestamp | No |
| `model` | Model identifier | Model identifier | No |
| `choices[].message` | Message object | Message object | No |
| `choices[].finish_reason` | Enum | Enum | No |
| `usage` | Token counts | Token counts | No |

**Quality Gate:** All fields must match OpenAI specification for seamless integration

---

### 2.3 Model Specification Accuracy

#### Claimed Models vs. Availability

| Model | Claimed Format | Size | Verified Available |
|-------|----------------|------|---------------------|
| Gemma-3-4b-it-GGUF | GGUF | ~3.2 GB | PENDING |
| Llama-3-8B-Instruct-GGUF | GGUF | ~5.5 GB | PENDING |
| Qwen2.5-7B-Instruct-GGUF | GGUF | ~4.8 GB | PENDING |
| whisper-small | ONNX | ~244 MB | PENDING |
| whisper-medium | ONNX | ~769 MB | PENDING |

**Quality Concern:** Model availability depends on user download. Integration must handle missing models gracefully.

---

## 3. Architecture Review

### 3.1 Service Design Assessment

#### Pattern Alignment with Existing Services

| Aspect | claudeService | whisperService | lemonadeProvider | Alignment |
|--------|---------------|----------------|------------------|-----------|
| Singleton Pattern | Yes | Yes | Yes | Aligned |
| Lazy Loading | No | Yes | Yes | Aligned |
| HMR Handling | Not documented | Not documented | Specified | IMPROVED |
| Error Classification | Basic | Basic | Detailed | IMPROVED |
| Logger Usage | Yes | Yes | Yes | Aligned |

**Assessment:** The proposed `lemonadeProvider` design follows established patterns and improves on error handling documentation.

---

#### Stale Closure Prevention

**Technical Analysis Includes:**
```typescript
// CORRECT - use get() in callback
someAsyncOperation(() => {
  const fresh = get();
  set({ data: fresh.data });
});
```

**Assessment:** Pattern correctly documented per project Critical Patterns (Section 4).

---

### 3.2 Integration Point Assessment

#### AIChatPanel Modifications

**Proposed Changes:**
- Provider selector dropdown
- Model selector for Lemonade models
- Server status indicator
- Graceful fallback handling

**Quality Concerns:**

| Concern | Severity | Mitigation |
|---------|----------|------------|
| UI complexity increase | LOW | Clear visual separation of providers |
| Disabled state confusion | MEDIUM | Show clear "Offline" status |
| Model list management | MEDIUM | Auto-populate from server |

**Recommendation:** Implement `LemonadeStatus` component as separate UI element before integrating into `AIChatPanel`.

---

#### Settings Store Extensions

**Proposed Schema Changes:**
```typescript
// ApiKeyType extension
type ApiKeyType = ... | 'lemonade';

// APIKeys interface
lemonade: string;  // Stores base URL

// SettingsState
lemonadeEnabled: boolean;
lemonadeModel: string;
lemonadeProvider: 'llamacpp' | 'whispercpp' | 'auto';
lemonadeAutoFallback: boolean;
```

**Quality Assessment:** Schema changes are minimal and well-scoped. No conflicts with existing settings.

---

### 3.3 Data Flow Validation

#### Message Flow Analysis

```
User Input
    │
    ▼
buildAPIMessages()
    │
    ▼
Provider Selection
    ├─> OpenAI (existing)
    └─> Lemonade (new)
            │
            ▼
    lemonadeProvider.chat()
            │
            ▼
    Response with tool_calls
            │
            ▼
    executeAITool() ──> aiTools handlers
            │
            ▼
    Tool Result -> Display
```

**Quality Gates:**
1. Message format must be identical for both providers
2. Tool call parsing must handle provider-specific variations
3. Error messages must be provider-agnostic where possible

---

## 4. Risk Register

### 4.1 Comprehensive Risk List

| ID | Risk | Category | Severity | Likelihood | Impact | Mitigation Status |
|----|------|----------|----------|------------|--------|-------------------|
| R001 | CORS not supported by Lemonade Server | Technical | CRITICAL | MEDIUM | BLOCKING | Mitigation Planned |
| R002 | Tool calling not supported | Technical | HIGH | MEDIUM | HIGH | Fallback Strategy Defined |
| R003 | Model quality insufficient for complex tasks | Technical | MEDIUM | HIGH | MEDIUM | Hybrid Provider Model |
| R004 | Server offline causes user frustration | UX | MEDIUM | HIGH | MEDIUM | Auto-detection + Status UI |
| R005 | GPU memory exhaustion | Technical | MEDIUM | LOW | MEDIUM | Model size warnings |
| R006 | Invalid JSON response from model | Technical | HIGH | MEDIUM | HIGH | Error handling + fallback |
| R007 | Model not downloaded | Technical | HIGH | HIGH | HIGH | Download detection + guidance |
| R008 | Authentication token mismatch | Technical | LOW | LOW | LOW | Configurable token |
| R009 | Rate limiting on local server | Technical | LOW | LOW | LOW | Documented limitation |
| R010 | Browser compatibility issues | Technical | MEDIUM | LOW | MEDIUM | Testing required |
| R011 | Vite proxy complexity in dev | Technical | LOW | MEDIUM | LOW | Configuration documented |
| R012 | State mutation bugs (stale closure) | Technical | HIGH | LOW | HIGH | Pattern documented |

---

### 4.2 Critical Risk Detail - R001: CORS Support

**Risk Description:**
Browser security model blocks cross-origin requests from `localhost:5173` to `localhost:8000` without proper CORS headers.

**Validation Required:**
```bash
curl -X OPTIONS http://localhost:8000/api/v1/chat/completions \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -v 2>&1 | grep -i "access-control"
```

**Expected Headers:**
```
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

**Mitigation Strategies (in priority order):**

1. **Server-Side Configuration (Preferred)**
   - Configure Lemonade Server CORS middleware
   - Add allowed origins configuration

2. **Vite Development Proxy**
   ```typescript
   // vite.config.ts
   server: {
     proxy: {
       '/api/lemonade': {
         target: 'http://localhost:8000',
         rewrite: (path) => path.replace(/^\/api\/lemonade/, '/api/v1'),
         configure: (proxy) => {
           proxy.on('proxyRes', (proxyRes) => {
             proxyRes.headers['Access-Control-Allow-Origin'] = '*';
           });
         }
       }
     }
   }
   ```

3. **Browser Extension (Testing Only)**
   - Document CORS Unblock extension for development

**Quality Gate:** CORS must be confirmed working before Phase 1 completion

---

### 4.3 High Risk Detail - R002: Tool Calling Support

**Risk Description:**
Lemonade Server may not support OpenAI-style structured tool calling, breaking the AI editing workflow.

**Validation Required:**
```bash
curl -X POST http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Gemma-3-4b-it-GGUF",
    "messages": [{"role": "user", "content": "Split the clip at 5 seconds"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "splitClip",
        "parameters": {
          "type": "object",
          "properties": {
            "clipId": {"type": "string"},
            "time": {"type": "number"}
          },
          "required": ["clipId", "time"]
        }
      }
    }],
    "tool_choice": "auto"
  }'
```

**Expected Response:**
```json
{
  "choices": [{
    "message": {
      "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": {
          "name": "splitClip",
          "arguments": "{\"clipId\":\"clip-123\",\"time\":5}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

**Fallback Strategy (if tool calling not supported):**

1. **JSON Mode Prompt Engineering**
   ```typescript
   const JSON_MODE_SYSTEM = `You are a video editing assistant.
   Respond ONLY with valid JSON in this exact format:
   {"action": "tool_name", "params": {/* parameters */}}

   Available actions: ${Object.keys(toolRegistry).join(', ')}

   User request: {userMessage}`;
   ```

2. **Regex Extraction Fallback**
   ```typescript
   function extractToolCall(response: string): ToolCall | null {
     const jsonMatch = response.match(/\{[\s\S]*\}/);
     if (!jsonMatch) return null;
     try {
       return JSON.parse(jsonMatch[0]);
     } catch {
       return null;
     }
   }
   ```

3. **Cloud Fallback**
   - Auto-switch to OpenAI/Claude for complex editing requests
   - User notification when fallback occurs

**Quality Gate:** Tool calling capability must be validated before Phase 2

---

### 4.4 High Risk Detail - R007: Model Not Downloaded

**Risk Description:**
Lemonade Server requires manual model download. Users may attempt to use the integration without required models.

**Detection Strategy:**
```typescript
async function checkModelAvailability(model: string): Promise<boolean> {
  const models = await lemonadeProvider.getAvailableModels();
  return models.includes(model);
}
```

**User Experience Flow:**
```
User selects Lemonade provider
        │
        ▼
Check server connectivity ──FAIL──> Show "Server Offline" message
        │ PASS
        ▼
Check model availability ──FAIL──> Show "Model Not Downloaded" + download link
        │ PASS
        ▼
Ready for chat
```

**Mitigation:**
- Model availability check on provider selection
- Clear download instructions with direct links
- One-click model download script (Phase 4)

---

## 5. Quality Gates

### 5.1 Phase 1: Core Integration Gates

**Entry Criteria:**
- [ ] Development environment set up (Node.js, Vite working)
- [ ] Lemonade Server cloned and dependencies installed
- [ ] Test project created for integration testing

**Exit Criteria (Must ALL pass):**

| Gate ID | Validation | Expected Result | Status |
|---------|------------|-----------------|--------|
| G1.1 | `lemonadeProvider.ts` created with chat() method | File exists, compiles, passes lint | PENDING |
| G1.2 | `lemonadeService.ts` created with health check | File exists, compiles | PENDING |
| G1.3 | Settings store extended with Lemonade fields | No TypeScript errors, persists correctly | PENDING |
| G1.4 | API Key Manager updated | 'lemonade' type added, no breaking changes | PENDING |
| G1.5 | Provider toggle added to AIChatPanel | UI renders, state updates correctly | PENDING |
| G1.6 | Server status indicator implemented | Shows online/offline state | PENDING |
| G1.7 | Graceful fallback when offline | No crashes, user notified | PENDING |
| G1.8 | CORS validated working | Requests succeed from browser | PENDING |
| G1.9 | Basic chat completes successfully | Response received and displayed | PENDING |

**Phase 1 Sign-off:** Requires all gates passed + QA review approval

---

### 5.2 Phase 2: Validation Gates

**Entry Criteria:**
- [ ] Phase 1 complete and signed off
- [ ] Lemonade Server running with at least one model downloaded

**Exit Criteria (Must ALL pass):**

| Gate ID | Validation | Expected Result | Status |
|---------|------------|-----------------|--------|
| G2.1 | Tool calling capability test | Tool calls returned in response OR JSON mode documented | PENDING |
| G2.2 | Model quality baseline test | Success rate measured on 10 editing prompts | PENDING |
| G2.3 | Error handling validation | All error types handled gracefully | PENDING |
| G2.4 | Integration test suite passes | All unit and integration tests green | PENDING |
| G2.5 | Performance baseline measured | Response time < 30s for simple edits | PENDING |
| G2.6 | GPU memory impact assessed | No crash on integrated GPU systems | PENDING |

**Phase 2 Sign-off:** Requires all gates passed + technical review

---

### 5.3 Phase 3: STT Integration Gates

**Entry Criteria:**
- [ ] Phase 2 complete and signed off
- [ ] Whisper models available on Lemonade Server

**Exit Criteria (Must ALL pass):**

| Gate ID | Validation | Expected Result | Status |
|---------|------------|-----------------|--------|
| G3.1 | Transcription endpoint validated | Returns segments with timestamps | PENDING |
| G3.2 | whisperService extended | Provider selection works | PENDING |
| G3.3 | Transcription quality tested | WER (Word Error Rate) < 15% on test audio | PENDING |
| G3.4 | Large file handling validated | Files > 100MB process without crash | PENDING |

---

### 5.4 Phase 4: Polish Gates (Deferred)

**Entry Criteria:**
- [ ] Phases 1-3 complete
- [ ] User feedback collected from beta testing

**Exit Criteria:**

| Gate ID | Validation | Expected Result | Status |
|---------|------------|-----------------|--------|
| G4.1 | Auto-detection on startup | Server status checked at app launch | PENDING |
| G4.2 | One-click server start | Server launches from UI | PENDING |
| G4.3 | Model download UI | Download progress visible | PENDING |
| G4.4 | TTS integration (optional) | Text-to-speech functional | PENDING |

---

## 6. Validation Checklists

### 6.1 Server Connectivity Checklist

**Purpose:** Verify Lemonade Server is accessible and responding correctly

**Preconditions:**
- Lemonade Server running on `localhost:8000`
- At least one model downloaded

**Test Steps:**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | `curl http://localhost:8000/health` | HTTP 200, JSON response | [ ] |
| 2 | `curl http://localhost:8000/api/v1/models -H "Authorization: Bearer lemonade"` | HTTP 200, models array | [ ] |
| 3 | Browser fetch to `/api/v1/models` from `localhost:5173` | No CORS error, data returned | [ ] |
| 4 | OPTIONS preflight request | CORS headers present | [ ] |
| 5 | Server offline simulation | Connection error handled gracefully | [ ] |

**Completion Criteria:** All steps pass

---

### 6.2 Chat Completion Checklist

**Purpose:** Verify chat functionality with and without tool calling

**Preconditions:**
- Server connectivity verified (Section 6.1)
- Gemma-3-4b-it-GGUF model available

**Test Steps:**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Send simple message "Hello" | Response received within 10s | [ ] |
| 2 | Send editing command "Split the clip" | Relevant response or tool call | [ ] |
| 3 | Send with tools parameter | Tool calls in response OR JSON output | [ ] |
| 4 | Send malformed request | Error handled, no crash | [ ] |
| 5 | Send during server restart | Timeout error, fallback offered | [ ] |
| 6 | Verify token usage reported | Usage object in response | [ ] |
| 7 | Test with max_tokens=10 | Response truncated appropriately | [ ] |
| 8 | Test temperature variations | Response varies with temperature | [ ] |

**Completion Criteria:** Steps 1-5 pass; Steps 6-8 informational

---

### 6.3 Tool Execution Checklist

**Purpose:** Verify tool calling and execution workflow

**Preconditions:**
- Chat completion working (Section 6.2)
- aiTools service loaded with test tools

**Test Steps:**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Request "Create a new video track" | createVideoTrack tool called | [ ] |
| 2 | Request "Delete selected clip" | deleteClip tool called | [ ] |
| 3 | Request "Split at 5 seconds" | splitClip tool called with time=5 | [ ] |
| 4 | Verify tool result displayed | Result shown in chat | [ ] |
| 5 | Verify timeline updated | Timeline state reflects change | [ ] |
| 6 | Test invalid tool arguments | Error caught, user notified | [ ] |
| 7 | Test missing tool handler | Graceful error, no crash | [ ] |
| 8 | Test batch tool calls | Multiple tools execute correctly | [ ] |

**Completion Criteria:** All steps pass

---

### 6.4 Error Handling Checklist

**Purpose:** Verify all error conditions are handled gracefully

**Test Steps:**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Stop Lemonade Server | "Server offline" message shown | [ ] |
| 2 | Disconnect network (WiFi off) | Appropriate error message | [ ] |
| 3 | Send request during server restart | Timeout error after 60s | [ ] |
| 4 | Request with invalid model name | "Model not found" error | [ ] |
| 5 | Send request that returns 500 | Error logged, user notified | [ ] |
| 6 | Trigger rate limit (rapid requests) | Rate limit error handled | [ ] |
| 7 | Send invalid JSON in tool args | Parse error caught | [ ] |
| 8 | Exhaust GPU memory (if possible) | OOM error, fallback offered | [ ] |

**Completion Criteria:** All error conditions show user-friendly messages; no crashes

---

### 6.5 UI Integration Checklist

**Purpose:** Verify user interface changes work correctly

**Test Steps:**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Open AIChatPanel | Panel renders without errors | [ ] |
| 2 | Click provider selector | Dropdown shows OpenAI and Lemonade | [ ] |
| 3 | Select Lemonade when offline | Shows "(Offline)" status | [ ] |
| 4 | Select Lemonade when online | Provider switches, status green | [ ] |
| 5 | Change model selector | Selected model updates | [ ] |
| 6 | View server status indicator | Shows current connection state | [ ] |
| 7 | Send message while loading | Loading state shown, input disabled | [ ] |
| 8 | Verify error toast/notification | Errors visible to user | [ ] |
| 9 | Test keyboard navigation | All controls accessible | [ ] |
| 10 | Verify responsive layout | UI works at different sizes | [ ] |

**Completion Criteria:** All steps pass; no visual regressions

---

### 6.6 Settings Persistence Checklist

**Purpose:** Verify settings are saved and restored correctly

**Test Steps:**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1 | Enable Lemonade provider | Setting saved to localStorage | [ ] |
| 2 | Select Lemonade model | Model preference persisted | [ ] |
| 3 | Refresh browser | Settings restored | [ ] |
| 4 | Change Lemonade settings | Changes persist across sessions | [ ] |
| 5 | Clear unrelated settings | Lemonade settings unaffected | [ ] |
| 6 | Export/import project settings | Lemonade config included | [ ] |

**Completion Criteria:** All settings persist correctly across sessions

---

## 7. Edge Cases

### 7.1 Server-Related Edge Cases

| ID | Scenario | Expected Behavior | Handling |
|----|----------|-------------------|----------|
| E001 | Server down at app startup | Show offline indicator, disable Lemonade option | Auto-detection |
| E002 | Server crashes mid-request | Timeout error, offer retry or fallback | 60s timeout |
| E003 | Server restarts during session | Reconnection attempt on next request | Health check |
| E004 | Multiple server instances | Connect to configured port only | Fixed URL |
| E005 | Server on non-standard port | User-configurable base URL | Settings field |

---

### 7.2 Model-Related Edge Cases

| ID | Scenario | Expected Behavior | Handling |
|----|----------|-------------------|----------|
| E006 | Selected model not downloaded | Show download prompt with link | Model check on select |
| E007 | Model download fails | Show error, suggest alternative | Fallback model list |
| E008 | Model too large for GPU | Warning before selection | VRAM detection |
| E009 | Model produces malformed output | Parse error, retry or fallback | JSON validation |
| E010 | Model returns empty response | Show "No response" message | Empty check |
| E011 | Model hallucinates tool names | "Unknown tool" error | Tool registry validation |

---

### 7.3 Resource-Related Edge Cases

| ID | Scenario | Expected Behavior | Handling |
|----|----------|-------------------|----------|
| E012 | GPU memory exhausted | OOM error, suggest smaller model | Memory monitoring |
| E013 | System sleep during processing | Resume or error on wake | Session recovery |
| E014 | Disk space low | Warning before large downloads | Space check |
| E015 | High CPU usage | Throttle requests | Rate limiting |

---

### 7.4 User Behavior Edge Cases

| ID | Scenario | Expected Behavior | Handling |
|----|----------|-------------------|----------|
| E016 | Rapid repeated requests | Queue or rate limit | Request debouncing |
| E017 | Very long message (>4096 tokens) | Truncate or reject with guidance | Token counting |
| E018 | Copy-paste binary data | Reject as invalid input | Input validation |
| E019 | Multiple browser tabs | Shared connection state | Cross-tab sync |
| E020 | Browser extension conflicts | Workarounds documented | Compatibility testing |

---

### 7.5 Integration Edge Cases

| ID | Scenario | Expected Behavior | Handling |
|----|----------|-------------------|----------|
| E021 | aiTools not initialized | Queue requests or error | Dependency check |
| E022 | Timeline empty during editor mode | Inform user, offer to create | Context validation |
| E023 | Tool execution fails mid-batch | Partial success with error report | Transaction handling |
| E024 | Settings corrupted | Reset to defaults, notify user | Schema validation |
| E025 | HMR during active request | Preserve connection state | HMR singleton pattern |

---

## 8. Go/No-Go Criteria

### 8.1 Decision Framework

```
                    ┌─────────────────────────┐
                    │   Start Integration     │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │   Phase 1 Complete?     │
                    │   (All Gates Passed)    │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │ NO              │ YES             │
              │                 │                 │
              ▼                 ▼                 ▼
    ┌─────────────────┐ ┌───────────────┐ ┌───────────────┐
    │   Address       │ │ Phase 2       │ │ Proceed to    │
    │   Blockers      │ │ Validation    │ │ Phase 2       │
    └─────────────────┘ └───────────────┘ └───────────────┘
```

---

### 8.2 Phase 1 Go/No-Go Criteria

**GO Criteria (ALL required):**
- [ ] G1.1-G1.9 all passed
- [ ] No CRITICAL bugs open
- [ ] CORS confirmed working
- [ ] Basic chat functional
- [ ] No data loss scenarios

**NO-GO Criteria (ANY triggers no-go):**
- [ ] CORS not resolvable
- [ ] Server unreachable from browser
- [ ] TypeScript compilation fails
- [ ] State management causes crashes
- [ ] Settings persistence broken

**Conditional GO (proceed with caution):**
- [ ] Tool calling not confirmed (proceed with JSON fallback)
- [ ] Model quality unknown (proceed with hybrid model)
- [ ] Minor UI polish needed (defer to Phase 4)

---

### 8.3 Phase 2 Go/No-Go Criteria

**GO Criteria (ALL required):**
- [ ] G2.1-G2.6 all passed
- [ ] Tool calling validated OR fallback implemented
- [ ] Model quality baseline acceptable for simple edits (>70% success)
- [ ] All error conditions handled
- [ ] Performance within acceptable range

**NO-GO Criteria (ANY triggers no-go):**
- [ ] Tool calling AND JSON fallback both fail
- [ ] Model cannot handle basic editing commands
- [ ] Unhandled crash scenarios remain
- [ ] Performance unacceptable (>60s response time)

---

### 8.4 Production Release Criteria

**Required for Release:**
- [ ] All Phases 1-3 complete
- [ ] No CRITICAL or HIGH bugs open
- [ ] Documentation complete
- [ ] User testing feedback incorporated
- [ ] Rollback procedure documented

**Recommended (not blocking):**
- [ ] Phase 4 features implemented
- [ ] TTS integration complete
- [ ] One-click server start working

---

## 9. Quality Metrics

### 9.1 Target Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Tool Call Accuracy | >85% | Test suite execution |
| Simple Edit Success Rate | >70% | 10-prompt baseline test |
| Complex Edit Success Rate | >40% | 10-prompt baseline test |
| Error Recovery Rate | 100% | All errors handled gracefully |
| Response Time (simple) | <30s | End-to-end timing |
| Response Time (complex) | <60s | End-to-end timing |
| Crash Rate | 0% | Integration testing |
| Settings Persistence | 100% | Cross-session testing |

### 9.2 Measurement Procedures

#### Tool Call Accuracy Test

```typescript
const TEST_CASES = [
  { input: "Split at 5 seconds", expectedTool: "splitClip", expectedParams: { time: 5 } },
  { input: "Delete this clip", expectedTool: "deleteClip" },
  { input: "Add a video track", expectedTool: "createVideoTrack" },
  // ... 10+ test cases
];

let passed = 0;
for (const test of TEST_CASES) {
  const result = await lemonadeProvider.chat([
    { role: "user", content: test.input }
  ], { tools: AI_TOOLS });

  if (result.toolCalls?.[0]?.name === test.expectedTool) {
    passed++;
  }
}

const accuracy = passed / TEST_CASES.length;
console.log(`Tool Call Accuracy: ${accuracy * 100}%`);
```

#### Model Quality Baseline Test

```typescript
const EDITING_PROMPTS = [
  "Split the clip at 5 seconds",
  "Delete the selected clip",
  "Trim from 10s to 30s",
  "Create a new video track",
  "Move clip to track 2",
  "Duplicate the clip",
  "Add a transition",
  "Mute the audio",
  "Speed up to 2x",
  "Reverse the clip"
];

const EXPECTED_ACTIONS = [
  { tool: "splitClip", params: { time: 5 } },
  { tool: "deleteClip" },
  { tool: "trimClip", params: { start: 10, end: 30 } },
  // ...
];

let successCount = 0;
for (let i = 0; i < EDITING_PROMPTS.length; i++) {
  const result = await evaluatePrompt(EDITING_PROMPTS[i], EXPECTED_ACTIONS[i]);
  if (result.success) successCount++;
}

const successRate = (successCount / EDITING_PROMPTS.length) * 100;
```

---

## 10. Document Approval

### 10.1 Review Signatures

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Quality Reviewer | Taylor Kim | 2026-03-15 | [Quality Review Complete] |
| Technical Lead | [Pending] | [Pending] | [Pending] |
| Product Owner | [Pending] | [Pending] | [Pending] |

### 10.2 Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-03-15 | Taylor Kim | Initial quality review document |

---

## 11. Appendices

### Appendix A: Quick Reference Commands

```bash
# CORS validation
curl -X OPTIONS http://localhost:8000/api/v1/chat/completions \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" -v

# Tool calling test
curl -X POST http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{"model":"Gemma-3-4b-it-GGUF","messages":[{"role":"user","content":"Split clip at 5s"}],"tools":[{"type":"function","function":{"name":"splitClip","parameters":{"type":"object","properties":{"time":{"type":"number"}}}}]}'

# Model availability
curl http://localhost:8000/api/v1/models -H "Authorization: Bearer lemonade"

# Health check
curl http://localhost:8000/health
```

### Appendix B: Test Data Files

| File | Purpose | Location |
|------|---------|----------|
| `test-audio.wav` | Transcription testing | `tests/fixtures/` |
| `editing-prompts.json` | Model quality baseline | `tests/fixtures/` |
| `expected-tool-calls.json` | Tool call validation | `tests/fixtures/` |

---

**Document End**

*This quality review document establishes the framework for Lemonade Server integration validation. All quality gates must pass before proceeding to the next implementation phase.*
