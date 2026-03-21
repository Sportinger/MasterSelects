# Lemonade Server Integration - Technical Analysis

**Document Type:** Technical Reference
**Status:** Ready for Implementation
**Last Updated:** 2026-03-15
**Branch:** `lemonade-support`

---

## 1. Executive Summary

### Integration Feasibility Assessment

Lemonade Server is **feasible to integrate** into MasterSelects as a local AI provider. The integration leverages existing OpenAI-compatible patterns in the codebase and follows established service architectures.

### Key Findings

| Aspect | Assessment | Notes |
|--------|------------|-------|
| **API Compatibility** | HIGH | OpenAI-compatible `/api/v1/chat/completions` endpoint |
| **Architecture Fit** | HIGH | Matches existing `claudeService` / `whisperService` patterns |
| **Implementation Effort** | MEDIUM | ~500-700 lines of new code across 4-6 files |
| **Risk Level** | MEDIUM | CORS and tool calling require validation |
| **Model Quality** | VARIABLE | 1-4B models suitable for simple edits; complex tasks may need cloud fallback |

### Recommended Approach

**Hybrid Provider Model:**
- Primary: Lemonade for routine editing tasks (fast, free, offline)
- Fallback: OpenAI/Claude for complex reasoning and tool-heavy operations
- User-controlled via provider toggle in AIChatPanel

---

## 2. Lemonade Server Capabilities

### 2.1 Server Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Lemonade Server                               │
│  c:/users/antmi/lemonade                                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  API Gateway (FastAPI)                                      │ │
│  │  POST /api/v1/chat/completions  (OpenAI-compatible)        │ │
│  │  POST /api/v1/audio/transcriptions  (Whisper-compatible)   │ │
│  │  GET  /api/v1/models                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐ │
│  │  llamacpp    │  whispercpp  │  Kokoro TTS  │  SD-CPP      │ │
│  │  (LLM)       │  (STT)       │  (TTS)       │  (Image)     │ │
│  │  Vulkan/NPU  │  NPU/CPU     │  CPU         │  ROCm/CPU    │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP POST
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MasterSelects                                 │
│  src/services/lemonadeProvider.ts                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Supported Modalities

| Modality | Backend | API Endpoint | Priority |
|----------|---------|--------------|----------|
| **Text Generation** | llamacpp | `/api/v1/chat/completions` | HIGH |
| **Speech-to-Text** | whispercpp | `/api/v1/audio/transcriptions` | HIGH |
| **Text-to-Speech** | Kokoro | `/api/v1/audio/speech` | LOW (deferred) |
| **Image Generation** | SD-CPP | `/api/v1/images/generations` | LOW (deferred) |

### 2.3 API Endpoint Specification

#### Chat Completions (LLM)

```
POST http://localhost:8000/api/v1/chat/completions
Authorization: Bearer lemonade
Content-Type: application/json
```

**Request Body:**
```json
{
  "model": "Gemma-3-4b-it-GGUF",
  "messages": [
    {"role": "system", "content": "You are a video editing assistant..."},
    {"role": "user", "content": "Split the clip at 5 seconds"}
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "tools": [
    {
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
    }
  ],
  "tool_choice": "auto"
}
```

