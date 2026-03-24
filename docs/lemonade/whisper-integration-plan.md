# Lemonade Whisper Integration Plan

**Document Type:** Implementation Plan
**Status:** Ready for Implementation
**Created:** 2026-03-23
**Priority:** P2 (Post-Phase 2)
**Estimated Effort:** 4-6 hours

---

## Executive Summary

This document details the integration of **Lemonade Server's whisper.cpp** as a transcription backend option for MasterSelects. The integration provides:

- **Faster transcription** using server-side GPU/NPU acceleration
- **Reduced browser resource usage** (no model download, no CPU load)
- **Seamless fallback** to browser-based Whisper when Lemonade is offline
- **User-controlled selection** via Settings UI

---

## 1. Current State Analysis

### 1.1 Existing Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MasterSelects Browser                         │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ whisperService  │───>│ transcription   │───>│   Web Audio │ │
│  │                 │    │ Worker          │    │   API       │ │
│  │ - Transformers  │    │                 │    │             │ │
│  │   .js           │    │ - Float32Array  │    │ - 16kHz     │ │
│  │ - Xenova/whisper│    │ - Chunked       │    │ - decode    │ │
│  │   -tiny         │    │   processing    │    │   AudioData │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│                                                                  │
│  Memory: ~500MB for model  │  CPU: High during transcription    │
│  Speed: ~0.3x real-time    │  Network: None (offline)           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Limitations

| Aspect | Current (Browser) | Lemonade (Server) |
|--------|-------------------|-------------------|
| **Model Size** | ~150MB download | No browser download |
| **Memory** | ~500MB RAM | Zero browser RAM |
| **CPU Usage** | High (100% during transcribe) | None (server-side) |
| **Speed** | ~0.3x real-time | ~2-5x real-time (GPU) |
| **Accuracy** | whisper-tiny | whisper-small/medium |
| **Offline** | Full offline support | Requires local server |

---

## 2. Lemonade Server STT Endpoint

### 2.1 Endpoint Specification

**Confirmed via validation testing (2026-03-16):**

```
POST http://localhost:8000/api/v1/audio/transcriptions
Authorization: Bearer lemonade
Content-Type: multipart/form-data
```

**Request Body (FormData):**
```typescript
FormData {
  file: File | Blob,         // Audio file (wav, mp4, mp3, etc.)
  model: string,             // "whisper-1" or model name
  language: string,          // "en" for English, "auto" for detection
  response_format: string,   // "verbose_json" for segments
  timestamp_granularities: string, // "segment" for timestamp arrays
}
```

**Expected Response:**
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

### 2.2 Available Models (Lemonade)

Based on validation results:
- `Whisper-Base` (llamacpp backend)
- `whisper-v3-turbo-FLM` (faster, good accuracy)

Recommended models for production:
- `whisper-small` (~244MB, balanced)
- `whisper-medium` (~769MB, high accuracy)

---

## 3. Architecture Design

