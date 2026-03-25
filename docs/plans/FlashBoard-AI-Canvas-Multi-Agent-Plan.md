# FlashBoard - AI Canvas Panel
## Repo-Fit Multi-Agent Plan

**Datum:** 2026-03-25
**Status:** Revised Draft
**Ziel:** Ein board-basierter AI-Workspace fuer MasterSelects, der auf der bestehenden AI-Video-, Media-, Timeline-, Project- und History-Architektur aufsetzt statt ein zweites paralleles AI-System aufzubauen.

---

## 1. Produktdefinition

FlashBoard ist in V1 **kein neues AI-Backend** und **kein neues Mini-Produkt im Produkt**.
Es ist eine neue Workspace-Ansicht fuer bestehende Generierungs-Flows.

**V1 umfasst:**
- Board-Ansicht innerhalb des bestehenden `ai-video` Panels
- Text-to-video und image-to-video ueber bestehende Provider-Services
- Referenzen aus Preview, Media Pool und Desktop-Dateien
- Generierte Medien landen zuerst im Media Pool, danach optional auf der Timeline
- Persistenz im Projektmodell (`project.json`), nicht in losen Sidecar-JSON-Baeumen
- Globales Undo/Redo ueber die bestehende History-Infrastruktur
- Provider-spezifische Queue mit begrenzter Parallelitaet

**Nicht Teil von V1:**
- "66+ Modelle ueber Kie.ai"
- Image-only Generation, solange dafuer kein bestehender Service im Repo vorhanden ist
- Unbegrenzte Parallelitaet
- Eigene Projektordner wie `project/flashboards/`
- Eigener Undo-Stack
- Prompt-Enhancer mit neuer LLM-Abhaengigkeit
- Grid-vs-Free-Dualsystem
- Board-Export als PNG/PDF
- Unbegrenzte Multi-Board-Tabs

**Phase 2 oder spaeter:**
- Multi-Board Tabs
- Board Export
- Prompt Templates / Enhancer
- Erweiterte Model Guides
- Zusätzliche Provider fuer reine Bildgenerierung
- Alternative Layout-Modi

---

## 2. Leitplanken fuer MasterSelects

1. **Provider-Reuse statt Provider-Neubau**
   FlashBoard verwendet bestehende Services:
   - `src/services/piApiService.ts`
   - `src/services/kieAiService.ts`
   - `src/services/cloudAiService.ts`

2. **Media Pool ist die kanonische Quelle**
   Jeder abgeschlossene Output wird importiert und ueber `mediaFileId` referenziert.
   Remote-URLs sind nur Laufzeitdaten waehrend des Jobs, nicht persistente Identitaet.

3. **Projektzustand bleibt zentral**
   Board-Daten werden in `project.json` gespeichert.
   Keine ad-hoc Verzeichnisstruktur ausserhalb der bestehenden Project-Facade.

4. **DnD nutzt bestehende Formate**
   FlashBoard -> Timeline verwendet dieselben Payloads wie Media Panel (`application/x-media-file-id`), nicht ein neues proprietaeres Drag-Protokoll.

5. **Undo/Redo bleibt global**
   FlashBoard wird in `historyStore` integriert.
   Kein separater History-Mechanismus.

6. **V1 optimiert Integration vor UI-Spektakel**
   Erst stabiler Provider-, Media-, Save- und History-Flow.
   Danach groessere Canvas- und Komfort-Features.

---

## 3. Architektur

### 3.1 V1 Architektur-Schnitt

