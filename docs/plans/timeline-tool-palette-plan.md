# Timeline Tool Palette Plan

## Ziel

MasterSelects soll eine kompakte, professionelle Timeline-Toolbar bekommen:

- wenige Haupt-Buttons
- gedrueckt halten oeffnet ein Flyout mit Unterwerkzeugen
- Klick auf den Haupt-Button aktiviert das zuletzt genutzte Werkzeug der Gruppe
- wiederholtes Druecken des Gruppen-Shortcuts zyklisiert durch die Unterwerkzeuge
- alle gaengigen NLE-Timeline-Werkzeuge sind einsortiert, ohne die Toolbar vollzustellen

## Kurzfassung der Entscheidung

- Tool-Palette mit 5 Root-Gruppen: Auswahl, Schnitt, Trimmen, Platzieren, Navigieren/Markieren.
- Tabler Icons bleibt primaeres Icon-System, weil es bereits installiert ist und genug Abdeckung fuer Timeline-Tools bietet.
- Eigene MS-Icons entstehen nur fuer NLE-Spezialfaelle wie Rolling, Slip, Slide, Ripple Trim, Delete Gap und Trim-to-Playhead.
- Phase 0 ist der Operation Kernel. Neue mutierende Tools, AI-Aktionen, Shortcuts, Kontextmenues und Drop-Gesten duerfen keinen zweiten Timeline-Mutationspfad aufbauen.
- Tool-Auswahl ist nicht mutierend und bleibt waehrend Export erlaubt; mutierende Commands und Pointer-Commits werden waehrend Export blockiert.
- Die Palette mountet im Ruler/Header-Bereich mit 150-340px Track-Header-Breite und nutzt Portal-Flyouts gegen Clipping.

Das Interaktionsmodell folgt dem bekannten Adobe-Muster: Werkzeuggruppen zeigen ein kleines Dreieck/Indicator; gedrueckt halten oeffnet die versteckten Werkzeuge. Adobe beschreibt dieses Pattern fuer After Effects/Adobe-Tools als "hold down the mouse button to view the hidden tools". Adobe dokumentiert auch das Wiederholen des Gruppen-Shortcuts zum Durchschalten versteckter Tools und momentary tool activation per gedrueckter Taste.

Quelle:
https://helpx.adobe.com/ca/after-effects/using/general-user-interface-items.html

## Plan-Struktur

Der Plan ist absichtlich zweischichtig:

- zuerst Icon-System und Full-Scope-Integration, also wie die neue Tool-Palette in MS architektonisch andockt und welche bestehenden Sonderpfade sie ersetzt
- danach die Tool-Taxonomie mit Gruppen, Flyout-Verhalten, Registry-Kurzfassung, Phasen, Roadmap und verbindlichen Defaults

## Abschlusskriterien fuer diesen Plan

Der Plan gilt als umsetzungsreif, wenn diese Punkte erfuellt sind:

- Toolgruppen, Untertools und Flyout-Verhalten sind vollstaendig beschrieben.
- Icon-System, externe Quellen und vorhandene Package-Situation sind geprueft.
- aktuelle MS-Codepfade sind mit konkreten Dateien benannt.
- Operation Kernel, Pointer Dispatcher, Overlay-Schicht, Shortcut-System, Export-Lock, History und AI-Tools sind als zusammenhaengende Zielarchitektur geplant.
- Migration ist so geordnet, dass keine neuen parallelen Split/Trim/Delete/Move-Kerne entstehen.
- Tests und manuelle Checks decken UI, Store, AI, Export-Lock, Undo/Redo, Linked-Clips, Collision und responsive Toolbar ab.
- offene Produktentscheidungen haben empfohlene Defaults, damit Implementation nicht blockiert.

## Icon-System

### Empfehlung: Tabler Icons als Primaer-Set

MasterSelects sollte fuer die Timeline-Tool-Palette ein einheitliches Icon-Set verwenden und nicht weiter einzelne Inline-SVGs pro Button zeichnen.

Status:

`@tabler/icons-react` ist bereits im Projekt installiert und wird in `TimelineControls.tsx` fuer Transport-, Snapping- und Cut-Buttons genutzt. Der naechste Schritt ist deshalb nicht Installation, sondern Konsolidierung ueber einen Timeline-Icon-Adapter.

Warum Tabler:

- offizielles Paket und Repository nennen aktuell mehr als 6000/6100 freie Icons; dadurch bessere Abdeckung fuer spezielle Editing-Begriffe als kleinere Sets.
- 24x24 Grid und 2px Stroke passen gut zur aktuellen Toolbar-Sprache.
- React Package, SVG Package, Webfont und Figma Plugin sind offiziell verfuegbar.
- MIT License und kommerzielle Nutzung sind auf der offiziellen Seite genannt.
- Es gibt passende Treffer fuer zentrale Begriffe wie `select`, `select-all`, `scissors`, `blade`, `split`, `ripple`, `stretch`, `insert`, `replace`, `timeline`, `keyframe`, `zoom`, `hand`.

Offizielle Quellen:

- Tabler Icons: https://tabler.io/icons
- Tabler Packages: https://tabler.io/icons/packages
- Tabler Repository: https://github.com/tabler/tabler-icons
- npm Package: https://www.npmjs.com/package/@tabler/icons-react

### Gepruefte Alternativen

| Set | Staerken | Schwaechen | Entscheidung |
|---|---|---|---|
| Tabler Icons | Groesste Abdeckung, modernes 24x24/2px-Outline-System, Figma + React, viele passende Tool-Namen | Groesseres Package; nur gezielte Imports verwenden | Primaer |
| Lucide | Sehr sauber, tree-shakable, aktiv, ISC, gute Basis-UI-Icons | Weniger NLE-spezifische Treffer; kein klares `blade`, schwach bei Keyframe/Ripple | Fallback fuer allgemeine UI, wenn Tabler nicht gewuenscht ist |
| Iconoir | Gute 3D-/Animation-/Keyframe-Abdeckung, MIT, React + Figma | Etwas eigener Look, weniger Standard fuer Dashboard-Toolbar-UI | Kandidat fuer 3D/Animation-spezifische Panels, nicht Timeline-Toolbar |
| Phosphor | Viele Gewichte, freundlich, MIT | Mehr Stilvielfalt als MS braucht; weniger klarer NLE-Tool-Fokus | Nicht fuer diese Toolbar |

Offizielle Quellen:

- Lucide: https://lucide.dev/
- Iconoir: https://iconoir.com/
- Phosphor: https://phosphoricons.com/
- Phosphor React Package: https://www.npmjs.com/package/@phosphor-icons/react

### Import-Regel

Nie das komplette Icon-Paket importieren. Nur einzelne Icons explizit importieren:

```ts
import {
  IconPointer,
  IconScissors,
  IconBlade,
  IconSelectAll,
} from '@tabler/icons-react';
```

Die Timeline sollte eine eigene Adapter-Datei bekommen:

```ts
// src/components/timeline/toolIcons.ts
export const TIMELINE_TOOL_ICONS = {
  select: IconPointer,
  blade: IconBlade,
  // ...
} satisfies Record<TimelineToolId, IconComponent>;
```

Dadurch bleibt die Toolbar unabhaengig vom konkreten Icon-Paket. Wenn spaeter einzelne Icons durch eigene MS-Icons ersetzt werden, aendert sich nur diese Datei.

### Mapping-Vorschlag

Root-Gruppen:

| Gruppe | Tabler Icon | Fallback / Hinweis |
|---|---|---|
| Auswahl | `IconPointer` | alternativ `IconSelect` |
| Schnitt | `IconBlade` | `IconScissors` falls Blade zu aggressiv wirkt |
| Trimmen | `IconAdjustmentsHorizontal` oder Custom `TrimBracket` | eigenes Icon wahrscheinlich besser |
| Platzieren | `IconReplace` | fuer Insert/Overwrite gut lesbar |
| Navigieren | `IconHandMove` oder `IconHandClick` | Zoom Child nutzt eigenes Icon |

Einzeltools:

| Tool | Tabler Icon | Bewertung |
|---|---|---|
| Select / Move | `IconPointer` | direkt |
| Track Select Forward | `IconSelectAll` + kleine Rechts-Pfeil-Variante | wahrscheinlich Custom-Composite |
| Track Select Backward | `IconSelectAll` + kleine Links-Pfeil-Variante | wahrscheinlich Custom-Composite |
| Track Select All Tracks | `IconLayersSelected` oder `IconSelectAll` | direkt oder Composite |
| Range Selection | `IconSelect` / `IconSquaresSelected` | direkt |
| Blade / Razor | `IconBlade` | direkt |
| Blade All Tracks | `IconBlade` + Layer-lines | Custom-Composite |
| Split at Playhead | `IconScissors` oder `IconArrowsSplit` | direkt |
| Split All Tracks | `IconArrowsSplit` + Layer-lines | Custom-Composite |
| Trim Start to Playhead | Custom `TrimStartToPlayhead` | Tabler-Basis mit bracket/arrow |
| Trim End to Playhead | Custom `TrimEndToPlayhead` | Tabler-Basis mit bracket/arrow |
| Ripple Delete | `IconRipple` + `IconTrash` | Custom-Composite |
| Delete Gap | `IconColumnRemove`/Custom gap-close | braucht MS-spezifisches Icon |
| Normal Edge Trim | Custom `TrimEdge` | eigenes Icon besser |
| Ripple Trim | `IconRipple` + trim bracket | Custom-Composite |
| Rolling Edit | Custom `RollingEdit` | eigenes NLE-Icon noetig |
| Slip | Custom `SlipEdit` | eigenes NLE-Icon noetig |
| Slide | Custom `SlideEdit` | eigenes NLE-Icon noetig |
| Rate Stretch | `IconStretching` oder `IconArrowsHorizontal` | direkt brauchbar |
| Position / Overwrite Move | `IconArrowsMove` oder `IconDragDrop` | direkt |
| Insert | `IconColumnInsertRight` oder Custom timeline insert | direkt als Basis |
| Overwrite | `IconReplace` | direkt |
| Replace | `IconReplace` | direkt |
| Fit to Fill | `IconArrowsMaximize` / Custom fit-to-range | eher Custom |
| Append at End | `IconPlayerTrackNext` oder Custom append | direkt als Basis |
| Place on Top | `IconLayersIntersect` / `IconLayersSelected` | direkt als Basis |
| Hand / Pan | `IconHandMove` | direkt |
| Zoom | `IconZoomIn` / `IconZoomOut` | direkt |
| Marker | `IconMapPin` oder `IconFlag` | direkt |
| In Point | Custom `MarkIn` | eigenes Icon besser |
| Out Point | Custom `MarkOut` | eigenes Icon besser |
| Pen / Keyframe | `IconKeyframe` oder `IconBallpen` | direkt |

### Eigene MS-Icons nur fuer NLE-Spezialfaelle

Tabler sollte die Grundsprache liefern. Fuer echte NLE-Konzepte sind eigene Icons sinnvoll, aber sie muessen im Tabler-Stil gezeichnet werden:

- 24x24 viewBox
- 2px Stroke
- round linecap/linejoin
- kein Fill ausser bei aktiven Overlays
- maximal ein Akzent-Overlay pro Icon

Eigene Icons brauchen wir voraussichtlich fuer:

- Rolling Edit
- Slip
- Slide
- Ripple Trim
- Delete Gap
- Trim Start/End to Playhead
- Track Select Forward/Backward, falls die Tabler-Composite-Variante nicht klar genug ist

Diese Icons sollten nicht als ad-hoc SVGs im Button liegen, sondern als React-Komponenten in:

```text
src/components/timeline/icons/
```

## Full-Scope Integration in MasterSelects

### Zielbild

Die Timeline-Tool-Palette soll nicht nur neue Buttons sein. Sie soll die zentrale Bedien- und Ausfuehrungsschicht fuer Timeline-Editing werden:

- eine registrierte Liste aller Timeline-Tools und Commands
- einheitliche Icons, Tooltips, Shortcuts, Aktiv-/Disabled-Zustaende
- ein zentraler Pointer-/Keyboard-Dispatcher fuer werkzeugabhaengige Timeline-Interaktion
- eine Edit-Operation-Schicht fuer Ripple, Trim, Insert, Overwrite, Lift, Extract und Delete Gap
- eine gemeinsame Preview/Overlay-Schicht fuer Cut-Linien, Range-Auswahl, Ripple-Previews, Trim-Handles und Track-Select-Highlights
- kompatibel mit AI Tools, Shortcut-Presets, Undo/Redo, Export-Lock und Guided Replay

Das ist bewusst groesser als ein reiner Button-Umbau. Die Toolbar wird zur Oberflaeche fuer eine robustere Timeline-Editing-Architektur.

### Aktuelle Andockpunkte im Code

Aktuell relevante Stellen:

| Bereich | Datei | Aktueller Zustand | Ziel |
|---|---|---|---|
| Tool State | `src/stores/timeline/types.ts` | `TimelineToolMode = 'select' | 'cut'` | `TimelineToolId`, Gruppen-State, momentary tool state |
| Tool Actions | `src/stores/timeline/playbackSlice.ts` | `setToolMode`, `toggleCutTool` | `setActiveTimelineTool`, `runTimelineToolCommand`, Legacy-Bridge fuer Cut |
| Toolbar UI | `src/components/timeline/TimelineControls.tsx` | Snapping + Cut Button direkt gerendert | `TimelineToolPalette` mit Gruppen/Flyouts |
| Icons | `TimelineControls.tsx`, diverse Inline-SVGs | Inline-SVG pro Button | Tabler Adapter + MS Custom Icons |
| Keyboard | `src/services/shortcutTypes.ts`, `shortcutPresets.ts`, `useTimelineKeyboard.ts` | einzelne Actions, `tool.cutToggle` | Registry-basierte Tool- und Command-Shortcuts |
| Cut Tool | `Timeline.tsx`, `TimelineClip.tsx` | Cut Hover/Click/Snap direkt im Clip | `bladeToolHandler` + gemeinsame overlay state |
| Selection | `selectionSlice.ts`, `useMarqueeSelection.ts` | Clip/keyframe selection getrennt von Werkzeugen | Selection tools nutzen zentrale selection operations |
| Drag/Trim | `useClipDrag.ts`, `useClipTrim.ts`, `useClipFade.ts` | Hook-spezifische Pointer-Logik | weiterhin nutzbar, aber ueber Tool Dispatcher aktivierbar |
| Export Lock | `exportEditLock.ts` | einzelne Action-Namen gesperrt, inklusive altem Toolmode | mutierende Operationen blocken, nicht-mutierende Tool-Auswahl erlauben |
| AI Tools | `src/services/aiTools/handlers/*` | mutieren Store direkt | neue Edit-Operationen auch fuer AI exposebar |
| History | `src/hooks/useGlobalHistory.ts`, `src/stores/historyStore.ts` | debounced Snapshot-History plus explizite Batches fuer AI | Tool-Operationen muessen explizite History-Transactions setzen |
| Shortcut Undo/Redo | `src/hooks/useGlobalHistory.ts` | globaler Shortcut ruft `undo()`/`redo()` direkt | Export-Lock muss History-Undo/Redo blocken oder sicher serialisieren |

### Review-Befunde aus Codebase-Check

Diese Punkte sind vor Umsetzung als harte Anforderungen zu behandeln:

- `@tabler/icons-react` ist schon installiert; der Plan darf keinen Install-Schritt als Voraussetzung fuehren, sondern muss den bestehenden Einsatz konsolidieren.
- AI-Clip-Handler enthalten bereits parallele Mutationskerne, besonders `splitClipBatch()` und direkte `useTimelineStore.setState()`-Aufrufe in `src/services/aiTools/handlers/clips.ts`. Neue Operationen duerfen nicht als dritter paralleler Kern entstehen.
- `cutRangesFromClip` ist ein frueher Migrationskandidat, weil es Range-Split/Delete-Semantik selbst zusammensetzt und linked audio dabei riskant ist.
- `exportEditLock.ts` wrapped Store-Actions nach Namen. Direkte `setState()`-Mutationen aus Services umgehen diese Sperre.
- Undo/Redo ist mutierend, wird aber global ueber `useGlobalHistory.ts` direkt ausgefuehrt und ist in der AI-Policy nicht als mutierendes Timeline-Risiko modelliert. Export-Lock muss History einschliessen.
- `linkedClipId` fuer Audio/Video-Paare und `linkedGroupId` fuer Multicam/Gruppen sind getrennte Kopplungssysteme. Ein Boolean `includeLinkedClips` reicht fuer neue Operationen nicht aus.
- Same-track collision ist heute nicht nur Verhindern von Overlap: bestehende Logik erlaubt Durchdruecken und kann ueberlappte Clips trimmen oder entfernen. Neue Policies muessen dieses Verhalten explizit abbilden.
- UI-Trim und andere Pointer-Operationen committen heute mehrere Store-Actions nacheinander. Neue Tool-Operationen brauchen explizite History-Transactions, damit ein Drag genau ein Undo-Step bleibt.
- `removeClip()` und AI-Delete nutzen Selection heute teilweise als implizite Linked-Policy. Neue Delete/Ripple-Operationen duerfen Linked-Verhalten nicht aus zufaellig gesetzter Selection ableiten.
- `trimClip()` im Store trimmt nur einen Clip; UI-Trim aktualisiert linked audio separat. AI `trimClip` hat heute kein `withLinked`. Trim-Operationen brauchen deshalb explizite Linked-Pair- und Linked-Group-Regeln.
- Collision muss bestehende Drag-/Drop-/Transition-Semantiken erhalten: same-track overwrite kann trimmen/loeschen, cross-track placement sucht freie Bereiche, external drop hat eigene Avoid-Overlap-Logik, transitions duerfen absichtlich ueberlappen.
- Die geplante Palette sitzt praktisch im `timeline-ruler-control-strip` mit ca. 210px Header-Breite. Fuenf Toolgruppen plus Snapping brauchen Compact-/Overflow-Regeln und Flyouts per Portal.
- Die Timeline ist in Video-/Audio-Sektionen mit eigenen vertikalen Offsets und horizontal transformierten Lanes geteilt. Pointer-Events brauchen mehr Kontext als nur Clip/Track/Time.
- Cut deaktiviert heute zwar Clip-Drag/Double-Click, aber Trim-/Fade-Handles koennen Edge-Klicks weiter abfangen. Tool-Prioritaet muss explizit werden.
- Shortcut-Migration betrifft nicht nur Registry-Daten, sondern auch `ShortcutActionId`, `ACTION_META`, Preset-Maps, Konflikterkennung, Settings-Labels, Gruppencycling, Escape und getrennte globale Listener.
- Overlay-Migration braucht eine Layer-Matrix: clip-local, section-scrolled und global-fixed duerfen nicht vermischt werden.

### Codex Review-Runde 2

Vor Umsetzung wird der Plan durch zwei frische Codex-Codebase-Reviews gegengeprueft. Beide Reviews sind lesend und duerfen keine Produktivdateien aendern; Ergebnisse werden danach in diesen Plan eingearbeitet.

Review A: Timeline Store, Edit-Operationen und AI-Bridge

- prueft `src/stores/timeline/**`, `src/services/aiTools/**`, `src/hooks/useGlobalHistory.ts`, `src/stores/historyStore.ts` und `src/stores/timeline/exportEditLock.ts`
- validiert, ob der Operation-Kernel alle mutierenden Pfade abdecken kann
- sucht direkte `useTimelineStore.setState()`-Mutationen und parallele Split/Trim/Delete-Implementierungen
- prueft Risiken bei `linkedClipId`, `linkedGroupId`, History-Batching, Export-Lock und AI-Tool-Kompatibilitaet
- liefert konkrete Plan-Aenderungen mit Datei-/Funktionsreferenzen

Review B: Timeline UI, Pointer-Interaktion, Shortcuts und Overlays

- prueft `src/components/timeline/**`, `src/hooks/**`, `src/services/shortcutTypes.ts`, `src/services/shortcutPresets.ts` und timeline-nahe CSS
- validiert die geplante Tool-Palette, Flyouts, Tool-Dispatcher und Overlay-Schicht gegen die heutige UI-Struktur
- sucht harte Kopplungen wie Cut-Hover in `Timeline.tsx`/`TimelineClip.tsx`, Drag/Trim-Sonderlogik und Shortcut-Sonderpfade
- prueft, welche bestehenden Controls durch die Tool-Palette ersetzt oder vereinfacht werden koennen
- liefert konkrete Plan-Aenderungen mit Datei-/Komponentenreferenzen

Akzeptanz fuer die Review-Runde:

- beide Reviews nennen mindestens die kritischsten Integrationsrisiken
- jeder Befund ist an reale Codepfade gebunden
- der Plan enthaelt danach eine aktualisierte Reihenfolge, falls ein Review harte Vorarbeiten identifiziert
- keine Review-Aussage bleibt als lose Idee stehen; sie wird entweder als Anforderung, Testfall, Migrationsschritt oder offene Entscheidung dokumentiert

Status nach Codex Review-Runde 2:

- Review A bestaetigt: Operation Kernel ist ein harter Phase-0-Blocker vor neuen mutierenden Commands.
- Review A ergaenzt: AI `splitClipBatch`, `cutRangesFromClip`, `reorderClips`, AI `trimClip`, Undo/Redo und external/drop placement muessen explizit in die Migration.
- Review B bestaetigt: UI-Shell ist nicht nur ein Button-Tausch; Mounting, Overflow, Pointer-Koordinaten, Handler-Prioritaet, Overlay-Planes und Shortcut-System muessen mitgeplant werden.
- Die folgenden Abschnitte sind entsprechend aktualisiert: Operation Kernel, Pointer Dispatcher, Ripple-/Collision-Policy, TimelineControls-Integration, Shortcut Settings, Export Lock, Phasen und Tests.

### Neue Modulstruktur