### 3.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Settings UI                                   │
│  Transcription Provider: [ Lemonade Server ▼ ]                   │
│  Fallback: [x] Auto-fallback to browser if offline              │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  whisperService (modified)                       │
│                                                                  │
│  transcribe(mediaFileId)                                         │
│    │                                                             │
│    ├─> Check provider setting                                    │
│    │                                                             │
│    ├─> 'lemonade': route to LemonadeWhisperService              │
│    │     ├─> Check server availability                          │
│    │     ├─> If offline + fallback enabled → browser            │
│    │     └─> Send audio file to Lemonade API                    │
│    │                                                             │
│    └─> 'local': existing Transformers.js path                   │
│          ├─> Extract audio as Float32Array                      │
│          └─> Run in transcriptionWorker                         │
└─────────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────────────┐
│  Lemonade Server      │       │  Browser (existing)           │
│  localhost:8000       │       │  transcriptionWorker.ts       │
│  whispercpp backend   │       │  Transformers.js              │
└───────────────────────┘       └───────────────────────────────┘
```

### 3.2 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Provider Selection** | Global setting (per-user) | Consistent with other transcription providers |
| **Fallback Behavior** | Auto-fallback to browser | Ensures transcription always works |
| **Audio Format** | Send original file/blob | No conversion needed, Lemonade handles all formats |
| **Large File Handling** | Single request (no chunking) | whisper.cpp handles long audio natively |
| **Server Detection** | On-demand + periodic health check | Balance responsiveness with overhead |

---

## 4. Implementation Plan

### 4.1 Files to Create

| File | Purpose | Estimated Lines |
|------|---------|-----------------|
| `src/services/lemonadeWhisperService.ts` | Lemonade STT API client | ~150 |
| `src/components/common/settings/LemonadeTranscriptionSettings.tsx` | Lemonade-specific settings | ~80 |

### 4.2 Files to Modify

| File | Changes | Estimated Lines |
|------|---------|-----------------|
| `src/stores/settingsStore.ts` | Add 'lemonade' to TranscriptionProvider type | ~5 |
| `src/services/whisperService.ts` | Add routing logic, Lemonade integration | ~80 |
| `src/components/common/settings/TranscriptionSettings.tsx` | Add Lemonade provider option | ~15 |
| `src/workers/transcriptionWorker.ts` | Optional: progress handling updates | ~10 |

### 4.3 Implementation Phases

**Phase 1: Core Service (1-2 hours)**
- Create `lemonadeWhisperService.ts`
- Implement `transcribe()` method with FormData upload
- Add server health check integration

**Phase 2: Settings Integration (1 hour)**
- Add 'lemonade' to `TranscriptionProvider` type
- Update settings store persistence
- Add provider option to TranscriptionSettings UI

**Phase 3: Routing Logic (1 hour)**
- Modify `whisperService.transcribe()` to route based on provider
- Implement fallback detection and auto-switching
- Add error handling for server errors

**Phase 4: Testing & Polish (1-2 hours)**
- Test with sample audio files
- Verify fallback behavior when server offline
- Add loading states and status indicators

---

## 5. Code Scaffolding

### 5.1 LemonadeWhisperService

```typescript
// src/services/lemonadeWhisperService.ts
// Lemonade Whisper Service
// Server-side transcription via Lemonade Server whisper.cpp

import { Logger } from './logger';
import { lemonadeProvider } from './lemonadeProvider';
import type { TranscriptEntry } from '../stores/multicamStore';

const log = Logger.create('LemonadeWhisper');

export interface LemonadeTranscriptionOptions {
  model?: string;
  language?: string;
  responseFormat?: 'json' | 'text' | 'verbose_json';
  timestampGranularities?: 'segment' | 'word';
}

export interface LemonadeTranscriptionResult {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

class LemonadeWhisperServiceClass {
  private defaultOptions: LemonadeTranscriptionOptions = {
    model: 'whisper-1',
    language: 'en',
    responseFormat: 'verbose_json',
    timestampGranularities: 'segment',
  };

  /**
   * Transcribe audio file via Lemonade Server
   */
  async transcribe(
    audioBlob: Blob,
    options: LemonadeTranscriptionOptions = {}
  ): Promise<LemonadeTranscriptionResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    log.info('Starting Lemonade transcription', {
      model: mergedOptions.model,
      language: mergedOptions.language,
      audioSize: audioBlob.size,
    });

    // Check server availability
    const serverAvailable = await lemonadeProvider.checkServerHealth();
    if (!serverAvailable.available) {
      throw new Error('Lemonade Server is offline. Please start the server.');
    }

    // Build FormData request
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', mergedOptions.model!);
    formData.append('language', mergedOptions.language!);
    formData.append('response_format', mergedOptions.responseFormat!);
    formData.append('timestamp_granularities', mergedOptions.timestampGranularities!);

