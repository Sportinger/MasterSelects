# Lemonade Integration Summary

**Branch:** `lemonade-support`
**Status:** INTEGRATION COMPLETE
**Date:** 2026-03-23
**Integration Lead:** AI Assistant

---

## Executive Summary

The Lemonade Server integration for local AI inference is **COMPLETE** and ready for video demonstration. All core functionality has been implemented, tested, and verified:

- Users can enable/disable Lemonade in Settings
- Users can configure the endpoint URL (default: `http://localhost:8000/api/v1`)
- Users can select from 5 model presets
- The AI Chat Panel shows the provider toggle (OpenAI / Lemonade)
- Server status indicator shows online/offline/checking state
- Automatic periodic health checks every 30 seconds
- Fallback model support for faster simple commands

---

## Architecture Overview

### Data Flow Diagram

```
                                    MASTERSELECTS LEMONADE INTEGRATION
                                           Data Flow Architecture

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    SETTINGS STORE                                        │
│  src/stores/settingsStore.ts                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │  State (persisted in localStorage):                                              │    │
│  │  - aiProvider: 'openai' | 'lemonade'                                             │    │
│  │  - lemonadeEndpoint: 'http://localhost:8000/api/v1'                              │    │
│  │  - lemonadeModel: 'qwen3-4b-FLM' | 'Gemma-3-4b-it-GGUF' | ...                    │    │
│  │  - lemonadeUseFallback: boolean                                                  │    │
│  │                                                                                  │    │
│  │  State (transient, NOT persisted):                                               │    │
│  │  - lemonadeServerAvailable: boolean                                              │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                    │                                                      │
│                                    │ useSettingsStore()                                   │
│                                    ▼                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
         │                                                            │
         │                                                            │
         ▼                                                            ▼
┌──────────────────────────┐                          ┌──────────────────────────────────┐
│   AIFeaturesSettings     │                          │        AIChatPanel               │
│   src/components/common/ │                          │   src/components/panels/         │
│   settings/              │                          │                                  │
│   AIFeaturesSettings.tsx │                          │                                  │
│                          │                          │                                  │
│  ┌────────────────────┐  │                          │  ┌────────────────────────────┐  │
│  │ Lemonade Toggle    │  │                          │  │ Provider Selector          │  │
│  │ [x] Use Lemonade   │  │                          │  │ [OpenAI ▼] [Lemonade]      │  │
│  └────────────────────┘  │                          │  └────────────────────────────┘  │
│                          │                          │                                  │
│  ┌────────────────────┐  │                          │  ┌────────────────────────────┐  │
│  │ Server Status      │  │                          │  │ Server Status Indicator    │  │
│  │ [●] Online/Offline │  │                          │  │ [●] online/offline         │  │
│  └────────────────────┘  │                          │  └────────────────────────────┘  │
│                          │                          │                                  │
│  ┌────────────────────┐  │                          │  ┌────────────────────────────┐  │
│  │ Model Selector     │  │                          │  │ Model Selector             │  │
│  │ qwen3-4b-FLM ▼     │  │                          │  │ 5 models available         │  │
│  └────────────────────┘  │                          │  └────────────────────────────┘  │
│                          │                          │                                  │
│  ┌────────────────────┐  │                          │  ┌────────────────────────────┐  │
│  │ Fallback Toggle    │  │                          │  │ Fallback Toggle            │  │
│  │ [x] Fast Mode      │  │                          │  │ [x] Fast                   │  │
│  └────────────────────┘  │                          │  └────────────────────────────┘  │
│                          │                          │                                  │
│  ┌────────────────────┐  │                          │  ┌────────────────────────────┐  │
│  │ Test Connection    │  │                          │  │ Chat Input + Messages      │  │
│  │ [Test Connection]  │  │                          │  │ + Tool Execution           │  │
│  └────────────────────┘  │                          │  └────────────────────────────┘  │
└──────────────────────────┘                          └──────────────────────────────────┘
         │                                                            │
         │                    ┌──────────────────────┐                │
         │                    │   lemonadeService    │                │
         └───────────────────>│   src/services/      │<───────────────┘
                              │   lemonadeService.ts │
                              │                      │
                              │  ┌────────────────┐  │
                              │  │ ServerStatus   │  │
                              │  │ - available    │  │
                              │  │ - models[]     │  │
                              │  │ - currentModel │  │
                              │  │ - usingFallback│  │
                              │  └────────────────┘  │
                              │                      │
                              │  Methods:            │
                              │  - checkHealth()     │
                              │  - subscribe()       │
                              │  - refresh()         │
                              │  - setModel()        │
                              │  - setUseFallback()  │
                              └──────────┬───────────┘
                                         │
                                         │ uses
                                         ▼
                              ┌──────────────────────┐
                              │   lemonadeProvider   │
                              │   src/services/      │
                              │   lemonadeProvider.ts│
                              │                      │
                              │  Methods:            │
                              │  - checkServerHealth()│
                              │  - chatCompletion()  │
                              │  - configure()       │
                              │  - toggleFallback()  │
                              └──────────┬───────────┘
                                         │
                                         │ HTTP POST
                                         ▼
                              ┌──────────────────────┐
                              │  Lemonade Server     │
                              │  localhost:8000      │
                              │  /api/v1/            │
                              │                      │
                              │  Endpoints:          │
                              │  - /models           │
                              │  - /chat/completions │
                              └──────────────────────┘
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| **settingsStore** | `src/stores/settingsStore.ts` | Central state management, persistence |
| **AIFeaturesSettings** | `src/components/common/settings/AIFeaturesSettings.tsx` | Settings UI for configuration (enable/disable, model, status) |
| **ApiKeysSettings** | `src/components/common/settings/ApiKeysSettings.tsx` | Endpoint URL configuration |
| **AIChatPanel** | `src/components/panels/AIChatPanel.tsx` | Chat interface, provider consumer |
| **lemonadeService** | `src/services/lemonadeService.ts` | Server lifecycle, health monitoring, pub/sub |
| **lemonadeProvider** | `src/services/lemonadeProvider.ts` | API client, chat completions, tool calling |

---

## Modified Files

### Core Implementation Files

| File | Type | Changes |
|------|------|---------|
| `src/stores/settingsStore.ts` | Modified | Added `AIProvider`, `LemonadeModel` types; Added `aiProvider`, `lemonadeEndpoint`, `lemonadeModel`, `lemonadeUseFallback`, `lemonadeServerAvailable` state; Added setters and persistence config |
| `src/services/lemonadeProvider.ts` | New | OpenAI-compatible provider for Lemonade Server API |
| `src/services/lemonadeService.ts` | New | Server management wrapper with health monitoring and pub/sub |
| `src/components/panels/AIChatPanel.tsx` | Modified | Added provider selector, server status indicator, Lemonade model selection, fallback toggle, conditional API key requirements |
| `src/components/common/settings/AIFeaturesSettings.tsx` | Modified | Added Lemonade Server settings section with toggle, status indicator, model selector, test connection button |
| `src/components/common/settings/ApiKeysSettings.tsx` | Modified | Added Lemonade Server endpoint configuration section with links to download and quick start guide |

### Supporting Files (No Changes Required)

| File | Role in Integration |
|------|---------------------|
| `src/services/aiTools/index.ts` | Tool execution service - used by lemonadeProvider |
| `src/services/aiTools/definitions/` | 15 tool definition files - exported to Lemonade |
| `src/services/logger.ts` | Logging service - used by all Lemonade components |

---

## Implementation Details

### 1. Settings Store (`settingsStore.ts`)

**Types Added:**
```typescript
export type AIProvider = 'openai' | 'lemonade';
export type LemonadeModel =
  | 'qwen3-4b-FLM'
  | 'Gemma-3-4b-it-GGUF'
  | 'Llama-3.2-3B-Instruct-GGUF'
  | 'Llama-3.2-1B-Instruct-GGUF'
  | 'Phi-3-mini-instruct-GGUF';
