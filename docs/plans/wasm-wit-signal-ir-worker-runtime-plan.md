# Wasm/WIT + Signal IR + Worker/Capability Runtime Plan

**Status:** Architektur- und Multi-Agent-Ausfuehrungsplan  
**Datum:** 2026-05-15  
**Ziel:** MasterSelects bekommt eine echte Runtime-Schicht, in der jede Datei als typisiertes Signal importiert, analysiert, transformiert, gerendert und exportiert werden kann. Keine Mock-Architektur, kein Wegwerf-MVP. Der erste Integrationsschnitt muss echte Dateien, echte Artefakte und echte Projekt-Persistenz bedienen.

---

## 1. Entscheidung

Die richtige strategische Richtung ist:

```text
Signal IR
  -> Content-addressed Artifact Store
  -> Extension Manifest + Capability Policy
  -> Worker Runtime
  -> Wasm Component/WIT Runtime
  -> Importer/Analyzer/Operator/Renderer Adapter
  -> Timeline/NodeGraph/Render Integration
```

Pandino oder ein anderer Service-Registry-Mechanismus kann spaeter als Bundle-/Service-Layer oben drauf kommen. Fuer den Kern ist jetzt wichtiger, dass MasterSelects ein stabiles Datenmodell, einen sicheren Ausfuehrungsraum und eine versionierte ABI bekommt. Sonst registrieren wir nur alte Kopplung in neuem Gewand.

---

## 2. Codebase-Befund

### 2.1 Import ist zentral, aber noch typbegrenzt

Relevante Dateien:

- `src/stores/mediaStore/helpers/importPipeline.ts`
- `src/stores/mediaStore/helpers/mediaTypeHelpers.ts`
- `src/stores/mediaStore/slices/fileImportSlice.ts`
- `src/stores/mediaStore/types.ts`
- `src/services/project/types/media.types.ts`

Befund:

- `classifyMediaType(file)` kennt Video, Audio, Image, Model, Gaussian Splat und Vector Animation.
- Unbekannte Dateien werden aktuell hart abgelehnt.
- `ProjectMediaFile.type` ist noch eine feste Union.
- Der Importpfad kopiert nach `Raw/`, erzeugt Thumbnails/Proxy/Metadaten und baut sofort ein `MediaFile`.

Konsequenz:

- Der Universal-Importer darf den existierenden Pfad nicht ersetzen, bevor er dessen Projekt-/Thumbnail-/Proxy-Verhalten abbildet.
- Neue Importer muessen zuerst als Adapter um den bestehenden Import laufen und dann Schritt fuer Schritt den festen Typknoten aufbrechen.

### 2.2 NodeGraph hat schon die richtige Sprache, aber nicht die Runtime

Relevante Dateien:

- `src/types/nodeGraph.ts`
- `src/stores/timeline/nodeGraphSlice.ts`
- `src/services/nodeGraph/clipGraphProjection.ts`
- `src/services/nodeGraph/aiNodeRuntime.ts`

Befund:

- `NodeGraphSignalType` kennt bereits `texture`, `audio`, `geometry`, `curve`, `mask`, `text`, `metadata`, `event`, `time`, `scene`, `timeline`, `render-target`, `number`, `boolean`, `string`.
- `NodeGraphRuntimeKind` kennt bereits `worker` und `wasm`.
- `aiNodeRuntime.ts` fuehrt generierten JS-Code aktuell ueber `new Function(...)` im Main Context aus.
- Textur-Processing ist stark limitiert und Canvas-basiert.

Konsequenz:

- Signal IR kann auf den vorhandenen Signaltypen aufbauen.
- Der erste harte Sicherheitsgewinn ist: AI/generated/custom nodes laufen nicht mehr im Main Context, sondern ueber Worker/Capability Runtime.

### 2.3 Worker/Wasm existiert nur punktuell

Relevante Dateien/Pfade:

- `src/workers/transcriptionWorker.ts`
- `src/services/sam2/sam2Worker.ts`
- `src/engine/gaussian/core/splatOrderSortWorker.ts`
- `src/engine/ffmpeg/FFmpegBridge.ts`
- `@playcanvas/splat-transform` WebP/Wasm-Nutzung

Befund:

- Es gibt mehrere Worker-/Wasm-Nutzungen, aber keinen gemeinsamen Host, keine gemeinsame Job-Lifecycle-API, keine Capability-Policy und keinen Artifact-Output-Vertrag.
- FFmpeg, SAM2 und Gaussian Sort loesen jeweils lokale Spezialfaelle.

Konsequenz:

- Die Runtime muss als eigene Schicht entstehen und existierende Spezial-Worker spaeter adaptieren, nicht sofort umschreiben.

### 2.4 Projektcache existiert, aber nicht als universeller Artifact Store

Relevante Dateien:

- `src/services/project/core/constants.ts`
- `src/services/project/domains/CacheService.ts`
- `src/services/project/domains/RawMediaService.ts`
- `src/services/projectDB.ts`
- `src/stores/mediaStore/helpers/fileHashHelpers.ts`

Befund:

- Projektfolder haben `Raw`, `Proxy`, `Analysis`, `Transcripts`, `Cache/thumbnails`, `Cache/splats`, `Cache/waveforms`.
- Hashing ist primaer Import-/Dedup-Hilfe, nicht universelle CAS-Basis.
- Thumbnails, Splats, Waveforms und Proxy Frames sind getrennte Spezialcaches.

Konsequenz:

- Fuer Signal IR brauchen wir einen generischen Artifact Store mit Manifesten, nicht nur weitere Spezialordner.
- Bestehende Folder koennen bleiben, aber neue Artefakte sollten unter `Cache/artifacts/<sha256>/...` oder einem aequivalenten Schema landen.

### 2.5 Policy-Muster existiert

Relevante Dateien:

- `src/services/aiTools/policy/types.ts`
- `src/services/aiTools/policy/registry.ts`

Befund:

- AI Tools haben bereits `readOnly`, `riskLevel`, `requiresConfirmation`, `sensitiveDataAccess`, `localFileAccess`, `allowedCallers`.

Konsequenz:

- Die Extension-/Runtime-Capabilities sollten dasselbe Denkmuster wiederverwenden, aber feiner fuer Dateizugriff, Netzwerk, GPU, Zeit, Random, Projekt-Schreibzugriff, Artifact-Schreibzugriff und Timeline-Mutation.

### 2.6 Effekte sind Registry-basiert, aber build-time

Relevante Dateien:

- `src/effects/index.ts`
- `src/effects/types.ts`
- `src/effects/*`

Befund:

- Effekte sind klar registriert, aber ueber statische Imports.
- WGSL-Shader und Uniform-Packing sind gute Kandidaten fuer spaetere Operator-Provider.

Konsequenz:

- Effekt-Registry bleibt zunaechst stabil.
- Ein spaeterer `signal-operator` kann Effektdefinitionen spiegeln, statt den Renderpfad sofort zu veraendern.

---

## 3. Zielarchitektur

### 3.1 Signal IR

Signal IR ist das gemeinsame Datenmodell fuer alles, was MasterSelects verarbeitet.

Kernobjekte:

- `SignalAsset`: importierte Datei oder erzeugtes Asset.
- `SignalRef`: referenzierbarer Output eines Assets, Operators oder NodeGraph.
- `SignalKind`: `texture`, `audio`, `geometry`, `point-cloud`, `mesh`, `scene`, `table`, `document`, `curve`, `mask`, `text`, `metadata`, `event`, `timeline`, `render-target`, `binary`.
- `SignalArtifact`: gespeichertes Ergebnis mit Content Hash, MIME, Byte Range, Codec/Encoding und Provenance.
- `SignalOperator`: pure oder stateful Transformation von Input-Signalen zu Output-Signalen.
- `SignalGraph`: persistierbare Verbindung von Quellen, Operatoren und Outputs.