    try {
      const response = await fetch(
        `${lemonadeProvider.getConfig().endpoint}/audio/transcriptions`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer lemonade',
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `Server returned ${response.status}`;
        log.error('Transcription failed:', errorMessage);
        throw new Error(`Transcription failed: ${errorMessage}`);
      }

      const result: LemonadeTranscriptionResult = await response.json();

      log.info('Transcription complete', {
        textLength: result.text.length,
        segments: result.segments.length,
      });

      return result;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Lemonade Server unreachable. Please ensure it is running.');
      }
      throw error;
    }
  }

  /**
   * Convert Lemonade result to TranscriptEntry format
   */
  toTranscriptEntries(
    result: LemonadeTranscriptionResult,
    speakerName: string = 'Speaker 1'
  ): TranscriptEntry[] {
    return result.segments.map((segment, index) => ({
      id: `transcript-lemonade-${index}`,
      start: segment.start * 1000, // Convert to milliseconds
      end: segment.end * 1000,
      speaker: speakerName,
      text: segment.text.trim(),
    }));
  }

  /**
   * Check if server is available
   */
  async isAvailable(): Promise<boolean> {
    const result = await lemonadeProvider.checkServerHealth();
    return result.available;
  }
}

// HMR-safe singleton
let instance: LemonadeWhisperServiceClass | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.lemonadeWhisperService) {
    instance = import.meta.hot.data.lemonadeWhisperService;
    log.debug('Restored instance from HMR');
  }
  import.meta.hot.dispose((data) => {
    data.lemonadeWhisperService = instance;
  });
}

export const lemonadeWhisperService = instance ?? new LemonadeWhisperServiceClass();

if (import.meta.hot && !instance) {
  instance = lemonadeWhisperService;
  import.meta.hot.data.lemonadeWhisperService = instance;
}

export { LemonadeWhisperServiceClass };
```

### 5.2 Settings Store Changes

```typescript
// src/stores/settingsStore.ts

// 1. Update TranscriptionProvider type (line ~41)
export type TranscriptionProvider =
  | 'local'
  | 'openai'
  | 'assemblyai'
  | 'deepgram'
  | 'lemonade';  // ADD THIS

// 2. Add Lemonade-specific settings to SettingsState (around line 79)
export interface SettingsState {
  // ... existing fields ...

  // Transcription settings
  transcriptionProvider: TranscriptionProvider;
  lemonadeTranscriptionEnabled: boolean;  // NEW
  lemonadeTranscriptionFallback: boolean; // NEW - auto-fallback to browser
}

// 3. Add actions (around line 147)
export interface SettingsState {
  // ... existing actions ...
  setLemonadeTranscriptionEnabled: (enabled: boolean) => void;
  setLemonadeTranscriptionFallback: (enabled: boolean) => void;
}

// 4. Implement actions (around line 270)
setLemonadeTranscriptionEnabled: (enabled) => {
  set({ lemonadeTranscriptionEnabled: enabled });
},
setLemonadeTranscriptionFallback: (enabled) => {
  set({ lemonadeTranscriptionFallback: enabled });
},

// 5. Update persistence partialize (around line 435)
partialize: (state) => ({
  // ... existing fields ...
  transcriptionProvider: state.transcriptionProvider,
  lemonadeTranscriptionEnabled: state.lemonadeTranscriptionEnabled,
  lemonadeTranscriptionFallback: state.lemonadeTranscriptionFallback,
  // ... rest of fields ...
}),
```

### 5.3 TranscriptionSettings UI

```tsx
// src/components/common/settings/TranscriptionSettings.tsx

import { useSettingsStore, type TranscriptionProvider } from '../../../stores/settingsStore';

const providers: {
  id: TranscriptionProvider;
  label: string;
  description: string;
  requiresServer?: boolean;
}[] = [
  {
    id: 'local',
    label: 'Local (Browser)',
    description: 'Runs in browser with Transformers.js. No setup required.'
  },
  {
    id: 'lemonade',
    label: 'Lemonade Server',
    description: 'Server-side whisper.cpp. Faster, uses GPU/NPU.',
    requiresServer: true,
  },
  {
    id: 'openai',
    label: 'OpenAI Whisper API',
    description: 'High accuracy, $0.006/minute. Requires API key.'
  },
  {
    id: 'assemblyai',
    label: 'AssemblyAI',
    description: 'Excellent accuracy, speaker diarization. $0.015/minute.'
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    description: 'Fast, good accuracy. $0.0125/minute.'
  },
];