**Response Body:**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "Gemma-3-4b-it-GGUF",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'll split the clip at 5 seconds.",
        "tool_calls": [
          {
            "id": "call_abc",
            "type": "function",
            "function": {
              "name": "splitClip",
              "arguments": "{\"clipId\":\"clip-123\",\"time\":5}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 25,
    "total_tokens": 175
  }
}
```

#### Audio Transcriptions (STT)

```
POST http://localhost:8000/api/v1/audio/transcriptions
Authorization: Bearer lemonade
Content-Type: multipart/form-data
```

**Request Body:**
```
FormData {
  file: File (audio/wav, audio/mp4, etc.)
  model: "whisper-1"
  language: "en"
  response_format: "verbose_json"
  timestamp_granularities: ["segment"]
}
```

**Response Body:**
```json
{
  "text": "Hello, this is a test transcription.",
  "segments": [
    {
      "start": 0.0,
      "end": 3.5,
      "text": "Hello, this is a test transcription."
    }
  ]
}
```

### 2.4 Model Formats

| Format | Support | Notes |
|--------|---------|-------|
| **GGUF** | PRIMARY | Recommended for llamacpp backend |
| **ONNX** | Supported | For whispercpp models |
| **Safetensors** | Limited | Image generation only |

**Recommended Models:**
- **LLM:** `Gemma-3-4b-it-GGUF`, `Llama-3-8B-Instruct-GGUF`, `Qwen2.5-7B-Instruct-GGUF`
- **STT:** `whisper-small`, `whisper-medium` (ONNX quantized)

---

## 3. MasterSelects AI Architecture

### 3.1 Current AI Services

```
┌─────────────────────────────────────────────────────────────────┐
│                    AIChatPanel.tsx                               │
│  - Model selector (OpenAI models)                               │
│  - Editor mode toggle                                           │
│  - Chat message display                                         │
│  - Tool execution indicators                                    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  aiTools Service                                 │
│  /src/services/aiTools/                                          │
│  - 76 tools across 15 categories                                │
│  - executeAITool(toolName, args) -> ToolResult                 │
│  - MODIFYING_TOOLS set for history tracking                     │
│  - Batch execution support (executeBatch)                       │
└─────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   claudeService  │ │  whisperService  │ │   piApiService   │
│   (EDL gen)      │ │  (transcription) │ │   (AI video)     │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### 3.2 Service Pattern Analysis

**claudeService Pattern:**
```typescript
// Singleton class with API endpoint
class ClaudeService {
  private apiEndpoint = 'https://api.anthropic.com/v1/messages';

  async generateEDL(params: GenerateEDLParams): Promise<EditDecision[]> {
    const apiKey = await apiKeyManager.getKey();
    // ... build prompt, fetch API, parse response
  }
}

export const claudeService = new ClaudeService();
```

**whisperService Pattern:**
```typescript
// Singleton with lazy model loading
class WhisperService {
  private pipeline: any = null;
  private isLoading = false;

  private async loadModel(): Promise<void> { /* ... */ }
  async transcribe(mediaFileId: string): Promise<TranscriptEntry[]> { /* ... */ }
  isModelLoaded(): boolean { /* ... */ }
}

export const whisperService = new WhisperService();
```

**aiTools Pattern:**
```typescript
// Modular handlers with type safety
export async function executeAITool(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  // History tracking, error handling, execution state
}
```

### 3.3 Settings Store Integration

```typescript
// /src/stores/settingsStore.ts
interface APIKeys {
  openai: string;
  assemblyai: string;
  deepgram: string;
  piapi: string;
  youtube: string;
  // ADD:
  lemonade: string;  // Base URL (default: "http://localhost:8000/api/v1")
}

interface SettingsState {
  // ADD:
  lemonadeEnabled: boolean;
  lemonadeModel: string;
  lemonadeProvider: 'llamacpp' | 'whispercpp';
}
```

### 3.4 Logger Usage

All services use the centralized `Logger` service:
```typescript
import { Logger } from '../services/logger';
const log = Logger.create('LemonadeProvider');

log.debug('Request sent', { url, model });
log.info('Response received', { tokens, latency });
log.warn('Fallback activated', { reason });
log.error('Request failed', error);
```

---

## 4. Integration Points

### 4.1 Primary Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AIChatPanel.tsx                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Provider Selector:  [OpenAI ▼] [Lemonade ▼]                │ │
│  │ Model Selector:     [gpt-5.1 ▼] [Gemma-3-4b-it ▼]          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
┌──────────────────┐                  ┌──────────────────┐
│  OpenAI Provider │                  │  LemonadeProvider │
│  (existing)      │                  │  (new)            │
│  - api.openai.com│                  │  - localhost:8000 │
│  - Full tools    │                  │  - Tool support? │
└──────────────────┘                  └──────────────────┘
```

### 4.2 Integration Points by Component

| Component | File | Change Type | Description |
|-----------|------|-------------|-------------|
| **AIChatPanel** | `src/components/panels/AIChatPanel.tsx` | MODIFY | Add provider toggle, Lemonade model selector |
| **Settings Store** | `src/stores/settingsStore.ts` | MODIFY | Add Lemonade settings, API key type |
| **API Key Manager** | `src/services/apiKeyManager.ts` | MODIFY | Add 'lemonade' to ApiKeyType |
| **aiTools Bridge** | `src/services/aiTools/bridge.ts` | CREATE | Optional: unified provider abstraction |
| **Lemonade Provider** | `src/services/lemonadeProvider.ts` | CREATE | Main service class |
| **Lemonade Service** | `src/services/lemonadeService.ts` | CREATE | Server management wrapper |

### 4.3 Data Flow

```
User Input (AIChatPanel)
    │
    ▼
buildAPIMessages() ──> Includes timeline context if editorMode
    │
    ▼
Provider Selection ──> OpenAI or Lemonade
    │
    ├─> OpenAI: callOpenAI() -> api.openai.com/v1/chat/completions
    │
    └─> Lemonade: lemonadeProvider.chat() -> localhost:8000/api/v1/chat/completions
            │
            ▼
    Response with tool_calls
            │
            ▼
    executeAITool(toolName, args) ──> aiTools handlers
            │
            ▼
    Tool Result -> setMessages() -> Display
```

---

## 5. Service Design

### 5.1 LemonadeProvider Class

```typescript
// /src/services/lemonadeProvider.ts
import { Logger } from './logger';
import { apiKeyManager } from './apiKeyManager';
import type { ToolDefinition, ToolResult } from './aiTools/types';

const log = Logger.create('LemonadeProvider');

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class LemonadeProvider {
  private baseUrl: string = 'http://localhost:8000/api/v1';
  private apiKey: string = 'lemonade';  // Default auth token
  private isOnline: boolean = false;
  private availableModels: string[] = [];

  /**
   * Check server connectivity
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (response.ok) {
        const data = await response.json();
        this.availableModels = data.data?.map((m: any) => m.id) || [];
        this.isOnline = true;
        log.info('Lemonade Server connected', { models: this.availableModels });
        return true;
      }
      this.isOnline = false;
      return false;
    } catch {
      this.isOnline = false;
      log.warn('Lemonade Server offline');
      return false;
    }
  }

  /**
   * Send chat completion request
   */
  async chat(
    messages: ChatMessage[],
    options: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
      tools?: ToolDefinition[];
      toolChoice?: 'auto' | 'none' | 'required';
    } = {}
  ): Promise<{
    content: string | null;
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }> {
    if (!this.isOnline) {
      await this.checkConnection();
      if (!this.isOnline) {
        throw new Error('Lemonade Server is offline. Please start the server.');
      }
    }

    const model = options.model || this.availableModels[0] || 'Gemma-3-4b-it-GGUF';

    log.debug('Sending chat request', { model, messages: messages.length });

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice ?? 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error(`API error: ${response.status}`, errorBody);

      if (response.status === 401) {
        throw new Error('Lemonade authentication failed');
      } else if (response.status === 429) {
        throw new Error('Lemonade Server rate limited');
      } else if (response.status >= 500) {
        throw new Error('Lemonade Server error');
      } else {
        throw new Error(`Lemonade API error: ${response.status}`);
      }
    }

    const data: ChatCompletionResponse = await response.json();
    const choice = data.choices?.[0];

    const toolCalls = (choice?.message?.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    log.info('Chat response received', {
      toolCalls: toolCalls.length,
      usage: data.usage,
    });

    return {
      content: choice?.message?.content || null,
      toolCalls,
      usage: data.usage,
    };
  }

  /**
   * Transcribe audio file
   */
  async transcribe(
    audioBlob: Blob,
    options: {
      model?: string;
      language?: string;
    } = {}
  ): Promise<{
    text: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }> {
    const formData = new FormData();
    formData.append('file', audioBlob);
    formData.append('model', options.model || 'whisper-1');
    formData.append('language', options.language || 'en');
    formData.append('response_format', 'verbose_json');

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error(`Transcription error: ${response.status}`, errorBody);
      throw new Error('Transcription failed');
    }

    const data = await response.json();
    return {
      text: data.text,
      segments: data.segments || [],
    };
  }

  /**
   * Get available models
   */
  getModels(): string[] {
    return [...this.availableModels];
  }

  /**
   * Check if server is online
   */
  isServerOnline(): boolean {
    return this.isOnline;
  }
}