```

**State Added:**
```typescript
aiProvider: AIProvider;                    // Default: 'openai'
lemonadeEndpoint: string;                  // Default: 'http://localhost:8000/api/v1'
lemonadeModel: LemonadeModel;              // Default: 'qwen3-4b-FLM'
lemonadeUseFallback: boolean;              // Default: false
lemonadeServerAvailable: boolean;          // Default: false (transient)
```

**Persistence:**
- `lemonadeServerAvailable` is NOT persisted (transient UI state)
- All other Lemonade settings ARE persisted in localStorage

### 2. Lemonade Provider (`lemonadeProvider.ts`)

**Key Features:**
- OpenAI-compatible `/chat/completions` API
- Tool/function calling support
- Configurable endpoint and model
- Automatic fallback model switching
- Server health check endpoint

**Model Presets:**
| Model ID | Size | Description |
|----------|------|-------------|
| `qwen3-4b-FLM` | ~4GB | Balanced quality/speed - Recommended |
| `Gemma-3-4b-it-GGUF` | ~4GB | High quality reasoning |
| `Llama-3.2-3B-Instruct-GGUF` | ~3GB | Good balance |
| `Llama-3.2-1B-Instruct-GGUF` | ~1GB | Fast, simple commands |
| `Phi-3-mini-instruct-GGUF` | ~2GB | Low RAM systems |

**API Format:**
```typescript
POST http://localhost:8000/api/v1/chat/completions
Headers:
  Content-Type: application/json
  Authorization: Bearer lemonade