export function TranscriptionSettings() {
  const {
    transcriptionProvider,
    setTranscriptionProvider,
    lemonadeTranscriptionFallback,
    setLemonadeTranscriptionFallback,
    apiKeys
  } = useSettingsStore();

  const [lemonadeAvailable, setLemonadeAvailable] = useState(false);

  // Check Lemonade availability on mount
  useEffect(() => {
    import('./lemonadeWhisperService').then(({ lemonadeWhisperService }) => {
      lemonadeWhisperService.isAvailable().then(setLemonadeAvailable);
    });
  }, []);

  return (
    <div className="settings-category-content">
      <h2>Transcription</h2>

      <div className="settings-group">
        <div className="settings-group-title">Provider</div>

        <div className="provider-list">
          {providers.map((provider) => (
            <label
              key={provider.id}
              className={`provider-option ${
                transcriptionProvider === provider.id ? 'active' : ''
              } ${provider.requiresServer && !lemonadeAvailable ? 'disabled' : ''}`}
            >
              <input
                type="radio"
                name="transcriptionProvider"
                value={provider.id}
                checked={transcriptionProvider === provider.id}
                onChange={() => setTranscriptionProvider(provider.id)}
                disabled={provider.requiresServer && !lemonadeAvailable}
              />
              <div className="provider-info">
                <span className="provider-label">
                  {provider.label}
                  {provider.requiresServer && (
                    <span className={`status-indicator ${lemonadeAvailable ? 'online' : 'offline'}`}>
                      {lemonadeAvailable ? '●' : '○'}
                    </span>
                  )}
                </span>
                <span className="provider-description">{provider.description}</span>
                {provider.requiresServer && !lemonadeAvailable && (
                  <span className="provider-warning">
                    Server offline - install Lemonade Server for this provider
                  </span>
                )}
              </div>
              {provider.id !== 'local' && !provider.requiresServer && apiKeys[provider.id as keyof typeof apiKeys] && (
                <span className="provider-status">✓</span>
              )}
            </label>
          ))}
        </div>

        {/* Lemonade-specific settings */}
        {transcriptionProvider === 'lemonade' && (
          <div className="lemonade-settings">
            <label className="checkbox-setting">
              <input
                type="checkbox"
                checked={lemonadeTranscriptionFallback}
                onChange={(e) => setLemonadeTranscriptionFallback(e.target.checked)}
              />
              <span>Auto-fallback to browser if server is offline</span>
            </label>
            <p className="settings-hint">
              When enabled, transcription will automatically use the browser-based
              Whisper if Lemonade Server is unavailable.
            </p>
          </div>
        )}

        <p className="settings-hint">
          API keys for transcription providers can be configured in the API Keys section.
          Lemonade Server requires no API key - just ensure it is running locally.
        </p>
      </div>
    </div>
  );
}
```

### 5.4 whisperService Routing Logic

```typescript
// src/services/whisperService.ts

// ADD at top of file
import { useSettingsStore } from '../stores/settingsStore';
import { lemonadeWhisperService } from './lemonadeWhisperService';

// MODIFY the transcribe method
class WhisperService {
  // ... existing private methods ...

  /**
   * Transcribe audio from a media file
   */
  async transcribe(
    mediaFileId: string,
    onProgress?: (progress: number) => void
  ): Promise<TranscriptEntry[]> {
    const { transcriptionProvider, lemonadeTranscriptionFallback } =
      useSettingsStore.getState();

    log.info('Starting transcription', { provider: transcriptionProvider });

    // Route to Lemonade if selected
    if (transcriptionProvider === 'lemonade') {
      return this.transcribeWithLemonade(
        mediaFileId,
        onProgress,
        lemonadeTranscriptionFallback
      );
    }

    // Fall through to existing browser-based transcription
    return this.transcribeWithBrowser(mediaFileId, onProgress);
  }

  /**
   * Transcribe using Lemonade Server
   */
  private async transcribeWithLemonade(
    mediaFileId: string,
    onProgress?: (progress: number) => void,
    useFallback?: boolean
  ): Promise<TranscriptEntry[]> {
    const mediaStore = useMediaStore.getState();
    const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);

