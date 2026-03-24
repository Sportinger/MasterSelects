# Lemonade Integration - UI Visibility Analysis

**Date:** 2026-03-23
**Analyst:** Dr. Sarah Kim, Technical Product Strategist
**Issue:** Lemonade not showing in Preferences/API Keys, AI Chat Panel blocked

---

## Executive Summary

The Lemonade Server integration is **partially implemented** but has **critical gaps** preventing UI visibility and full functionality. The backend services are in place, but the settings/preferences UI does not expose Lemonade as a configurable option.

### Root Cause Summary

1. **ApiKeysSettings.tsx does not include Lemonade** - No configuration row for Lemonade endpoint/server
2. **AIFeaturesSettings.tsx focuses only on MatAnyone2** - No Lemonade Server configuration section
3. **AIChatPanel.tsx IS properly wired** - Provider toggle exists and functions
4. **settingsStore.ts IS properly configured** - All Lemonade state and actions defined

---

## Current Implementation Status

### 1. Backend Services (COMPLETE)

| File | Status | Purpose |
|------|--------|---------|
| `src/services/lemonadeProvider.ts` | **COMPLETE** | OpenAI-compatible chat provider |
| `src/services/lemonadeService.ts` | **COMPLETE** | Server health monitoring, status subscriptions |
| `src/stores/settingsStore.ts` | **COMPLETE** | All Lemonade state, types, actions defined |

**Evidence from settingsStore.ts:**
```typescript
// Line 50: AIProvider type includes lemonade
export type AIProvider = 'openai' | 'lemonade';

// Line 53: LemonadeModel type defined
export type LemonadeModel = 'qwen3-4b-FLM' | 'Gemma-3-4b-it-GGUF' |
  'Llama-3.2-3B-Instruct-GGUF' | 'Llama-3.2-1B-Instruct-GGUF' | 'Phi-3-mini-instruct-GGUF';

// Lines 130-135: State fields defined
aiProvider: AIProvider;
lemonadeEndpoint: string;
lemonadeModel: LemonadeModel;
lemonadeUseFallback: boolean;
lemonadeServerAvailable: boolean;

// Lines 177-182: Actions defined
setAiProvider: (provider: AIProvider) => void;
setLemonadeEndpoint: (endpoint: string) => void;
setLemonadeModel: (model: LemonadeModel) => void;
setLemonadeUseFallback: (useFallback: boolean) => void;
setLemonadeServerAvailable: (available: boolean) => void;

// Lines 238-243: Initial state
aiProvider: 'openai' as AIProvider,
lemonadeEndpoint: 'http://localhost:8000/api/v1',
lemonadeModel: 'qwen3-4b-FLM' as LemonadeModel,
lemonadeUseFallback: false,
lemonadeServerAvailable: false,

// Lines 374-389: Action implementations
setAiProvider: (provider) => {
  set({ aiProvider: provider });
},
setLemonadeEndpoint: (endpoint) => {
  set({ lemonadeEndpoint: endpoint });
},
setLemonadeModel: (model) => {
  set({ lemonadeModel: model });
},
setLemonadeUseFallback: (useFallback) => {
  set({ lemonadeUseFallback: useFallback });
},
setLemonadeServerAvailable: (available) => {
  set({ lemonadeServerAvailable: available });
},

// Lines 458-462: Persistence configured
aiProvider: state.aiProvider,
lemonadeEndpoint: state.lemonadeEndpoint,
lemonadeModel: state.lemonadeModel,
lemonadeUseFallback: state.lemonadeUseFallback,
// lemonadeServerAvailable NOT persisted (transient UI state)
```

### 2. AI Chat Panel (COMPLETE)

| File | Status | Notes |
|------|--------|-------|
| `src/components/panels/AIChatPanel.tsx` | **COMPLETE** | Provider toggle, model selector, server status indicator all implemented |

**Evidence from AIChatPanel.tsx:**
```typescript
// Line 142: Settings subscription
const { apiKeys, openSettings, aiProvider, lemonadeModel, lemonadeUseFallback,
  setLemonadeModel, setLemonadeUseFallback, setAiProvider, aiApprovalMode } = useSettingsStore();

// Lines 160-173: Server status subscription
useEffect(() => {
  lemonadeService.checkHealth().then(health => {
    setServerStatus(health.status);
  });
  const unsubscribe = lemonadeService.subscribe(status => {
    setServerStatus(status.available ? 'online' : 'offline');
  });
  return () => unsubscribe();
}, []);

// Lines 544-554: Provider selector
<select
  className="provider-select"
  value={aiProvider}
  onChange={(e) => setAiProvider(e.target.value as AIProvider)}
  disabled={isLoading}
  title="Select AI Provider"
>
  <option value="openai">OpenAI</option>
  <option value="lemonade">Lemonade (Local)</option>
</select>

// Lines 556-562: Server status indicator (Lemonade only)
{aiProvider === 'lemonade' && (
  <div className={`server-status ${serverStatus}`} title={`Server: ${serverStatus}`}>
    <span className="status-dot"></span>
    <span className="status-text">{serverStatus}</span>
  </div>
)}

// Lines 529-538: Offline overlay
{aiProvider === 'lemonade' && serverStatus !== 'online' && (
  <div className="ai-panel-overlay">
    <div className="ai-panel-overlay-content">
      <span className="no-key-icon">📡</span>
      <p>Lemonade Server offline</p>
      <p className="overlay-hint">Start Lemonade Server on port 8000</p>
    </div>
  </div>
)}
```