```text
src/components/timeline/tools/
  TimelineToolPalette.tsx
  TimelineToolButton.tsx
  TimelineToolFlyout.tsx
  TimelineToolOverlayLayer.tsx
  useTimelineToolKeyboard.ts
  useTimelineToolPointerDispatcher.ts
  toolIcons.ts
  registry/
    timelineToolGroups.ts
    timelineToolDefinitions.ts
    timelineToolShortcuts.ts
  handlers/
    selectTool.ts
    trackSelectTool.ts
    rangeSelectTool.ts
    bladeTool.ts
    trimTool.ts
    rippleTrimTool.ts
    rollingEditTool.ts
    slipTool.ts
    slideTool.ts
    rateStretchTool.ts
    positionTool.ts
    handTool.ts
    zoomTool.ts
    markerTool.ts
    penKeyframeTool.ts
  icons/
    RollingEditIcon.tsx
    SlipEditIcon.tsx
    SlideEditIcon.tsx
    RippleTrimIcon.tsx
    TrimToPlayheadIcon.tsx
    TrackSelectIcon.tsx

src/stores/timeline/
  toolSlice.ts
  editOperations/
    types.ts
    selectionOperations.ts
    splitOperations.ts
    trimOperations.ts
    rippleOperations.ts
    rangeOperations.ts
    placementOperations.ts
    collision.ts
    preview.ts
```

Der Store kann spaeter intern anders organisiert werden, aber diese Ownership-Grenzen sind wichtig:

- UI-Komponenten kennen Tools, Gruppen, Flyouts und Icons.
- Tool-Handler uebersetzen Pointer/Keyboard in Operationen.
- Store-Operationen veraendern Timeline-Daten.
- Operation Preview berechnet Ghosts/Highlights, ohne State final zu veraendern.

### Store-Zielmodell

Ersetzen:

```ts
export type TimelineToolMode = 'select' | 'cut';
```

Durch:

```ts
export type TimelineToolGroupId =
  | 'selection'
  | 'cut'
  | 'trim'
  | 'placement'
  | 'navigation';

export type TimelineToolKind = 'mode' | 'command';

export type TimelineToolId =
  | 'select'
  | 'track-select-forward'
  | 'track-select-backward'
  | 'track-select-forward-all'
  | 'range-select'
  | 'blade'
  | 'blade-all-tracks'
  | 'split-at-playhead'
  | 'split-all-at-playhead'
  | 'trim-start-to-playhead'
  | 'trim-end-to-playhead'
  | 'ripple-trim-start-to-playhead'
  | 'ripple-trim-end-to-playhead'
  | 'edge-trim'
  | 'ripple-trim'
  | 'rolling-edit'
  | 'slip'
  | 'slide'
  | 'rate-stretch'
  | 'position-overwrite'
  | 'insert'
  | 'overwrite'
  | 'replace'
  | 'fit-to-fill'
  | 'append-at-end'
  | 'place-on-top'
  | 'ripple-overwrite'
  | 'hand'
  | 'zoom'
  | 'marker'
  | 'in-point'
  | 'out-point'
  | 'pen-keyframe';

export interface TimelineToolState {
  activeTimelineToolId: TimelineToolId;
  previousTimelineToolId: TimelineToolId | null;
  lastTimelineToolByGroup: Record<TimelineToolGroupId, TimelineToolId>;
  openTimelineToolGroupId: TimelineToolGroupId | null;
  momentaryTimelineToolId: TimelineToolId | null;
  timelineRangeSelection: TimelineRangeSelection | null;
  timelineToolPreview: TimelineToolPreview | null;
}
```

Legacy-Kompatibilitaet fuer inkrementelle Migration:

```ts
const toolMode =
  activeTimelineToolId === 'blade' || activeTimelineToolId === 'blade-all-tracks'
    ? 'cut'
    : 'select';
```

`toggleCutTool()` bleibt zunaechst bestehen, ruft aber intern `setActiveTimelineTool('blade')`.

### Operation Kernel als P0-Chokepoint

Vor neuen Editing-Tools muss ein kleiner Operation Kernel entstehen. Er ist die zentrale mutierende Grenze fuer alle Timeline-Tool-Commands:

```ts
interface ApplyTimelineEditOperationOptions {
  source:
    | 'ui'
    | 'shortcut'
    | 'context-menu'
    | 'ai-tool'
    | 'guided-replay'
    | 'external-drop';
  historyLabel?: string;
  previewOnly?: boolean;
  signal?: AbortSignal;
}

interface TimelineEditResult {
  success: boolean;
  operationId: string;
  changedClipIds: string[];
  selectedClipIds?: string[];
  warnings: TimelineEditWarning[];
}

function applyTimelineEditOperation(
  operation: TimelineEditOperation,
  options: ApplyTimelineEditOperationOptions,
): TimelineEditResult;
```

Pflichten dieses Kernels:

- Export-/rendering lock pruefen, bevor Timeline-Daten mutieren.
- History-Transaction starten und garantiert beenden.
- Linked-pair und linked-group Policy aufloesen.
- Locked/hidden/muted track policy pruefen.
- Collision/overwrite/ripple policy anwenden.
- Selection nach Operation setzen.
- Cache invalidieren und Duration aktualisieren.
- Warnings liefern, statt stille Teilfehler zu erzeugen.

Dieser Kernel darf zunaechst nur wenige Operationen koennen, aber alle neuen mutierenden Timeline-Pfade muessen dadurch laufen. Neue UI-, Shortcut-, Kontextmenue-, AI-, Guided-Replay- und Drop-Placement-Mutationen duerfen nicht vor dem Kernel eingefuehrt werden.

Jede committed Operation muss genau eine History-Transaction oeffnen und schliessen. Fehlgeschlagene oder reine No-op-Operationen duerfen keinen Undo-Eintrag erzeugen.

Wichtig ist eine klare Trennung der direkten Store-Schreibpfade:

- Edit-State-Mutationen wie `clips`, `tracks`, `layers`, `clipKeyframes`, Selection nach Edit, Ripple/Trim/Split/Delete/Move muessen durch den Operation Kernel laufen oder als Legacy-Ausnahme dokumentiert sein.
- Runtime-State-Mutationen wie `playheadPosition`, Playback-Flags, Decoder-/Layer-Sync-Zwischenstaende und reine UI-View-Preferences duerfen direkte Store-Actions behalten, solange sie keine Timeline-Struktur veraendern.
- Services duerfen nicht per `useTimelineStore.setState()` editierende Timeline-Struktur veraendern, ohne Export-Lock, History-Transaction, Linked-Policy und Collision-Policy zu durchlaufen.

Die Migration soll deshalb nicht blind alle `setState()`-Aufrufe entfernen. Sie klassifiziert jeden direkten Schreibpfad als `edit-state`, `runtime-state`, `view-state` oder `legacy-exception`.

### Tool Registry

Die Registry wird die einzige Quelle fuer Toolbar, Shortcuts, Tooltips, Settings und Tests:

```ts
interface TimelineToolDefinition {
  id: TimelineToolId;
  groupId: TimelineToolGroupId;
  kind: TimelineToolKind;
  label: string;
  shortLabel?: string;
  description: string;
  icon: TimelineToolIconId;
  shortcutActionId?: ShortcutActionId;
  defaultShortcut?: KeyCombo[];
  priority: 'P0' | 'P1' | 'P2';
  requiresSelection?: boolean;
  mutatesTimeline: boolean;
  allowedDuringPlayback?: boolean;
  disabledReason?: (context: TimelineToolContext) => string | null;
}
```

Die Registry ersetzt:

- harte Button-Labels und SVGs in `TimelineControls.tsx`
- verteilt gepflegte Shortcut-Labels
- indirekte Duplikate zwischen `Keyboard-Shortcuts.md`, Presets und Toolbar-Titeln
- Sonderfaelle wie "Cut Tool active" im Button-Code

### Pointer Dispatcher

Heute entscheiden mehrere Hooks und Komponenten selbst, ob sie auf Pointer reagieren:

- `TimelineClip` kennt Cut Tool direkt.
- `useClipDrag` startet immer bei Clip-Mousedown, ausser Cut blockiert es.
- `useClipTrim` startet direkt an Kanten.
- `useMarqueeSelection` startet auf leerem Raum.

Ziel:

```ts
interface TimelinePointerContext {
  targetKind:
    | 'clip'
    | 'clip-edge'
    | 'clip-fade'
    | 'track-lane'
    | 'track-header'
    | 'ruler'
    | 'keyframe'
    | 'marker'
    | 'empty';
  sectionKind: 'video' | 'audio' | 'ruler' | 'track-header';
  clipId?: string;
  trackId?: string;
  edge?: 'left' | 'right';
  time: number;
  localX: number;
  localY: number;
  scrollX: number;
  sectionScrollY: number;
  trackHeaderWidth: number;
  targetElement: EventTarget | null;
  sourceEvent: PointerEvent | MouseEvent;
}

interface TimelineToolHandler {
  onPointerDown?: (context: TimelinePointerContext) => TimelineToolHandledResult;
  onPointerMove?: (context: TimelinePointerContext) => TimelineToolHandledResult;
  onPointerUp?: (context: TimelinePointerContext) => TimelineToolHandledResult;
  onKeyDown?: (context: TimelineKeyContext) => TimelineToolHandledResult;
  getCursor?: (context: TimelinePointerContext) => string | null;
}
```

Damit kann MS vereinfachen:

- Cut-spezifische MouseMove/Click-Logik aus `TimelineClip.tsx` entfernen.
- Cursor-Logik wird aus Clip-Styles in Tool-Handler verschoben.
- Marquee/TrackSelect/RangeSelect teilen sich Hit-Testing.
- Trim/Ripple/Roll/Slip/Slide teilen sich Edge- und neighbor-resolution.
- Tool-Overlays werden zentral gerendert statt pro Clip.

Tool-Prioritaet muss explizit werden. Nicht-Select-Tools entscheiden vor legacy handlers, ob sie Clip-Drag, Trim-Handles, Fade-Handles, Audio-Regionen, Spectral-Regionen, Keyframes, Marker oder Playhead-Drag uebernehmen, blocken oder durchreichen. Blade muss zum Beispiel klar definieren, ob ein Klick nahe der Clipkante schneidet oder den Trim-Handle aktiviert.

Overlay-Ownership wird pro Tool festgelegt:

| Plane | Einsatz | Beispiele |
|---|---|---|
| `clip-local` | an einen Clip gebunden und mit Clip transformiert | Fade, Audio-Region, Spectral-Region, lokale Keyframes |
| `section-scrolled` | in Video- oder Audio-Sektion, folgt Scroll/Zoom | Range Selection, Track Select Highlight, Ripple Preview |
| `global-fixed` | ueber der gesamten Timeline, nicht lane-gebunden | Flyout Anchor Debug, globaler Drag Ghost, ruler-nahe Guides |

Jedes Tool-Preview deklariert Plane und z-index. Dadurch werden Cut-Linien, Range-Highlights und Trim-Previews nicht mehr als zufaellige Clip- oder Timeline-Sonderlayer verteilt.