    if (!mediaFile || !mediaFile.file) {
      throw new Error('Media file not found');
    }

    onProgress?.(10);

    try {
      // Check server availability
      const available = await lemonadeWhisperService.isAvailable();

      if (!available) {
        if (useFallback) {
          log.warn('Lemonade offline, falling back to browser');
          return this.transcribeWithBrowser(mediaFileId, onProgress);
        }
        throw new Error('Lemonade Server is offline. Enable auto-fallback or start the server.');
      }

      onProgress?.(30);

      // Send file to Lemonade (no audio extraction needed)
      const result = await lemonadeWhisperService.transcribe(mediaFile.file);

      onProgress?.(95);

      // Convert to TranscriptEntry format
      const entries = lemonadeWhisperService.toTranscriptEntries(result);

      onProgress?.(100);
      log.info('Lemonade transcription complete', { entries: entries.length });

      return entries;
    } catch (error) {
      log.error('Lemonade transcription error:', error);

      if (useFallback) {
        log.warn('Falling back to browser transcription');
        return this.transcribeWithBrowser(mediaFileId, onProgress);
      }

      throw error;
    }
  }

  /**
   * Transcribe using browser-based Whisper (existing implementation)
   */
  private async transcribeWithBrowser(
    mediaFileId: string,
    onProgress?: (progress: number) => void
  ): Promise<TranscriptEntry[]> {
    // ... existing transcribe implementation renamed here ...
    await this.loadModel((progress) => {
      onProgress?.(Math.round(progress * 0.5));
    });

    const audioData = await this.extractAudio(mediaFileId);
    // ... rest of existing code ...
  }

  // ... rest of existing methods ...
}
```

---

## 6. Key Questions & Answers

### Q1: Should this be a global setting or per-transcription choice?

**Answer: Global setting (per-user)**

Rationale:
- Consistent with existing transcription provider pattern (local/OpenAI/AssemblyAI/Deepgram)
- Users typically have a preferred workflow
- Per-transcription choice adds UI complexity for minimal benefit
- Users can change provider in Settings before any transcription

### Q2: How to handle large audio files (chunking vs single request)?

**Answer: Single request (no chunking)**

Rationale:
- Lemonade's whisper.cpp handles long audio natively
- whisper.cpp is optimized for long-form transcription
- Browser memory is conserved (no Float32Array allocation)
- Server has more RAM and can process in one pass
- Simpler implementation, fewer edge cases

If files exceed server limits (e.g., >2 hours):
- Server will return error
- User can split clips manually in timeline
- Consider chunking as future enhancement if needed

### Q3: What happens when Lemonade is offline (auto-fallback)?

**Answer: Three-tier fallback strategy**

```
1. User selects 'Lemonade' as provider
2. On transcribe():
   a. Check server availability
   b. If online → use Lemonade
   c. If offline:
      - Auto-fallback enabled → use browser Whisper
      - Auto-fallback disabled → show error dialog
3. Error dialog offers:
   - "Start Lemonade Server" (link to instructions)
   - "Use Browser Instead" (one-time fallback)
   - "Cancel"
