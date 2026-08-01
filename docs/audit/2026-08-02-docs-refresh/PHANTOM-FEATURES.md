# Phantom-Features — dokumentiert, aber nicht (mehr) vorhanden

Destilliert aus den 52 Audit-Findings vom 2026-08-02. „(nie gebaut)" =
geplant/beschrieben, aber nie implementiert; „(entfernt)" = existierte,
wurde ausgebaut. Kosmetische Umbenennungen sind bewusst ausgelassen.

## Codex-Usage-Monitoring
- Fester Desktop-Shortcut/Projekt-Launcher → existiert nirgends; realer Ersatz ist `scripts/start-codex-usage-watch.ps1`.

## AI-Bridge-Control
- Fünf MCP-Chat-Tools (`bridge_send_chat_message`, `bridge_compare_chat_prompts`, `bridge_list_chat_runs`, `bridge_get_chat_run`, `bridge_get_chat_system_prompt`) → nicht mehr in `scripts/masterselects-mcp.mjs` registriert. (entfernt)
- `/api/agent-chat`-Endpoint samt Routentabelle, `POST /turn`-Optionen, `confirm: true`-Pflicht → kein solcher Endpoint; Vite-Plugin installiert nur `installAgentControlEndpoints`. (entfernt)
- Bridge-exponierter v1/v2-Prompt-Vergleich + Task-Playbook-Controls → FlashBoard-Typ erlaubt nur `promptVersion: 'v2'`; Model-Turn-API ist In-App-Code. (entfernt)

## Color-Correction
- Geplante `src/engine/color/`-Architektur (`ColorGradeCompiler`, `ColorScratchPool`, `ColorUniformPacker`, per-Node-Shader, `ColorPassPlan`) → nur `ColorPipeline.ts` existiert. (nie gebaut)
- Gecachte Bind-Groups → Bind-Group wird pro `applyGrade()` neu erzeugt. (nie gebaut)
- List/Graph-Features (Branch-Header, Mixer, Reordering, Graph-Diagnose-UI, HDR/Log/Curves/HSL/Windows/Output-Controls) → nur editierbare Node-Liste, erster serieller Branch. (nie gebaut)
- Color-Tab-Quick-Controls für Scopes + Before/After/Matte/Node-Quellen → Scopes lesen nur `getLastRenderedTexture()`. (nie gebaut)
- `flags.useFloatColorPipeline`, `rgba16float`-Intermediates, Export-Precision-Policy → alles `rgba8unorm`. (nie gebaut)
- Preset-Library, LUT-Import/Export, Still/Reference-Workflows, Compare → keine Implementierung. (nie gebaut)

## OCR-Analysis
- OCR als verfügbarer Agent-Timeline-Kanal mit lokalem Worker → kein Produktionsaufrufer, kein Worker registriert, Adapter hartkodiert `ocr: []`. (nie gebaut)
- Sprachpakete im lokalen Offline-Cache → kein Package-Cache, kein Downloader. (nie gebaut)
- OCR-Ergebnis-Cache → `createOcrCacheKey` existiert, aber nichts liest/schreibt ihn. (nie gebaut)

## Security
- Verschlüsselter IndexedDB-Store mit zehn AI-Key-Typen + verstecktes `Ctrl+Shift+8`/`Ctrl+Shift+7`-UI → nur der YouTube-Key ist browser-gespeichert; Legacy-Credentials löscht die IndexedDB-v3-Migration. (entfernt)
- `.keys.enc`-Export/Import → keinerlei Implementierung.
- `src/services/lemonadeProvider.ts`, `src/components/panels/AIChatPanel.tsx` → Dateien existieren nicht. (entfernt)

## AI-Integration
- „Kie.ai oder Lemonade Local"-Chat inkl. Provider-Tabelle/Setup/Streaming/Loopback → Provider-Union ist `kernel | kie`; kein Lemonade-Runtime-Client. (entfernt)

## FlashBoard
- `piapi`- und eigenständiger `elevenlabs`-Service + PiAPI-Provider im Katalog → `FlashBoardService` ist nur noch `'cloud'`. (entfernt)
- Wiederherstellung eines persistierten aktiven Boards + Referenz-Nodes → aktive Records nur `kind: 'generation'`. (entfernt)
- Seedance-Audio-Referenz-Sync + Referenzmodus-Sound-Toggle → generische Seedance-Referenzen schlagen in der Validierung fehl. (entfernt)

## Export
- Automatisches Routing großer Quellen zu HTMLVideo Precise (1,5/2-GB-Limits) → kein Size-Guard, kein Fast→Precise-Fallback; Nutzer wählt Precise manuell.
- Export-Tab-Änderungen im globalen Undo/Redo → `exportStore` ruft keine History-APIs auf.