### Edit-Operation-Schicht

Die groesste langfristige Vereinfachung kommt nicht durch die Toolbar, sondern durch gemeinsame Timeline-Operationen.

Neue Operationen:

```ts
type TimelineEditOperation =
  | SplitOperation
  | TrimOperation
  | RippleTrimOperation
  | RollingEditOperation
  | SlipOperation
  | SlideOperation
  | RateStretchOperation
  | RippleDeleteOperation
  | LiftOperation
  | ExtractOperation
  | InsertOperation
  | OverwriteOperation
  | ReplaceOperation
  | FitToFillOperation;
```

Jede Operation hat:

```ts
interface TimelineEditOperationBase {
  id: string;
  type: string;
  compositionId: string;
  scope: TimelineEditScope;
  createdAt: number;
  source: 'ui' | 'shortcut' | 'context-menu' | 'ai-tool' | 'guided-replay' | 'external-drop';
}
```

Ausfuehrung:

```ts
previewTimelineEditOperation(operation): TimelineEditPreview
applyTimelineEditOperation(operation): TimelineEditResult
```

Vorteile:

- AI Tools muessen nicht eigene Varianten von Split/Trim/Ripple bauen.
- Undo/Redo bekommt bessere semantische Namen.
- Guided Replay kann dieselbe Operation visualisieren.
- Toolbar, Kontextmenue und Shortcut fuehren exakt denselben Codepfad aus.
- Tests koennen Operationen isoliert pruefen, ohne DOM.

### Ripple- und Collision-Policy

Alle komplexen Tools brauchen dieselbe Policy:

```ts
interface TimelineEditScope {
  trackIds: string[];
  linkedPairPolicy: 'ignore' | 'include' | 'preserve-sync' | 'selection-dependent';
  linkedGroupPolicy: 'ignore' | 'include' | 'preserve-offsets' | 'selection-dependent';
  lockedTrackPolicy: 'skip' | 'block-operation';
  hiddenTrackPolicy: 'skip' | 'include';
  mutedAudioPolicy: 'include' | 'skip';
  rippleMode: 'none' | 'track' | 'all-unlocked' | 'linked-groups';
  collisionMode:
    | 'avoid'
    | 'overwrite-by-trim-delete'
    | 'transition-overlap'
    | 'ripple-insert'
    | 'ripple-delete'
    | 'gap-only'
    | 'preview-only';
  selectionAfterOperation:
    | 'preserve'
    | 'select-created'
    | 'select-affected'
    | 'clear';
}
```

Damit ersetzen wir verstreute Sonderlogik:

- `moveClip(... skipLinked, skipGroup, skipTrim, excludeClipIds)` wird langfristig weniger Parameter brauchen.
- `getPositionWithResistance` bleibt als UI-Hilfe, aber die finale Kollisionsentscheidung sitzt in einer gemeinsamen Operation.
- Locked-track-Checks werden zentral, nicht pro Hook neu.

Bestehende Verhalten werden gemappt, nicht wegoptimiert:

- same-track move entspricht `overwrite-by-trim-delete`, weil ueberlappte Clips heute getrimmt oder entfernt werden koennen.
- cross-track move und external drop entsprechen `avoid`, weil freie Bereiche gesucht werden.
- transitions entsprechen `transition-overlap`, weil dort Ueberlappung absichtlich ist.
- insert/ripple delete verwenden eigene Policies, damit sie locked tracks und linked pairs konsistent behandeln.

### UI-Integration

`TimelineControls` sollte schlanker werden:

Der konkrete Mount-Punkt ist der Ruler/Header-Bereich, praktisch `timeline-ruler-control-strip`. Die Default-Breite des Track-Headers liegt bei ca. 210px; die Tool-Palette darf also nicht von einer breiten Topbar ausgehen.

Anforderungen:

- fuenf Toolgruppen plus Snapping muessen in einer kompakten Header-Breite funktionieren.
- bei wenig Platz braucht die Palette ein Overflow-/Density-Verhalten statt horizontales Ueberlaufen.
- Flyouts muessen ueber ein anchored Portal gerendert werden, damit Timeline-Scroller und `.timeline-body-content` sie nicht clippen.
- Tooltips, Flyout-Panels und Menues duerfen Video-/Audio-Lanes nicht verschieben.

Vorher:

- Transport Buttons
- Slot Toggle
- Snapping
- Cut Button
- Master Audio
- View Dropdown
- Proxy
- Zoom

Ziel:

```tsx
<TimelineControls variant="transport" />
<TimelineToolPalette variant="main" />
<TimelineControls variant="utility" />
<TimelineControls variant="zoom" />
```

Die Tool-Palette uebernimmt:

- Auswahl-/Schnitt-/Trim-/Platzieren-/Navigieren-Gruppen
- Snapping als separater Modifier Toggle neben den Toolgruppen
- Tooltips aus Registry
- Disabled States aus Registry
- Flyouts
- aktive Gruppe und aktives Child-Icon

Transport, Master Audio, View, Proxy und Zoom bleiben in `TimelineControls`, koennen aber spaeter ebenfalls Icon-Adapter nutzen.

### Was wir direkt ersetzen oder vereinfachen koennen

| Heute | Ersatz | Nutzen |
|---|---|---|
| `toolMode: 'select' | 'cut'` | `activeTimelineToolId` | alle Tools skalieren ohne Union-Hacks |
| `toggleCutTool` als Sonderaktion | `setActiveTimelineTool('blade')` + Legacy wrapper | alte Shortcuts bleiben, neue Tools docken an |
| Cut Button in `TimelineControls` | Registry-rendered Tool Group | kein Button-Sonderfall |
| Inline-SVGs fuer Timeline Edit Tools | Tabler Adapter + Custom Icons | einheitlicher Look, weniger JSX |
| Cut Hover State in `Timeline.tsx` | `timelineToolPreview` | alle Tool-Previews einheitlich |
| Cut MouseMove/Click in `TimelineClip.tsx` | `bladeToolHandler` | Clip-Komponente wird dummer |
| Marquee als isolierter Spezialhook | `rangeSelectTool`/`selectTool` nutzt shared hit-testing | Range und Marquee teilen Geometrie |
| `splitClipAtPlayhead` als einzige Split-Command-Variante | Split Operations: selected/current/all tracks | sauberer fuer Toolbar, Shortcut, AI |
| Delete nur remove selected clips | Delete/Lift/RippleDelete/DeleteGap Commands | echte NLE-Semantik |
| Shortcut-Presets kennen nur `tool.cutToggle` | Tool-Registry liefert alle bindbaren Tools | Settings UI bleibt konsistent |
| Export lock kennt einzelne alte Actions | Tool/Command Actions im Lock | keine mutierenden Tools waehrend Export |

### Was nicht ersetzt werden sollte

Nicht alles muss neu gebaut werden:

- `useClipDrag` bleibt fuer Select/Move zunaechst bestehen.
- `useClipTrim` bleibt fuer Normal Edge Trim zunaechst bestehen.
- `useClipFade` bleibt getrennt; Fade ist kein Timeline-Haupttool.
- `useMarkerDrag` bleibt fuer Marker-Transport, kann spaeter in Tool Handler integriert werden.
- `useTimelineZoom`, `usePlayheadDrag`, `usePlayheadSnap` bleiben.

Der richtige Umbau ist: bestehende robuste Hooks behalten, aber ihre Aktivierung und Konfliktlogik ueber Tool Handler steuern.

### Integration mit AI Tools

Die vorhandenen AI Tools haben bereits Split/Trim/Delete/Move-Funktionen. Full Scope sollte sie nicht parallel weiterentwickeln, sondern auf die neue Operation-Schicht ziehen.

Wichtig: AI-Consolidation ist keine spaete Politur. Sobald ein neuer Split/Trim/Delete/Ripple-Command gebaut wird, muss der entsprechende AI-Handler entweder denselben Operation Kernel nutzen oder explizit als Legacy-Pfad markiert sein. Sonst entstehen drei konkurrierende Semantiken: UI, Store und AI.

Fruehe Migrationskandidaten:

- `splitClipBatch()` in `src/services/aiTools/handlers/clips.ts`
- `handleCutRangesFromClip()`
- `handleReorderClips()`, weil es Timeline-Startzeiten direkt neu setzt
- `handleDeleteClip()` / `handleDeleteClips()`
- `handleMoveClip()`
- `handleTrimClip()`, inklusive neuer Linked-Pair-Policy statt implizit single-clip

Ziel-Mapping:

| AI Tool heute | Zukuenftiger Kern |
|---|---|
| `splitClip` | `applyTimelineEditOperation({ type: 'split' })` |
| `splitClipAtTimes` | Batch von `split` Operationen |
| `deleteClip(s)` | `lift` oder `delete` Operation mit Scope |
| `moveClip` | `move`/`position-overwrite` Operation |
| `trimClip` | `trim` Operation |
| `cutRangesFromClip` | `range` + `lift/extract` Operation |
| `reorderClips` | Batch aus `move`/`append` Operationen mit expliziter collision policy |
| `executeBatch` | Operation transaction mit einem Undo-Punkt |

Dadurch bekommt AI dieselbe Undo-, Lock-, Linked-Clip- und Collision-Semantik wie die UI.

### Integration mit Guided Replay

Die Tool-Palette passt gut zum vorhandenen Guided-Action-Runtime-Plan.

Jede Operation sollte optional liefern:

```ts
interface TimelineEditReplayDescriptor {
  toolId: TimelineToolId;
  targets: TimelineReplayTarget[];
  pointerPath?: TimelineReplayPoint[];
  overlayLabels?: TimelineReplayLabel[];
  durationMs?: number;
}
```

Damit kann die AI spaeter zeigen:

- Toolgruppe oeffnen
- Blade auswaehlen
- Cut-Linie setzen
- Ripple Delete ausfuehren
- Ergebnis hervorheben

Ohne DOM-Klicks als Wahrheit zu benutzen.

### Integration mit Shortcut Settings

`ShortcutActionId` sollte erweitert werden:

```ts
| 'tool.select'
| 'tool.trackSelectForward'
| 'tool.trackSelectBackward'
| 'tool.rangeSelect'
| 'tool.blade'
| 'tool.trim'
| 'tool.rippleTrim'
| 'tool.rollingEdit'
| 'tool.slip'
| 'tool.slide'
| 'tool.rateStretch'
| 'tool.position'
| 'tool.hand'
| 'tool.zoom'
| 'command.splitAtPlayhead'
| 'command.splitAllAtPlayhead'
| 'command.trimStartToPlayhead'
| 'command.trimEndToPlayhead'
| 'command.rippleDelete'
| 'command.deleteGap'
| 'command.lift'
| 'command.extract'
| 'command.insert'
| 'command.overwrite'
| 'command.replace'
| 'command.fitToFill'
```

`edit.splitAtPlayhead` kann als alias/legacy action bleiben, sollte aber in der UI als `command.splitAtPlayhead` erscheinen.

Preset-Strategie:

- MasterSelects: modern, kompakt, eigene Defaults.
- Premiere: C Razor, A Track Select, Ctrl+K Split.
- Resolve: B Blade, Ctrl+B Split.
- FCP: B Blade, Cmd+B Blade at Playhead, Range Selection prominent.
- AE: kein NLE-Trim-Fokus, aber Toolgruppen-Cycling und Pen/Hand/Zoom nah an AE.

Migration betrifft alle Shortcut-Schichten:

- `ShortcutActionId` erweitern.
- `ACTION_META` aus Registry oder Registry-Sync speisen.
- `BASE_MAP` und alle Preset-Maps aktualisieren.
- Konflikterkennung und Settings-Labels auf Tool-/Command-Metadaten umstellen.
- Gruppencycling fuer wiederholte Gruppen-Shortcuts ergaenzen.
- Escape schliesst Flyouts und bricht Preview-/Drag-Operationen ab.
- Globale Undo/Redo-Listener bleiben kompatibel, werden aber gegen Export-Lock und Operation-Transactions geprueft.

### Integration mit Export Lock

Alle neuen mutierenden Actions muessen vom Operation Kernel und `exportEditLock.ts` blockiert werden. Aktuell sind `setToolMode` und `toggleCutTool` als alte Actions gesperrt; mit der neuen Palette muss Tool-Auswahl als nicht-mutierend reklassifiziert werden.

Nicht mutierend:

- Toolgruppe oeffnen
- aktives Tool wechseln
- Hand/Zoom
- Hover Preview

Mutierend:

- alle Commands, die Clips/Tracks/Keyframes/Marker veraendern
- Tool Pointer-Up, wenn es eine Edit Operation committed

Empfehlung:

- `setActiveTimelineTool` waehrend Export erlauben, aber mutierende Handler disabled rendern.
- Legacy `setToolMode`/`toggleCutTool` aus der mutierenden Export-Lock-Kategorie herausloesen oder intern auf nicht-mutierende Tool-Auswahl mappen.
- `runTimelineToolCommand` waehrend Export blocken, wenn Command mutiert.
- Pointer-Preview waehrend Export erlauben; Pointer-Commit mutierender Tools blocken.
- `timelineToolPreview` waehrend Export erlauben, solange keine Mutation passiert.
- History `undo` und `redo` waehrend Export blocken oder in eine explizite Export-sichere Warteschlange schieben.
- AI-Policy darf mutierende Timeline-Operationen nicht als `readOnly` klassifizieren, nur weil sie semantisch "Undo" oder "Redo" heissen.
- Direkte `useTimelineStore.setState()`-Mutationen aus Services muessen fuer mutierende Timeline-Tools durch Operationen ersetzt oder im Export-Lock gesondert verboten werden.

### Integration mit Persistence

Nicht in Projektdatei speichern:

- aktives Tool
- offene Flyouts
- Preview State
- Range Selection, ausser sie wird spaeter als echte Work Area/Selection persistiert

Lokal in Settings speichern:

- letzte Toolgruppe/Child-Auswahl optional
- Toolbar-Dichte
- Single-shot Blade Preference
- Tool Flyout Delay
- Tooltips an/aus

Projektdatei bleibt sauber und reproduzierbar.

### Integration mit Docs

Bei Implementierung muessen aktualisiert werden:

- `docs/Features/Timeline.md`
- `docs/Features/Keyboard-Shortcuts.md`
- `docs/Features/AI-Integration.md`, wenn AI Tools auf Operationen umgestellt werden
- `docs/Features/Guided-Action-Runtime-Plan.md`, wenn Replay-Descriptor genutzt wird

`src/version.ts` nur bei spaeterem Merge nach `master` anfassen, gemaess Repo-Regel.

## Zentrale Operationen im Detail

### Selection Operations

```ts
selectTimelineClips(ids, options)
selectClipsFromTime(time, options)
selectClipsInRange(range, options)
selectClipsByTrack(trackIds, options)
clearTimelineSelection(options)
```

Ersetzt/ergaenzt:

- `selectClip`
- `selectClips`
- Teile von `useMarqueeSelection`

Wichtig:

- linked clip policy explizit
- curve editor protection erhalten
- locked tracks nicht automatisch selektieren, ausser explizit fuer read-only highlight

### Split Operations

```ts
splitAtTime({ clipIds, time, includeLinked })
splitAllAtTime({ time, trackIds, includeLinked })
splitAtTimes({ clipId, times, includeLinked })
```

Ersetzt/ergaenzt:

- `splitClip`
- `splitClipAtPlayhead`
- AI split handlers

Wichtig:

- keine Double-Splits bei linked audio/video
- Clip min duration
- source runtime ownership bleibt korrekt
- selection after split konsistent

### Trim Operations

```ts
trimClipEdge({ clipId, edge, targetTime, mode: 'normal' | 'ripple' })
trimSelectionToPlayhead({ edge, mode })
rollingEdit({ leftClipId, rightClipId, editTime })
slipClip({ clipId, sourceDelta })
slideClip({ clipId, timelineDelta })
rateStretchClip({ clipId, targetDuration })
```

Ersetzt/ergaenzt:

- Teile von `useClipTrim`
- spaeter Parameter-Komplexitaet in `moveClip`

Wichtig:

- naturalDuration und infinite clip semantics
- vector loop extension
- audio pitch preservation bei Rate Stretch
- transitions an Schnittpunkten
- linked audio sync

### Range Operations

```ts
setTimelineRangeSelection(range)
clearTimelineRangeSelection()
liftRange(range, options)
extractRange(range, options)
copyRange(range, options)
splitRangeBoundaries(range, options)
```

Wichtig:

- Range ist nicht nur Clip-Auswahl.
- Range kann ueber Teilbereiche von Clips liegen.
- Lift laesst Gap.
- Extract schliesst Gap.

### Placement Operations

```ts
insertSourceAtTime(source, time, options)
overwriteSourceAtTime(source, time, options)
replaceClipWithSource(targetClipId, source, options)
fitSourceToRange(source, range, options)
appendSource(source, options)
placeSourceOnTop(source, time, options)
```

Abhaengigkeiten:

- Current Source aus Media Panel / Source Monitor / selected media item.
- Track targeting policy.
- Overlap resolver.

## Umsetzung als robuste Gesamtsequenz

### Slice 0: Operation Kernel P0

Dieser Slice ist ein harter Gate vor neuen mutierenden Tools. Sichtbare UI-Shell kann parallel vorbereitet werden, aber jeder neue Split/Trim/Delete/Ripple/Move/Drop-Commit muss nach diesem Slice ueber den Kernel laufen.

Lieferung:

- `applyTimelineEditOperation`.
- Export-Guard im Kernel.
- History-Transaction pro Operation.
- zentrale Linked-/Group-/Track-/Collision-Policy-Typen.
- nur Split, Select-from-time, Ripple Delete und Delete Gap als erste Operationen.

Vereinfachung:

- Neue Tools und AI-Migrationen bekommen einen gemeinsamen Chokepoint.
- Mutierende Direct-`setState()`-Pfade koennen gezielt abgebaut werden.

### Slice A: Tool Foundation

Dateien:

- `src/stores/timeline/toolSlice.ts`
- `src/components/timeline/tools/registry/*`
- `src/components/timeline/tools/toolIcons.ts`
- `src/components/timeline/tools/TimelineToolPalette.tsx`
- `src/components/timeline/tools/TimelineToolFlyout.tsx`

Lieferung:

- Bestehendes `@tabler/icons-react` ueber einen Timeline-Icon-Adapter konsolidieren.
- Registry fuer alle Tools/Commands anlegen.
- Toolbar rendert Gruppen aus Registry.
- `activeTimelineToolId` und `lastTimelineToolByGroup`.
- Legacy `toolMode`, `setToolMode`, `toggleCutTool` bleiben kompatibel.
- `TimelineToolPalette` mountet im Ruler-Control-Strip und kann bei 210px Header-Breite kompakt/overflow rendern.
- Flyouts rendern per anchored Portal und werden nicht von Timeline-Scrollcontainern geclippt.
- Nur Select und Blade sind funktional gemappt, aber alle Tools sichtbar mit Disabled/Future State nach Plan.

Warum trotzdem Full-Scope:

- Die vollstaendige Registry existiert von Anfang an.
- Die Architektur kennt Mode/Command, Mutability, Shortcut, Icon, Disabled State.
- Spaetere Tools sind keine neuen UI-Sonderfaelle.

### Slice B: Pointer Dispatcher und Blade-Migration

Dateien:

- `useTimelineToolPointerDispatcher.ts`
- `handlers/bladeTool.ts`
- `TimelineToolOverlayLayer.tsx`
- Anpassungen in `Timeline.tsx`, `TimelineClip.tsx`

Lieferung:

- Cut Hover/Click aus `TimelineClip.tsx` entfernen.
- Blade benutzt Tool Handler.
- `timelineToolPreview` rendert Cut-Indikator.
- Blade all tracks kann dieselbe Infrastruktur nutzen.
- `TimelinePointerContext` enthaelt Video/Audio-Section, lokale Koordinaten, Scrollwerte und target element.
- Handler-Prioritaet fuer Blade vs Clip-Drag, Trim, Fade, Marker, Keyframe und Playhead ist dokumentiert und getestet.
- Overlay-Planes fuer `clip-local`, `section-scrolled` und `global-fixed` sind festgelegt.

Vereinfachung:

- Clip-Komponente kennt nicht mehr `cutHoverInfo`.
- `Timeline.tsx` muss keinen Cut-Spezialstate halten.

### Slice C: Edit Operations Core

Dateien:

- `editOperations/types.ts`
- `splitOperations.ts`
- `selectionOperations.ts`
- `rippleOperations.ts`
- Tests unter `tests/unit/timeline/editOperations/*`

Lieferung:

- pure functions fuer Split, Select From Time, Ripple Delete, Delete Gap.
- Store-Actions rufen Operationen auf.
- AI Split/Delete/Range-Handler wechseln auf dieselben Operationen, bevor neue Palette-Commands fuer diese Semantik aktiviert werden.

Vereinfachung:

- `splitClipAtPlayhead` wird ein duenner Wrapper.
- Selection- und Split-Tests werden leichter.

### Slice D: Auswahlgruppe vollstaendig

Lieferung:

- Track Select Forward/Backward.
- All Tracks Modifier.
- Range Selection Visual State.
- Range Selection Actions fuer Lift/Extract spaeter.

Vereinfachung:

- Marquee-Geometry wird shared.
- "ab hier alles auswaehlen" wird first-class statt Workaround.

### Slice E: Schnitt-Commands vollstaendig

Lieferung:

- Split All at Playhead.
- Blade All Tracks.
- Trim Start/End to Playhead.
- Ripple Delete.
- Delete Gap.
- Kontextmenue nutzt dieselben Commands.

Vereinfachung:

- Delete semantics werden explizit: Delete/Lift vs Ripple Delete.
- Context menu muss nicht eigene Clip-Entscheidungen treffen.