```

### Q4: Should we support language selection?

**Answer: Yes, via existing pattern**

The current `transcriptionWorker.ts` already supports:
- `'en'` - English-only model
- `'auto'` - Auto-detect language
- Other ISO codes - Specific language

Lemonade Whisper should mirror this:
```typescript
const result = await lemonadeWhisperService.transcribe(audioBlob, {
  language: 'en', // or 'auto', 'de', 'fr', etc.
});
```

---

## 7. Error Handling

### 7.1 Error Scenarios

| Error | User Message | Fallback Action |
|-------|--------------|-----------------|
| Server offline | "Lemonade Server is not running" | Auto-fallback if enabled |
| Server timeout | "Server took too long to respond" | Retry once, then fallback |
| Model not loaded | "Whisper model not available" | Suggest model download |
| Audio format error | "Audio format not supported" | Try format conversion |
| Rate limit | "Server is busy, try again" | Queue for retry |

### 7.2 Error Recovery Code

```typescript
async function transcribeWithRetry(
  mediaFileId: string,
  maxRetries: number = 2
): Promise<TranscriptEntry[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await whisperService.transcribe(mediaFileId);
    } catch (error) {
      lastError = error as Error;

      if (error instanceof Error && error.message.includes('offline')) {
        // Don't retry offline errors - use fallback immediately
        break;
      }

      log.warn(`Transcription attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
      }
    }
  }

  throw lastError;
}
```

---

## 8. Testing Checklist

### 8.1 Functional Tests

- [ ] Lemonade transcription with server online
- [ ] Browser fallback when server offline (auto-fallback enabled)
- [ ] Error when server offline (auto-fallback disabled)
- [ ] Large file transcription (>10 minutes audio)
- [ ] Multi-language transcription (auto-detect)
- [ ] Progress reporting (0-100%)
- [ ] Transcript entry timestamps accuracy

### 8.2 Integration Tests

- [ ] Settings provider selection persists across sessions
- [ ] UI status indicator updates when server starts/stops
- [ ] Concurrent transcriptions (queue handling)
- [ ] Memory usage comparison (Lemonade vs browser)

### 8.3 Performance Benchmarks

| Metric | Browser | Lemonade | Target |
|--------|---------|----------|--------|
| 1-minute audio | ~3 min | ~30 sec | <1 min |
| 5-minute audio | ~15 min | ~2 min | <3 min |
| Memory usage | ~500 MB | ~50 MB | <100 MB |
| CPU usage | ~100% | ~5% | <20% |

---

## 9. Documentation Updates

### 9.1 User Documentation

Add to `docs/Features/Transcription.md`:

```markdown
## Lemonade Server Transcription

Lemonade Server provides server-side whisper.cpp transcription for faster results.

### Setup

1. Install Lemonade Server from https://github.com/lemonade-sdk/lemonade
2. Start the server: `python -m lemonade --port 8000`
3. In MasterSelects Settings → Transcription, select "Lemonade Server"
4. (Optional) Enable "Auto-fallback to browser" for offline support

### Benefits

- **Faster**: 5-10x faster than browser transcription
- **Lower memory**: No model download, minimal browser RAM
- **Better accuracy**: Supports larger whisper models (small, medium)
- **Server-side**: No CPU usage during transcription

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Server offline" | Start Lemonade Server |
| "Model not available" | Download whisper model in Lemonade |
| Slow transcription | Check server is using GPU/NPU |
```

### 9.2 Developer Documentation

Update `docs/lemonade/README.md`:

```markdown
## STT Integration Status

| Component | Status | Notes |
|-----------|--------|-------|
| Endpoint | VERIFIED | `/api/v1/audio/transcriptions` |
| FormData | VERIFIED | file, model, language, response_format |
| Integration | PENDING | See whisper-integration-plan.md |
```

---

## 10. Related Documents

| Document | Purpose |
|----------|---------|
| [`technical-analysis.md`](./technical-analysis.md) | API endpoint specifications |
| [`validation-results.md`](./validation-results.md) | STT endpoint validation |
| [`quality-review.md`](./quality-review.md) | Quality gates and testing |
| [`README.md`](./README.md) | Integration overview |

---

## 11. Appendix: Quick Commands

### Test Lemonade STT Endpoint

```bash
# Basic connectivity test
curl http://localhost:8000/api/v1/audio/transcriptions \
  -H "Authorization: Bearer lemonade" \
  -F "file=@test.wav" \
  -F "model=whisper-1" \
  -F "language=en" \
  -F "response_format=verbose_json"
```

### Compare Transcription Speed

```bash
# Browser (Transformers.js)
# Check browser console timing

# Lemonade
time curl -s http://localhost:8000/api/v1/audio/transcriptions \
  -H "Authorization: Bearer lemonade" \
  -F "file=@sample-5min.wav" \
  -F "model=whisper-1" \
  -o /dev/null
```

### Check Server Logs

```bash
# Lemonade Server logs (check for transcription requests)
tail -f c:/users/antmi/lemonade/logs/server.log
```

---

*This document provides the complete implementation plan for Lemonade Whisper integration. Follow the scaffolding code and modify as needed during implementation.*