// Singleton instance
export const lemonadeProvider = new LemonadeProvider();
```

### 5.2 LemonadeService (Server Management)

```typescript
// /src/services/lemonadeService.ts
import { Logger } from './logger';

const log = Logger.create('LemonadeService');

interface ServerConfig {
  port: number;
  host: string;
  models: string[];
  backends: {
    llm: boolean;
    stt: boolean;
    tts: boolean;
    image: boolean;
  };
}

class LemonadeService {
  private config: ServerConfig | null = null;
  private healthCheckInterval: number | null = null;

  /**
   * Start health check polling
   */
  startHealthCheck(intervalMs: number = 5000): void {
    this.stopHealthCheck();  // Clear existing

    const check = async () => {
      try {
        const response = await fetch('http://localhost:8000/health');
        if (response.ok) {
          this.config = await response.json();
          log.debug('Health check passed', this.config);
        }
      } catch {
        log.debug('Health check failed - server may be offline');
        this.config = null;
      }
    };

    check();  // Immediate check
    this.healthCheckInterval = window.setInterval(check, intervalMs);
    log.info('Lemonade health check started');
  }

  /**
   * Stop health check polling
   */
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get current server status
   */
  getStatus(): {
    online: boolean;
    config: ServerConfig | null;
  } {
    return {
      online: this.config !== null,
      config: this.config,
    };
  }