### Slice F: Trim Engine

Lieferung:

- Ripple Trim.
- Rolling Edit.
- Slip.
- Slide.
- Rate Stretch.
- Operation Preview fuer Ghost-Clips, blocked states und source bounds.

Vereinfachung:

- Drag/Trim-Kollisionen laufen ueber gemeinsame Policy.
- `moveClip` kann langfristig intern ueber Operationen gehen.

Aktueller Implementierungsstand:

- Ripple Trim, Rolling Edit, Slip, Slide und Rate Stretch existieren als `TimelineEditOperation`-Varianten mit fokussierten Unit-Tests fuer linked audio/video, Nachbar-Clips, source timing, timeline timing und Speed-Semantik.
- Trim Start/End to Playhead und Ripple Trim Start/End to Playhead laufen ueber den Operation Kernel.
- Edge Trim, Ripple Trim, Rolling Edit und Rate Stretch sind in der UI ueber Trim-Handles angebunden und committen durch `applyTimelineEditOperation`.
- Slip und Slide sind als Body-Drag-Gesten angebunden: Slip verschiebt Source-In/Out bei gleicher Timeline-Position, Slide bewegt den Clip zwischen Nachbarn und commitet beide Werkzeuge durch den Operation Kernel.
- Icon-Cursor sind fuer aktive Pointer-Tools angebunden, damit das ausgewaehlte Werkzeug am Mauszeiger sichtbar bleibt.
- `TimelineToolOverlayLayer` rendert gemeinsame Section-Overlays fuer Track Select, Blade All Tracks, blocked states und Placement-Ghost-Clips mit Source-In/Out-Bounds.
- Noch offen sind hoehere Operation-Previews fuer Trim/Ripple-Ghost-Zustaende jenseits der bereits vorhandenen Drag-Previews.

### Slice G: Placement Engine

Lieferung:

- Insert.
- Overwrite.
- Replace.
- Fit to Fill.
- Append.
- Place on Top.
- Ripple Overwrite.
- Drag-and-drop Targeting nutzt dieselbe Engine.

Vereinfachung:

- Media Panel Drop, Source Monitor Edit Buttons und Toolbar Commands laufen ueber denselben Code.

Aktueller Implementierungsstand:

- `place-timeline-range` existiert als Operation-Kernel-Pfad fuer Insert- und Overwrite-artige Range-Vorbereitung.
- Insert splittet Clips am Einfuegepunkt und schiebt folgende Clips auf den Ziel-Tracks nach rechts.
- Position/Overwrite trimmt, loescht oder splittet Clips im Zielbereich, bevor der neue Drop-Clip erzeugt wird.
- Linked video/audio-Split-Parts behalten ihre Links, wenn beide Tracks in der Placement-Operation betroffen sind.
- Externe Drops im aktivierten `Position / Overwrite`-Tool nutzen diese Operation; normale Select-Drops bleiben gap-aware.
- Die Toolbar-Commands Insert, Overwrite, Replace, Fit to Fill, Append, Place on Top und Ripple Overwrite loesen die aktuelle Source aus Media Panel oder Source Monitor auf und fuehren danach die passende Placement-Operation aus.
- Replace, Fit to Fill und Ripple Overwrite nutzen bevorzugt Timeline-Range oder kompatiblen Zielclip; Insert/Overwrite nutzen den Playhead, Append das Track-Ende und Place on Top eine freie oder neu angelegte Videospur.
- Source-Monitor-In/Out wird als Quellrange fuer Placement aufgeloest; die Commands erhalten daraus Source-Dauer, Source-In und volle Natural-Duration.
- Source Monitor bietet direkte Insert-, Overwrite-, Replace-, Fit-, Append- und Top-Buttons ausserhalb der Timeline-Toolbar, auch fuer Still-Image-Quellen.
- Placement-Commands veroeffentlichen beim Hover/Fokus eine nicht-mutierende Ghost-Preview mit Track-Zielen, Timeline-Dauer und Source-In/Out-Bounds.

### Slice H: AI/Gesture/Docs Consolidation

Lieferung:

- AI handlers auf Operationen mappen.
- Guided Replay Descriptor.
- Keyboard Settings ergaenzen.
- Docs aktualisieren.
- alte Compatibility Wrapper markieren.
- mutierende AI-Handler auf Operation Kernel ziehen.
- Direct-`setState()`-Mutationen in AI-Clip-Editing-Handlern entfernen oder als Legacy-Ausnahme dokumentieren.

Aktueller Implementierungsstand:

- Pen/Keyframe ist als Navigation/Marking-Mode aktiviert und nutzt einen eigenen Icon-Cursor.
- Klicks auf sichtbare Keyframe-Property-Lanes setzen Keyframes am Klickzeitpunkt mit einem aus der vorhandenen Lane interpolierten Wert.
- `TimelineEditOperation` kann ueber `createTimelineEditReplayDescriptor()` in einen `TimelineEditReplayDescriptor` gemappt und mit `compileTimelineEditReplayDescriptor()` als visuelle Guided-Actions wiedergegeben werden.
- Die verbleibende Consolidation betrifft vor allem hoehere Trim/Ripple-Ghost-Previews und den Completion-Audit gegen alle Qualitaetskriterien.

## Tests und Qualitaetskriterien

### Unit Tests

Pflichtbereiche:

- tool registry completeness
- every tool has icon, label, group, kind, mutability
- shortcut metadata exists for bindable tools
- export lock blocks mutating commands
- split operations avoid linked duplicates
- ripple delete respects locked tracks
- delete gap only removes actual gaps
- trim to playhead handles infinite/generated clips
- range selection hit-testing is frame-stable
- AI `cutRangesFromClip` with linked audio leaves no orphaned linked parts
- undo/redo is blocked or safe while export is active
- mutating AI clip tools do not bypass the operation/export guard
- AI split/delete/trim on locked tracks and locked linked clips does not mutate state
- AI `reorderClips` goes through operation/collision policy
- linked pair policy and linked group policy are tested separately
- same-track overwrite-by-trim/delete preserves existing drag-drop semantics
- cross-track placement and external drop avoid overlap
- transition overlap remains allowed and is not treated as corruption
- pointer hit-testing handles video/audio split sections and scroll offsets
- overlay coordinate conversion is stable across zoom/scroll
- Blade-vs-trim-handle priority is deterministic
- UI trim/linked trim commits as one undo step
- multi-select drag commits as one undo step

### Component Tests

Pflichtbereiche:

- long press opens flyout
- right-click/chevron opens flyout
- root click activates last child
- Escape closes flyout
- disabled command cannot run
- active tool state is visible
- shortcut labels render from registry
- palette compact/overflow states fit narrow track-header widths

### Browser/Visual Tests

Pflichtbereiche:

- toolbar fits at desktop and mobile widths
- toolbar fits at 150px, 210px and 340px track-header widths
- flyout does not overflow viewport
- flyout is not clipped by timeline body/scrollers
- icons render nonblank
- Cut/Blade overlay aligns with frame grid
- Track Select highlight matches selected clips
- Range Selection overlay does not cover unrelated UI

### Manual Smoke Tests

Pflichtszenarien:

- split linked video/audio
- Blade click near clip edges behaves according to tool priority
- track select forward on one track
- track select forward all unlocked tracks
- range/track select across video and audio sections
- ripple delete selected middle clip
- delete gap between clips
- trim start/end to playhead
- marker, in/out and keyframe rows still receive intended interactions
- undo/redo after every operation
- export lock disables mutating commands


## Iststand in MasterSelects

MasterSelects hat aktuell nur zwei Timeline-Werkzeugmodi:

```ts
export type TimelineToolMode = 'select' | 'cut';
```

Vorhanden sind:

- Select / Move
- Multi-select und Marquee Selection
- Edge Trim durch Ziehen der Clip-Kanten
- Cut Tool
- Split at Playhead
- Copy / Paste / Delete
- In / Out Points
- Marker
- Snapping
- Zoom / Pan per Scroll-Gesten
- Track Lock / Mute / Solo / Visibility

Das reicht fuer Basis-Editing, aber nicht fuer schnelles NLE-artiges Arbeiten. Vor allem fehlen Track Select, Ripple/Trim-Werkzeuge, Range Selection, Lift/Extract und echte Insert/Overwrite-Operationen.

## Design-Prinzipien

### 1. Wenige Gruppen, viele Werkzeuge

Die Toolbar soll nicht jedes Tool einzeln zeigen. Ziel sind 5 Hauptgruppen:

1. Auswahl
2. Schnitt
3. Trimmen
4. Platzieren
5. Navigieren und Markieren

Damit bleiben die Werkzeuge nah an bekannten NLEs, ohne Premiere/FCP/Resolve/Avid exakt zu kopieren.

### 2. Modus vs. Befehl sauber trennen

Nicht jedes "Tool" ist technisch ein persistenter Modus.

Persistent Tool Mode:

- aendert Maus-/Pointer-Verhalten, bis ein anderes Tool gewaehlt wird
- Beispiele: Select, Track Select, Range Select, Blade, Ripple Trim, Roll, Slip, Slide, Hand, Zoom

Momentary Command:

- fuehrt sofort eine Operation aus
- Beispiele: Split at Playhead, Split All Tracks, Trim Start to Playhead, Ripple Delete, Lift, Extract, Insert, Overwrite

In der UI duerfen beide im selben Flyout auftauchen. In der Implementierung brauchen sie unterschiedliche Typen.

### 3. Letzte Auswahl pro Gruppe merken

Jede Werkzeuggruppe speichert ihr zuletzt gewaehltes Child-Tool.

Beispiel:

- Hauptbutton "Auswahl" zeigt standardmaessig Pointer.
- User waehlt im Flyout "Track Select Forward".
- Danach aktiviert ein einfacher Klick auf den Auswahl-Hauptbutton wieder Track Select Forward.

Das entspricht Adobe-Toolbar-Erwartungen und macht Power-User schneller.

### 4. Tool-Shortcuts bleiben NLE-presettauglich

Jedes Tool bekommt:

- individuelle bindbare Shortcut-Action
- optional einen Gruppen-Shortcut
- Preset-Mapping fuer MasterSelects, Premiere, DaVinci, Final Cut, After Effects

Wiederholtes Druecken des Gruppen-Shortcuts kann durch die Unterwerkzeuge laufen. Shift + Gruppen-Shortcut kann rueckwaerts laufen.

## Vorgeschlagene Hauptgruppen

### Gruppe 1: Auswahl

Root Icon: Pointer

Zweck:

- Dinge auswaehlen
- Bereiche auswaehlen
- "ab hier alles auswaehlen"

| Tool | Typ | Beschreibung | Prioritaet |
|---|---|---|---|
| Select / Move | Mode | Clips, Keyframes und Handles normal auswaehlen und bewegen | P0 |
| Track Select Forward | Mode | Alle Clips ab Klickposition rechts auswaehlen, standardmaessig auf der getroffenen Spur | P0 |
| Track Select Backward | Mode | Alle Clips links von Klickposition auswaehlen | P1 |
| Track Select Forward All Tracks | Command/Modifier | Alle Clips ab Position ueber alle unlocked/visible Tracks auswaehlen | P0 |
| Range Selection | Mode | Zeitbereich ueber Clips/Tracks ziehen; Grundlage fuer Lift/Extract/Copy | P1 |

