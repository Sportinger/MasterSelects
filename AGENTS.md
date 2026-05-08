# AGENTS.md

Repo-Anweisungen fuer Codex und andere Coding Agents bei der Arbeit an MasterSelects.

Diese Datei ist das Codex-Pendant zu `CLAUDE.md`. Wenn sich Workflow, Branch-Regeln, Debug-Rezepte oder Projektkonventionen aendern, `AGENTS.md` und `CLAUDE.md` gemeinsam pflegen.

---

## 0. Projektziel / Vision

MasterSelects soll bis Juni 2026 ALLE Media-Dateien unterstuetzen, nicht nur Video, Audio und Bilder, sondern wirklich alles:

- 3D: OBJ, FBX, glTF
- Dokumente: PDF, SVG
- CAD / technische Daten: DXF, STEP
- Datenformate: JSON, CSV, binaere Formate, Point Clouds und mehr

Inspiration ist das TouchDesigner-Prinzip: Jede Datei wird zu einem visuellen Signal. Es gibt keine "nicht unterstuetzten" Dateien. Alles wird Textur, Geometrie oder Daten, kann auf der Timeline platziert, composited und exportiert werden.

## 0.1 Codex Skill Mapping

Die alten Claude-Commands unter `C:\Users\admin\.claude\commands\` sollen in Codex ueber Skills abgebildet werden. Wenn die folgenden Skills verfuegbar sind, diese bevorzugen:

| Claude Command | Codex Skill | Zweck |
|---|---|---|
| `/masterselects` | `masterselects` | Timeline-, Clip-, Preview- und Analyse-Aktionen ueber die lokale AI-Bridge |
| `/cloudflare` | `cloudflare-api` | Cloudflare REST / Wrangler |
| `/stripe` | `stripe-api` | Stripe REST API |
| `/vazer` | `vazer-app-api` | Lokale VAZer App / XML / Analyse |
| `/react-doctor` | `react-doctor` | React-Codebase-Analyse |
| `/nano-banana` | `nano-banana` | Bildgenerierung via Gemini |
| `/kie` | `kie-ai-api-route` | Kie.ai Bild- und Video-Generation |
| `/kling` | `kling` | Kling Video Prompting / API |
| `/tasks` | `tasks` | Aufgabenliste |
| `/email` | `email` | Strato / OX Mail |
| `/gmail` | `gmail` | Gmail per IMAP/SMTP |
| `/dienstplan` | `dienstplan` | PDF-Dienstplan -> Kalender |

Wenn ein Skill nicht verfuegbar ist, direkt ueber lokale Skripte, MCP-Tools, HTTP-Bridge oder API arbeiten. Nicht an Claude-Command-Dateien haengen bleiben.

## 0.2 MasterSelects Debug Bridge

Fuer App-Debugging existieren lokale AI-Tools hinter `POST http://localhost:5173/api/ai-tools`. Voraussetzung: Dev-Server laeuft und die App ist im Browser geoeffnet.

| Tool | Parameter | Zweck |
|---|---|---|
| `getStats` | none | Engine-Snapshot: FPS, Timing, Decoder, Drops, Audio, GPU |
| `getStatsHistory` | `samples?`, `intervalMs?` | Mehrere Snapshots mit min/max/avg |
| `getLogs` | `limit?`, `level?`, `module?`, `search?` | Browser-Logs gefiltert abrufen |
| `getPlaybackTrace` | `windowMs?`, `limit?` | WebCodecs- und VF-Pipeline-Events plus Health-State |
| `debugExport` | `startTime?`, `endTime?`, `durationSeconds?`, `width?`, `height?`, `fps?`, `includeAudio?`, `exportMode?`, `download?`, `maxRuntimeMs?` | Dev-Bridge-only Exportprobe im echten Browser. Ruft `FrameExporter` auf und liefert Blob-Groesse, Progress, Engine-Status und Export-/GPU-Logs zurueck. |

Der `masterselects`-Skill ist der bevorzugte Einstieg. Wenn der Skill nicht nutzbar ist, die HTTP-Bridge direkt per `curl` ansprechen.

### Export-Debug ueber Bridge

Wenn Export im UI haengt oder fehlschlaegt, zuerst im echten Browser ueber die Bridge reproduzieren. Der lokale Dev-Bridge-POST braucht den Bearer-Token aus `.ai-bridge-token`:

```powershell
$token = Get-Content -Path .ai-bridge-token -Raw
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

$body = @{ tool = 'getStats'; args = @{} } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Smoke-Test ohne Download:

```powershell
$body = @{
  tool = 'debugExport'
  args = @{
    startTime = 0
    durationSeconds = 1.0
    width = 640
    height = 360
    fps = 15
    includeAudio = $false
    exportMode = 'fast'
    download = $false
    maxRuntimeMs = 25000
  }
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Full-Timeline-Test mit aktuellen Exportdefaults:

```powershell
$body = @{ tool = 'debugExport'; args = @{ includeAudio = $true; exportMode = 'fast'; download = $false } } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://localhost:5173/api/ai-tools' -Method Post -Headers $headers -Body $body
```

Interpretation:

- `debugExport` ist absichtlich kein Chat/Public-Tool, sondern ein selbstregistrierter Dev-Bridge-Handler mit Policy-Zugriff fuer `devBridge`, `console` und `internal`.
- `maxRuntimeMs` bricht den Browser-Export sauber ab, bevor der Dev-Bridge-Request haengt; fuer lange Exporte gezielt hoeher setzen.
- Wenn `debugExport` einen Blob mit `size > 0` liefert, funktioniert der Browser-Exportpfad grundsaetzlich. UI-Fehler dann in `ExportPanel`, Download, Preset-State oder Progress-State suchen.
- Wenn Logs `WebGPU device lost during export` zeigen und `getStats` danach `renderLoop.isRunning=false`, `renderDispatcher=null` oder `targetCanvasCount=0` meldet, ist die Browser-Engine in einem stale Device-State. Erst `reloadApp`/Hard Reload ueber die Bridge oder Browser neu laden, dann erneut testen.
- Windows-Warnungen zu `requestAdapter(powerPreference)` und NativeHelper-WebSocket-Fehler sind nicht automatisch Exportblocker. NativeHelper ist nur relevant, wenn der getestete Pfad ihn wirklich braucht.
- Bei Timeline mit Video-only-Clips muss `FrameExporter` Audio ueberspringen; ein langer Start bei "Rendering audio" weist auf fehlerhafte Audio-Range-Erkennung hin.

---

## 1. Workflow

### Branch-Regeln

| Branch | Zweck |
|---|---|
| `staging` | Entwicklung, Standardziel fuer laufende Arbeit |
| `master` | Production, nur via PR |

### Commit- und Push-Regeln

Vor jedem Commit alle Checks ausfuehren:

```bash
npm run build
npm run lint
npm run test
```

Regeln:

- Nie direkt auf `master` committen.
- Nie selbststaendig nach `master` mergen.
- Nie selbststaendig pushen, ausser der User verlangt es explizit.
- Kleine, zusammenhaengende Aenderungen bevorzugen.
- Nicht committen, wenn Build, Lint oder Tests fehlschlagen.

### Merge zu Master

Nur wenn der User es explizit verlangt:

1. Version in `src/version.ts` erhoehen.
2. CHANGELOG in `src/version.ts` aktualisieren.
3. Commit und Push.
4. PR von `staging` nach `master` erstellen und mergen.
5. `staging` wieder auf den aktuellen `master`-Stand bringen.

### Version / Changelog

- Datei: `src/version.ts`
- Version nur bei Merge nach `master` erhoehen
- CHANGELOG immer am Anfang erweitern
- `KNOWN_ISSUES` aktuell halten

### Dokumentation

Bei Feature-Aenderungen relevante Doku in `docs/Features/` aktualisieren.

---

## 2. Quick Reference

```bash
npm install && npm run dev
npm run dev:changelog
npm run build
npm run build:deploy
npm run lint
npm run test
npm run test:watch
npm run test:unit
npm run test:ui
npm run test:coverage
npm run preview
```

### Dev-Server Regeln

- Standard ist `npm run dev`
- `npm run dev:changelog` nur, wenn der Changelog-Dialog gebraucht wird
- Production-Builds zeigen den Changelog automatisch

### Native Helper

```bash
cd tools/native-helper
cargo run --release
```

Ports:

- WebSocket: `9876`
- HTTP: `9877`

---

## 3. Architektur

Wichtige Bereiche:

- `src/components/`: React-UI, Timeline, Panels, Preview, Docking, Export, Mobile
- `src/stores/`: Zustand-Stores fuer Timeline, Media, History, Settings, Dock, Slice, Render Targets, SAM2, Multicam, YouTube
- `src/engine/`: WebGPU Rendering, Render Dispatcher, Texture-, Audio-, Export- und Analysis-Pipeline
- `src/effects/`: GPU-Effekte und gemeinsame Shader
- `src/transitions/`: GPU-Transitions
- `src/services/`: Business Logic wie Layer Builder, Media Runtime, Monitoring, Project Storage, AI Tools, Export
- `src/hooks/`, `src/utils/`, `src/types/`, `src/workers/`, `src/shaders/`

Besonders zentrale Dateien:

- `src/engine/WebGPUEngine.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/stores/timeline/index.ts`
- `src/stores/mediaStore/index.ts`
- `src/stores/historyStore.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/services/logger.ts`
- `src/engine/featureFlags.ts`

Mehr Kontext steht in `README.md` und `docs/Features/README.md`.

---

## 4. Kritische Patterns

### HMR-Singletons

Singletons wie Engine, FFmpegBridge oder SAM2 muessen HMR ueberleben.

```ts
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

### Stale Closures vermeiden

In async Callbacks immer frischen Zustand ueber `get()` oder funktionale Updates lesen.

```ts
video.onload = () => {
  const current = get().layers;
  set({ layers: current.map(...) });
};
```

### Video Ready State

Auf `canplaythrough` warten, nicht nur auf `loadeddata`.

### Zustand Slice Pattern

```ts
export const createSlice: SliceCreator<Actions> = (set, get) => ({
  actionName: (params) => {
    const state = get();
    set({ /* updates */ });
  },
});
```

### React State Updates

- Funktionale `setState`-Updates bevorzugen
- Lazy State Initialization fuer teure Initialisierung nutzen
- `toSorted()` statt `sort()` verwenden, um Mutationen zu vermeiden

### Zustand Middleware

- Alle Stores nutzen `subscribeWithSelector`
- `settingsStore` und `dockStore` nutzen zusaetzlich `persist`
- `mediaStore` nutzt eine abweichende Slice-Creator-Signatur als Timeline

---

## 5. Debugging und Logging

### Logger

```ts
import { Logger } from '@/services/logger';
const log = Logger.create('ModuleName');

log.debug('Verbose', { data });
log.info('Event');
log.warn('Warning', data);
log.error('Fehler', error);
```

### Browser-Console Shortcuts

```js
Logger.enable('WebGPU,FFmpeg')
Logger.enable('*')
Logger.disable()
Logger.setLevel('DEBUG')
Logger.setLevel('WARN')
Logger.search('device')
Logger.errors()
Logger.dump(50)
Logger.summary()
```

### Haeufige Probleme

| Problem | Check |
|---|---|
| Schwarzes Canvas | `readyState >= 2` pruefen |
| Device mismatch | HMR kaputt, Seite neu laden |
| Linux mit 15fps | Vulkan-Flag pruefen |
| WebCodecs Fehler | Fallback auf HTMLVideoElement erwarten |
| Schwarz nach Refresh | Cold-Start / Restore-Pfad, ggf. hard reload |

### Playback Debugging

Im Browser verfuegbar:

- `window.__WC_PIPELINE__`
- `window.__VF_PIPELINE__`

Hilfreiche Log-Module:

```js
Logger.enable('WebCodecsPlayer,PlaybackHealth,LayerCollector')
Logger.enable('VideoSyncManager,ParallelDecode,RenderLoop')
Logger.setLevel('DEBUG')
```

Wichtige Monitoring-Services in `src/services/monitoring/`:

- `playbackHealthMonitor`
- `playbackDebugStats`
- `framePhaseMonitor`
- `wcPipelineMonitor`
- `vfPipelineMonitor`
- `scrubSettleState`

### Scripted Playback-Tests

Wenn der Dev-Server laeuft, fuer Repros bevorzugt die AI-Bridge nutzen:

- `simulateScrub`
- `simulatePlayback`
- `simulatePlaybackPath`
- `getPlaybackTrace`
- `getClipDetails`
- `reloadApp`

Worauf in Traces achten:

- `stalePreviewWhileTargetMoved`
- `decoderResets`
- `previewFreezeEvents`
- `previewPathCounts.empty`
- `driftSeconds`
- Health-Anomalien wie `FRAME_STALL`, `SEEK_STUCK`, `HIGH_DROP_RATE`, `GPU_SURFACE_COLD`
- `firstPreviewUpdateMs`

Weitere Details: `docs/Features/Debugging.md` und `docs/Features/Playback-Debugging.md`

---

## 6. Render- und Datenfluss

Grober Render-Pfad:

```text
useEngine
  -> WebGPUEngine.initialize()
    -> RenderLoop.start()
      -> RenderDispatcher.render(layers)
        -> LayerCollector
        -> Compositor / Effects
        -> NestedCompRenderer
        -> OutputPipeline
        -> SlicePipeline
```

Texture-Typen:

| Quelle | GPU-Typ |
|---|---|
| HTMLVideoElement | `texture_external` via `importExternalTexture` |
| Firefox HTMLVideo Fallback | `texture_2d<f32>` |
| VideoFrame | `texture_external` |
| HTMLImageElement | `texture_2d<f32>` |
| Canvas / Text | `texture_2d<f32>` |
| Native Decoder Frames | dynamische `texture_2d<f32>` |

---

## 7. Praktische Agent-Regeln fuer dieses Repo

- Erst Kontext lesen, dann aendern.
- Bei Timeline-, Playback-, Render- oder Export-Bugs zuerst Logs / Traces / Monitoring sichten.
- Bei groesseren Feature-Aenderungen immer auch Auswirkungen auf `docs/Features/`, `src/version.ts` und Tests pruefen.
- Fuer Editor-Automation bevorzugt den `masterselects`-Skill statt manuelle Browser-Spekulation.
- Wenn ein Workflow aus `CLAUDE.md` und `AGENTS.md` auseinanderlaeuft, beide Dateien wieder synchronisieren.