  /**
   * Get server URL
   */
  getServerUrl(): string {
    return 'http://localhost:8000';
  }

  /**
   * Get API base URL
   */
  getApiUrl(): string {
    return `${this.getServerUrl()}/api/v1`;
  }
}

// Singleton instance
export const lemonadeService = new LemonadeService();
```

### 5.3 Settings Store Modifications

```typescript
// /src/stores/settingsStore.ts

// 1. Add to ApiKeyType
export type ApiKeyType =
  | 'openai'
  | 'assemblyai'
  | 'deepgram'
  | 'piapi'
  | 'youtube'
  | 'klingAccessKey'
  | 'klingSecretKey'
  | 'lemonade';  // NEW

// 2. Add to APIKeys interface
interface APIKeys {
  openai: string;
  assemblyai: string;
  deepgram: string;
  piapi: string;
  youtube: string;
  klingAccessKey: string;
  klingSecretKey: string;
  lemonade: string;  // NEW - stores base URL
}

// 3. Add to SettingsState
interface SettingsState {
  // ... existing fields ...

  // Lemonade settings
  lemonadeEnabled: boolean;
  lemonadeModel: string;
  lemonadeProvider: 'llamacpp' | 'whispercpp' | 'auto';
  lemonadeAutoFallback: boolean;  // Auto-fallback to cloud if offline
}
```

### 5.4 AIChatPanel Modifications

```tsx
// /src/components/panels/AIChatPanel.tsx

// Add provider state
const [provider, setProvider] = useState<'openai' | 'lemonade'>('openai');
const [lemonadeOnline, setLemonadeOnline] = useState(false);

// Check Lemonade status on mount
useEffect(() => {
  lemonadeProvider.checkConnection().then(setLemonadeOnline);
}, []);