Default-Verhalten:

- Click: aktiviert Select / zuletzt genutztes Auswahltool
- Hold: oeffnet Flyout
- Shortcut `V`: Select
- Shortcut-Vorschlag `A`: Track Select Forward
- Shift mit Track Select: alle Tracks
- Alt/Option mit Track Select: nur linked group ignorieren oder einschliessen, je nach finaler UX-Entscheidung

Warum als eigene Gruppe:

- "ab hier alles auswaehlen" ist kein Schnittwerkzeug, sondern ein Selektionswerkzeug.
- Range Selection gehoert hierher, auch wenn es oft vor Lift/Extract genutzt wird.

### Gruppe 2: Schnitt

Root Icon: Blade / Scissors

Zweck:

- Clips trennen
- Schnitte erzeugen
- schnelles "Edit Point" Arbeiten

| Tool | Typ | Beschreibung | Prioritaet |
|---|---|---|---|
| Blade / Razor | Mode | Klick auf Clip trennt an Klickposition | P0, vorhanden |
| Blade All Tracks | Mode/Modifier | Trennt alle Clips unter der Schnittposition auf unlocked Tracks | P0 |
| Split at Playhead | Command | Trennt Clips am Playhead, respektiert Auswahl | P0, vorhanden |
| Split All Tracks at Playhead | Command | Trennt alle durchlaufenden Clips am Playhead | P0 |
| Trim Start to Playhead | Command | Linke Clipkante bis Playhead trimmen | P0 |
| Trim End to Playhead | Command | Rechte Clipkante bis Playhead trimmen | P0 |
| Ripple Trim Start to Playhead | Command | Linke Clipkante trimmen und folgende Clips nachziehen | P1 |
| Ripple Trim End to Playhead | Command | Rechte Clipkante trimmen und folgende Clips nachziehen | P1 |

Default-Verhalten:

- Click: aktiviert Blade / zuletzt genutztes Schnitttool
- Hold: oeffnet Flyout
- Shortcut in MS: `C` fuer Blade
- Premiere-Preset: `C` Razor, `Ctrl+K` Split at Playhead
- Resolve/FCP-Preset: `B` Blade, `Ctrl+B` Split at Playhead

Warum nicht alles unter Trimmen:

- Blade/Split erzeugt neue Schnittpunkte.
- Trim-Werkzeuge verschieben vorhandene Schnittpunkte.
- "Trim to Playhead" fuehlt sich wie Schnitt an, ist aber technisch ein Kantenbefehl. Es bleibt hier, weil User es als schnelles Cut-Command erwarten.

### Gruppe 3: Trimmen

Root Icon: Trim Bracket / Rolling Edit

Zweck:

- bestehende Schnittpunkte feinjustieren
- Timeline-Laenge kontrolliert veraendern oder stabil halten
- Source-Timing innerhalb eines Clips aendern

| Tool | Typ | Beschreibung | Prioritaet |
|---|---|---|---|
| Normal Edge Trim | Mode | Clipkante trimmen ohne Ripple, aktuell per Handle vorhanden | P0 |
| Ripple Trim | Mode | Clipkante trimmen und alle folgenden Clips auf betroffenen Tracks verschieben | P1 |
| Rolling Edit | Mode | Schnittpunkt zwischen zwei Clips verschieben, Gesamtdauer bleibt gleich | P1 |
| Slip | Mode | Clip bleibt zeitlich gleich, Source-In/Out verschieben sich | P1 |
| Slide | Mode | Clip bewegt sich zwischen Nachbarn, Nachbarn werden gegentrimmt | P2 |
| Rate Stretch | Mode | Clipdauer durch Ziehen aendern, Speed passt sich automatisch an | P2 |

Default-Verhalten:

- Click: aktiviert zuletzt genutztes Trim-Tool, initial Normal Edge Trim
- Hold: oeffnet Flyout
- Shortcut-Vorschlag `T`: Trim-Gruppe
- Wiederholtes `T`: Normal Trim -> Ripple -> Roll -> Slip -> Slide -> Rate Stretch

Implementierungs-Hinweis:

- Diese Gruppe sollte erst nach einer robusten `TimelineEditOperation`-Schicht ausgebaut werden.
- Ripple/Roll/Slip/Slide muessen linked audio, locked tracks, multicam groups, transitions und clip source bounds sauber behandeln.

### Gruppe 4: Platzieren

Root Icon: Insert / Overwrite

Zweck:

- Material aus Media Panel, Source Monitor oder Auswahl in die Timeline legen
- Clips mit oder ohne Ripple einfuegen
- bestehendes Material ersetzen oder ueberschreiben

| Tool | Typ | Beschreibung | Prioritaet |
|---|---|---|---|
| Position / Overwrite Move | Mode | Clip frei platzieren, Kollisionen ueberschreiben oder Gap erlauben | P1 |
| Insert | Command | Source/Media an Playhead einfuegen und rechts liegende Clips verschieben | P1 |
| Overwrite | Command | Source/Media an Playhead platzieren und vorhandenes Material ueberschreiben | P1 |
| Replace | Command | Zielclip durch Source ersetzen, Timing nach Regel erhalten | P2 |
| Fit to Fill | Command | Source in Zielbereich einpassen, Speed wird angepasst | P2 |
| Append at End | Command | Source ans Timeline-Ende setzen | P2 |
| Place on Top | Command | Source auf obere freie Video-Spur legen | P2 |
| Ripple Overwrite | Command | Zielbereich ersetzen und Luecke/Tail entsprechend ripple-adjusten | P2 |

Default-Verhalten:

- Diese Gruppe kann anfangs als Commands-Flyout starten, auch ohne persistenten Mode.
- Drag-and-drop aus Media Panel sollte spaeter dieselben Operationen als Drop-Modus anbieten.
- Source Monitor / Preview Panel kann diese Commands ebenfalls nutzen.

Warum eigene Gruppe:

- Insert/Overwrite sind keine reinen Schnittwerkzeuge.
- Sie gehoeren zum "Edit material into timeline"-Workflow.

### Gruppe 5: Navigieren und Markieren

Root Icon: Hand / Magnifier

Zweck:

- Timeline bewegen
- zoomen
- Marker und In/Out setzen
- Keyframes/Pen auf Timeline-Oberflaechen platzieren

| Tool | Typ | Beschreibung | Prioritaet |
|---|---|---|---|
| Hand / Pan | Mode | Timeline per Drag verschieben | P2 |
| Zoom | Mode | Click/Drag zoomt in/out um Pointer/Range | P2 |
| Marker | Command/Mode | Marker am Playhead oder per Klickposition setzen | P1 |
| In Point | Command/Mode | In-Point am Playhead oder per Klick setzen | P1 |
| Out Point | Command/Mode | Out-Point am Playhead oder per Klick setzen | P1 |
| Pen / Keyframe | Mode | Keyframes direkt auf Clip/Property-Lanes setzen | P1 |

Default-Verhalten:

- MS hat Navigation schon per Scroll, daher ist diese Gruppe weniger dringend.
- Marker/In/Out koennen als flyout commands sichtbar werden, ohne bestehende Shortcuts zu ersetzen.
- Pen/Keyframe wird wichtiger, sobald Timeline-Automation und Keyframe-Lanes dichter werden.

## Entfernen: keine eigene Hauptgruppe

Lift/Extract/Delete sind wichtig, aber sie muessen nicht als sechste Toolbar-Gruppe erscheinen. Sie sollten im Flyout der Schnitt-Gruppe oder im Kontext einer Range Selection auftauchen.

| Tool | Typ | Empfohlener Ort | Beschreibung | Prioritaet |
|---|---|---|---|---|
| Delete | Command | Keyboard / context menu | Auswahl entfernen, Gap bleibt je nach Operation | vorhanden |
| Ripple Delete | Command | Schnitt-Flyout + Context Menu | Auswahl entfernen und Luecke schliessen | P0 |
| Delete Gap | Command | Schnitt-Flyout + Gap Context Menu | Leeren Zeitraum entfernen und rechts liegende Clips nachziehen | P0 |
| Lift | Command | Range Selection action | Range entfernen, Gap bleibt | P1 |
| Extract | Command | Range Selection action | Range entfernen und Folgematerial nachziehen | P1 |

Grund:

- Delete ist meist Shortcut-/Kontextmenue-getrieben.
- Eine eigene Remove-Gruppe wuerde die Toolbar aufblaehen.
- Range Selection + sichtbare Mini-Actions ist ergonomischer.

## Empfohlene Toolbar im ersten Release

Kompakte sichtbare Hauptbuttons:

1. Auswahl
2. Schnitt
3. Trimmen
4. Platzieren
5. Navigieren
6. Snapping Toggle
7. View/Display Controls
8. Zoom Controls

Snapping bleibt bewusst Toggle, nicht Tool. Es modifiziert viele Werkzeuge.

## Flyout-Verhalten

### Oeffnen

Ein Flyout oeffnet durch:

- Pointer down laenger als 350 ms
- Rechtsklick auf Toolgruppe
- Klick auf kleines Chevron/Dreieck
- optional: Alt/Option + Klick

### Auswahl

Wenn das Flyout offen ist:

- Pointer release ueber Unterwerkzeug waehlt es aus
- Klick auf Unterwerkzeug waehlt es aus
- Escape schliesst ohne Aenderung
- Arrow Up/Down navigiert
- Enter waehlt

### Anzeigen

Jede Zeile zeigt:

- Icon
- Label
- Shortcut
- Modifiers-Hinweis, falls relevant
- disabled state mit Grund, z.B. "locked track" oder "no source selected"

Der Root-Button zeigt immer das aktive oder zuletzt genutzte Child-Icon.

### Tooltips

Root tooltip:

```text
Auswahltools (V)
Click: Select
Hold: Track Select, Range Select
```

Child tooltip:

```text
Track Select Forward
Selects clips from click position to the right.
Shift: all unlocked tracks.
```

## Tool Registry

Neue zentrale Registry:

```ts
type TimelineToolKind = 'mode' | 'command';

interface TimelineToolDefinition {
  id: TimelineToolId;
  groupId: TimelineToolGroupId;
  kind: TimelineToolKind;
  label: string;
  icon: TimelineToolIcon;
  shortcutActionId?: ShortcutActionId;
  defaultShortcut?: KeyCombo[];
  priority: 'P0' | 'P1' | 'P2';
  isEnabled?: (state: TimelineToolContext) => boolean;
  disabledReason?: (state: TimelineToolContext) => string | null;
}

interface TimelineToolGroupDefinition {
  id: TimelineToolGroupId;
  label: string;
  icon: TimelineToolIcon;
  defaultToolId: TimelineToolId;
  shortcutActionId?: ShortcutActionId;
  tools: TimelineToolId[];
}
```