```text
src/
|-- components/
|   |-- panels/
|   |   |-- AIVideoPanel.tsx                 # bestehender Dock-Einstieg
|   |   `-- flashboard/
|   |       |-- FlashBoardWorkspace.tsx      # Board-Ansicht als Mode innerhalb von ai-video
|   |       |-- FlashBoardToolbar.tsx        # View Switch, Queue Info, New Draft, Board Name
|   |       |-- FlashBoardCanvas.tsx         # freie Platzierung, viewport, selection
|   |       |-- FlashBoardNode.tsx           # Draft/Queue/Completed Node
|   |       |-- FlashBoardComposer.tsx       # Prompt + Provider + Settings
|   |       |-- FlashBoardReferenceTray.tsx  # Start/End/References via mediaFileId
|   |       `-- FlashBoardInspector.tsx      # Node details / retry / duplicate / add-to-timeline
|   |
|   `-- timeline/
|       `-- hooks/useExternalDrop.ts         # reuse media-file drag path, no board-specific protocol
|
|-- stores/
|   |-- flashboardStore/
|   |   |-- index.ts
|   |   |-- types.ts
|   |   |-- slices/
|   |   |   |-- boardSlice.ts               # boards + viewport
|   |   |   |-- nodeSlice.ts                # nodes + job lifecycle + selection
|   |   |   `-- uiSlice.ts                  # local mode, panel UI, ephemeral state
|   |   `-- selectors.ts
|   |
|   |-- historyStore.ts                     # snapshot schema erweitert
|   `-- ...
|
|-- services/
|   |-- flashboard/
|   |   |-- FlashBoardJobService.ts         # adapter ueber piApi/kieAi/cloudAi
|   |   |-- FlashBoardModelCatalog.ts       # leitet Provider/Versionen aus bestehenden Services ab
|   |   |-- FlashBoardMediaBridge.ts        # Import in mediaStore + Folder + drag helpers
|   |   `-- types.ts
|   |
|   `-- project/
|       |-- projectSave.ts                  # flashboard state in project.json schreiben
|       |-- projectLoad.ts                  # flashboard state laden
|       `-- types/                          # ProjectFile um flashboard erweitern
|
`-- types/
    `-- dock.ts                             # V1 behaelt PanelType ai-video; eigenes flashboard panel optional spaeter
```

### 3.2 Wichtige Architekturentscheidung

**V1 fuegt keinen neuen Dock-Panel-Typ hinzu.**

Stattdessen bekommt das bestehende `ai-video` Panel einen neuen Workspace-Mode:
- `classic`
- `board`

So bleiben Default-Layout, Dock-Konfiguration und bestehende Nutzerpfade stabil.
Ein eigener `flashboard` Panel-Typ ist erst Phase 2, wenn der Workflow im Alltag funktioniert.

---

## 4. Datenmodelle

### 4.1 Laufzeit-Store

```typescript
interface FlashBoardStoreState {
  activeBoardId: string | null;
  boards: FlashBoard[];
  selectedNodeIds: string[];
  viewMode: 'board';
  composer: {
    draftNodeId: string | null;
    isOpen: boolean;
  };
}

interface FlashBoard {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport: {
    zoom: number;
    panX: number;
    panY: number;
  };
  nodes: FlashBoardNode[];
}

interface FlashBoardNode {
  id: string;
  kind: 'generation' | 'reference';
  createdAt: number;
  updatedAt: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  request?: FlashBoardGenerationRequest;
  job?: FlashBoardJobState;
  result?: FlashBoardResult;
}

interface FlashBoardGenerationRequest {
  service: 'piapi' | 'kieai' | 'cloud';
  providerId: string;
  version: string;
  mode?: string;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  aspectRatio?: string;
  generateAudio?: boolean;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds: string[];
}

interface FlashBoardJobState {
  status: 'draft' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  remoteTaskId?: string;
  progress?: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

interface FlashBoardResult {
  mediaFileId: string;
  mediaType: 'video' | 'image';
  duration?: number;
  width?: number;
  height?: number;
}
```

### 4.2 Projektmodell

```typescript
interface ProjectFlashBoardState {
  version: 1;
  activeBoardId: string | null;
  boards: ProjectFlashBoard[];
  generationMetadataByMediaId: Record<string, FlashBoardGenerationMetadata>;
}

interface ProjectFlashBoard {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  viewport: {
    zoom: number;
    panX: number;
    panY: number;
  };
  nodes: ProjectFlashBoardNode[];
}

interface ProjectFlashBoardNode {
  id: string;
  kind: 'generation' | 'reference';
  createdAt: string;
  updatedAt: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  request?: FlashBoardGenerationRequest;
  job?: Omit<FlashBoardJobState, 'remoteTaskId'>;
  result?: FlashBoardResult;
}

interface FlashBoardGenerationMetadata {
  mediaFileId: string;
  providerId: string;
  version: string;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  aspectRatio?: string;
  generateAudio?: boolean;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds: string[];
  createdAt: string;
}
```