Wichtige Designregel:

- Timeline und Render Engine duerfen nicht sofort direkt auf jedes neue Format zugreifen muessen.
- Jede neue Datei wird zuerst SignalAsset plus mindestens ein SignalRef. Danach entscheiden Adapter, ob daraus Clip, Node, Geometry, Texture, Table oder Document Preview wird.

### 3.2 Extension ABI

Extension-Typen:

- `importer`: erkennt Dateien, extrahiert Metadaten, erzeugt SignalRefs und Artefakte.
- `analyzer`: erzeugt Analyseartefakte, z.B. transcript, waveform, mesh stats, table schema, document outline.
- `operator`: transformiert SignalRefs, z.B. table -> curve, mesh -> point-cloud, document page -> texture.
- `renderer-adapter`: erzeugt renderbare Layer-Inputs fuer WebGPU/Canvas/HTML.
- `exporter`: erzeugt Dateien aus SignalGraph/Timeline/Render Targets.

ABI-Schichten:

- TypeScript Host API fuer built-in Provider.
- Worker RPC ABI fuer JS/TS Provider.
- WIT ABI fuer Wasm Components.

Warum WIT:

- WIT beschreibt Contracts fuer WebAssembly Components, nicht Verhalten.
- WIT kann Interfaces und Worlds definieren.
- WIT Resources eignen sich fuer Handles, die nicht als riesige Bytes kopiert werden sollen.
- `jco` ist der relevante JS-nahe Toolchain-Kandidat fuer Components im Browser-/Node-Umfeld.

### 3.3 Worker/Capability Runtime

Runtime-Aufgaben:

- Provider isoliert ausfuehren.
- Jobs starten, abbrechen, priorisieren und monitoren.
- Transferables nutzen: `ArrayBuffer`, `ImageBitmap`, spaeter `VideoFrame` wo moeglich.
- Capabilities erzwingen: Dateilesen, Dateischreiben, Projektcache, Netzwerk, Random, Time, GPU, Timeline-Mutation.
- Progress, Logs, Diagnostics und Artifact-Outputs standardisieren.

Nicht-Ziel:

- Kein versteckter globaler DI-Container als erstes Fundament.
- Keine Main-Thread-Ausfuehrung von untrusted/generated Plugin-Code.

### 3.4 Artifact Store

Der Artifact Store ist die Bruecke zwischen Import, Analyse, Runtime und Projektpersistenz.

Pflicht:

- SHA-256 Content Hash fuer echte Artefakte.
- Manifest mit `artifactId`, `hash`, `size`, `mimeType`, `encoding`, `producer`, `sourceRefs`, `createdAt`, `schemaVersion`.
- Speicherziel im Projektordner und IndexedDB-Index.
- Backwards-kompatible Nutzung bestehender `Cache/thumbnails`, `Cache/splats`, `Cache/waveforms`, solange die alten Pfade gebraucht werden.

Zielpfad-Vorschlag:

```text
Cache/artifacts/
  sha256/
    ab/
      abcdef.../
        artifact.bin
        manifest.json
```

---

## 4. Parallele Agentenstruktur

Wir starten mit 6 Implementierungs-Agenten plus 3 Review-/Synthese-Agenten. Die 6 Implementierungs-Agenten arbeiten parallel mit klarer Ownership. Die 3 Review-Agenten pruefen danach Befunde, API-Schnittstellen und Integrationsrisiken.

### Agent 1: Signal IR + Typmigration

Ownership:

- `src/signals/**`
- `src/types/nodeGraph.ts` nur additive Anpassungen
- Tests unter `tests/unit/signals/**`

Auftrag:

- `SignalKind`, `SignalAsset`, `SignalRef`, `SignalArtifact`, `SignalGraph`, `SignalOperatorDescriptor` definieren.
- Mapping von bestehendem `MediaFile`, `ProjectMediaFile`, `TimelineSourceType`, `NodeGraphSignalType` auf Signal IR dokumentieren.
- Keine Importpipeline umbauen.
- Keine Render-Hotpaths anfassen.

Ergebnis:

- Kompilierende TypeScript-Typen.
- Mapping-Dokument als Kommentar oder `docs/Features/Signal-IR.md`.
- Unit-Tests fuer Schema Guards/normalization.

### Agent 2: Artifact Store + Projektpersistenz

Ownership:

- `src/artifacts/**`
- `src/services/project/domains/ArtifactService.ts`
- additive Anpassungen in `src/services/project/core/constants.ts`
- additive Anpassungen in `src/services/projectDB.ts`
- Tests unter `tests/unit/artifacts/**`

Auftrag:

- Generischen Artifact Store bauen.
- SHA-256 Hashing fuer Blob/ArrayBuffer/File implementieren.
- Manifest lesen/schreiben.
- Project folder + IndexedDB Index verbinden.
- Bestehende Cache Services nicht entfernen.

Ergebnis:

- `putArtifact`, `getArtifact`, `hasArtifact`, `listArtifactsBySource`, `deleteArtifact`.
- Projektordner-Konstante fuer `Cache/artifacts`.
- Tests mit echten Blob-Artefakten.

### Agent 3: Extension Registry + Capability Policy

Ownership:

- `src/extensions/**`
- `src/runtime/capabilities/**`
- Tests unter `tests/unit/extensions/**`

Auftrag:

- Provider Manifest definieren.
- Capability-Modell definieren.
- Registry fuer built-in, worker und wasm Provider bauen.
- Policy-Pruefung analog zu AI Tool Policy, aber fuer Runtime-Jobs.

Capability-Vorschlag:

```ts
type RuntimeCapability =
  | 'file.read'
  | 'file.write'
  | 'artifact.read'
  | 'artifact.write'
  | 'project.read'
  | 'project.write'
  | 'network.fetch'
  | 'time.now'
  | 'random'
  | 'gpu.compute'
  | 'timeline.mutate'
  | 'ai.invoke';
```

Ergebnis:

- Provider koennen registriert und nach File Signature, MIME, Extension, SignalKind und RuntimeKind gesucht werden.
- Unknown Provider/Capability fail-closed.
- Tests fuer erlaubte/verbotene Capabilities.

### Agent 4: Worker Runtime

Ownership:

- `src/runtime/worker/**`
- `src/workers/runtimeHost.worker.ts`
- Tests unter `tests/unit/runtime/worker/**`

Auftrag:

- Gemeinsames Worker-Protokoll fuer Runtime-Jobs bauen.
- Job lifecycle: `queued`, `running`, `progress`, `completed`, `failed`, `cancelled`.
- AbortController-Unterstuetzung.
- Transferables sauber behandeln.
- Logs/Diagnostics aus Worker zurueckfuehren.

Ergebnis:

- `WorkerRuntimeHost`.
- `RuntimeJobClient`.
- Testbarer Echo-/Hash-/CSV-Worker als echter Worker-Fixture, nicht als Mock.
- Keine Kopplung an MediaStore.

### Agent 5: Wasm/WIT Host + ABI

Ownership:

- `wit/masterselects/**`
- `src/runtime/wasm/**`
- `scripts/wasm/**`
- Tests unter `tests/unit/runtime/wasm/**`

Auftrag:

- WIT Packages fuer MasterSelects Provider definieren.
- Host-Facade fuer Wasm Components entwerfen.
- `jco`/Component Model Toolchain als realen Buildpfad pruefen.
- Minimaler echter Wasm-Provider: CSV oder binary metadata importer, der echte Bytes verarbeitet und ein Signal Manifest ausgibt.

WIT-Startpunkt:

```wit
package masterselects:runtime@0.1.0;

interface signals {
  enum signal-kind {
    texture,
    audio,
    geometry,
    point-cloud,
    table,
    document,
    curve,
    mask,
    text,
    metadata,
    binary,
  }

  record artifact-ref {
    id: string,
    hash: string,
    mime-type: string,
    size: u64,
  }

  record signal-ref {
    id: string,
    kind: signal-kind,
    artifact: option<artifact-ref>,
    metadata-json: string,
  }
}

interface importer {
  use signals.{signal-ref};

  record import-request {
    file-name: string,
    mime-type: string,
    bytes: list<u8>,
  }

  record import-result {
    signals: list<signal-ref>,
    diagnostics-json: string,
  }

  can-import: func(file-name: string, mime-type: string, header: list<u8>) -> bool;
  import-file: func(request: import-request) -> result<import-result, string>;
}

world masterselects-importer {
  export importer;
}
```

Ergebnis:

- WIT ist versioniert.
- Wasm-Host kann mindestens einen echten Component-Importer laden oder, falls Browser-Component-Support blockiert, via `jco transpile` als ES-Modul nutzen.
- Dokumentierter Toolchain-Befehl.

### Agent 6: Universal Import Orchestrator + Kompatibilitaetsadapter

Ownership:

- `src/importers/**`
- additive Anpassungen in `src/stores/mediaStore/helpers/importPipeline.ts`
- additive Anpassungen in `src/stores/mediaStore/slices/fileImportSlice.ts`
- Tests unter `tests/unit/importers/**`

Auftrag:

- Import-Orchestrator bauen, der zuerst Provider Discovery macht und danach den passenden Importpfad ausfuehrt.
- Bestehende Medienformate weiter ueber den aktuellen Importpfad laufen lassen.
- Neue Signal-Importer fuer CSV und PLY/OBJ oder SVG als echte erste Verticals anschliessen.
- Fallback: unknown file wird als `binary` SignalAsset mit Metadaten importiert, nicht hart verworfen.

Ergebnis:

- Bestehende Video/Audio/Image/Model/Gaussian/Vector Imports bleiben kompatibel.
- Mindestens ein bisher unbekanntes Format landet als echtes SignalAsset mit Artifact und Project-Persistenz.
- Import UI/MediaStore bekommt eine Kompatibilitaetsdarstellung, ohne Timeline-Zwang.

---

## 5. Review- und Konsens-Agenten

### Review Agent A: API/Kontrakt

Prueft:

- Passen Signal IR, Artifact Store, Extension Registry, Worker Runtime und WIT zusammen?
- Gibt es doppelte Begriffe oder inkonsistente IDs?
- Sind alte Media-/Timeline-Typen sauber adaptierbar?

Output:

- `docs/plans/wasm-signal-review-api.md`

### Review Agent B: Runtime/Security

Prueft:

- Laeuft generated/custom code wirklich ausserhalb des Main Context?
- Sind Capabilities fail-closed?
- Gibt es unkontrollierten File-, Network-, Random-, Time- oder Project-Zugriff?
- Sind Worker-Jobs abbrechbar und diagnosierbar?

Output:

- `docs/plans/wasm-signal-review-runtime-security.md`

### Review Agent C: Integration/Performance

Prueft:

- Wird der WebGPU Render-Hotpath geschont?
- Gibt es unnoetige Kopien grosser Dateien?
- Bleiben bestehende Imports, Project Save/Load und Export ungebrochen?
- Sind Tests realistisch und nicht nur Type-Tests?

Output:

- `docs/plans/wasm-signal-review-integration-performance.md`

### Konsens

Nach den drei Reviews schreibt der Integrator:

- `docs/plans/wasm-signal-runtime-consensus.md`

Muss enthalten:

- gemeinsam akzeptierte API
- offene harte Entscheidungen
- Reihenfolge der Merge-Slices
- Liste der Dateien, die noch nicht parallel angefasst werden duerfen

---

## 6. Abhaengigkeiten und Parallelisierung