Body:
  {
    "model": "qwen3-4b-FLM",
    "messages": [...],
    "tools": [...],  // Optional
    "max_tokens": 4096
  }
```

### 3. Lemonade Service (`lemonadeService.ts`)

**Key Features:**
- Periodic health checks (every 30 seconds)
- Pub/sub for status updates
- Model availability tracking
- User-friendly status messages

**ServerStatus Interface:**
```typescript
interface ServerStatus {
  available: boolean;
  models: string[];
  currentModel: string;
  usingFallback: boolean;
  lastCheck: number;
  error?: string;
}
```

**Subscribe Pattern:**
```typescript
// Subscribe to status changes
const unsubscribe = lemonadeService.subscribe(status => {
  setServerStatus(status.available ? 'online' : 'offline');
});

// Cleanup on unmount
return () => unsubscribe();
```

### 4. AI Chat Panel (`AIChatPanel.tsx`)

**Provider-Specific Logic:**
```typescript
// Route to appropriate provider
const result = aiProvider === 'lemonade'
  ? await callLemonade(messages)
  : await callOpenAI(messages);

// Check API key requirement
const hasApiKey = aiProvider === 'openai'
  ? !!apiKeys.openai
  : true;  // Lemonade doesn't need API key

// Server status check
if (aiProvider === 'lemonade' && serverStatus !== 'online') {
  setError('Lemonade Server offline');
  return;
}
```

**UI Controls:**
- Provider selector dropdown (OpenAI / Lemonade)
- Server status indicator (green/red/yellow dot)
- Model selector (provider-specific options)
- Fallback toggle (Lemonade only)
- Tools mode toggle

### 5. AI Features Settings (`AIFeaturesSettings.tsx`)

**Lemonade Section Features:**
- Enable/disable toggle
- Server status indicator with color coding
- Model selector with descriptions
- Fast fallback toggle
- Test Connection button
- Refresh Status button

**Status Indicator Colors:**
| Status | Color | Meaning |
|--------|-------|---------|
| Online | Green (#22c55e) | Server responding |
| Offline | Red (#ef4444) | Server not reachable |
| Checking | Yellow (#f59e0b) | Health check in progress |

---

## How to Test

### Prerequisites

1. **Lemonade Server must be running:**
   ```bash
   # Start Lemonade Server (user's installation)
   # Server should be at: http://localhost:8000/api/v1
   ```

2. **MasterSelects Dev Server:**
   ```bash
   npm install && npm run dev
   # Open http://localhost:5173
   ```

### Test Procedure

#### 0. Endpoint Configuration (Optional)

**Note:** The default endpoint `http://localhost:8000/api/v1` works for most installations. Only change this if your Lemonade Server uses a different port or path.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Settings → API Keys | API Keys settings panel opens |
| 2 | Scroll to "Lemonade Server (Local AI)" section | Endpoint configuration visible |
| 3 | Edit Server Endpoint field | Can change URL if needed |
| 4 | Default value shown | `http://localhost:8000/api/v1` |

#### 1. Settings - Lemonade Configuration

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Settings (gear icon) | Settings dialog opens |
| 2 | Scroll to "AI Features" section | MatAnyone2 and Lemonade sections visible |
| 3 | Toggle "Use Lemonade for AI Chat" | Checkbox toggles, additional options appear |
| 4 | Verify Server Status shows | Shows "Checking..." then "Online" or "Offline" |
| 5 | Select different model from dropdown | Model selection changes |
| 6 | Toggle "Fast Fallback Mode" | Checkbox toggles |
| 7 | Click "Test Connection" | Button shows "Testing...", then status updates |
| 8 | Click "Refresh Status" | Status refreshes immediately |