Vorgeschlagene IDs:

```ts
type TimelineToolGroupId =
  | 'selection'
  | 'cut'
  | 'trim'
  | 'placement'
  | 'navigation';

type TimelineToolId =
  | 'select'
  | 'track-select-forward'
  | 'track-select-backward'
  | 'track-select-forward-all'
  | 'range-select'
  | 'blade'
  | 'blade-all-tracks'
  | 'split-at-playhead'
  | 'split-all-at-playhead'
  | 'trim-start-to-playhead'
  | 'trim-end-to-playhead'
  | 'ripple-trim-start-to-playhead'
  | 'ripple-trim-end-to-playhead'
  | 'edge-trim'
  | 'ripple-trim'
  | 'rolling-edit'
  | 'slip'
  | 'slide'
  | 'rate-stretch'
  | 'position-overwrite'
  | 'insert'
  | 'overwrite'
  | 'replace'
  | 'fit-to-fill'
  | 'append-at-end'
  | 'place-on-top'
  | 'ripple-overwrite'
  | 'hand'
  | 'zoom'
  | 'marker'
  | 'in-point'
  | 'out-point'
  | 'pen-keyframe';
```

## Store-Aenderungen

Aktuell:

```ts
toolMode: 'select' | 'cut'
```

Ziel:

```ts
activeTimelineToolId: TimelineToolId;
lastTimelineToolByGroup: Record<TimelineToolGroupId, TimelineToolId>;
```

Kompatibilitaets-Bridge:

```ts
const isCutToolActive = activeTimelineToolId === 'blade';
const isSelectToolActive = activeTimelineToolId === 'select';
```

Bestehende APIs wie `toggleCutTool()` koennen in der ersten Migration erhalten bleiben:

```ts
toggleCutTool: () => {
  setActiveTimelineTool(
    get().activeTimelineToolId === 'blade' ? 'select' : 'blade'
  );
}
```

## Event-Architektur

Langfristig sollte Timeline-Input nicht weiter ueber viele verstreute Spezialfaelle wachsen.

Vorgeschlagene Schicht:

```ts
interface TimelineToolHandler {
  onPointerDown?: (event: TimelinePointerEvent) => TimelineToolResult;
  onPointerMove?: (event: TimelinePointerEvent) => TimelineToolResult;
  onPointerUp?: (event: TimelinePointerEvent) => TimelineToolResult;
  onKeyDown?: (event: TimelineKeyEvent) => TimelineToolResult;
  getCursor?: (context: TimelineToolContext) => string;
  getOverlay?: (context: TimelineToolContext) => React.ReactNode;
}
```

Erste Migration muss nicht alles umbauen. Aber neue Tools sollten nicht einzeln in `Timeline.tsx` wachsen, sondern ueber Handler registriert werden.

## Umsetzung in Phasen

### Phase 0: Operation Kernel und Mutationsgrenze

Ziel:

- `applyTimelineEditOperation()` als zentrale Grenze einfuehren
- Export-Lock, History-Transaction, Linked-Pair-/Linked-Group-Policy und Collision-Policy dort verankern
- direkte editierende `useTimelineStore.setState()`-Pfade klassifizieren
- AI `splitClipBatch`, `cutRangesFromClip`, `reorderClips`, AI `trimClip`, external drop placement und Undo/Redo als fruehe Migrations-/Guard-Kandidaten markieren

Scope:

- wenige Operationen reichen: Split, Select-from-time, Ripple Delete, Delete Gap
- keine neuen mutierenden Tool-Commands ausserhalb des Kernels
- Runtime-/View-State darf weiterhin ausserhalb des Kernels laufen

Tests:

- Export-Lock blockt Kernel-Operationen, AI-Pfade, Tool-Commands und Undo/Redo waehrend Export
- failed/no-op Operation erzeugt keinen Undo-Eintrag
- eine committed Operation erzeugt genau einen Undo-Eintrag
- Linked-Pair-Policy und Linked-Group-Policy werden getrennt getestet
- same-track overwrite, cross-track avoid, external drop avoid und transition overlap bleiben unterscheidbar

### Phase 1: UI-Shell und Registry

Ziel:

- Tool-Registry einbauen
- Toolbar-Gruppen und Flyouts darstellen
- bestehende Tools Select und Blade ueber neue Registry routen
- `toggleCutTool` kompatibel halten
- Mounting im `timeline-ruler-control-strip`, Compact-/Overflow-Verhalten und Portal-Flyouts loesen

Scope:

- keine neuen Editing-Operationen
- nur bestehende Funktionen neu organisieren
- `setActiveTimelineTool` ist nicht mutierend und waehrend Export erlaubt

Tests:

- Root-Button aktiviert letztes Child
- Hold/Right-click oeffnet Flyout
- Escape schliesst Flyout
- Shortcut fuer Cut funktioniert weiter
- Export lock deaktiviert mutierende Tools
- Palette passt bei 150/210/340px Header-Breite ohne geclippte Flyouts

### Phase 2: Auswahlgruppe

Ziel:

- Track Select Forward
- Track Select Backward
- Track Select Forward All Tracks
- Range Selection als visuelle Auswahl

Neue Store-Actions:

```ts
selectClipsFromTime(time, options)
selectClipsInTimelineRange(range, options)
setTimelineRangeSelection(selection)
clearTimelineRangeSelection()
```

Diese Actions sind Operation-Kernel-Commands oder duerfen nur read-only Selection-State veraendern, wenn sie explizit so klassifiziert sind.

Tests:

- locked tracks werden ignoriert
- linked clips werden konsistent selektiert
- Shift-Modifier fuer all tracks
- Range Selection funktioniert ueber mehrere Tracks

### Phase 3: Schnitt-Commands

Ziel:

- Split All Tracks at Playhead
- Blade All Tracks
- Trim Start/End to Playhead
- Ripple Delete
- Delete Gap

Neue Store-Actions:

```ts
splitAllClipsAtTime(time, options)
trimClipEdgeToTime(clipId, edge, time, options)
rippleDeleteSelection(options)
deleteGapAtTime(time, options)
```

Diese Commands duerfen erst entstehen, wenn Phase 0 steht. UI, Shortcut, Kontextmenue und AI muessen denselben Operation-Kernel-Pfad nutzen.

Tests:

- locked tracks bleiben unveraendert
- linked audio bleibt synchron
- undo/redo pro Operation
- all-tracks respects visibility/lock policy

### Phase 4: Trim-Engine

Ziel:

- Ripple Trim
- Rolling Edit
- Slip
- Slide
- Rate Stretch

Neue Kernschicht:

```ts
TimelineEditOperation
TimelineEditPreview
TimelineCollisionPolicy
TimelineRippleScope
```

Warum erst hier:

- Diese Werkzeuge bauen auf der in Phase 0 eingefuehrten Preview-, Collision-, Export-Lock- und Undo-Semantik auf.
- Sie duerfen nicht als kleine Sonderfaelle in Mouse-Handlers entstehen.

Tests:

- source bounds
- clip min duration
- linked audio
- transitions
- multicam groups
- overlapping policy
- undo/redo

### Phase 5: Platzieren

Ziel:

- Insert
- Overwrite
- Replace
- Fit to Fill
- Append
- Place on Top
- Ripple Overwrite

Abhaengigkeit:

- Source/Media Panel muss eine klare "current source selection" bereitstellen.
- Drop-Gesten sollten dieselben Operationen nutzen wie Toolbar-Commands.

Tests:

- insert ripples right-side clips
- overwrite trims/removes overlapped ranges korrekt
- place-on-top findet passende freie Spur oder erstellt eine neue
- fit-to-fill setzt Speed und preservesPitch korrekt

### Phase 6: Navigieren, Marker, Pen

Ziel:

- Hand Tool
- Zoom Tool
- Marker Click Tool
- In/Out Click Tools
- Pen/Keyframe Tool

Kann spaeter kommen, weil MS bereits gute Scroll-/Shortcut-Navigation hat.

## Priorisierte Roadmap

P0:

1. Operation Kernel + Export-/History-/Linked-/Collision-Policies
2. Tool-Registry + Flyout UI
3. Track Select Forward / All Tracks
4. Split All Tracks at Playhead
5. Trim Start/End to Playhead
6. Ripple Delete / Delete Gap

P1:

1. Range Selection
2. Lift / Extract
3. Ripple Trim
4. Rolling Edit
5. Slip
6. Insert / Overwrite
7. Marker/In-Out visible tool commands

P2:

1. Slide
2. Rate Stretch
3. Replace / Fit to Fill
4. Append / Place on Top / Ripple Overwrite
5. Hand / Zoom Tool modes

## Nicht-Ziele fuer den ersten Slice

- keine vollstaendige Premiere/FCP/Resolve-Kopie
- keine separate Remove-Hauptgruppe
- keine komplette Rewrite von Timeline.tsx
- keine Source-Monitor-Abhaengigkeit fuer Phase 1
- keine neuen Hidden Shortcuts ohne Settings-UI-Eintrag

## Entscheidungen und Defaults

Diese Defaults sind fuer die erste Implementierung verbindlich. Sie koennen spaeter als Settings erweitert werden, blockieren aber die Umsetzung nicht.

1. Track Select beruecksichtigt standardmaessig unlocked und visible Tracks. Hidden Tracks werden ignoriert, locked Tracks blockieren oder warnen je nach Operation.
2. "All Tracks" wird sowohl als eigenes Child-Tool als auch als Shift-Modifier angeboten. Das Child ist discoverable, der Modifier bleibt schnell fuer Power-User.
3. Range Selection wird als eigene sichtbare Timeline-Range im Tool-State gespeichert und erst bei Lift/Extract/Delete/Split in konkrete Clip-Operationen uebersetzt.
4. Delete bleibt lift-artig und loescht Auswahl ohne Luecke zu schliessen. Ripple Delete ist ein eigener Command im Schnitt-Flyout und Kontextmenue.
5. Blade bleibt standardmaessig im Blade-Modus. Das heutige Zurueckspringen zu Select wird als optionales "single-shot blade" Child oder Preference abgebildet.
6. Aktives Tool wechseln ist nicht mutierend und waehrend Export erlaubt. Mutierende Commands und Pointer-Commits bleiben waehrend Export blockiert.
7. Neue AI-Tools oder Guided-Replay-Aktionen duerfen keine eigenen Timeline-Mutationskerne bekommen; sie muessen den Operation Kernel nutzen.

## Empfehlung

Die beste Balance ist:

- 5 Hauptgruppen in der Toolbar
- Remove-Operationen unter Schnitt/Range-Kontext statt eigener Gruppe
- erst Operation Kernel und Mutationsgrenze bauen
- dann UI-Registry und Flyout sichtbar machen
- danach P0-Editing-Commands ueber denselben Kernel liefern
- erst dann die komplexe Trim-Engine bauen

Damit bekommt MasterSelects schnell den sichtbaren professionellen Werkzeugrahmen, ohne die schwierigen Ripple/Roll/Slip/Slide-Semantiken als fragile Einzelhacks einzubauen.