### Wave 1: Contracts und Fundamente

Parallel startbar:

- Agent 1 Signal IR
- Agent 2 Artifact Store
- Agent 3 Extension Registry + Capability Policy
- Agent 4 Worker Runtime
- Agent 5 WIT Host/ABI

Agent 6 kann parallel vorbereiten:

- aktuelle Importpipeline kapseln
- Tests fuer bestehende Importklassifikation schreiben
- noch keine finale Integration ohne Signal IR + Registry + Artifact Store

### Wave 2: Realer Vertical Slice

Startbedingung:

- `SignalRef`, `SignalArtifact`, Provider Manifest und Artifact Store Interfaces sind stabil genug.

Parallel:

- Agent 5 liefert echten Wasm/WIT Importer.
- Agent 4 liefert Worker-Ausfuehrung.
- Agent 6 verbindet Orchestrator mit CSV/SVG/PLY oder binary fallback.
- Agent 1 ergaenzt Mapping fuer Timeline/NodeGraph.
- Agent 2 bindet Artefakte in Projektpersistenz ein.
- Agent 3 erzwingt Capabilities im Orchestrator.

### Wave 3: NodeGraph und Runtime Migration

Neue oder Folge-Agenten:

- NodeGraph-Agent migriert `aiNodeRuntime.ts` auf Worker/Capability Runtime.
- Render-Adapter-Agent baut `SignalRef -> LayerSource` Adapter.
- Persistence-Agent erweitert Project Save/Load um SignalAssets und Artifacts.

Erst hier werden Hotpaths wie `LayerCollector`, `RenderDispatcher`, `LayerBuilderService` oder Timeline-Clip-Typen groesser angefasst.

---

## 7. Merge-Slices

### Slice 1: Pure Contracts

Enthaelt:

- `src/signals/**`
- `src/extensions/**`
- `src/runtime/capabilities/**`
- `wit/masterselects/**`
- Tests fuer Types/Policy

Akzeptanz:

- `npm run test -- tests/unit/signals tests/unit/extensions`
- `npm run build`

### Slice 2: Artifact Store

Enthaelt:

- `src/artifacts/**`
- Project constants
- ProjectDB additive schema/index changes
- Tests mit echten Blob/File Daten

Akzeptanz:

- Artefakt schreiben, lesen, erneut deduplizieren.
- Altes Thumbnail/Splat/Waveform Verhalten bleibt unveraendert.

### Slice 3: Worker Runtime

Enthaelt:

- Worker Host
- Job Client
- Runtime Worker Fixture
- Cancellation/Progress/Diagnostics Tests

Akzeptanz:

- Echter Worker-Test verarbeitet echte Bytes.
- Job kann abgebrochen werden.
- Transferables werden genutzt.

### Slice 4: Wasm/WIT Toolchain

Enthaelt:

- WIT package
- Build Script
- Beispiel-Component
- Host Adapter

Akzeptanz:

- Ein echter Wasm/WIT Importer verarbeitet eine Fixture-Datei.
- Toolchain ist lokal reproduzierbar dokumentiert.
- Wenn Browser-Loading nicht direkt geht, ist `jco transpile` als ES-Modul-Fallback bewiesen.

### Slice 5: Universal Importer

Enthaelt:

- Import Orchestrator
- Adapter zum bestehenden `processImport`
- Binary/CSV/SVG/PLY erster Signal Import
- MediaStore-Kompatibilitaet

Akzeptanz:

- Bestehende Medienimports laufen weiter.
- Eine bisher unbekannte Datei wird nicht abgelehnt, sondern als SignalAsset importiert.
- Project Save/Load verliert die Signal-Referenz nicht.

### Slice 6: NodeGraph Runtime Migration

Enthaelt:

- `aiNodeRuntime.ts` weg von `new Function` im Main Context.
- Worker/Capability Runtime fuer generated/custom nodes.
- SignalRef-basierte Inputs/Outputs.