// Update callOpenAI to route based on provider
const callProvider = useCallback(async (apiMessages: APIMessage[]) => {
  if (provider === 'lemonade' && lemonadeOnline) {
    return lemonadeProvider.chat(apiMessages, {
      model,
      tools: editorMode ? AI_TOOLS : undefined,
    });
  } else {
    // Fallback to OpenAI
    return callOpenAI(apiMessages);
  }
}, [provider, lemonadeOnline, model, editorMode]);

// Add provider selector to UI
<select
  value={provider}
  onChange={(e) => setProvider(e.target.value as 'openai' | 'lemonade')}
  disabled={isLoading}
>
  <option value="openai">OpenAI</option>
  <option value="lemonade" disabled={!lemonadeOnline}>
    Lemonade {lemonadeOnline ? '' : '(Offline)'}
  </option>
</select>
```

---

## 6. Code Patterns

### 6.1 Singleton Pattern (HMR-Safe)

```typescript
// For services that need to survive hot reloads
let instance: LemonadeProvider | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.lemonadeProvider) {
    instance = import.meta.hot.data.lemonadeProvider;
  }
  import.meta.hot.dispose((data) => {
    data.lemonadeProvider = instance;
  });
}

export const lemonadeProvider = instance || new LemonadeProvider();
```

### 6.2 Stale Closure Prevention

```typescript
// INCORRECT - captures stale state
const currentState = get();
someAsyncOperation(() => {
  set({ data: currentState.data });  // BUG: stale!
});

// CORRECT - use functional update
someAsyncOperation(() => {
  set((state) => ({ data: state.data }));  // Fresh state
});

// CORRECT - use get() in callback
someAsyncOperation(() => {
  const fresh = get();
  set({ data: fresh.data });
});
```

### 6.3 Error Handling Strategy

```typescript
class LemonadeProvider {
  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    try {
      // 1. Check connectivity
      if (!this.isOnline) {
        const connected = await this.checkConnection();
        if (!connected) {
          throw new Error('Server offline');
        }
      }

      // 2. Make request with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // 3. Handle HTTP errors
      if (!response.ok) {
        await this.handleHttpError(response);
      }

      // 4. Parse and validate response
      const data = await response.json();
      return this.parseResponse(data);

    } catch (error) {
      log.error('Chat request failed', error);

      // 5. Classify error
      if (error instanceof TimeoutError) {
        throw new Error('Request timed out');
      } else if (error instanceof ConnectionError) {
        throw new Error('Server unreachable');
      } else {
        throw error;
      }
    }
  }
}
```

### 6.4 Tool Calling Pattern

```typescript
// Match existing aiTools pattern
interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