**Wichtig:**
- Persistiert wird `mediaFileId`, nicht `url`
- `remoteTaskId` ist Laufzeit-Zustand und wird nicht als stabile Projektidentitaet behandelt
- Prompt-Metadaten koennen pro `mediaFileId` nachgeschlagen werden, ohne Sidecar-Dateien zu erzeugen

---

## 5. Provider- und Service-Strategie

### 5.1 Model Catalog

`FlashBoardModelCatalog` baut die auswaehlbaren Optionen aus bereits existierenden Services auf:

- Video-Provider aus `piApiService`
- Kie-Provider aus `kieAiService`
- Hosted-Kling ueber dieselbe Request-Form wie `cloudAiService`

**V1 Regeln:**
- Nur Modelle anzeigen, die das Repo heute schon ansprechen kann
- Keine hartcodierte "66+ Modelle"-Behauptung
- Keine Bildmodelle, wenn es dafuer noch keinen integrierten Client gibt

### 5.2 Job Service

`FlashBoardJobService` kapselt:
- Request-Validierung
- Provider-Auswahl
- Queue / Parallelitaet
- Status-Polling
- Retry / Cancel
- Weitergabe an `FlashBoardMediaBridge`

**Parallelitaet in V1:**
- globales Soft-Limit: 3
- provider-spezifisch konfigurierbar
- Kie standardmaessig konservativer als PiAPI

**Polling in V1:**
- Provider-spezifisch
- Kie orientiert sich an den bestehenden Defaults, nicht an aggressiven 1s/2s Polls

### 5.3 Media Bridge

`FlashBoardMediaBridge` uebernimmt:
- `AI Gen` Root-Folder im Media Pool erzeugen
- Unterordner `AI Gen/Video`
- Unterordner `AI Gen/Images`
- fertiges Blob/File ueber `mediaStore.importFile()` importieren
- Import-Ergebnis als `mediaFileId` an FlashBoard zurueckgeben
- Drag-Daten fuer Timeline aus `mediaFileId` erzeugen

**Wichtig:** FlashBoard zieht nie rohe Remote-URLs auf die Timeline.
Nach Completion gilt nur noch das importierte Media-Objekt.

---

## 6. UI-Scope fuer V1

### 6.1 Enthalten

- ein Board
- freie Platzierung
- Zoom + Pan
- Node Selection
- Duplicate / Delete / Retry
- Prompt Composer im Side Panel oder Popover
- Start-/End-Referenz aus:
  - Preview Capture
  - Media Pool
  - Desktop-Datei
- Queue-Status je Node
- Completed Node Preview
- "Add to Timeline"
- Drag vom Node zur Timeline ueber `mediaFileId`

### 6.2 Bewusst verschoben

- Multi-Board Tabs
- Marquee Selection
- Copy/Paste zwischen Boards
- Grid Mode / Masonry Auto Layout
- Prompt Enhancer
- Board Export
- komplexe Hover-Mini-Player
- umfangreiche Kontextmenues mit Upscale / Variant Chains

---

## 7. Multi-Agent Aufteilung

Der Plan ist absichtlich kleiner geschnitten. V1 braucht **5 Agents**, nicht 6-7 lose gekoppelte Baustellen.

```text
Phase 1 (parallel)
  Agent A  Store + Project Types
  Agent B  Board UI im ai-video Panel
  Agent C  Job Service + Model Catalog + Queue

Phase 2 (parallel)
  Agent D  Media Bridge + Timeline DnD + Reference Inputs
  Agent E  Project Save/Load + History Integration + Polish
```

### Agent A - Store & Project Types
**Scope:**
- `src/stores/flashboardStore/`
- `src/services/project/types/`

**Tasks:**
1. FlashBoard store mit `subscribeWithSelector`
2. Board- und Node-Typen definieren
3. Actions fuer:
   - `createBoard(name)`
   - `renameBoard(id, name)`
   - `setActiveBoard(id)`
   - `createDraftNode(boardId, position?)`
   - `updateNodeRequest(nodeId, patch)`
   - `queueNode(nodeId)`
   - `updateNodeJob(nodeId, patch)`
   - `completeNode(nodeId, result)`
   - `failNode(nodeId, error)`
   - `moveNode(nodeId, position)`
   - `resizeNode(nodeId, size)`
   - `duplicateNode(nodeId)`
   - `removeNode(nodeId)`
4. Projekt-Typen um optionalen `flashboard` Abschnitt erweitern

