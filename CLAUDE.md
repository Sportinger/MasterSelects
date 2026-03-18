# CLAUDE.md

Anweisungen für AI-Assistenten (Claude, GPT, etc.) bei der Arbeit an diesem Projekt.

---

## 0. Projektziel / Vision (Deadline: Juni 2026)

**MasterSelects muss ALLE Media-Dateien unterstützen** — nicht nur Video/Audio/Bild, sondern wirklich ALLES:
3D (OBJ, FBX, glTF), PDF, SVG, CAD (DXF/STEP), Binärdaten, Point Clouds, JSON, CSV, und mehr.

**Inspiration: TouchDesigner-Prinzip** — Jede Datei wird zu einem visuellen Signal. So wie TouchDesigner in SOPs/TOPs/CHOPs jede Datenquelle sichtbar und manipulierbar macht (Geometrie → Vertices als Farben, Audio → Wellenform-Textur, Daten → Heatmaps), soll MasterSelects jedes Dateiformat in die GPU-Pipeline bringen und auf dem Canvas rendern können.

**Kernidee:** Es gibt keine "nicht unterstützten" Dateien. Alles wird Textur, Geometrie oder Daten — alles kann auf der Timeline platziert, composited und exportiert werden.

---

## 0.1 AI Debug Tools (kein Browser-Plugin nötig!)

Die `/masterselects` Skill stellt 4 Debug-Tools bereit, die über den HTTP Bridge laufen (`POST http://localhost:5173/api/ai-tools`). Voraussetzung: Dev-Server läuft + App in Browser-Tab geöffnet.

| Tool | Parameters | Beschreibung |
|------|-----------|-------------|
| `getStats` | _(none)_ | Engine-Snapshot: FPS, Timing, Decoder, Drops, Audio, GPU |
| `getStatsHistory` | `samples?`, `intervalMs?` | N Snapshots über Zeit sammeln mit min/max/avg Summary |
| `getLogs` | `limit?`, `level?`, `module?`, `search?` | Browser-Logs filtern nach Level (DEBUG/INFO/WARN/ERROR), Modul, Suchtext |
| `getPlaybackTrace` | `windowMs?`, `limit?` | WebCodecs/VF Pipeline-Events + Health-State für Playback-Debugging |

**Nutzung:** `/masterselects getLogs module=PlaybackHealth level=WARN` oder `/masterselects getPlaybackTrace windowMs=10000`

---

## 1. Workflow (WICHTIG!)

### Branch-Regeln
| Branch | Zweck |
|--------|-------|
| `staging` | Entwicklung - hierhin committen |
| `master` | Production - nur via PR |

### Commit-Regeln
```bash
# VOR jedem Commit: Build prüfen!
npm run build

# Nach JEDER Änderung sofort:
git add . && git commit -m "description" && git push origin staging
```

**IMMER vor Commit:**
- `npm run build` ausführen
- Alle Errors beheben (Warnings sind OK)
- Erst dann committen

**NIEMALS:**
- Direkt auf `master` committen
- Selbstständig zu `master` mergen
- Mehrere Änderungen sammeln
- Committen ohne vorherigen Build-Check

### Merge zu Master (nur wenn User es verlangt!)
```bash
# 1. Version erhöhen in src/version.ts
# 2. CHANGELOG aktualisieren in src/version.ts
# 3. Commit & Push
# 4. PR erstellen und mergen:
gh pr create --base master --head staging --title "..." --body "..."
gh pr merge --merge
# 5. Staging synchronisieren:
git fetch origin && git merge origin/master && git push origin staging
```

### Version & Changelog
- **Datei:** `src/version.ts`
- **Version:** Nur bei Merge zu master erhöhen (PATCH +1)
- **CHANGELOG:** Neuen Eintrag am Anfang mit `version`, `date`, `changes[]`
- **KNOWN_ISSUES:** Aktuelle Bugs pflegen

### Dokumentation
Bei Feature-Änderungen: `docs/Features/` aktualisieren

---

## 2. Quick Reference

```bash
npm install && npm run dev   # http://localhost:5173 (ohne Changelog)
npm run dev:changelog        # Dev-Server MIT Changelog-Dialog
npm run build                # Production build (tsc + vite, Changelog immer aktiv)
npm run build:deploy         # Production build ohne tsc (nur vite)
npm run lint                 # ESLint check
npm run test                 # Vitest einmal ausführen
npm run test:watch           # Vitest im Watch-Modus
npm run test:unit            # Nur Unit-Tests (tests/unit/)
npm run test:ui              # Vitest mit Browser-UI
npm run test:coverage        # Vitest mit Coverage-Report
npm run preview              # Built output lokal serven
```

