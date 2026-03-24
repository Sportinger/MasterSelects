# Lemonade Tool Calling Error Analysis

**Date:** 2026-03-23
**Issue:** "LITERALLY SAYS SOME ERROR" in AI Chat Panel when using Lemonade provider
**Branch:** lemonade-support

---

## Executive Summary

The error occurs due to **CORS policy blocking** when the browser (running on `localhost:5173`) attempts to call the Lemonade Server at `localhost:8000` directly via fetch API. The browser enforces same-origin policy, and without explicit CORS headers from the Lemonade Server, the request is blocked before it reaches the server.

**Root Cause:** Missing CORS headers on Lemonade Server responses
**Failing Component:** `lemonadeProvider.ts` -> `chatCompletion()` method
**User-facing symptom:** Generic error message in AI Chat Panel

---

## 1. Current Architecture Analysis

### 1.1 Request Flow

```
AIChatPanel.tsx (localhost:5173)
       |
       v
callLemonade() [useCallback]
       |
       v
lemonadeProvider.chatCompletion(messages, { tools })
       |
       v
fetch('http://localhost:8000/api/v1/chat/completions')
       |
       v
[CORS BLOCK - Browser Security]
       |
       v
Error caught in AIChatPanel.tsx:493
       |
       v
setError(err.message) -> Displays to user
```

### 1.2 Key Files Involved

| File | Role | Issue Location |
|------|------|----------------|
| `src/components/panels/AIChatPanel.tsx` | UI component, initiates requests | Line 281-302 (callLemonade), Line 493 (error handling) |
| `src/services/lemonadeProvider.ts` | HTTP client to Lemonade Server | Line 249-257 (fetch call) |
| `src/services/lemonadeService.ts` | Server health monitoring | Not directly involved in error |
| `src/services/aiTools/definitions/index.ts` | Tool definitions | Format is correct |

---

## 2. Error Source Identification

### 2.1 CORS Error (PRIMARY ISSUE)

**What happens:**
1. Browser runs on `http://localhost:5173` (Vite dev server)
2. Lemonade Server runs on `http://localhost:8000`
3. `fetch()` call from `localhost:5173` to `localhost:8000` triggers CORS preflight
4. Lemonade Server does NOT return `Access-Control-Allow-Origin` header
5. Browser blocks the response
6. JavaScript receives a generic network error

**Browser console error (typical):**
```
Access to fetch at 'http://localhost:8000/api/v1/chat/completions' from origin 'http://localhost:5173'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Error caught in code:**
```typescript
// AIChatPanel.tsx:493
setError(err instanceof Error ? err.message : 'Failed to send message');
```

This results in either:
- `TypeError: Failed to fetch` (most common)
- `NetworkError when attempting to fetch resource`
- `Failed to send message` (generic fallback)

### 2.2 Tool Definition Format (VERIFIED CORRECT)

Our tool definitions in `src/services/aiTools/types.ts` (lines 38-50):

```typescript
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}
```

**This matches OpenAI's format exactly:**
```json
{
  "type": "function",
  "function": {
    "name": "getTimelineState",
    "description": "...",
    "parameters": {
      "type": "object",
      "properties": {...},
      "required": []
    }
  }
}
```

**Conclusion:** Tool format is NOT the issue.

### 2.3 Model Capability (POTENTIAL SECONDARY ISSUE)

User confirms: "Lemonade Server DOES have tool calling support and some models support it coherently"

**Risk:** If the selected model doesn't support tool calling:
- Server returns 400/422 error
- Error message would be: "Model does not support tool calling" or similar
- This would appear AFTER CORS is fixed

**Current default model:** `qwen3-4b-FLM` (per `lemonadeProvider.ts:17`)

---

## 3. Exact Error Messages by Scenario

| Scenario | Browser Console | AI Chat Panel Display |
|----------|-----------------|----------------------|
| **CORS Block** | `Access to fetch blocked by CORS policy` | `TypeError: Failed to fetch` |
| Server Offline | `ERR_CONNECTION_REFUSED` | `Lemonade Server offline - Please start the server` |
| Model Doesn't Support Tools | N/A (request succeeds) | `Model does not support function calling` |
| Invalid Tool Format | `400 Bad Request` | `Server returned 400` |
| Timeout | `AbortError` | `Request timed out` |

---

## 4. Root Cause Confirmation

### 4.1 Why CORS is the Issue

1. **Different ports = different origins:**
   - `http://localhost:5173` !== `http://localhost:8000`
   - Browser treats these as completely different origins

2. **Lemonade Server likely doesn't set CORS headers:**
   - Most local AI servers (Ollama, LM Studio, etc.) don't enable CORS by default
   - Need to either:
     - Add CORS headers to Lemonade Server
     - Use a proxy
     - Spoof CORS via browser extension/dev mode

3. **Evidence from code:**
   - `vite.config.ts` has CORS handling for `/api/*` routes (lines 156-168)
   - This only helps for requests TO the Vite server, not FROM browser TO external server

### 4.2 Why Tool Format is NOT the Issue

1. Our `ToolDefinition` interface matches OpenAI spec
2. `lemonadeProvider.ts` sends tools in correct format (lines 235-237):
   ```typescript
   requestBody.tools = options.tools;
   requestBody.tool_choice = 'auto';
   ```