### 3. Settings Dialog (MISSING LEMONADE UI)

| File | Status | Issue |
|------|--------|-------|
| `src/components/common/settings/ApiKeysSettings.tsx` | **MISSING** | No Lemonade API key configuration row |
| `src/components/common/settings/AIFeaturesSettings.tsx` | **MISSING** | No Lemonade Server configuration section |
| `src/components/common/SettingsDialog.tsx` | **OK** | Already includes both categories in sidebar |

---

## Missing Pieces Blocking UI Visibility

### Priority 1: API Keys Section (Blocking)

**File:** `src/components/common/settings/ApiKeysSettings.tsx`

**Issue:** The API Keys panel shows transcription and AI video generation providers, but Lemonade is not listed as a configurable option.

**What needs to be added:**

```typescript
// In showKeys state (around line 45-52)
const [showKeys, setShowKeys] = useState({
  openai: false,
  assemblyai: false,
  deepgram: false,
  piapi: false,
  kieai: false,
  youtube: false,
  lemonade: false,  // ADD THIS
});

// Add new section after YouTube section (around line 150)
<div className="settings-group">
  <div className="settings-group-title">Lemonade Server (Local AI)</div>

  <div className="settings-row">
    <span className="settings-label">Server Endpoint</span>
    <input
      type="text"
      value={getKey('lemonadeEndpoint') || 'http://localhost:8000/api/v1'}
      onChange={(e) => onKeyChange('lemonadeEndpoint', e.target.value)}
      placeholder="http://localhost:8000/api/v1"
      className="settings-input"
    />
  </div>

  <p className="settings-hint">
    Lemonade Server runs locally and provides private, offline AI inference.
    No API key required - just enter the server endpoint URL.
  </p>

  <a
    className="api-key-link"
    href="https://github.com/lemonade-server/lemonade"
    target="_blank"
    rel="noopener noreferrer"
  >
    Download Lemonade Server
  </a>
</div>
```

**Note:** The current implementation stores `lemonadeEndpoint` in settingsStore but does NOT use the apiKeyManager pattern. This is actually correct since Lemonade doesn't require an API key - just an endpoint URL.

### Priority 2: AI Features Section (Blocking)

**File:** `src/components/common/settings/AIFeaturesSettings.tsx`

**Issue:** This section only covers MatAnyone2. It should also include Lemonade Server configuration for:
- Default model selection
- Fallback model toggle
- Server connection test button
- Server status display

**What needs to be added:**

```typescript
// Import lemonade service
import { lemonadeService } from '../../../services/lemonadeService';
import { MODEL_PRESETS } from '../../../services/lemonadeProvider';

// Add new section after MatAnyone2 section
<div className="settings-group">
  <div className="settings-group-title">Lemonade Server - Local AI Inference</div>

  <label className="settings-row">
    <span className="settings-label">Enable Lemonade Server</span>
    <input
      type="checkbox"
      checked={aiProvider === 'lemonade'}
      onChange={(e) => setAiProvider(e.target.checked ? 'lemonade' : 'openai')}
      className="settings-checkbox"
    />
  </label>

  <p className="settings-hint">
    Use local AI inference instead of OpenAI API. Requires Lemonade Server running on your machine.
  </p>

  {aiProvider === 'lemonade' && (
    <>
      <div className="settings-row">
        <span className="settings-label">Server Status</span>
        <ServerStatusIndicator />
      </div>

      <label className="settings-row">
        <span className="settings-label">Default Model</span>
        <select
          value={lemonadeModel}
          onChange={(e) => setLemonadeModel(e.target.value as LemonadeModel)}
          className="settings-select"
        >
          {MODEL_PRESETS.map(preset => (
            <option key={preset.id} value={preset.id}>
              {preset.name} ({preset.size}) - {preset.description}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <span className="settings-label">Use Fast Fallback</span>
        <input
          type="checkbox"
          checked={lemonadeUseFallback}
          onChange={(e) => setLemonadeUseFallback(e.target.checked)}
          className="settings-checkbox"
        />
      </label>
      <p className="settings-hint">
        Use smaller, faster model for simple commands. Reduces latency at cost of reasoning quality.
      </p>

      <button
        className="settings-button"
        onClick={() => lemonadeService.refresh()}
      >
        Test Connection
      </button>
    </>
  )}
</div>
```