Akzeptanz:

- Custom/AI Node erzeugt reales Ergebnis ueber Worker.
- Main Thread fuehrt keinen generated code direkt aus.
- Bestehende Node Workspace UI bleibt bedienbar.

---

## 8. Harte Architekturregeln

1. Keine neuen Plugin-/Generated-Code-Pfade im Main Context.
2. Keine neue Dateiart darf nur als UI-Mock auftauchen. Sie muss ein echtes SignalAsset und mindestens ein reales Artifact oder nachvollziehbare Metadata erzeugen.
3. Bestehende Imports fuer Video/Audio/Image/Model/Gaussian/Vector duerfen nicht regressieren.
4. Hotpaths (`RenderDispatcher`, `LayerCollector`, `WebGPUEngine`) werden erst nach Contract- und Adapter-Schicht angefasst.
5. Unknown file ist kein Fehlerfall mehr. Mindestens `binary` SignalAsset ist Pflicht.
6. Jede Runtime-Ausfuehrung hat Job-ID, Logs, Progress, Result, Diagnostics und Cancellation.
7. Alle Capabilities fail-closed.
8. Project Save/Load muss SignalAssets, Artifacts und Provider-Versionen versioniert persistieren.
9. Artefakte sind content-addressed. Pfadnamen oder Media IDs allein reichen nicht.
10. Wasm/WIT ABI wird versioniert und darf nicht implizit aus TypeScript-Typen generiert werden, ohne die WIT-Dateien zu reviewen.

---

## 9. Erste echte Verticals

Diese Verticals sind sinnvoll, weil sie verschiedene Signal-Klassen erzwingen:

### Vertical A: CSV -> table -> curve/texture preview

Warum:

- Kleine Dateien, schnelle Tests, hoher Nutzen fuer "jede Datei wird Signal".
- Erzwingt `table`, `metadata`, optional `curve`.

Akzeptanz:

- CSV importiert als `SignalAsset`.
- Header/Rows/Column Types werden analysiert.
- Preview kann mindestens eine Tabellen-/Texturansicht erzeugen.

### Vertical B: PLY/OBJ -> geometry/point-cloud

Warum:

- Nahe an bestehender Model/Gaussian-Welt.
- Erzwingt Geometry/Point Cloud Artefakte.

Akzeptanz:

- PLY oder OBJ wird importiert, auch wenn es nicht ueber den alten Modelpfad laeuft.
- Stats werden als Metadata Artifact persistiert.
- Spaeterer Render-Adapter kann daraus LayerSource bauen.

### Vertical C: SVG -> document/vector/texture

Warum:

- Passt zum Ziel "Dokumente/SVG".
- Erzwingt Document/Vector/Texture-Bruecke.

Akzeptanz:

- SVG wird als `document` oder `vector` SignalAsset importiert.
- Raster Preview wird als Artifact erzeugt.
- Original bleibt als binary/document Artifact erhalten.

---

## 10. Agent-Prompts

### Prompt fuer Agent 1

```text
Du bist Agent 1 fuer MasterSelects Wasm/WIT + Signal IR. Lies AGENTS.md und den Plan docs/plans/wasm-wit-signal-ir-worker-runtime-plan.md. Deine Ownership ist src/signals/**, additive Aenderungen in src/types/nodeGraph.ts und tests/unit/signals/**. Baue echte TypeScript-Typen und Guards fuer SignalAsset, SignalRef, SignalArtifact, SignalGraph und SignalOperatorDescriptor. Schreibe deine Befunde und geaenderten Dateien am Ende auf. Fasse dich nicht mit Importpipeline oder Render-Hotpaths an.
```

### Prompt fuer Agent 2