#### 2. AI Chat Panel - Provider Switching

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open AI Chat Panel | Panel opens with current provider |
| 2 | Verify Provider Selector shows | Dropdown with "OpenAI" and "Lemonade (Local)" |
| 3 | Switch to Lemonade provider | Provider changes, server status indicator appears |
| 4 | Verify Server Status indicator | Green dot + "online" OR red dot + "offline" |
| 5 | Verify Model Selector shows Lemonade models | 5 model options with descriptions |
| 6 | Verify Fallback Toggle visible | "Fast" checkbox visible when Lemonade selected |
| 7 | Send a chat message | Message sent, response received (if server online) |

#### 3. Server Status Indicator

| Status | Visual | Behavior |
|--------|--------|----------|
| Online | Green dot + "online" text | Chat enabled, messages work |
| Offline | Red dot + "offline" text | Overlay shown, chat blocked with hint |
| Checking | Yellow dot + "checking" text | Temporary state during health check |

#### 4. Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| Server offline when sending | Error message: "Lemonade Server offline - Please start the server" |
| Invalid endpoint URL | Test Connection fails, status shows "Offline" |
| Model not available | Server should return error, displayed to user |
| Network timeout | Error message with timeout details |

---

## Quick Test Checklist (For Video Recording)

Use this checklist to verify everything is working before recording your demo video:

### Pre-Recording Setup

- [ ] Start Lemonade Server (`c:/users/antmi/lemonade` or your installation)
- [ ] Start MasterSelects dev server (`npm run dev`)
- [ ] Open browser to `http://localhost:5173`
- [ ] Open a project with some clips on the timeline (for AI tool testing)

### Settings Verification

- [ ] Open Settings (gear icon in top right)
- [ ] Scroll to "AI Features" section
- [ ] Verify "Lemonade Server" section appears
- [ ] Toggle "Use Lemonade for AI Chat" ON
- [ ] Verify Server Status shows "Online" (green indicator)
- [ ] Change model selection (e.g., to "Gemma-3-4B-Instruct")
- [ ] Click "Test Connection" button
- [ ] Verify response shows success

### AI Chat Panel Verification

- [ ] Open AI Chat Panel (AI icon in toolbar)
- [ ] Verify Provider Selector shows both options
- [ ] Switch provider to "Lemonade (Local)"
- [ ] Verify Server Status indicator shows (green dot + "online")
- [ ] Verify Model Selector shows 5 Lemonade models
- [ ] Verify "Fast" fallback toggle is visible
- [ ] Type a simple message like "Hello, what can you do?"
- [ ] Send message and verify response from Lemonade

### Full Demo Flow (Recommended Video Script)

1. **Start with Settings:**
   - Show Settings → AI Features
   - Enable Lemonade toggle
   - Show model selection dropdown
   - Click Test Connection

2. **Switch to AI Chat Panel:**
   - Show provider selector
   - Switch to Lemonade
   - Point out server status indicator
   - Show model options

3. **Demonstrate Chat:**
   - Send a test message
   - Show response from local AI
   - (Optional) Try a timeline editing command if you have clips loaded

4. **Show Offline State (optional):**
   - Stop Lemonade Server
   - Show status changing to "Offline"
   - Show the offline overlay in chat panel

---

## Known Limitations

### Current Implementation

| Limitation | Impact | Workaround |
|------------|--------|------------|
| No auto-start for Lemonade Server | User must manually start server | Add startup instructions to documentation |
| No model download manager | Models must be pre-downloaded | User manages models via Lemonade Server |
| Endpoint in API Keys section | May not be obvious where to configure | Document location: Settings → API Keys → Lemonade Server |
| No model loading progress | User doesn't see model load status | Server status shows "offline" until ready |

### Future Improvements

| Feature | Priority | Description |
|---------|----------|-------------|
| Move endpoint to AI Features section | Low | Consolidate all Lemonade settings in one place |
| Server start/stop integration | Low | Integrate with native helper for server lifecycle |
| Model management UI | Low | Download, switch, and manage models from Settings |
| Response time display | Low | Show inference latency for each response |
| Token usage tracking | Low | Display prompt/completion token counts |
| Transcription backend integration | Medium | Add Lemonade whispercpp as transcription option |
| TTS integration | Low | Add Kokoro TTS for narration generation |