## Credit-Burn-Meter
- „Registrierte AI-Surface" (Target-Registrierungs-API) → Meter sucht `activeSettlement.targetId` per `document.getElementById()` mit Fallback.

## Keyframes
- Shift+Wheel-Resize und Rechtsklick-Handle-Reset im Graph-Editor → nur im unreferenzierten Legacy-`CurveEditor.tsx`. (entfernt)

## Debugging
- `window.aiTools.execute/list/status` → kein solches Assignment; Client nutzt HMR-Messages + `executeAITool` direkt.

## Face-Analysis
- Active-Speaker-Erkennung (Default-Ergebnis + ROI-Modell-Pfad) als nutzbar → nur Policy/Typen/Scaffolding, kein Produktionsaufrufer. (nie gebaut)

## Audio-Intelligence
- Nutzung durch „kernel story moments" / Prosodie als „kernel emphasis evidence" → kein Client-Code stützt das; Loader lädt kein Prosodie-Payload.

## Node-Workspace
- AI-Nodes beim Export-Rendering → nur Preview-`LayerBuilderService` ruft sie auf; `ExportLayerBuilder` hat keine Integration. (nie gebaut)

## Native-Helper
- Statusdialog „Download directory"/„Project root" → Felder werden nicht gerendert.
- `--allowed-origins` leer = „alle localhost" → ohne Option installiert `main.rs` explizite Prod/Staging/Dev-Origins.

## Landing-Page
- `landing.localhost`/`/landing` öffnen den Editor direkt im START-Layout → kein Code verbindet Landing mit `FACTORY_START_LAYOUT_ID`. (nie gebaut)

## Project-Persistence
- `ProjectFile.youtube`-Persistenz / gespeichertes YouTube-Panel → Save löscht `youtube`. (entfernt)

## Download-Panel
- AI-Tools persistieren Ergebnisse im Legacy-`youtubeStore`-Projekt-Payload → Save löscht, Hydration resettet. (entfernt)

## Scene-Cut-Detection
- Fade/Dissolve-Klassifikator („werden nicht als Hard Cuts gemeldet") → reiner Frame-zu-Frame-Schwellwert-Detektor. (nie gebaut)
- Hover-Summary mit Clip-Count + Source-Total → nur „N cuts"-Pill.

## Proxy-System
- All-Intra-MP4-Proxy-Pfad „für schnelle Reaktivierung" → kein aktiver Generator/Playback-Pfad; JPEG-Pfade schließen `mp4-all-intra` aus. (entfernt)

## Signal-IR
- Wasm-Execution als aktive Runtime-Grenze → `WasmImporterHost` ist nur Adapter-API; registriert sind nur builtin CSV/JSON/Binary.

## GPU-Engine
- `useRenderGraph` als „noch Stub"-Flag → Flag existiert nicht mehr; Shared-Compositor-Pfad ist aktiv. (entfernt)

## Timeline
- „Geplante Tools sichtbar, aber deaktiviert bis zur Operation-Kernel-Migration" → Tool-Registry hat keine `future`-Einträge.

## UI-Panels
- `AI Chat` / `ai-chat` als aktives Dock-Panel → kein solcher `PanelType`. (entfernt)
- „Genau 74 animierte SVG-Transition-Thumbnails" mit Hover-/Reduced-Motion-Vertrag → Dispatch mit generischem SVG-Fallback; Vertrag nirgends kodiert.
- Gemounteter Mobile-Touch-Editor mit Gesten + Mobile-Export-UI → `MobileApp` rendert nur das Unsupported-Device-Gate; Komponenten ungemountet.
- „Work in Progress"-Gruppe im Panels-Menü → `WIP_PANEL_TYPES` ist leer.

## Agent-Timeline-Benchmarking
- Lokaler Benchmark als betriebsbereiter Messpfad → `configureAgentTimelineLocalBenchmarkCapabilities` wird nirgends aufgerufen; Cold-Runs blockieren.

## README (root)
- „OpenAI/Cloud oder lokaler Lemonade-Chat" → Hosted-Chat ist Kie.ai. (entfernt)
- EvoLink-/PiAPI-kompatible Katalogpfade → nur abgelehntes Legacy-Key-Handling in `functions/lib/noByok.ts`. (entfernt)

---
Summe: 40 Phantom-Einträge in 24 der 52 Findings-Dateien.
Schwerpunkte: Color-Correction, OCR-Analysis, Security/Lemonade-BYOK-Reste,
AI-Bridge-Chat-Tools.