### Agent B - Board UI
**Scope:**
- `src/components/panels/flashboard/`
- `src/components/panels/AIVideoPanel.tsx`

**Tasks:**
1. `AIVideoPanel` um Workspace-Mode `classic | board` erweitern
2. `FlashBoardWorkspace.tsx`
3. `FlashBoardCanvas.tsx` mit Zoom/Pan/freier Platzierung
4. `FlashBoardNode.tsx` fuer draft / queued / processing / completed / failed
5. `FlashBoardToolbar.tsx`
6. `FlashBoardComposer.tsx`
7. `FlashBoardInspector.tsx`

**V1 UI-Regel:**
Kein Grid-Mode, keine Multi-Board-Tabs, kein eigener Dock-Typ.

### Agent C - Job Service & Catalog
**Scope:**
- `src/services/flashboard/`

**Tasks:**
1. `FlashBoardModelCatalog.ts`
2. `FlashBoardJobService.ts`
3. Adapter ueber:
   - `piApiService`
   - `kieAiService`
   - `cloudAiService`
4. Provider-spezifische Queue
5. Polling und Retry
6. Status-Events zur Store-Aktualisierung

### Agent D - Media Bridge & DnD
**Scope:**
- `src/services/flashboard/FlashBoardMediaBridge.ts`
- `src/components/timeline/hooks/useExternalDrop.ts` nur falls noetig

**Tasks:**
1. `AI Gen` / `AI Gen/Video` / `AI Gen/Images` im Media Pool verwalten
2. Completed Outputs importieren
3. Referenzen aus Media Pool akzeptieren
4. Desktop-Dateien als Referenzen importieren
5. Node -> Timeline ueber vorhandene `mediaFileId` Payloads
6. "Add to Timeline" Action

**Wichtig:**
Nur bestehende Drag-Pfade erweitern, keine neue Board-spezifische Timeline-Drop-Welt erfinden.

### Agent E - Save/Load, History, Polish
**Scope:**
- `src/services/project/projectSave.ts`
- `src/services/project/projectLoad.ts`
- `src/stores/historyStore.ts`
- `src/hooks/useGlobalHistory.ts`

**Tasks:**
1. FlashBoard State nach `project.json` schreiben
2. FlashBoard State beim Projektladen wiederherstellen
3. Auto-Dirty / continuous save fuer flashboardStore einhaengen
4. History-Snapshot um FlashBoard erweitern
5. Undo/Redo fuer Move / Resize / Delete / Duplicate / Request-Edits
6. Tests fuer:
   - serialization
   - history
   - provider queue
   - import bridge

---

## 8. Shared Contracts

### 8.1 Job Service

```typescript
interface SubmitNodeJobInput {
  nodeId: string;
  request: FlashBoardGenerationRequest;
}

interface SubmitNodeJobResult {
  nodeId: string;
  remoteTaskId: string;
}

jobService.submit(input: SubmitNodeJobInput): Promise<SubmitNodeJobResult>;
jobService.cancel(nodeId: string): Promise<void>;
jobService.retry(nodeId: string): Promise<void>;
```

### 8.2 Media Bridge

```typescript
interface ImportGeneratedMediaInput {
  nodeId: string;
  file: File;
  mediaType: 'video' | 'image';
  metadata: FlashBoardGenerationMetadata;
}

interface ImportGeneratedMediaResult {
  mediaFileId: string;
}

mediaBridge.importGeneratedMedia(input): Promise<ImportGeneratedMediaResult>;
mediaBridge.addMediaToTimeline(mediaFileId: string): Promise<void>;
mediaBridge.buildTimelineDragPayload(mediaFileId: string): void;
```

### 8.3 Project Save / Load

```typescript
projectData.flashboard = serializeFlashBoardState(flashboardStore.getState());
hydrateFlashBoardFromProject(projectData.flashboard);
```

---

## 9. Persistenz-Details

### 9.1 Speichern

FlashBoard wird ueber die bestehenden Projektwege gespeichert:
- `setupAutoSync()` auf `flashboardStore` erweitern
- `syncStoresToProject()` um FlashBoard-Serialisierung erweitern
- `project.json` bleibt die einzige kanonische Projektdatei

### 9.2 Laden