### Dev-Server Regeln
- **IMMER `npm run dev` verwenden** (ohne Changelog)
- `npm run dev:changelog` nur wenn User Changelog sehen will
- Production builds zeigen Changelog automatisch

### Native Helper (optional, cross-platform)
```bash
# All platforms (FFmpeg decode/encode + yt-dlp downloads):
cd tools/native-helper && cargo run --release

# Windows: requires FFMPEG_DIR + LIBCLANG_PATH env vars (see tools/native-helper/README.md)
```
Ports: WebSocket `9876`, HTTP `9877`

---

## 3. Architektur (Kurzübersicht)

```
src/
├── components/          # React UI
│   ├── timeline/        # Timeline-Editor (hooks/, components/, utils/)
│   ├── panels/          # Properties, Media, AI, Scopes, Transitions, SAM2, Transcript, etc.
│   ├── preview/         # Canvas + Overlays (Mask, SAM2, MultiPreview)
│   ├── dock/            # Panel-System (DockContainer, Tabs, Split, Float)
│   ├── common/          # Shared UI: Toolbar, Settings, Dialogs, Overlays
│   ├── export/          # Export Dialog + Panel
│   ├── outputManager/   # Output Window / Slice management
│   └── mobile/          # Mobile-optimized UI
├── stores/              # Zustand State
│   ├── timeline/        # 17 Slices: track, clip, keyframe, mask, playback, selection, transition,
│   │   │                #   ramPreview, proxyCache, clipEffect, linkedGroup, downloadClip,
│   │   │                #   solidClip, textClip, clipboard, aiActionFeedback, marker
│   │   ├── clip/        # Clip sub-modules (addVideoClip, addAudioClip, addImageClip, etc.)
│   │   ├── helpers/     # clipStateHelpers, idGenerator, blobUrlManager, audioDetection, etc.
│   │   └── selectors.ts # 50 optimized selectors (individual, grouped, derived, stable action)
│   ├── mediaStore/      # 9 Slices: fileImport, fileManage, folder, proxy, composition,
│   │   │                #   slot, multiLayer, project, selection
│   │   └── init.ts      # IndexedDB init, auto-save, beforeunload, audio cleanup
│   ├── historyStore.ts  # Snapshot-based Undo/Redo
│   ├── engineStore.ts   # Engine ready state, GPU info
│   ├── settingsStore.ts # User preferences
│   ├── dockStore.ts     # Panel layout state
│   ├── sliceStore.ts    # Slice/region management
│   ├── renderTargetStore.ts # Output targets
│   ├── sam2Store.ts     # SAM2 segmentation state
│   ├── multicamStore.ts # Multicam editing state
│   └── youtubeStore.ts  # YouTube download state
├── engine/              # WebGPU Rendering
│   ├── core/            # WebGPUContext, RenderTargetManager
│   ├── render/          # RenderLoop, RenderDispatcher, LayerCollector, Compositor, NestedCompRenderer, layerEffectStack
│   ├── pipeline/        # CompositorPipeline, EffectsPipeline, OutputPipeline, SlicePipeline
│   ├── texture/         # TextureManager, MaskTextureManager, ScrubbingCache
│   ├── managers/        # CacheManager, ExportCanvasManager, OutputWindowManager, outputWindowPlacement
│   ├── export/          # FrameExporter, VideoEncoderWrapper, AudioEncoder, types
│   ├── audio/           # AudioMixer, TimeStretchProcessor, AudioExportPipeline
│   ├── video/           # VideoFrameManager
│   ├── ffmpeg/          # FFmpegBridge
│   ├── analysis/        # Scopes (Histogram, Waveform, Vectorscope, OpticalFlow)
│   ├── stats/           # PerformanceStats
│   ├── structuralSharing/ # SnapshotManager for render optimization
│   ├── ParallelDecodeManager.ts  # Multi-clip parallel decode
│   ├── WebCodecsPlayer.ts        # WebCodecs playback engine
│   ├── WebCodecsExportMode.ts    # Export-specific WebCodecs path
│   └── featureFlags.ts           # Runtime feature toggles
├── effects/             # 30 GPU Effects (color/, blur/, distort/, stylize/, keying/, generate/, time/, transition/)
│   ├── _shared/         # common.wgsl (154 lines shared utility)
│   └── EffectsPipeline.ts # Effect orchestration
├── transitions/         # GPU Transitions (crossfade, etc.)
├── services/            # Business logic
│   ├── layerBuilder/    # LayerBuilderService, VideoSyncManager, AudioSyncHandler,
│   │                    #   AudioTrackSyncManager, LayerCache, FrameContext, TransformCache, types, index
│   ├── mediaRuntime/    # Clip bindings, runtime playback registry, session policies
│   ├── monitoring/      # playbackHealthMonitor, playbackDebugStats, framePhaseMonitor,
│   │                    #   vfPipelineMonitor, wcPipelineMonitor, scrubSettleState
│   ├── project/         # ProjectCoreService, NativeProjectCoreService, save/load, file service
│   │   └── domains/     # AnalysisService, CacheService, ProxyStorageService, RawMediaService, TranscriptService
│   ├── nativeHelper/    # Native FFmpeg decoder client
│   ├── sam2/            # SAM2 segmentation service
│   ├── aiTools/         # AI tool bridge (76 tools across 15 definition files)
│   │   ├── definitions/ # 15 tool definition files
│   │   └── handlers/    # Tool handler dispatch + visual feedback
│   ├── export/          # FCPXML export
│   └── (standalone)     # logger, audioManager, thumbnailRenderer, whisperService,
│                        #   renderScheduler, ramPreviewEngine, compositionRenderer,
│                        #   clipAnalyzer, clipTranscriber, sceneDescriber, apiKeyManager, etc.
├── hooks/               # React hooks: useEngine, useGlobalHistory, useMIDI, useTheme,
│                        #   useClipPanelSync, useContextMenuPosition, useThumbnailCache, ...
├── utils/               # Helpers: keyframeInterpolation, maskRenderer, fileLoader,
│                        #   speedIntegration, externalDragPlacement, externalDragSession, ...
├── types/               # TypeScript types, mp4box.d.ts
├── workers/             # Web Workers (transcription)
├── shaders/             # WGSL: composite, effects, output, slice, opticalflow
├── assets/              # Static assets
├── test/                # In-browser test components
└── changelog-data.json  # 5,000+ line changelog data (imported by version.ts)
```