```text
Du bist Agent 2 fuer MasterSelects Artifact Store. Lies AGENTS.md und den Plan docs/plans/wasm-wit-signal-ir-worker-runtime-plan.md. Deine Ownership ist src/artifacts/**, src/services/project/domains/ArtifactService.ts, additive Aenderungen in src/services/project/core/constants.ts und src/services/projectDB.ts sowie tests/unit/artifacts/**. Implementiere echten content-addressed Artifact Store mit SHA-256, Manifesten und Projektfolder/IndexedDB-Anbindung. Schreibe Befunde und geaenderte Dateien am Ende auf. Bestehende Cache-Services nicht entfernen.
```

### Prompt fuer Agent 3

```text
Du bist Agent 3 fuer MasterSelects Extension Registry und Capability Policy. Lies AGENTS.md und den Plan docs/plans/wasm-wit-signal-ir-worker-runtime-plan.md. Deine Ownership ist src/extensions/**, src/runtime/capabilities/** und tests/unit/extensions/**. Definiere Provider Manifest, RuntimeCapability, Registry und fail-closed Policy-Pruefung fuer built-in, worker und wasm Provider. Schreibe Befunde und geaenderte Dateien am Ende auf.
```

### Prompt fuer Agent 4

```text
Du bist Agent 4 fuer MasterSelects Worker Runtime. Lies AGENTS.md und den Plan docs/plans/wasm-wit-signal-ir-worker-runtime-plan.md. Deine Ownership ist src/runtime/worker/**, src/workers/runtimeHost.worker.ts und tests/unit/runtime/worker/**. Baue echten WorkerRuntimeHost mit Job Lifecycle, Progress, Diagnostics, Cancellation und Transferables. Nutze echte Worker-Fixtures statt Mocks. Schreibe Befunde und geaenderte Dateien am Ende auf.
```

### Prompt fuer Agent 5

```text
Du bist Agent 5 fuer MasterSelects Wasm/WIT Runtime. Lies AGENTS.md und den Plan docs/plans/wasm-wit-signal-ir-worker-runtime-plan.md. Deine Ownership ist wit/masterselects/**, src/runtime/wasm/**, scripts/wasm/** und tests/unit/runtime/wasm/**. Definiere die WIT ABI, pruefe jco/component-model Toolchain und liefere einen echten Wasm/WIT Importer fuer eine Fixture-Datei. Schreibe Befunde, Toolchain-Befehle und geaenderte Dateien am Ende auf.
```

### Prompt fuer Agent 6

```text
Du bist Agent 6 fuer MasterSelects Universal Import Orchestrator. Lies AGENTS.md und den Plan docs/plans/wasm-wit-signal-ir-worker-runtime-plan.md. Deine Ownership ist src/importers/**, additive Aenderungen in src/stores/mediaStore/helpers/importPipeline.ts und src/stores/mediaStore/slices/fileImportSlice.ts sowie tests/unit/importers/**. Kapsle den bestehenden Importpfad, schliesse Provider Discovery an und sorge dafuer, dass unknown files als binary SignalAsset importiert werden. Bestehende Medienimports muessen weiter funktionieren. Schreibe Befunde und geaenderte Dateien am Ende auf.
```

---

## 11. Quellen und technische Anker

- WebAssembly Component Model WIT: https://component-model.bytecodealliance.org/design/wit.html
- WIT Spezifikation im Component Model Repository: https://github.com/WebAssembly/component-model/blob/main/design/mvp/WIT.md
- Bytecode Alliance jco: https://github.com/bytecodealliance/jco
- ComponentizeJS: https://github.com/bytecodealliance/ComponentizeJS
- WASI Interfaces: https://wasi.dev/interfaces

---

## 12. Naechster praktischer Schritt

1. Plan in sechs Agenten parallel ausfuehren lassen.
2. Jeder Agent schreibt Befunde und geaenderte Dateien.
3. Drei Review-Agenten pruefen API, Runtime/Security und Integration/Performance.
4. Integrator schreibt Konsens und merged zuerst nur Slice 1.
5. Danach echte Verticals mergen, beginnend mit Artifact Store + Worker Runtime + CSV/binary Import.