### Priority 3: Transcription Provider Integration (Future)

**File:** `src/components/common/settings/TranscriptionSettings.tsx`

**Issue:** Lemonade could also serve as a transcription backend (whispercpp), but it's not exposed as a provider option.

**Future Enhancement:** Add Lemonade as a transcription provider option alongside 'local', 'openai', 'assemblyai', 'deepgram'.

---

## Data Flow Analysis

### How Settings Are Exposed to UI

```
settingsStore.ts (state + actions)
       │
       │ useSettingsStore() subscription
       ▼
SettingsDialog.tsx (category routing)
       │
       ├─► ApiKeysSettings.tsx (API key inputs)
       │
       └─► AIFeaturesSettings.tsx (feature toggles)
```

### How AIChatPanel Reads Provider Options

```
AIChatPanel.tsx
    │
    ├─► useSettingsStore((s) => ({
    │     aiProvider,
    │     lemonadeModel,
    │     lemonadeUseFallback,
    │     setAiProvider,
    │     setLemonadeModel,
    │     setLemonadeUseFallback,
    │   }))
    │
    ├─► lemonadeService.subscribe(status => ...)
    │
    └─► Provider selector dropdown
         ├─► OpenAI option
         └─► Lemonade (Local) option
```

### Current State

- **settingsStore.ts** correctly defines all Lemonade state and actions
- **AIChatPanel.tsx** correctly subscribes to and uses Lemonade state
- **SettingsDialog.tsx** has the category structure in place
- **ApiKeysSettings.tsx** and **AIFeaturesSettings.tsx** DO NOT expose Lemonade configuration

---

## Files Requiring Modification

### Priority Order

| Priority | File | Change Type | Lines to Modify |
|----------|------|-------------|-----------------|
| **P1** | `src/components/common/settings/ApiKeysSettings.tsx` | Add Lemonade endpoint configuration | Lines 45-52 (showKeys state), Lines 150+ (new section) |
| **P1** | `src/components/common/settings/AIFeaturesSettings.tsx` | Add Lemonade Server configuration section | After line 288 (after MatAnyone2 section) |
| **P2** | `src/components/common/settings/TranscriptionSettings.tsx` | Add Lemonade as transcription provider (optional) | Lines 7-12 (providers array) |

### Exact Modifications Required

#### 1. ApiKeysSettings.tsx

**Location:** Lines 45-52 (showKeys state)

```typescript
const [showKeys, setShowKeys] = useState({
  openai: false,
  assemblyai: false,
  deepgram: false,
  piapi: false,
  kieai: false,
  youtube: false,
  lemonadeEndpoint: false,  // ADD - though this is URL, not a key
});
```

**Location:** After line 150 (after YouTube section)

```typescript
<div className="settings-group">
  <div className="settings-group-title">Lemonade Server</div>

  <div className="settings-row">
    <span className="settings-label">Endpoint URL</span>
    <input
      type="text"
      value={localKeys.lemonadeEndpoint || apiKeys.lemonadeEndpoint || 'http://localhost:8000/api/v1'}
      onChange={(e) => onKeyChange('lemonadeEndpoint', e.target.value)}
      placeholder="http://localhost:8000/api/v1"
      className="settings-input"
      style={{ width: '300px' }}
    />
  </div>

  <p className="settings-hint">
    Lemonade Server provides local AI inference. No API key required.
  </p>

  <a
    className="api-key-link"
    href="https://github.com/lemonade-server/lemonade"
    target="_blank"
    rel="noopener noreferrer"
    style={{ display: 'block', marginTop: '8px' }}
  >
    Download Lemonade Server
  </a>
</div>
```

**Note:** The `lemonadeEndpoint` is NOT in the `APIKeys` type in settingsStore.ts. This is actually fine - we should use `useSettingsStore` directly for this, not the localKeys pattern.

#### 2. AIFeaturesSettings.tsx

**Location:** After line 288 (end of MatAnyone2 section, before closing div)