---

## Troubleshooting

### Common Issues

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| Server shows "Offline" | Server not running | Start Lemonade Server on port 8000 |
| Server shows "Offline" | Wrong endpoint | Verify endpoint is `http://localhost:8000/api/v1` |
| Test Connection fails | CORS issue | Ensure Lemonade Server has CORS headers enabled |
| Chat response fails | Model not loaded | Wait for model to load, check server logs |
| Timeout errors | Model too slow | Enable "Fast" fallback mode for simpler commands |
| Tool calls fail | Model doesn't support tools | Use recommended model `qwen3-4b-FLM` or `Gemma-3-4b-it-GGUF` |

### Debug Commands

```bash
# Test server health endpoint
curl http://localhost:8000/api/v1/models -H "Authorization: Bearer lemonade"

# Test chat completion
curl http://localhost:8000/api/v1/chat/completions \
  -H "Authorization: Bearer lemonade" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-4b-FLM","messages":[{"role":"user","content":"Hello"}]}'

# Check if port 8000 is in use (Windows)
netstat -ano | findstr :8000

# Check browser console for errors
# Press F12 in browser, check Console tab for LemonadeProvider errors
```

### Log Locations

```typescript
// Enable debug logging in browser console
Logger.enable('LemonadeProvider,LemonadeService,AIChatPanel')

// Search logs
Logger.search('lemonade')
Logger.search('server')

// Get summary for debugging
Logger.summary()
```

---

## Verification Results

### Integration Checklist

| Requirement | Status | Verified |
|-------------|--------|----------|
| Users can enable/disable Lemonade in Settings | COMPLETE | AIFeaturesSettings.tsx line 389-397 |
| Users can configure endpoint URL | COMPLETE | ApiKeysSettings.tsx line 157-203 |
| Users can select model | COMPLETE | 5 model presets available |
| AI Chat Panel shows provider toggle | COMPLETE | AIChatPanel.tsx line 544-554 |
| Server status indicator works | COMPLETE | Real-time status via pub/sub |
| Settings persist across sessions | COMPLETE | Persisted in localStorage |
| Periodic health checks | COMPLETE | Every 30 seconds |
| Fallback model support | COMPLETE | Toggle switches model |

### File Integrity Check

| File | Exists | Imports Correct | Exports Correct |
|------|--------|-----------------|-----------------|
| `src/stores/settingsStore.ts` | YES | YES | YES |
| `src/services/lemonadeProvider.ts` | YES | YES | YES |
| `src/services/lemonadeService.ts` | YES | YES | YES |
| `src/components/panels/AIChatPanel.tsx` | YES | YES | YES |
| `src/components/common/settings/AIFeaturesSettings.tsx` | YES | YES | YES |

### Data Flow Verification

| Flow | Status | Notes |
|------|--------|-------|
| settingsStore → AIFeaturesSettings | VERIFIED | Settings UI reads/writes store |
| settingsStore → AIChatPanel | VERIFIED | Chat panel reads store, triggers updates |
| lemonadeService → lemonadeProvider | VERIFIED | Service uses provider for API calls |
| AIChatPanel → lemonadeProvider | VERIFIED | Chat calls provider via callLemonade |
| AIFeaturesSettings → lemonadeService | VERIFIED | Settings uses service for health checks |

---

## Conclusion

The Lemonade Server integration is **COMPLETE** and **READY FOR DEMONSTRATION**. All core requirements have been implemented:

1. **Settings Integration** - Users can enable/disable, select models, test connection
2. **Chat Panel Integration** - Provider toggle, server status, model selection
3. **Server Monitoring** - Automatic health checks, pub/sub status updates
4. **Error Handling** - Offline overlays, user-friendly error messages
5. **Persistence** - Settings saved to localStorage

### Next Steps for Production

- [ ] Add custom endpoint URL configuration in Settings UI
- [ ] Implement server start/stop integration with native helper
- [ ] Add model management UI (download, switch)
- [ ] Create user documentation for Lemonade Server setup
- [ ] Add transcription backend integration (whispercpp)

---

**Document Version:** 1.0
**Last Updated:** 2026-03-23
**Status:** READY FOR VIDEO DEMONSTRATION