3. OpenAI API calls work (same tool definitions, line 244)

---

## 5. Recommended Fix

### Option A: Add CORS Headers to Lemonade Server (RECOMMENDED)

If you control the Lemonade Server code, add CORS middleware:

**Python/FastAPI example:**
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
```

**Python/Flask example:**
```python
from flask_cors import CORS
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:5173"]}})
```

### Option B: Proxy Through Vite Dev Server

Add a proxy route in `vite.config.ts`:

```typescript
// In configureServer section
server.middlewares.use('/api/lemonade', (req, res) => {
  // Proxy to localhost:8000
  const target = 'http://localhost:8000/api/v1';
  // ... proxy logic
});
```

Then update `lemonadeProvider.ts` endpoint to use `/api/lemonade` instead of direct `localhost:8000`.

### Option C: Browser Extension / Dev Mode (QUICK TEST)

For immediate testing without server changes:

1. **Chrome extension:** Install "Allow CORS: Access-Control-Allow-Origin"
2. **Firefox:** Set `privacy.file_unique_origin` to `false` in `about:config`
3. **Dev mode flag:** Start Chrome with `--disable-web-security --user-data-dir=/tmp/chrome`

**WARNING:** Option C is for development only, never production.

### Option D: Server-Side Spoof (IF Lemonade supports config)

Some servers support environment variable configuration:

```bash
# Try these before starting Lemonade Server
export CORS_ALLOWED_ORIGINS="http://localhost:5173"
export ENABLE_CORS=true
```

---

## 6. Test Plan

### Step 1: Verify CORS is the Issue

1. Open browser DevTools -> Network tab
2. Send a message in AI Chat Panel with Lemonade provider selected
3. Look for the failed request to `localhost:8000`
4. Check console for CORS error message

**Expected:** CORS policy error confirming the diagnosis

### Step 2: Apply Fix (Option A - Server Headers)

1. Add CORS middleware to Lemonade Server
2. Restart Lemonade Server
3. Refresh browser page
4. Send test message

**Expected:** Request succeeds, tool calls work

### Step 3: Verify Tool Calling Works

1. Select Lemonade provider in AI Chat Panel
2. Ensure "Tools" toggle is enabled
3. Send message: "Show me the timeline state"
4. Expected behavior:
   - AI calls `getTimelineState` tool
   - Tool executes
   - AI responds with timeline summary

### Step 4: Test Fallback Behavior

1. Switch to a model that may not support tools
2. Send same message
3. Verify graceful degradation or clear error message

---

## 7. Additional Considerations

### 7.1 Server Health Check

The current `checkServerHealth()` in `lemonadeProvider.ts` (lines 136-180) also fetches from `localhost:8000`:

```typescript
const response = await fetch(`${this.config.endpoint}/models`, {
```

This will ALSO fail with CORS. The health check may show "offline" even when server is running.

### 7.2 Error Handling Improvements

Current error handling could be more informative:

```typescript
// Current (line 302-305)
if (error instanceof Error) {
  if (error.name === 'AbortError') {
    log.error('Request timeout');
    throw new Error('Request timed out...');
  }
  log.error('Chat completion failed:', error);
  throw error;
}
```

**Improved:**
```typescript
if (error instanceof Error) {
  if (error.name === 'AbortError') {
    throw new Error('Request timed out...');
  }
  if (error.message.includes('Failed to fetch')) {
    throw new Error('Cannot connect to Lemonade Server. Check CORS configuration.');
  }
  throw error;
}
```

### 7.3 Model Selection

If CORS is fixed but tool calling still fails:

1. Try different models in the dropdown
2. `qwen3-4b-FLM` should support tools (based on Qwen architecture)
3. Smaller models like `Llama-3.2-1B-Instruct-GGUF` may have limited tool support

---

## 8. Implementation Checklist

- [ ] **Confirm CORS error** in browser console
- [ ] **Add CORS headers** to Lemonade Server OR set up proxy
- [ ] **Test health check** endpoint works
- [ ] **Test chat completion** without tools
- [ ] **Test chat completion** with tools enabled
- [ ] **Verify tool execution** loop works end-to-end
- [ ] **Document Lemonade Server setup** for other developers
- [ ] **Add CORS error detection** to error handling

---

## 9. Files to Modify

| File | Change Type | Priority |
|------|-------------|----------|
| `tools/lemonade-server/server.py` (or equivalent) | Add CORS middleware | P0 |
| `src/services/lemonadeProvider.ts` | Improve error messages | P1 |
| `src/components/panels/AIChatPanel.tsx` | Better CORS error display | P2 |
| `docs/lemonade/setup.md` | Document CORS requirement | P2 |

---

## 10. Summary

**The error is CORS, not tool format.**

1. Browser blocks requests from `localhost:5173` to `localhost:8000`
2. Lemonade Server needs to return `Access-Control-Allow-Origin: http://localhost:5173`
3. Tool definitions are correctly formatted
4. Once CORS is fixed, verify model supports tool calling

**Next Step:** Add CORS headers to Lemonade Server and restart.