**Detaillierte Struktur:** siehe `README.md` oder `docs/Features/`

---

## 4. Critical Patterns (MUST READ)

### HMR Singleton
Singletons (Engine, FFmpegBridge, SAM2Service) müssen Hot Reloads überleben:
```typescript
let instance: MyService | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.myService) {
    instance = import.meta.hot.data.myService;
  }
  import.meta.hot.dispose((data) => {
    data.myService = instance;
  });
}
```

### Stale Closure Fix
Immer `get()` in async Callbacks:
```typescript
// FALSCH
const { layers } = get();
video.onload = () => set({ layers: layers.map(...) });

// RICHTIG
video.onload = () => {
  const current = get().layers;
  set({ layers: current.map(...) });
};
```

### Video Ready State
Warten auf `canplaythrough`, nicht `loadeddata`:
```typescript
video.addEventListener('canplaythrough', () => {
  // Jetzt ist Video bereit
}, { once: true });
```

### Zustand Slice Pattern
```typescript
export const createSlice: SliceCreator<Actions> = (set, get) => ({
  actionName: (params) => {
    const state = get();
    set({ /* updates */ });
  },
});
```

### Functional setState (prevents stale closures)
```typescript
// WRONG: needs items as dependency, recreated on every change
const addItems = useCallback((newItems) => {
  setItems([...items, ...newItems])
}, [items])

// RIGHT: stable callback, no stale closure
const addItems = useCallback((newItems) => {
  setItems(curr => [...curr, ...newItems])
}, [])
```

### Lazy State Initialization
```typescript
// WRONG: runs on EVERY render
const [index, setIndex] = useState(buildSearchIndex(items))

// RIGHT: runs only once
const [index, setIndex] = useState(() => buildSearchIndex(items))
```

### toSorted() instead of sort() (prevents state mutation)
```typescript
// WRONG: mutates original array
const sorted = users.sort((a, b) => a.name.localeCompare(b.name))

// RIGHT: creates new array
const sorted = users.toSorted((a, b) => a.name.localeCompare(b.name))
```