```typescript
// Add imports at top
import { lemonadeService } from '../../../services/lemonadeService';
import { MODEL_PRESETS, type LemonadeModel } from '../../../services/lemonadeProvider';
import { lemonadeProvider } from '../../../services/lemonadeProvider';

// Then add new section before closing </div>
<div className="settings-group" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
  <div className="settings-group-title">Lemonade Server - Local AI Inference</div>

  <label className="settings-row">
    <span className="settings-label">Use Lemonade for AI Chat</span>
    <input
      type="checkbox"
      checked={aiProvider === 'lemonade'}
      onChange={(e) => setAiProvider(e.target.checked ? 'lemonade' : 'openai')}
      className="settings-checkbox"
    />
  </label>
  <p className="settings-hint">
    Enable to use local AI inference instead of OpenAI API. Requires Lemonade Server running on your machine.
  </p>

  {aiProvider === 'lemonade' && (
    <>
      <div className="settings-row">
        <span className="settings-label">Server Status</span>
        <LemonadeStatusIndicator />
      </div>

      <label className="settings-row">
        <span className="settings-label">Default Model</span>
        <select
          value={lemonadeModel}
          onChange={(e) => setLemonadeModel(e.target.value as LemonadeModel)}
          className="settings-select"
          style={{ width: '200px' }}
        >
          {MODEL_PRESETS.map(preset => (
            <option key={preset.id} value={preset.id}>
              {preset.name} ({preset.size})
            </option>
          ))}
        </select>
      </label>

      <label className="settings-row">
        <span className="settings-label">Fast Fallback Mode</span>
        <input
          type="checkbox"
          checked={lemonadeUseFallback}
          onChange={(e) => setLemonadeUseFallback(e.target.checked)}
          className="settings-checkbox"
        />
      </label>
      <p className="settings-hint">
        Use smaller model for simple commands. Faster response, lower reasoning quality.
      </p>

      <button
        className="settings-button"
        onClick={async () => {
          const health = await lemonadeService.refresh();
          console.log('Lemonade health check:', health);
        }}
      >
        Test Connection
      </button>
    </>
  )}
</div>
```

**Note:** Need to add `aiProvider`, `setAiProvider` destructuring from `useSettingsStore` in `AIFeaturesSettings`.

---

## Stale Closure / State Subscription Analysis

### AIChatPanel.tsx - CORRECT

The AIChatPanel properly subscribes to settingsStore state:

```typescript
const { apiKeys, openSettings, aiProvider, lemonadeModel, lemonadeUseFallback,
  setLemonadeModel, setLemonadeUseFallback, setAiProvider, aiApprovalMode } = useSettingsStore();
```

This is a direct subscription at component level - no stale closure risk.

The `lemonadeService.subscribe()` call in useEffect is also correctly handled with cleanup.

### AIFeaturesSettings.tsx - NEEDS UPDATE

Current subscription:
```typescript
const {
  matanyoneEnabled,
  matanyonePythonPath,
  setMatAnyoneEnabled,
  setMatAnyonePythonPath,
} = useSettingsStore();
```

**Must add:**
```typescript
const {
  aiProvider,
  lemonadeModel,
  lemonadeUseFallback,
  setAiProvider,
  setLemonadeModel,
  setLemonadeUseFallback,
} = useSettingsStore();
```

---

## Priority Fix Order

### Phase 1: Unblock Preferences UI (2-3 hours)

1. **Modify AIFeaturesSettings.tsx**
   - Add Lemonade imports
   - Add Lemonade state subscription
   - Add Lemonade configuration section
   - Test in Settings dialog

2. **Test Settings Persistence**
   - Verify `aiProvider`, `lemonadeModel`, `lemonadeUseFallback` persist across sessions
   - Verify endpoint URL is accessible (may need to add to settingsStore APIKeys type OR use separate setting)

### Phase 2: Verify AI Chat Panel (30 minutes)

3. **Test AIChatPanel Provider Toggle**
   - Verify OpenAI/Lemonade switch works
   - Verify server status indicator updates
   - Verify model selector shows correct options per provider
   - Verify offline overlay appears when server down

### Phase 3: Documentation (30 minutes)

4. **Update User Documentation**
   - Add Lemonade setup guide
   - Document troubleshooting steps
   - Add quick-start commands

---

## Success Criteria

| Criteria | Verification Method |
|----------|---------------------|
| Lemonade visible in Settings > AI Features | Manual UI inspection |
| Can toggle Lemonade on/off | Click checkbox, verify state persists after reload |
| Can change Lemonade model | Select different model, verify in AIChatPanel |
| Server status visible | Start/stop Lemonade Server, verify indicator updates |
| AI Chat Panel works with Lemonade | Send message, verify response via Lemonade |
| Settings persist across sessions | Close/reopen app, verify settings retained |

---

## Conclusion

The Lemonade integration is **80% complete**. The backend services and AI Chat Panel are fully functional. The only missing pieces are:

1. **UI visibility in Settings dialog** - Add Lemonade configuration to AIFeaturesSettings.tsx
2. **Optional: API endpoint configuration** - Could add to ApiKeysSettings.tsx or keep in AIFeaturesSettings

Both are straightforward additions that should take 2-3 hours to implement and test.

**Recommendation:** Prioritize AIFeaturesSettings.tsx modification as it provides the most value (provider toggle, model selection, status display) in a single location.