async function handleToolCalls(
  toolCalls: ToolCall[],
  executionContext: ExecutionContext
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const toolCall of toolCalls) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.arguments);
    } catch {
      results.push({
        success: false,
        error: 'Invalid arguments JSON',
      });
      continue;
    }

    try {
      const result = await executeAITool(toolCall.name, args);
      results.push(result);
    } catch (error) {
      results.push({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}
```

---

## 7. File Changes Summary

### 7.1 Files to Create

| File | Purpose | Estimated Lines |
|------|---------|-----------------|
| `src/services/lemonadeProvider.ts` | Main Lemonade API client | ~200 |
| `src/services/lemonadeService.ts` | Server management wrapper | ~100 |
| `src/components/panels/LemonadeStatus.tsx` | Server status indicator component | ~80 |
| `tests/unit/lemonadeProvider.test.ts` | Unit tests | ~150 |

**Total New Code:** ~530 lines

### 7.2 Files to Modify

| File | Changes | Estimated Lines |
|------|---------|-----------------|
| `src/stores/settingsStore.ts` | Add Lemonade settings, API key type | ~20 |
| `src/services/apiKeyManager.ts` | Add 'lemonade' to ApiKeyType | ~5 |
| `src/components/panels/AIChatPanel.tsx` | Provider toggle, model selector | ~80 |
| `src/stores/settingsStore.ts` (persistence) | Add Lemonade to partialize | ~5 |

**Total Modified Code:** ~110 lines

### 7.3 Total Impact

| Metric | Value |
|--------|-------|
| New Files | 4 |
| Modified Files | 4 |
| New Lines | ~530 |
| Modified Lines | ~110 |
| Test Coverage Target | 80%+ |

---

## 8. Technical Challenges

### 8.1 CORS Support

**Risk:** HIGH - Browser may block requests to localhost:8000

**Validation Required:**
```bash
curl -X OPTIONS http://localhost:8000/api/v1/chat/completions \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

**Mitigation Strategies:**

1. **Vite Proxy (Development)**
   ```typescript
   // vite.config.ts
   export default defineConfig({
     server: {
       proxy: {
         '/api/lemonade': {
           target: 'http://localhost:8000',
           rewrite: (path) => path.replace(/^\/api\/lemonade/, '/api/v1'),
         },
       },
     },
   });
   ```

2. **Browser Extension (Production)**
   - Recommend CORS Unblock extension for testing
   - Document server-side CORS configuration

3. **Server Configuration**
   - Add CORS headers to Lemonade Server
   - `Access-Control-Allow-Origin: http://localhost:5173`

### 8.2 Tool Calling Support

**Risk:** MEDIUM - Lemonade may not support OpenAI-style tool calling

**Validation Required:**
```bash
curl http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Gemma-3-4b-it-GGUF",
    "messages": [{"role": "user", "content": "Split the clip at 5 seconds"}],
    "tools": [{"type": "function", "function": {"name": "splitClip", ...}}]
  }'
```

**Fallback Strategy:**

If tool calling is not supported:
1. **JSON Extraction Mode**
   ```typescript
   // Prompt engineering for structured output
   const JSON_MODE_PROMPT = `
   Respond ONLY with valid JSON in this format:
   {"action": "tool_name", "params": {...}}

   Available actions: ${Object.keys(toolRegistry).join(', ')}
   `;
   ```

2. **Hybrid Mode**
   - Simple edits: Lemonade with JSON extraction
   - Complex edits: Fallback to OpenAI/Claude

### 8.3 Model Quality

**Risk:** MEDIUM - 1-4B models may not match GPT-5 quality

**Mitigation:**

1. **Model Tier Strategy**
   ```
   Tier 1 (Simple): Lemonade with 7B+ model
   - "Trim this clip"
   - "Delete the selected track"

   Tier 2 (Complex): OpenAI/Claude fallback
   - "Create a documentary-style cut with B-roll"
   - "Remove all silent sections and jump cuts"
   ```

2. **Quality Baseline Testing**
   ```typescript
   // Test suite for model quality
   const EDITING_PROMPTS = [
     "Split the clip at 5 seconds",
     "Delete the selected clip",
     "Trim the clip from 10s to 30s",
     "Create a new video track",
     "Move the clip to track 2",
   ];

   // Measure success rate
   const successRate = await evaluateModel(prompts, expectedActions);
   ```

### 8.4 Server Lifecycle

**Risk:** MEDIUM - Users may not understand server management

**Mitigation:**

1. **Auto-Detection**
   ```typescript
   // Check on app startup
   useEffect(() => {
     lemonadeProvider.checkConnection().then((online) => {
       setLemonadeOnline(online);
       if (!online) {
         showNotification('Lemonade Server offline. Start it to use local AI.');
       }
     });
   }, []);
   ```

2. **Status Indicator**
   ```tsx
   <div className="lemonade-status">
     <span className={`status-dot ${online ? 'online' : 'offline'}`} />
     <span>{online ? 'Lemonade Online' : 'Lemonade Offline'}</span>
     {!online && <button onClick={startServer}>Start Server</button>}
   </div>
   ```

3. **Documentation**
   - Clear setup instructions
   - One-click server start script
   - Model download links

### 8.5 GPU Memory Management

**Risk:** LOW-MEDIUM - Local models may exhaust GPU memory

**Mitigation:**

1. **Model Size Warnings**
   ```typescript
   const MODEL_SIZES: Record<string, number> = {
     'Gemma-3-4b-it-GGUF': 3.2,  // GB
     'Llama-3-8B-Instruct-GGUF': 5.5,
     'Qwen2.5-7B-Instruct-GGUF': 4.8,
   };

   if (MODEL_SIZES[model] > availableVRAM) {
     warnUser('Model may not fit in available VRAM');
   }
   ```

2. **Graceful Degradation**
   - Fall back to smaller models
   - Auto-switch to cloud provider on OOM errors

---

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// tests/unit/lemonadeProvider.test.ts
describe('LemonadeProvider', () => {
  describe('checkConnection', () => {
    it('returns true when server is online', async () => {
      // Mock fetch to return 200
      const result = await lemonadeProvider.checkConnection();
      expect(result).toBe(true);
      expect(lemonadeProvider.isServerOnline()).toBe(true);
    });

    it('returns false when server is offline', async () => {
      // Mock fetch to throw error
      const result = await lemonadeProvider.checkConnection();
      expect(result).toBe(false);
    });
  });

  describe('chat', () => {
    it('sends request and parses response', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const result = await lemonadeProvider.chat(messages);
      expect(result.content).toBeDefined();
    });

    it('handles tool calls', async () => {
      // Mock response with tool_calls
      const result = await lemonadeProvider.chat(messages, { tools: AI_TOOLS });
      expect(result.toolCalls).toBeDefined();
    });
  });
});
```

### 9.2 Integration Tests

```typescript
// tests/integration/lemonade-integration.test.ts
describe('Lemonade Integration', () => {
  it('completes editing workflow', async () => {
    // 1. Start Lemonade Server
    // 2. Send editing command
    // 3. Verify tool execution
    // 4. Verify timeline state change
  });
});
```

---

## 10. Implementation Checklist

### Phase 1: Core Integration (3-4 days)

- [ ] Create `lemonadeProvider.ts` with chat() method
- [ ] Create `lemonadeService.ts` for server management
- [ ] Add Lemonade settings to settingsStore
- [ ] Add 'lemonade' to apiKeyManager
- [ ] Add provider toggle to AIChatPanel
- [ ] Implement server status indicator
- [ ] Add model selector for Lemonade models
- [ ] Implement graceful fallback when offline

### Phase 2: Validation (1-2 days)

- [ ] Validate CORS support
- [ ] Validate tool calling support
- [ ] Run model quality baseline tests
- [ ] Document findings in validation-results.md

### Phase 3: STT Integration (1-2 days)

- [ ] Add whispercpp backend to whisperService
- [ ] Add transcription provider setting
- [ ] Test transcription quality

### Phase 4: Polish (Deferred)

- [ ] Auto-detection on startup
- [ ] One-click server start
- [ ] Model download UI
- [ ] TTS integration

---

## 11. Related Documents

| Document | Purpose |
|----------|---------|
| [`README.md`](./README.md) | Integration overview and status |
| [`validation-results.md`](./validation-results.md) | Validation test results |
| [`quality-review.md`](./quality-review.md) | Quality review findings |
| [`strategic-recommendation.md`](./strategic-recommendation.md) | Implementation plan |

---

## 12. Appendix: Quick Reference

### Environment Setup

```bash
# 1. Clone Lemonade Server
cd c:/users/antmi
git clone https://github.com/lemonade-sdk/lemonade.git
cd lemonade

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start server
python -m lemonade --port 8000

# 4. Verify connectivity
curl http://localhost:8000/api/v1/models -H "Authorization: Bearer lemonade"
```

### Quick Test Commands

```bash
# Test basic chat
curl http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{"model":"Gemma-3-4b-it-GGUF","messages":[{"role":"user","content":"Hello"}]}'

# Test tool calling
curl http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"Gemma-3-4b-it-GGUF",
    "messages":[{"role":"user","content":"Split clip at 5s"}],
    "tools":[{"type":"function","function":{"name":"splitClip","parameters":{"type":"object"}}}]
  }'
```

---

*This document is the technical reference for Lemonade Server integration. Update as implementation progresses.*