### Zustand Middleware
All stores use `subscribeWithSelector` middleware. `settingsStore` and `dockStore` also use `persist` middleware.
MediaStore uses `MediaSliceCreator` variant (slightly different signature than timeline's `SliceCreator`).

---

## 5. Debugging & Logging

### Logger verwenden
```typescript
import { Logger } from '@/services/logger';
const log = Logger.create('ModuleName');

log.debug('Verbose', { data });  // Nur wenn DEBUG aktiv
log.info('Event');               // Immer sichtbar
log.warn('Warning', data);       // Orange
log.error('Fehler', error);      // Rot + Stack Trace
```

### Console Commands
```javascript
Logger.enable('WebGPU,FFmpeg')  // Module aktivieren
Logger.enable('*')              // Alle aktivieren
Logger.disable()                // Nur Errors

Logger.setLevel('DEBUG')        // Alle Level
Logger.setLevel('WARN')         // Nur Warn+Error

Logger.search('device')         // Logs durchsuchen
Logger.errors()                 // Nur Fehler
Logger.dump(50)                 // Letzte 50 ausgeben
Logger.summary()                // Übersicht für AI
```

### Common Issues

| Problem | Lösung |
|---------|--------|
| 15fps auf Linux | `chrome://flags/#enable-vulkan` aktivieren |
| "Device mismatch" | HMR kaputt -> Seite neu laden |
| Schwarzes Canvas | `readyState >= 2` prüfen |
| WebCodecs Fehler | Fällt automatisch auf HTMLVideoElement zurück |

---

## 6. Wichtige Dateien

| Bereich | Datei |
|---------|-------|
| Version/Changelog | `src/version.ts` |
| Engine Entry | `src/engine/WebGPUEngine.ts` |
| Render Dispatcher | `src/engine/render/RenderDispatcher.ts` |
| Timeline Store | `src/stores/timeline/index.ts` |
| Media Store | `src/stores/mediaStore/index.ts` |
| History (Undo/Redo) | `src/stores/historyStore.ts` |
| Effects Registry | `src/effects/index.ts` |
| Effects Pipeline | `src/effects/EffectsPipeline.ts` |
| Layer Builder | `src/services/layerBuilder/LayerBuilderService.ts` |
| Video Sync | `src/services/layerBuilder/VideoSyncManager.ts` |
| Logger | `src/services/logger.ts` |
| Project Storage | `src/services/project/core/ProjectCoreService.ts` |
| Engine Hook | `src/hooks/useEngine.ts` |
| Monitoring Services | `src/services/monitoring/playbackHealthMonitor.ts` |
| Media Runtime | `src/services/mediaRuntime/index.ts` |
| Native Project Storage | `src/services/project/core/NativeProjectCoreService.ts` |
| Feature Flags | `src/engine/featureFlags.ts` |

### Neuen Effect hinzufügen
Detailed guide: `docs/Features/Effects.md` (Developer Internals section)

---

## 7. Texture Types

| Source | GPU Type |
|--------|----------|
| Video (HTMLVideoElement) | `texture_external` via `importExternalTexture` (zero-copy) |
| Video (HTMLVideoElement, Firefox) | `texture_2d<f32>` via `htmlVideoPreviewFallback.ts` (copies to persistent texture to avoid black frames) |
| Video (VideoFrame) | `texture_external` via `importExternalTexture` (zero-copy) |
| Image (HTMLImageElement) | `texture_2d<f32>` via `copyExternalImageToTexture` (copied once, cached) |
| Canvas (Text Clips) | `texture_2d<f32>` via `copyExternalImageToTexture` (cached by reference) |
| Native Decoder Frames | `texture_2d<f32>` dynamic textures (re-uploaded per frame) |

---

## 8. Render Pipeline

```
useEngine hook (src/hooks/useEngine.ts)
  └── engine.initialize() -> WebGPUContext + all pipelines
        └── RenderLoop.start()
              └── requestAnimationFrame loop (idle detection + fps limiting)
                    └── RenderDispatcher.render(layers)
                          ├── LayerCollector: Import textures (external/cached/scrubbing)
                          ├── Compositor: Ping-pong compositing + effects per layer
                          ├── NestedCompRenderer: Handle compositions-in-compositions
                          ├── OutputPipeline: Output to preview canvas
                          └── SlicePipeline: Output to slice/render target canvases
```

---

*Ausführliche Dokumentation: `docs/Features/README.md`*