Beim Projekt-Load:
- erst Media Store laden
- dann FlashBoard-State hydrieren
- Nodes mit `result.mediaFileId` gegen geladene Media-Files aufloesen

### 9.3 Keine Sidecar-Dateien in V1

Es gibt in V1 **keine**:
- `board-{id}.json`
- `flashboards-index.json`
- `{mediaFileId}.meta.json`

Wenn spaeter Search/Export ausserhalb von `project.json` notwendig wird, kann das als Phase 2 ergaenzt werden.

---

## 10. History-Integration

`historyStore` wird um einen serialisierbaren FlashBoard-Ausschnitt erweitert:

```typescript
flashboard: {
  activeBoardId: string | null;
  boards: ProjectFlashBoard[];
}
```

**Undoable in V1:**
- Node move
- Node resize
- Node duplicate
- Node delete
- Request-Aenderungen
- Board rename

**Nicht undoable in V1:**
- laufendes Remote-Polling
- reines Fortschrittsrauschen
- temporaere Hover/UI-Zustaende

---

## 11. Risiken & Mitigation

| Risiko | Mitigation |
|--------|------------|
| Provider-Scope driftet weg von realem Code | Catalog ausschliesslich aus bestehenden Services ableiten |
| Remote URLs laufen ab | Output sofort importieren, danach nur `mediaFileId` persistieren |
| History-Snapshots werden zu gross | Nur serialisierbare Board-Daten speichern, keine Blob-URLs oder Task-Responses |
| Kie/PiAPI Rate Limits | Queue + Soft-Limits von Anfang an |
| Dock-/Panel-Komplexitaet | V1 bleibt im bestehenden `ai-video` Panel |
| Zu viel UI-Scope fuer V1 | Multi-board, export, enhancer und grid mode explizit verschieben |

---

## 12. Milestones

| Milestone | Beschreibung | Fertig wenn... |
|-----------|-------------|----------------|
| M1 | Board Mode shell | `ai-video` kann zwischen classic und board wechseln |
| M2 | Draft -> Queue -> Complete | Ein Node startet ueber bestehende Services und aktualisiert seinen Status |
| M3 | Import Bridge | Fertige Ergebnisse landen im `AI Gen` Folder und referenzieren `mediaFileId` |
| M4 | Timeline Integration | Node kann ueber `mediaFileId` zur Timeline hinzugefuegt oder gezogen werden |
| M5 | Project Persistence | Board-Inhalt wird mit Projekt gespeichert und wieder geladen |
| M6 | Global Undo/Redo | Move/Delete/Edit auf FlashBoard sind undoable |
| M7 | Optional V1.5 | Multi-board oder Export erst nach stabilem Kernflow |

---

## 13. Agent Prompts

### Gemeinsames Prefix

```text
Du arbeitest im MasterSelects Projekt (React + TypeScript + Zustand).
Lies CLAUDE.md fuer Konventionen.
Dein Scope ist Teil des FlashBoard Features.
FlashBoard ist in V1 eine Board-Ansicht innerhalb des bestehenden ai-video Panels.
Nutze bestehende Services und bestehende Store-/Project-/History-Pfade.
Baue kein separates AI-System, keine Sidecar-Projektstruktur und keinen separaten Undo-Stack.
```

### Agent-spezifisch

- **Agent A:** "Implementiere flashboardStore und Project-Typ-Erweiterungen."
- **Agent B:** "Implementiere Board UI unter `components/panels/flashboard/` und den Mode-Switch in `AIVideoPanel.tsx`."
- **Agent C:** "Implementiere Model Catalog und Job Service als Adapter ueber bestehende Provider-Services."
- **Agent D:** "Implementiere Media Bridge, Referenz-Import und Timeline-Anbindung ueber `mediaFileId`."
- **Agent E:** "Integriere FlashBoard in projectSave/load, setupAutoSync und historyStore."

---

## 14. Kurzfassung

Der angepasste Plan macht FlashBoard fuer MasterSelects absichtlich kleiner und enger:
- bestehendes `ai-video` Panel statt neuer Dock-Welt
- bestehende Provider statt Fantasie-Registry
- `mediaFileId` statt persistierter URLs
- `project.json` statt Sidecar-Dateien
- globale History statt eigener Undo-Logik

Das ist weniger spektakulaer als der erste Entwurf, aber deutlich besser passend zur echten Codebasis.
