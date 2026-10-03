# Timeline Node Graph – Umsetzungsplan

Stand: 2026-10-02, ergänzt 2026-10-03 (Node-Hierarchie, Media, Zeitkette, Transitions).
Status (2026-10-03): Phasen 0–4, Pakete A–F und die Lücken aus 0–3 umgesetzt und geprüft, uncommittet
(kein Build/Commit ohne Freigabe). Abweichungen, Messbasis und offene Punkte in Abschnitt 12.

Dieser Plan konkretisiert das [ursprüngliche Konzept](Timeline-Node-Graph-Plan.md)
nach Abgleich mit der Codebase. Er ersetzt dessen Umsetzungsempfehlungen und
Aufwandsannahmen. Das Konzept bleibt als Sammlung der längerfristigen Ideen erhalten.
Performance-Ziele sind zu messen; dieser Plan enthält keine gemessenen Zusagen.

Internes Planungsdokument: lokal beziehungsweise im privaten Repository halten;
nicht in öffentliche Source-Snapshots übernehmen.

## 1. Ziel und Produktentscheidung

Die Timeline bleibt das Hauptwerkzeug für Schnitt und zeitliche Anordnung. Der
Node-Workspace erhält eine Composition-Ansicht, die Beziehungen sichtbar macht und
später dauerhaft bearbeitbare Schnittregeln anbietet:

- Die Timeline zeigt, **wo** Clips liegen.
- Der Graph zeigt, **warum** sie dort liegen und welche Verarbeitung sie verbindet.
- Beide Oberflächen verwenden dieselben fachlichen Aktionen und Daten.
- Der Composition-Output besteht aus Bild und Ton. Zeit ist Auswertungskontext.

Der erste Mehrwert ist Navigation und Übersicht. Der erste neue funktionale Mehrwert
ist ein begrenzter, vollständiger Anwendungsfall: ausgewählte Clips anhand einer
gespeicherten Regel auf analysierte Beats verteilen und die Verteilung später ändern.

Eine frei programmierbare Timeline-Laufzeit, virtuelle Clips und ein Live-Show-System
sind keine Voraussetzungen für diese beiden Ergebnisse.

## 2. Befund in der heutigen Codebase

| Grundlage | Tatsächlicher Stand | Konsequenz |
|---|---|---|
| Node-Projektion | `NodeGraphOwner` und Workspace-Subjects sind clipbezogen. | Composition braucht einen eigenen Kontext, nicht nur einen zusätzlichen Enum-Wert. |
| Gruppen und Ports | Typisierte Ports, Gruppen und Verbindungskontrolle existieren. | Darstellung wiederverwenden; Clip-Referenzen nicht als vollständige Effektgraphen vorab aufbauen. |
| Große Graphen | Sichtbarkeitsfilter, Canvas-Darstellung und schrittweises Mounten existieren. | Vorhandene Infrastruktur erweitern und messen, keinen zweiten Canvas entwickeln. |
| Clip-Zeit | Auswahl aktiver Clips nutzt konkrete Clip-Arrays und feste Intervalle. | Zunächst normale Clips erzeugen; virtuelle Instanzen erfordern später eine gemeinsame Auswertungsschicht. |
| Schnittaktionen | Speed-Änderungen behandeln Dauer, Keyframes, Linked Audio, Locks, Undo und Invalidierung. | Node-Eingaben müssen durch diese Aktionen beziehungsweise gemeinsame fachliche Mutationen laufen. |
| Parameterquellen | Ausgewählte Effekt-/Farbwerte sind anschließbar; Zeitwerte noch nicht allgemein. | Zeitsteuerung als explizite Fähigkeit mit Einheiten und Grenzen ergänzen. |
| Zeitbasen | Clip-lokale Keyframes, spezielle Source-Time-Keyframes für Flock sowie Transition-Zeitabbildungen existieren. | Wiederverwenden, aber nicht als fertige allgemeine Uhrenarchitektur behandeln. |
| Audio | Track-/Master-Zustand und Send-Deskriptoren existieren. | Vollständige Bus-Auswertung für Live und Export ist ein eigenes Vorhaben. |
| Frame-Zugriff | Gemeinsamer SourceFrameService für zeitliche Quellenabfragen existiert. | Decode-/Upload-Infrastruktur wiederverwenden; kein fertiger Instanz-Scheduler. |

Einstiegspunkte:

- [Node-Typen](../../src/types/nodeGraph.ts),
  [Workspace-Subject](../../src/components/panels/nodes/useNodeGraphSubject.ts),
  [Workspace-Panel](../../src/components/panels/nodes/NodeWorkspacePanel.tsx),
  [Canvas](../../src/components/panels/nodes/NodeGraphCanvas.tsx).
- [FrameContext](../../src/services/layerBuilder/FrameContext.ts),
  [LayerBuilder](../../src/services/layerBuilder/LayerBuilderService.ts),
  [Speed-Aktionen](../../src/stores/timeline/clip/clipSpeedActions.ts).
- [Parameterziele](../../src/services/parameterSources/parameterSourceTargets.ts),
  [Keyframe-Zeitbasen](../../src/services/flock/time/flockKeyframeTime.ts),
  [TransitionSourceMap](../../src/services/timeline/transitionSourceMap.ts).
- [Audio-Export-Sends](../../src/engine/audio/exportPipeline/trackDataPlanning.ts),
  [AudioMixer](../../src/engine/audio/AudioMixer.ts),
  [SourceFrameService](../../src/services/mediaRuntime/sourceFrames/SourceFrameService.ts).

## 3. Architektur: Darstellung, Arrangement und Retime trennen

### 3.1 Composition-Ansicht: Projektion bestehender Daten

Die neue Ansicht projiziert Clips, Spuren, bestehende Transitions und tatsächlich
unterstützte Audio-Verarbeitung. Sie speichert keine zweite ausführbare Timeline.

Ein expliziter Workspace-Kontext unterscheidet Clip und Composition. Auswahl,
Navigation, Inspector, Aktionen und Vorschau müssen den Kontext auswerten; eine
Composition-ID darf nicht versehentlich als Clip-ID an bestehende Dienste gelangen.

Composition-eigene Darstellungsdaten enthalten nur Layout, Faltungen und andere
Ansichtspräferenzen. Bestehende `sharedSceneGraphs` sind ein Präzedenzfall für
Composition-Eigentum, aber kein Speichercontainer für fachfremde Timeline-Regeln.

Clip-Nodes sind eingeklappt Referenzen mit stabiler Clip-ID, Kurzinfo und Mini-Balken.
Der Clip-Untergraph wird erst beim Aufklappen aufgebaut (siehe 3.1c): Composition- und
Clip-Ebene sind **ein gemeinsamer Node-Graph**, kein Wechsel zwischen zwei Ansichten.

Kabel haben eine eindeutige Bedeutung: Referenz, Spurzuweisung, Transition oder
unterstütztes Routing. Zeitlich benachbarte Clips werden nicht als Bildverarbeitungskette
`Clip A → Clip B` verkabelt. Bestehende Beziehungen ohne Editierunterstützung bleiben
als solche erkennbar und nicht frei umsteckbar.

### 3.1a Hierarchie und Node-Typen (Entscheidung 2026-10-03)

Ebenen des Node-Workspace:

| Ebene | Inhalt | Status |
|---|---|---|
| 0 – Composition | Media, Clip-Referenzen, Tracks, Transitions, Video-Stack, Audio-Master, Output, später Regeln. | neu |
| 1 – Clip | Bestehender Clip-Graph: Source → Transform → Mask → Color → Effekte → Output, Audio-Kette; inline in Ebene 0 aufklappbar (3.1c). | vorhanden, eingebettet |
| 2 – Gruppen | Bestehende Effekt-/Operator-Gruppen innerhalb des Clip-Graphen. | vorhanden, unverändert |

Verschachtelte Compositions und geöffnete Transition-Compositions sind wieder Ebene 0
ihrer eigenen Composition; die Breadcrumb zeigt den Pfad, zum Beispiel
`Main › Transition A→B › Clip (outgoing)`.

Neue Projektions-Nodes der Ebene 0 (gespeichert wird nur Layout):

| Node | Ports | Phase | Bearbeitung |
|---|---|---|---|
| Composition Output | in: `Bild` (texture), `Ton` (audio) | 1 | keine |
| Video-Stack | in: je Videospur (texture), Reihenfolge = Compositing; out: `Bild` | 1 | erst mit eigener Spur-Reihenfolge-Aktion |
| Audio-Master | in: je Audiospur (audio); out: `Ton` | 1 | keine; Busse siehe Abschnitt 9 |
| Track (Video/Audio) | in: `Clips` (clip, mehrfach); out: texture bzw. audio; Status Lock/Mute/Solo/Visible | 1 | Phase 2: Spurwechsel über `move-clips` |
| Media | out: je verwendetem Stück (clip) | 1 | keine |
| Clip-Referenz | out: `clip`; Mini-Balken, Badges für Speed/Reverse/Trim/Regel/Korrektur | 1 | Doppelklick/Auswahl klappt Ebene 1 inline auf (3.1c) |
| Transition | in: `A` (clip), `B` (clip); out: in den Track | 1 | über bestehende Transition-Aktionen |
| Nested Comp | Variante der Clip-Referenz mit Öffnen-Aktion | 1 | Navigation |
| Zeitkette `Slice → Speed → Place` | aufklappbare Gruppe am Clip-Node | 2 | Trim-, Speed- und Move-Operationen |
| Beat-Quelle | out: `Beats` (event, Sekunden Timeline-Zeit); Beat-Grid-Artefakt eines Audio-Clips oder Tempo-Map | 3 | Quelle wählen |
| Rule: Beats verteilen | in: `Beats` (event), `Mitglieder` (clip, geordnet); out: `Place` (time) je Mitglied | 3 | Parameter, Reihenfolge, Lösen, Materialisieren |

Kabelbedeutungen: `Media → Clip` gemeinsame Quelle; `Clip → Track` Zugehörigkeit;
`Track → Stack/Master` Compositing beziehungsweise Mix; `Clip ⇄ Transition`
Transition-Beziehung; gestrichelt Linked Audio; `Beats → Rule → Clip.Place`
Regelsteuerung. Alle Kabel außer Spurzuweisung (Phase 2) und Regelkabel (Phase 3)
sind `readOnly`. Die vorhandenen Signaltypen `clip`, `event`, `time`, `texture`,
`audio` reichen; Einheiten kommen über den erweiterten `NodePortContract`.

**Media-Nodes:** Jede in der aktiven Composition verwendete Datei erhält einen
Media-Node; eine verschachtelte Composition zählt als eigene Quelle. Standardmäßig ist
die Gruppe `Media (n)` eingeklappt, jede Karte zeigt Name, Länge und Anzahl der
Stücke, die Kabel sind gebündelt. Aufgeklappt zeigt die Karte einen Quellbalken mit den
verwendeten Quellbereichen; Klick auf ein Segment wählt den Clip in Timeline und Graph.

**Zeitkette am Clip-Node:** `Slice → Speed → Place` ist eine aufklappbare Gruppe am
Clip-Node im Composition-Graphen, nicht Teil des Clip-Graphen (Ebene 1 bleibt reine
Bild-/Tonverarbeitung). Eingeklappt ist der Clip-Node nur die Referenzkarte;
ausgewählt zeigt der Inspector Slice (In/Out), Speed/Reverse und Place (Start, Spur)
mit Resolve-Primitives; aufgeklappt zeigt der vorhandene Gruppen-/Faltmechanismus die
Kette `Media → Slice → Speed → Place → Track`. Die Kette ist fest, nicht umsortierbar.

**Zerteilen und Verteilen:** Slice bestimmt, welcher Quellteil ein Stück ist; Place
beziehungsweise eine Arrangement-Regel bestimmt, wo es liegt. Zerteilen bleibt in der
ersten Version eine Timeline-Aktion (Split, `splitClipAtTimes`, `splitClipEvenly`);
regelgesteuert wird zunächst nur das Verteilen (Phase 3). Eine gespeicherte
Slice-Regel (gleichmäßig, Marker, Beats, Szenenwechsel) ist ein späterer Operator und
erzeugt ebenfalls echte Clips mit stabilen IDs. Pro Eigenschaft darf höchstens eine
Regel Eigentümer sein; Slice- und Arrangement-Regel dürfen denselben Clip steuern.

### 3.1d Spur-Streifen auf Zeitachse (Entscheidung 2026-10-03, Nutzer)

Eine Clip-Node pro Schnitt macht die Composition-Wurzel schon bei 30 Clips unübersichtlich: 45 Nodes,
109 Kabel, lange Spurspalten, bei „Fit“ 13 % Zoom. Darum gilt für Ebene 0:

- **Spur-Streifen:** Jede Spur ist standardmäßig ein breiter Streifen mit einer Mini-Timeline ihrer Clips:
  ein Segment pro Clip an seiner Timeline-Position und -Länge, mit Nummer bzw. Name und kleinen Badges
  (Speed/Reverse/Freeze/Loop/Warp/Regel/Korrektur). Das ist dasselbe Prinzip wie der Quellbalken der
  Media-Gruppe.
- **Zeitachse links → rechts wie in der Timeline:** Alle Streifen haben denselben x-Ursprung und
  denselben Maßstab, gleichzeitige Clips stehen genau übereinander. Die Spuren liegen in Timeline-Reihenfolge
  untereinander (Video oben, Audio darunter). Rechts davon folgen Video-Stack bzw. Audio-Master und der Output.
- **Transitions** erscheinen im Streifen als Markierung über der Clipgrenze, mit Auswahl, Inspector und
  „Open body“. Eine eigene Transition-Node gibt es nur bei Auswahl.
- **Clip-Nodes nur bei Bedarf:** Ein Klick auf ein Segment wählt den Clip in Timeline und Graph und zeigt
  seine Clip-Referenz-Node am Segment. Aufklappen (3.1c, Ebene 1) funktioniert wie bisher. Ohne Auswahl
  oder Aufklappen gibt es keine Einzelkabel pro Clip.
- **Kabel:** Media → Streifen gebündelt je Medium und Spur; Streifen → Stack/Master; Regel → Streifen der
  Mitglieder, wobei die Mitgliedssegmente hervorgehoben werden.
- **Daten unverändert:** Die Projektion behält Clip-, Transition- und Regel-Nodes mit stabilen IDs
  (Inspector, Agent, Regeln). Die Streifen sind eine Darstellung über dem vorhandenen Falt- und
  Summary-Segment-Mechanismus, kein zweites Datenmodell.

### 3.1c Ein gemeinsamer Node-Graph (Entscheidung 2026-10-03, Nutzer)

Vorlage ist das bestehende Clip-Node-System (`NodeWorkspacePanel`, `NodeGraphCanvas`,
Toolbar mit Arrange/Compact/Avoid/Kabelstil, Katalog, Presets, Kontext- und
Verbindungsmenüs, Vorschauen, Node-Inspector, Gruppen und Faltung). Die
Composition-Ebene wird in dieses System integriert, nicht als zweite Ansicht daneben
gebaut. Es gibt genau einen Workspace, eine Canvas und eine Interaktionslogik.

- **Ebenen durch Aufklappen:** Ebene 0 zeigt Media, Clip-Karten, Tracks, Transitions,
  Video-Stack, Audio-Master und Output. Eine Clip-Karte klappt an Ort und Stelle zu
  ihrem vollständigen Clip-Graphen auf (Source → Transform → Mask → Color → Effekte →
  Output, Audio-Kette, Ebene-2-Gruppen) und ist dort mit allen vorhandenen Werkzeugen
  voll editierbar. Mehrere Clips dürfen gleichzeitig aufgeklappt sein.
- **Auswahl wählt die Wurzel:** Es gibt einen Graphen, die Ansicht beginnt an einer
  wählbaren Wurzel. `Timeline` (beziehungsweise `Active` ohne Clip-Auswahl) beginnt an
  der Composition und zeigt den ganzen Graphen; Clips sind dort inline aufklappbar.
  Wird ein Clip angeklickt (`Active` mit Clip-Auswahl oder gepinnter Clip), zeigt der
  Workspace nicht den Timeline-Graphen, sondern denselben Graphen **ab diesem Clip**:
  dessen Teilgraph mit denselben Nodes, IDs, Layouts, Gruppen und Werkzeugen wie beim
  Inline-Aufklappen, ergänzt höchstens um die direkten Nahtstellen (Media-Quelle, Track)
  als Kontext. Doppelklick beziehungsweise Enter auf eine Clip-Karte klappt sie in der
  Timeline-Wurzel auf/zu. Die Breadcrumb zeigt den Pfad `Composition › Clip`; Klick auf
  die Composition wechselt zur Timeline-Wurzel, mit dem Clip aufgeklappt und im Fokus.
- **Echte Kabel an den Nahtstellen:** `Media → Source` des aufgeklappten Clips und
  `Clip-Output → Track` (Bild beziehungsweise Ton bei verknüpftem Paar) ersetzen die
  Kabel der Referenzkarte. Innerhalb des Clips gelten die bestehenden Clip-Kabel; die
  Invariante „keine Bildkabel zwischen benachbarten Clips“ bleibt.
- **Eigentum bleibt getrennt:** Clip-Nodes gehören weiter dem Clip (`clip.nodeGraph`,
  Effekte, Keyframes); ihr Layout wird relativ zum Clip-Ursprung gespeichert und beim
  Aufklappen verschoben dargestellt. Composition-Layout und Faltungen liegen in
  `compositionGraph.layout`. Jede Aktion wird anhand des Node-Eigentümers an den
  passenden Adapter geleitet (Composition-Aktionen beziehungsweise die vorhandenen
  Clip-Aktionen dieses Clips); Node-IDs eingebetteter Clips sind pro Clip
  namensraumgetrennt, damit keine Composition-ID als Clip-ID durchrutscht.
- **Kosten:** Eingeklappte Clips bauen keinen Untergraphen. Nur aufgeklappte Clips werden
  über die vorhandene Clip-Projektion gebaut und pro unveränderter Eingabe gecacht.
- **Inspector:** ein Inspector; Composition-Nodes zeigen die Composition-Abschnitte
  (Slice/Speed/Place, Track, Transition, Regel), Clip-Nodes den bestehenden
  Node-Inspector.

### 3.1b Transitions und Transition-Compositions

Grundlage ist der bestehende Vertrag aus
[Transition Compositions](../Features/Transition-Compositions.md): Eine Transition
rendert entweder transient aus ihrem Rezept oder über eine verknüpfte
Transition-Composition (`TimelineTransition.compositionId`, `TransitionCompositionLink`,
`sourceLayout: 'mapped-v3'`). Der Graph bildet diese Zustände ab und erzeugt selbst
keinen neuen Zustand.

- **Ebene 0 der Eltern-Composition:** Der Transition-Node liegt zwischen den Kabeln
  von Clip A (`outgoing`) und Clip B (`incoming`) und führt in den gemeinsamen Track.
  Badges zeigen Typ, Dauer, Offset und Zustand: `Rezept` (noch keine Composition),
  `Composition` (verknüpft), `Bake` beziehungsweise `Bake veraltet` (zum Beispiel
  Datamosh-Artefakt).
- **Öffnen:** Doppelklick verwendet die vorhandene Aktion „Transition-Body öffnen“. Ist
  noch keine Composition vorhanden, materialisiert erst diese explizite Aktion sie;
  das bloße Anzeigen des Graphen materialisiert nie.
- **Innen (Ebene 0 der Transition-Composition):** Dieselbe Composition-Ansicht zeigt
  die normalerweise volle Dauer überspannenden Quellclips `outgoing` und `incoming`,
  bei Mehrfeld-Vorlagen deren Panel-Slices, sowie generierte Overlay-Ebenen als normale
  Clip-Referenzen. Jede Quellclip-Karte verweist auf ihren Eltern-Clip
  (`parentOutgoingClipId`/`parentIncomingClipId`) und auf dieselbe Media-Identität;
  ein Link springt zurück in die Eltern-Composition.
- **Zeitkette innen:** Slice und Speed der Quellclips stammen aus der
  `TransitionSourceMap` (Quellzeit, ursprüngliche Clip-Animationszeit, lokale
  Rezeptzeit). Sie werden mit ihren Zeitdomänen angezeigt, sind in Version eins aber
  `readOnly`; Änderungen erfolgen am Eltern-Clip oder über Transition-Dauer/-Offset.
  Ein Bearbeitungsvertrag für gemappte Zeit gehört zu Phase 4.
- **Effekte innen:** Transforms, Masken, Effekte und Blend-Fenster der inneren Ebenen
  sind normale Clip-Graphen (Ebene 1) und dort wie gewohnt bearbeitbar.
- **Regeln:** Mitglieder mit Transitions werden von der Beat-Regel zunächst abgelehnt
  (Abschnitt 5). Die Transition-Composition selbst enthält keine Regeln.

### 3.2 Arrangement: Anordnung beim Editieren berechnen

Arrangement-Operatoren berechnen feste Startzeiten, Zielspuren, Reihenfolgen und,
soweit ausdrücklich unterstützt, Dauern. Beispiele: Sequence, Snap to Beats, Stagger.

Eingänge sind versionierte Quelldaten, geordnete Clip-Referenzen, Parameter,
vorberechnete Analyse-Artefakte und manuelle Korrekturen. Ein Instanzindex `i` kann
als Eingabe dienen; die aktuelle Abspielzeit verändert die Anordnung nicht.

Eine reine Planungsfunktion liefert einen begrenzten Änderungsvorschlag inklusive
betroffener IDs, Konflikte und Warnungen. Erst die fachliche Mutation wendet ihn
atomar an. Ungültige Ergebnisse hinterlassen keine Teiländerungen.

### 3.3 Retime: Quellzeit innerhalb eines Ausgabeintervalls bestimmen

Retime bildet Composition-Zeit über Clip-Zeit auf Quellzeit ab. Reverse, Freeze,
Loop und Warp gehören hierhin. Das aktive Ausgabeintervall bleibt explizit.

Für die erste Regelversion ist eine Animation von `Place.start` über Abspielzeit `t`
nicht vorgesehen. Bewegliche Aktivitätsintervalle würden Scheduling, Overlaps,
Audio und Transitions gleichzeitig verändern und erhalten gegebenenfalls später
einen eigenen Vertrag.

Der Retime-Vertrag muss mindestens beschreiben:

- Ausgabeintervall und Dauerpolitik, insbesondere bei Freeze und Loop.
- Abbildung auf Quellzeit und separate Animationszeitbasis.
- Verhalten außerhalb der Quellgrenzen: Hold, Loop oder Fehler, explizit pro Operator.
- Richtungswechsel, Sprungstellen und erforderliche Quellbereiche für Prefetch.
- Audio-Verhalten einschließlich Pitch, Stummschaltung oder vorberechnetem Ergebnis.
- Identische Semantik in Preview, Scrub, Export und verschachtelten Compositions.

Kompilierung geschieht bei relevanten Änderungen. Pro Frame wird weiterhin eine
kompilierte Zeitfunktion ausgewertet; ein allgemeiner Graph-Interpreter ist nicht
nötig. Die bestehenden Verbraucher benötigen dafür gegebenenfalls Adapter. Eine
unveränderte gesamte Render-/Playback-Pipeline wird ausdrücklich nicht zugesagt.

## 4. Eine maßgebliche Datenquelle pro Eigenschaft

### Normale Clips

Bestehende Clip-Felder und Keyframes bleiben maßgeblich. Node-Eingaben rufen die
gleichen fachlichen Aktionen wie die Timeline auf. `Media → Slice → Speed → Place`
ist zunächst eine feste Darstellung dieser Semantik, keine frei umsortierbare Kette.

Eine gemeinsam dargestellte Media-Quelle wird über stabile Medienidentität referenziert.
Mehrere Clip-Nodes dürfen daraus lesen; Decode-Ressourcen gehören weiterhin den
bestehenden Laufzeitdiensten. Ein gemeinsamer Media-Node garantiert keine kostenlose
parallele Auswertung mehrerer Quellzeiten.

### Regelgesteuerte Clips

Eine Composition-eigene Regeldefinition besitzt eine versionierte Struktur:

- stabile Regel-ID, Operatortyp und Schema-Version;
- geordnete Mitglieder mit stabiler Mitglieds-ID und Clip-/Medienreferenzen;
- deklarierte gesteuerte Eigenschaften und Parameter;
- Referenzen und Revisionen verwendeter Analyse-Artefakte;
- manuelle Korrekturen pro Mitglied und Eigenschaft;
- Seed, falls der Operator Zufall verwendet.

Regel plus Korrekturen sind für gesteuerte Eigenschaften maßgeblich. Die berechneten
Werte werden in normale Timeline-Clips geschrieben, damit bestehende Verbraucher
zunächst weiterarbeiten. Diese Werte sind eine abgeleitete Projektion, kein zweiter
unabhängig editierbarer Zustand. Andere Clip-Eigenschaften bleiben normal editierbar.

Alle Änderungen an gesteuerten Eigenschaften benötigen denselben Mutationsweg,
unabhängig davon, ob sie aus Timeline, Inspector, Graph oder Agent kommen. Unbemerkte
Direktänderungen, die beim nächsten Berechnen verschwinden, sind nicht zulässig.

Regeländerung, Korrekturen und resultierende Clip-Änderungen gehören in dieselbe
Undo-Transaktion. Nicht über unkoordinierte Store-Subscriptions nachträglich korrigieren.

## 5. Erster Regel-Operator: Clips auf Beats verteilen

### Begrenzter Funktionsumfang

- Eingabe: geordnete Auswahl vorhandener Clips sowie ein fertiges Beat-Artefakt.
- Parameter: erster Beat, Beat-Schrittweite, gemeinsamer Zeitversatz und Zielspur.
- Ausgabe: neue Startpositionen; Trim, Speed und Inhalt bleiben erhalten.
- Standard: nächstes ausgewähltes Mitglied auf den nächsten durch die Schrittweite
  bestimmten Beat setzen. Zu wenige Beats sind ein erklärter Konflikt.
- Lücken sind erlaubt. Überlappungen auf der Zielspur werden zunächst abgelehnt;
  automatische Kürzungen oder neue Transitions sind nicht Teil dieses Operators.
- Bereits mit Transitions verbundene Mitglieder werden zunächst abgelehnt, bis
  eine explizite gemeinsame Transition-Mutation verfügbar und geprüft ist.
- Linked Audio folgt über die bestehende Verknüpfungssemantik. Ein gesperrter
  betroffener Clip beziehungsweise eine gesperrte Zielspur blockiert die Transaktion.

Die Regel kann bestehende Clips übernehmen. Wiederholungen und Cloner sind eine
spätere Erweiterung; auch diese erzeugen zunächst echte Clips mit stabilen IDs.

### Manuelle Bearbeitung und Lebenszyklus

| Aktion | Verhalten der ersten Version |
|---|---|
| Gesteuerten Clip horizontal ziehen | Zeitkorrektur in Sekunden am stabilen Mitglied speichern; auf neuen Regelwert addieren. |
| Reihenfolge ändern | Mitgliedsidentität und Korrektur bleiben zusammen; Array-Index ist keine Identität. |
| Gesteuerten Clip auf andere Spur ziehen | Bei gesteuerter Spur explizite Zielspur-Korrektur speichern und validieren. |
| Clip trimmen oder Speed ändern | Bestehende Aktion verwenden; abhängige Regelkonflikte vor dem gemeinsamen Commit prüfen. |
| Mitglied aus Regel lösen | Aktuelle Werte behalten, Mitgliedschaft und Korrekturen entfernen. |
| Gesamte Regel materialisieren | Alle aktuellen Clip-Werte behalten und die Regelbindung entfernen. |
| Mitglied löschen | Mitglied aus Regel und Timeline in einer Transaktion entfernen. |
| Gesteuerten Clip splitten | In Version eins mit Erklärung blockieren; vorheriges Lösen der Bindung anbieten. Kein stilles Neuinterpretieren. |
| Gesteuerten Clip kopieren | Kopie erhält neue ID und aktuelle Werte als normaler Clip; Original bleibt gebunden. |
| Composition duplizieren | Regeln, Mitglieder und interne Referenzen vollständig remappen. |
| Analyse ändern oder ersetzen | Regel als veraltet markieren; explizite Neuberechnung mit Vorschau und Konfliktprüfung. |
| Quelle fehlt oder Operatorversion unbekannt | Gespeicherte Clip-Projektion erhalten, Regel sichtbar sperren; nicht still neu berechnen. |

Diese Regeln gelten auch für Ripple-, Gruppen- und Agent-Aktionen, soweit sie
gesteuerte Eigenschaften berühren. Nicht unterstützte Kombinationen werden vor
Änderungen abgelehnt. Ein feinerer Split-Vertrag kann später ergänzt werden.

## 6. Zeittypen und Abhängigkeiten

Numerische Ports erhalten neben dem Signaltyp einen fachlichen Vertrag:
Sekunden mit Zeitbasis, Geschwindigkeitsfaktor, Instanzindex oder dimensionsloser
Wert. Verbindungen zwischen verschiedenen Einheiten brauchen eine ausdrückliche
Konvertierung. Bestehende Port-Verträge erweitern, kein paralleles Typsystem bauen.

Neue Zeitquellen werden einzeln freigeschaltet. Die vorhandenen Parameterquellen
sind kein Versprechen, jedes Zahlenfeld beliebig dynamisch steuern zu können.

Die vorhandene Kabel-Zyklusprüfung bleibt bestehen. Zusätzlich muss die fachliche
Abhängigkeitsprüfung implizite Abhängigkeiten erfassen: Zeitbasen, Analysequellen,
gesteuerte Clips und verschachtelte Compositions. Ein azyklischer sichtbarer Graph
allein beweist keine widerspruchsfreie Auswertung.

Vorberechnete Analyse des eigenen Quellmaterials ist nicht grundsätzlich zyklisch.
Problematisch wird die Abhängigkeit, wenn eine Regel den Zustand verändert, aus dem
ihre eigene Eingabe neu berechnet wird. Source- und Processed-Artefakte deshalb
unterscheiden und Revisionen beziehungsweise Gültigkeit festhalten.

Zeitfunktionen sind deterministisch; Zufall hat einen Seed. Determinismus allein
garantiert weder beschränkte Decode-Kosten noch eindeutige Invertierbarkeit.

## 7. Bedienung und Skalierung

- Source-Selector: `Active`, explizite `Timeline` und vorhandene Clip-Ziele.
- `Active` folgt der Auswahl; ohne Clip-Auswahl zeigt es die aktuelle Composition.
  Ein explizit gewähltes oder gepinntes Ziel bleibt stabil.
- Breadcrumb unterscheidet Aufklappen im gemeinsamen Graphen (3.1c) und das tatsächliche
  Öffnen einer verschachtelten Composition. Navigation verwendet deren vorhandenen Lebenszyklus.
- Standardlayout nach Spur und Zeit, ergänzt um lesbare Mindestabstände. Node-x ist
  keine zweite Schnittoberfläche: freies Verschieben einer Karte ändert nur Layout.
  Zeitänderungen erfolgen in Timeline oder expliziten Place-Kontrollen.
- Clip → Track bezeichnet Zugehörigkeit; Track → Stack bezeichnet Compositing-Reihenfolge.
  Aktuelle Overlap-Auswahl beibehalten: mehrere überlappende Clips können existieren,
  der LayerBuilder wählt im normalen Videopfad den später startenden Clip.
- Regelgesteuerte Eigenschaften und manuelle Korrekturen sind an Clip und Node sichtbar.
- Keine ständig laufenden Vorschauen aller Clips. Vorschauen bedarfsgesteuert aktivieren.
- Playhead und Meter dürfen keine komplette Graph-Neuprojektion pro Frame auslösen.
- Bestehende Canvas-/Viewport-Infrastruktur verwenden; LOD um reduzierte Karten und
  gebündelte Beziehungen ergänzen. Geschlossene Ansichten erzeugen keine Graph-Arbeit.
- Neue Inspector-Kontrollen verwenden die bestehenden Resolve-Primitives sowie
  Pointer-/Touch-Fokusregeln und sichtbaren Tastaturfokus.

## 8. Umsetzung in überprüfbaren Phasen

### Phase 0 – Verträge und Messbasis

Workspace-Kontexte, Speicherort der Composition-Darstellung, Mutationswege und
Regel-Eigentum festlegen. Bestehende Projekt-Serialisierung, Repository-Transaktionen,
History und Composition-Wechsel als Integrationspunkte dokumentieren.

Referenzprojekte mit 30, 300 und 1000 Clips vorbereiten. Graph-Öffnung, Edit-Latenz,
Neuprojektionen, Speicher und Playback mit offenem/geschlossenem Panel erfassen.
Die 1000-Clip-Variante dient als Stresstest, nicht als ungeprüftes Leistungsversprechen.

Abnahme: klarer Daten- und Aktionsvertrag; reproduzierbare Baseline. Keine neue Runtime.

### Phase 1 – Composition-Ansicht und Navigation

Composition-Subject und passende Aktionen/Inspector-Adapter ergänzen. Clips, Spuren,
Transition-Referenzen, Video-Stack und bestehende Audio-Verarbeitung projizieren.
Layout speichern, Kontextwechsel und Clip-Navigation implementieren.

Abnahme: gleiche Timeline vor/nach Öffnen der Ansicht; korrektes Projekt-Roundtrip;
keine vollständigen Clip-Untergraphen im eingeklappten Zustand; messbar begrenzte
Darstellungskosten. Noch keine neuen Busse, Zeitoperatoren oder Regeldefinitionen.

### Phase 2 – Bestehende Clip-Eigenschaften bearbeiten

Media-/Slice-/Speed-/Place-Darstellung ergänzen. Bestehende Aktionen anbinden,
einschließlich Linked Audio, Locks, Dauer, Keyframes, Undo und Cache-Invalidierung.
Spurzuweisungen nur dort umsteckbar machen, wo die fachliche Aktion verfügbar ist.

Abnahme: dieselbe Änderung aus Timeline und Graph liefert denselben fachlichen Zustand;
Trim, Speed, Reverse, Spurwechsel und Undo funktionieren auch mit verknüpftem Audio.

### Phase 3 – Beat-Regel als vollständiger Anwendungsfall

Regeldefinition, reine Planung, atomare Anwendung, Korrekturen und Materialize bauen.
Eigentumskontrolle in alle betroffenen Mutationswege integrieren. Projektablage,
History, Duplizieren, Fehlerfälle und Agent-Zugriff gehören in diese Phase.

Abnahme: Regelparameter ändern dieselben Clip-IDs; manuelle Korrekturen überleben
Neuberechnung; kein Teilzustand bei Konflikten; Save/Reload und Undo/Redo erhalten
Regel und Ergebnis; Playback und Export verwenden die aktualisierten normalen Clips.

Erst nach dieser Abnahme weitere Arrangement-Operatoren wie Sequence, Stagger,
Marker-Verteilung und Wiederholung ergänzen.

### Phase 4 – Gemeinsamen Retime-Vertrag etablieren

Zuerst vorhandene Speed-/Reverse-Semantik einschließlich Transition-Zeitabbildung
über gemeinsame Verträge absichern. Verbraucher in Preview, Prefetch, Export, Audio
und verschachtelten Compositions identifizieren und anbinden.

Danach Freeze, Loop und Warp einzeln ergänzen. Jede Fähigkeit muss Dauer, Randfälle,
Audio und Vorbereitungskosten definieren; nicht alle Fähigkeiten gleichzeitig freigeben.
Die Regeln aus [Temporal Frame Access](../architecture/Temporal-Frame-Access.md) gelten.

Abnahme: gleiche Quellframe-/PTS-Auswahl beim direkten Seek, Vorwärts-/Rückwärtsscrub
und Export, auch mit Trim, Speed und verschachtelter Zeit. Audio-Verhalten ist
ausdrücklich implementiert und geprüft, keine stillschweigende Video-only-Zusage.

## 9. Eigenständige Folgeprojekte

### Audio-Busse und Routing

Separat spezifizieren: Bus-Entitäten, Track-Ausgänge, Pre-/Post-Fader-Sends,
Mute/Solo, Zyklusverbot, Meter, Effektausläufe, Latenz und Preview-/Export-Parität.
Vorschlag: Busse zunächst im Mixer/Graph führen, ohne künstliche Clip-Spuren anzulegen.
Die Node-Ansicht bildet nur tatsächlich implementiertes Routing ab.

`targetBusId: 'unknown'` ist im aktuellen Renderer ein Fallback für eine fehlende ID;
das Vorhandensein der Send-Deskriptoren belegt keine vollständige Bus-Laufzeit.

### Virtuelle Instanzen

Nur bei gemessenem Nutzen gegenüber normalen erzeugten Clips priorisieren. Benötigt
einen gemeinsamen ausgewerteten Composition-Zustand für Timeline, Playback, Export,
Audio und Tools; stabile Instanz-IDs, Overrides, Auswahl, Schnittsemantik und
Ressourcenbudget gehören dazu. Keine zweite Implementierung nur im Node-Panel.

### Video-Spur-Effekte

Eigener Render-Vertrag: Spur-Zwischenergebnis, Alpha/Blend-Semantik, Auflösung,
Cache und Export. Zusätzliche Passes nur für betroffene Spuren planen und messen.

### Live-Vorausplanung und Slot Grid

Zuerst konkrete Lastfälle, Warmup, Pipeline-Vorbereitung und Speichergrenzen messen.
Bestehende Slot-Grid-Uhren und Ressourcenverträge integrieren; Cue-Trigger sind
zusätzlicher Ausführungskontext und nicht automatisch Teil einer linearen Zeitfunktion.

Keine harte Echtzeitgarantie aus dem Graphmodell ableiten. Ein Show-Prüfer kann
Anforderungen schätzen, einen Geräte-Probelauf auswerten und vorberechnete Alternativen
anbieten. Shader-Fusion nur für nachweislich kompatible Effektketten planen; Sampling,
Zwischenergebnisse und History können eigene Passes erfordern.

### Freies Cross-Clip-Compositing

Bleibt außerhalb dieses Plans. Spurzuweisung und Timeline-Abhängigkeiten sind kein
Versprechen beliebiger Bildkabel zwischen Clips.

## 10. Agent-Grenze und Verifikation

Der Agent erhält kompakte Composition-/Regelansichten mit stabilen IDs. Große Clip-
und Effektgraphen werden bei Bedarf abgefragt, nicht komplett in jeden Zustand kopiert.

Neue öffentliche Aktionen sind deterministische, fachlich begrenzte Editor-Operationen
für vorhandene Produktfunktionen. Auswahl, Kombination und Planung dieser Operationen
gehören gemäß [ADR-001](../architecture/ADR-001-Fast-V2-Kernel-Owned-Orchestration.md)
in den privaten Kernel. Ein Undo-Schritt entsteht durch eine Transaktion, nicht allein
durch die Darstellung als einzelner Node. Tool-Katalog und gepinnte Verträge gemeinsam
aktualisieren, wenn neue öffentliche Aktionen hinzukommen.

Gesammelt nach Abschluss aller umgesetzten Phasen prüfen (Ausführungsmodus siehe
Abschnitt 12); die folgende Liste ist ein Katalog, aus dem der Orchestrator die
risikorelevanten Punkte auswählt, keine Pflicht-Abnahme pro Phase:

- Projektion und Persistenz: stabile IDs, Composition-Wechsel, Save/Reload,
  Duplizieren, Undo/Redo, unbekannte Versionen und fehlende Quellen.
- Mutationen: Locks, Linked Audio, Trim/Speed, Konflikte, Delete/Copy sowie ausdrücklich
  nicht unterstützte Split-/Ripple-Kombinationen ohne Teiländerungen.
- Regeln: deterministische Ergebnisse, unveränderte IDs, Korrekturen nach Umordnung,
  veraltete Analyse und atomarer Rollback.
- Runtime: vorhandenes Playback/Export erhalten; neue Retime-Fälle einschließlich
  Quellgrenzen, Richtungswechseln, VFR, Audio und Nested Compositions vergleichen.
- UI: echte Bedienung im lokalen Editor, Pointer/Touch und Tastaturfokus;
  Baseline-Vergleich bei großen Timelines und offenem/geschlossenem Panel.
- Agent-Änderungen: eigener vollständiger In-App-Chat-Lauf mit Audit-Prüfung.

Nur relevante benannte Tests ausführen, keine volle Vitest-Suite. Bei Runtime-Änderungen
den finalen Build gemäß AGENTS.md ausführen. Keine Performance-Versprechen ohne
vergleichbare Messung und keine Weiterführung bekannter Fehler in spätere Phasen.

## 11. Entscheidung nach dem ersten nutzbaren Ausbau

Nach Phase 3 anhand realer Schnittaufgaben bewerten: Sind Regeländerungen schneller
und verständlicher als direkte Timeline-Bearbeitung? Bleiben Nutzer bei der Bindung
oder lösen sie sie sofort? Ist der zusätzliche Graph bei großen Projekten hilfreich?

Diese Ergebnisse bestimmen die nächste Investition. Retime, Audio-Routing und Live
müssen nicht gemeinsam entstehen. Der Composition-Graph bleibt auch ohne diese
Folgeprojekte ein nutzbares, abgeschlossenes Produktmerkmal.

## 12. Ausführungsmodus (Entscheidung 2026-10-03)

### Feste Invarianten und Gestaltungsfreiheit

Verbindlich sind nur diese Invarianten:

- Die Timeline-Clips bleiben die einzige ausführbare Wahrheit; der Graph ist Projektion.
  Gespeichert werden nur Layout, Faltungen und Regeldefinitionen.
- Jede fachliche Änderung läuft über bestehende Timeline-Operationen beziehungsweise
  eine gemeinsame Mutation, atomar und als ein Undo-Schritt; keine Teiländerungen.
- Gesteuerte Eigenschaften gehen nie still verloren: manuelle Änderungen werden
  Korrekturen, nicht unterstützte Fälle werden vor der Änderung abgelehnt.
- Anzeigen erzeugt keinen Projektzustand (zum Beispiel keine Transition-Composition).
- Kabel haben eine eindeutige Bedeutung; keine Bildkabel zwischen benachbarten Clips.
- Kernel-Grenze aus ADR-001, 700-LOC-Grenze, Inspector- und Fokusregeln aus AGENTS.md.

Alles andere ist Empfehlung: Dateischnitt, Modulnamen, genaue Port-Namen, Layout-
Algorithmus, LOD-Stufen, Form des Ownership-Guards, Reihenfolge innerhalb einer Phase.
Der ausführende Agent darf davon abweichen, wenn er im Code einen einfacheren oder
robusteren Weg findet, und vermerkt die Abweichung kurz in diesem Abschnitt unter
„Abweichungen“. Widerspricht der Code einer Invariante, wird nachgefragt statt umgangen.

### Orchestrierung

Der ausführende Agent ist Orchestrator: Er schneidet Arbeitspakete mit disjunkten
Schreibmengen, lässt sie von Worker-Agenten bauen (zum Beispiel über den
`codex-worker`-Skill oder Subagenten), prüft deren Diffs gegen die Invarianten und
integriert. Selbst implementiert er nur Integrationsnähte und kleine Korrekturen.

Empfohlener Paketschnitt:

| Paket | Inhalt | Abhängigkeit |
|---|---|---|
| A – Datenvertrag | Typen für Composition-Kontext, Layout, Regel; Feld `compositionGraph` entlang des `sharedSceneGraphs`-Pfads (Store, History, Serialisierung, Repository-Klassifikation, Revision) | – |
| B – Projektion | reine Funktion Timeline → Composition-Graph (Media, Clip, Track, Transition, Stack, Master, Output, Zeitkette, Bündelung) | Typen aus A |
| C – UI | Composition-Subject, Quelle „Timeline“, Breadcrumb, Navigation in Clip/Nested/Transition, Inspector-Abschnitte Slice/Speed/Place | B |
| D – Beat-Regel | reine Planung, Anwendung über `move-clips`, Ownership-Guard, Split-Sperre, Lösen/Materialisieren | A |
| E – Agent-Zugriff | kompakte Composition-/Regelansicht und Regel-Aktionen als Editor-Tools | D; erfordert den In-App-Chat-Lauf nach AGENTS.md |
| F – Gemeinsamer Graph | Clip-Node-System als Vorlage: ein Workspace, Composition-Ebene integriert, Clips inline aufklappbar, Aktionen nach Node-Eigentümer geroutet (3.1c) | B, C; vor E |

A und B laufen parallel, danach C und D parallel. Durchlauf ab 2026-10-03 (Nutzerauftrag):
zuerst die Lücken aus 0–3, dann F, dann E, danach Phase 4 (Retime: zuerst
Speed/Reverse-Vertrag, danach Freeze, Loop, Warp einzeln).

### Verifikation pro Paket

Ab dem Durchlauf vom 2026-10-03 (Nutzerauftrag) wird pro Paket geprüft:

- Worker liefern einen Typecheck ihrer Dateien; der Orchestrator führt danach `tsc`,
  gezielte Unit-Tests für die neue Logik und einen Browser-Durchgang im eigenen
  browser-lokalen Testprojekt mit echten Medien (Video mit Ton) aus, nie im Tab des Nutzers.
- Ergebnisse per Screenshot bewerten: Lesbarkeit des Graphen, Layout, Fokus (Pointer und
  Tastatur), korrekte Timeline-Werte, Undo/Redo, Save/Reload. Höchstens drei
  Verbesserungsiterationen pro Paket; Offenes kommt in den Abschlussbericht.
- Phase 4 zusätzlich: Quellframe-/PTS-Gleichheit bei Seek, Vorwärts-/Rückwärts-Scrub und
  Export sowie das Audio-Verhalten.
- `npm run build` und Commit erst auf ausdrückliche Anweisung des Nutzers („build bitte“).

### Abweichungen

Stand 2026-10-03, Phasen 0–3 (Pakete A–D) integriert; Phase 4 und Paket E offen.

- **Ownership-Guard als synchrone Patch-Umschreibung** (`synchronizeCompositionRules` in der
  Revision-Middleware, nach `synchronizeSharedSceneGraphs`) statt Prüfungen in jedem Mutationsweg.
  Jede Start-/Spuränderung eines Mitglieds aus Timeline, Inspector, Graph, Ripple oder Agent
  wird im selben Patch und damit im selben Undo-Schritt zur Korrektur; gelöschte Mitglieder
  verlassen die Regel. Patches, die `compositionGraph` selbst enthalten (Regelanwendung), bleiben
  unberührt. Leere Regeln bleiben sichtbar. Beim Entfernen eines Mitglieds werden die übrigen
  Korrekturen neu bezogen, damit nichts springt.
- **Split-Sperre** nur an den Einstiegen `splitClip`, `split-at-time`/`split-all-at-time` und
  `split-at-times`; Meldung verweist auf „Release“.
- **Beat-Snapshot in der Regel** (`beatSnapshot` + `sourceRevision`): Planung und Guard sind
  synchron und deterministisch ohne asynchronen Artefaktzugriff; Quelländerung markiert die Regel
  `stale`, Neuberechnung nur explizit über „Refresh source“.
- **Atomare Regelanwendung**: `startBatch` + `runEditorGesture`/`finishEditorGesture` im
  Repository-Modus, Snapshot-Rollback im Legacy-Modus; `move-clips` wird vorab mit dem reinen
  Planer simuliert, weil es gültige Teilmengen akzeptiert.
- **Vertragsnaht**: `NodeGraphOwner` ist eine Union `clip | composition`, Bindungen
  `composition-*`, `NodeGraphNode.summary` für Badges und Mini-Balken; Composition-Layout und
  Faltungen liegen in `compositionGraph.layout`.
- **Verknüpftes Video/Audio als ein Node** (Nutzerentscheidung): ein Clip-Node mit Ausgängen
  `Bild` → Videospur und `Ton` → Audiospur (`targetClipId` je Port), kein Linked-Audio-Kabel.
- **Regelkabel in v1 `readOnly`**: Mitgliedschaft und Reihenfolge werden im Regel-Inspector
  bearbeitet, nicht durch Umstecken.
- **Auswahl im Composition-Graphen pinnt die Quelle auf „Timeline“**, sonst würde `Active` beim
  Klick auf einen Clip-Node sofort in den Clip-Graphen springen; Doppelklick öffnet den Clip.
- **Duplizieren**: `duplicateComposition` behält Clip-IDs, Regeln brauchen kein Remapping;
  eingefügte Kopien erhalten neue IDs und sind normale Clips.
- `updateCompositionGraph(..., { skipHistory })` ignoriert `skipHistory` (kein gemeinsamer
  Mechanismus); Layout-Drags bleiben lokal und schreiben einmal beim Loslassen.

Ergänzt 2026-10-03 (Lücken aus 0–3, Paket F, Paket E, Phase 4):

- **Messbasis als Dev-Hook statt gespeicherter Referenzprojekte:** `createCompositionReferenceTimeline`
  (rein, für Unit-Skalierungstests) und `window.__MS_COMPOSITION_BASELINE__` (nur DEV) bauen 30/300/1000
  Clip-Paare aus einem importierten Medium über die normalen Store-Aktionen als ein Undo-Schritt;
  `measureCompositionProjection` zählt Projektionen. Reproduzierbar ohne Projektdateien im Repository.
- **Transition-Eltern** werden rein abgeleitet (`deriveCompositionTransitionParents`): direkte
  Verknüpfung, generierte Panel-IDs, sonst gleiche Medienidentität plus gleicher Quellzeitvertrag;
  mehrdeutige Fälle bleiben bewusst unverknüpft. „Go to parent clip“ wartet auf `openCompositionTab`.
- **Beat-Quelle:** jeder Clip mit Ton ist wählbar; nicht analysierte Clips sind nur UI-Entwurf
  („Analyze beats“ startet die vorhandene Beat/Onset-Analyse), erst danach läuft `setBeatRuleSource`.
  Processed-Beat-Grids liegen bereits in Clip-Zeit (nach Trim/Speed/Reverse gerendert) und werden
  nur noch um `startTime` verschoben; vorher wurden sie fälschlich erneut durch Trim/Speed gemappt.
- **Media-Quellbalken:** bis zu vier Spuren für überlappende Stücke, danach nummerierte Kacheln.
- **Kernel-Katalog:** Der Dev-Kernel hatte einen anderen Digest gepinnt als dieser Editor
  (`renameTrack`, `syncClipsViaAudio`, `getAudioSyncStatus`, `setMulticamMode` ohne Kernel-Kategorie),
  der In-App-Chat lief deshalb mit `400 invalid_request`. Wird mit Paket E synchronisiert.
- **Paket F (gemeinsamer Graph):** `CompositionWorkspace` und `NodeWorkspaceContextPanel` entfallen; ein
  `NodeWorkspacePanel` mit Wurzel Composition oder Clip. Eingebettete Clip-Nodes tragen Namensräume
  (`clip:<clipId>::<lokaleId>`), `workspaceRouting` leitet jede Canvas-Aktion an den Eigentümer; die
  Clip-Werkzeuge stecken in einem pro Clip instanziierten Controller (`useClipWorkspaceController`), es
  gibt keine zweite Implementierung der Clip-Bearbeitung. Timing bleibt im Composition-Inspector;
  optionale Kontextnähte (Media/Track) in der Clip-Wurzel entfallen in v1. Kabel-Knickpunkte auf
  Composition-Ebene werden nicht gespeichert (bräuchte `compositionGraph.layout.branches`).
  Standardlayout: Spalten Media → Clips (nach Spur und Startzeit, feste Abstände) → Tracks →
  Stack/Master → Output, Regeln darunter; Verdrängung durch aufgeklappte Clips zur Projektionszeit.
- **Paket E:** sechs atomare Tools (`getCompositionGraph`, `createBeatRule`, `updateBeatRule`,
  `releaseBeatRuleMember`, `materializeBeatRule`, `startClipBeatAnalysis`). Release nur einzeln (die
  geteilte Aktion ist atomar pro Mitglied). Fehler tragen alle Konflikte im `error`-Text, weil die
  öffentliche Operationsgrenze bei Misserfolg nur `error` weiterreicht. Kernel: nur Kategorie-Zuordnung
  und Digest-Pin (plus die vier zuvor fehlenden Multicam-/Track-Tools), keine Prompt- oder Fast-Path-Logik.
- **Tempo-Map-Revision ohne Composition-Länge:** Eine Regel, die die Composition verlängert, hat sich
  vorher sofort selbst als `stale` markiert. Die Revision hängt nur noch an der Tempo-Map; der Snapshot
  deckt `max(600 s, 2 × Länge)` ab, „Refresh source“ erweitert ihn.
- **Phase 4, Retime-Vertrag (`src/services/timeline/retime/clipRetime.ts`):** Vorrang
  `transitionSourceMap` > `transitionSourceTimeOverride` > `transitionSourceHold` > signierte
  Speed-Integration (Start bei `inPoint`, wenn Speed bei lokal 0 ≥ 0, sonst `outPoint`, Klemmen auf das
  Trim-Fenster). `reversed` ist eine Spiegelung `in + out − s` mit negierter Rate (für konstante Speed =
  XOR mit dem Speed-Vorzeichen). Gemappte Transition-Zeiten werden nicht erneut gespiegelt. Vorher
  ignorierte die Top-Level-Preview `reversed`, und die Export-Vorbereitung las ein fehlendes `reversed`
  als rückwärts (`undefined !== false`); beides ist behoben, die alten Testerwartungen wurden angepasst.
- **Videoframe-Auswahl rückwärts linksoffen:** Gespiegelte Abtastung macht aus `[a, b)` ein `(a′, b′]`.
  Exakt auf Ausgabeframe-Grenzen (Export tastet am Frame-Anfang ab) wählte der Export deshalb den
  Quellframe rechts der Grenze, die Preview den richtigen (im Browser gemessen: Vorwärts-Clip Export =
  Preview, Rückwärts-Clip um einen Frame versetzt). `videoFrameSourceTime` verschiebt nur die
  Frame-Auswahl rückwärts laufender Abtastungen um 1e-5 s nach links; Audio, Split, Trim und
  Umkehrfunktion bleiben exakt.
- **Audio-Vertrag (R2):** Export/Mixdown rendern Speed und Reverse nach demselben Vertrag (XOR,
  ein Integrator mit Holds). Die Live-Preview spielt Rückwärts-/Kurven-Clips aus einem
  revisionsgeschlüsselten Render-Cache (dieselbe Clip-Render-Funktion wie der Export, LRU 8 Clips /
  300 s / 128 MiB) und bleibt stumm, solange der Render aussteht. Freeze ist in Preview und Export stumm.
- **Nested und Split/Trim (R3):** Parent→Kind-Zeit und Kind-Quellzeit laufen rekursiv über den Vertrag
  (Preview, Warmup, Proxy, RAM-Preview, Export). Split und Trim erhalten das gezeigte Quellbild an jeder
  Zeitstelle; bei umgekehrten Clips ändert der linke Rand den Out-Punkt. Speed-Keyframe-Splits behalten
  das bisherige Verhalten (exaktes Rebasing einer Rampe ist nicht Teil dieses Durchlaufs).
- **Freeze (R4):** Feld `timeRemap: { kind: 'freeze', sourceTime }`, Vorrang nach den Transition-Overrides
  und vor Speed; Dauer unabhängig von In/Out, rechte Kante frei verlängerbar; Speed/Reverse bleiben
  gespeichert, wirken aber nicht; verknüpftes Paar atomar; unbekannte künftige `timeRemap`-Arten bleiben
  als opakes JSON erhalten.
- **Loop (R5, R5b, R5c):** `timeRemap: { kind: 'loop', phase? }`. Die signierte Integration läuft
  ungeklemmt weiter und wird halboffen in `[in, out)` gefaltet, danach greift die Reverse-Spiegelung.
  Ein leerer Zyklus hält am In-Punkt. Ein Quellfenster über eine Faltstelle hinweg liefert konservativ
  `[in, out]`. Es gibt keine Umkehrfunktion. Trim und Split passen `phase` an, sodass jede Zeitstelle ihr
  Quellbild behält. Die rechte Kante ist frei verlängerbar, im Select-/Edge-Trim aber durch den nächsten
  Clip (auch auf der verknüpften Spur) begrenzt; Ripple-Trim verschiebt die Folgeclips. Audio wiederholt
  den bearbeiteten Zyklus. Bei automatisierter Speed wird über die Quellzeit resampelt, die Tonhöhe
  bleibt dann nicht erhalten. Die Preview nutzt den Processed-Buffer-Pfad.
- **Warp (R6, R6b):** `timeRemap: { kind: 'warp', points: [{ time, source }] }` mit 2–256 Punkten,
  stückweise linear, Halten außerhalb der Punkte und Klemmen auf die Quell-Domain. Speed und Reverse
  bleiben gespeichert, wirken aber nicht. **Abweichung:** Statt der geplanten Zweipunkt-Initialisierung
  übernimmt das Einschalten die aktuell sichtbare Abbildung adaptiv: affine und eingefrorene Abbildungen
  exakt, Kurven mit einem Fehler unter einem halben Frame, Loop-Sprünge als Ein-Frame-Brücke. Braucht die
  Abbildung mehr als 256 Punkte, wird das Einschalten atomar abgelehnt, ohne Clip- oder History-Änderung.
  Das Umschalten ist eine Store-Aktion (`toggleClipWarp`), die Properties, Kontextmenü und
  Composition-Inspector gemeinsam nutzen. Audio wird mit der signierten Steigung resampelt, Halten
  bleibt stumm, die Tonhöhe wird nicht erhalten. Der Export-Audiopfad holt die Quellbereiche jetzt über
  den Vertrag (`clipSourceRange.ts`, `sourceBufferStart`) statt über In/Out.
- **P1 (Skalierung der Composition-Wurzel):** Abgeschaltet wurde der volle DOM/SVG-Fallback vor dem
  Canvas-Start, ebenso die Okklusionskopien pro Kabel; es gibt jetzt einen gemeinsamen räumlichen
  Rechteck-Index. Port-, Branch- und Gruppensuchen in Schleifen sind indiziert. Unveränderte projizierte
  Nodes behalten ihre Identität (Structural Sharing), Card-Callbacks sind stabil, und Avoid-Routing wird
  bei unveränderter Geometrie wiederverwendet. Die DEV-Messpunkte `ms-node:*` (User Timing) sind in
  `docs/Features/Node-Workspace.md` beschrieben, `tests/unit/nodeGraphScaleGeometry.test.ts` bewacht die
  Komplexität über Zähler. Vier dort gefundene rote Tests (Fisheye-Gruppenzahl, Cable-Avoidance,
  Flow-Pfeil) sind auf HEAD 517e3be0 bereits rot und nicht Teil dieses Plans; das Overscan-Fixture wurde
  an die lazy Preview-Controller angepasst.
- **Richtung und Fenster bei Video-Consumern (R6c–R6e):** Ein Browsertest zeigte, dass ein identischer
  Warp auf einem umgekehrten Clip an einer exakten Frame-Grenze einen Frame später zeigte. Die Ursache war,
  dass Decoder-Wahl, Warmup und Seek-Toleranz aus den gespeicherten Feldern `reversed`/`speed` sowie festen
  13–50-ms-Fenstern abgeleitet wurden. Richtung und Fenster kommen jetzt aus dem Vertrag (Vorzeichen der
  aufgelösten `sourceRate` × Wiedergaberichtung, `frameDomain`). Pausiert bzw. nach einem Scrub wird nur
  noch der exakt gleiche Quellframe akzeptiert (Frame-Index statt Millisekunden); während der Wiedergabe
  bleiben die bisherigen Drift-Schwellen. Properties sperrt Speed und Keyframe-Steuerung bei Freeze und
  Warp (mit Hinweis). Das Timeline-Kontextmenü zeigt Freeze/Loop/Warp im Stil der übrigen Einträge, mit
  Häkchen und „Unfreeze“.
- **Warp-Initialisierung:** Eine Klemm-Kreuzung, die durch Rundung 1e-16 s vor dem Clipende lag,
  erzeugte einen doppelten Endpunkt. Kreuzungen innerhalb von 1 ns um die Enden zählen jetzt als Endpunkt.
- **Export-Audio bei verschachtelten Compositions:** Nach R6b wurde Nested-Mixdown-PCM nicht mehr am
  Export-Ende gekürzt. Für Clips ohne Loop/Warp ist das wieder so, verankert am In-Punkt; Loop und Warp
  behalten ihr ganzes Fenster.
- **UI-Befunde aus den Browserprüfungen, behoben:** Der Composition-Breadcrumb bleibt einzeilig, jedes
  Glied wird mit Ellipse gekürzt, der volle Pfad steht im Tooltip, der Tastaturring liegt innerhalb der
  Zeile. Die Composition-Inspector-Spalte ist ein Size-Container, damit die schmalen Resolve-Regeln
  greifen (vorher 377 px Inhalt in 303 px Spalte, horizontal scrollbar). „Distribute on beats“ zählt den
  Audio-Partner eines mit ausgewählten Video-Clips nicht mehr als eigenes Mitglied (die Planung zieht
  verknüpfte Partner wie `move-clips` nach). Vorher scheiterte die Regel an „Track … is incompatible“.
  Der Warp-Punkteditor rendert bei der Wiedergabe nicht mehr pro Frame neu.

### Messbasis (gemessen 2026-10-03, vor Paket P1)

Aufbau: eigene Composition „Baseline“ im browser-lokalen Testprojekt, `__MS_COMPOSITION_BASELINE__.build(N,
{ clipDuration: 1.5, trackCount: 3 })` mit einem echten Medium (H.264 + AAC), N verknüpfte Video/Audio-Paare.
Nodes-Panel mit Wurzel Composition, Media-Gruppe eingeklappt, kein Clip aufgeklappt, Toolbar-Standard.
Edit = Verschieben des letzten Clips um 0,1 s über `move-clips`, gemessen bis zwei Animation-Frames später.

| N Paare | Graph-Nodes | Projektion | Panel öffnen | Edit, Panel offen | Edit, Panel zu | Projektionen/Edit | Wiedergabe offen/zu |
|---|---|---|---|---|---|---|---|
| 30 | 42 | 0,4 ms | 275 ms | 182 ms | 73 ms | 1 | 29 / 30 fps |
| 300 | 312 | 2–3 ms | 9,6–13,9 s | 5,4–11 s | 121–155 ms | 1 | 29 / 27 fps |
| 1000 | – | – | nicht gemessen (bei 300 bereits superlinear) | – | – | – | – |

Befund: Die Projektion ist billig; die Kosten entstehen beim Rendern der Composition-Wurzel (React-Commit
bis 3,4 s bei 300 Paaren, danach Canvas-/Routing-Arbeit). Geschlossenes Panel: null Projektionen pro Edit.
Wiedergabe im eingeschwungenen Zustand unbeeinträchtigt (keine Commits während der Wiedergabe). Daraus
folgt Paket P1 (Skalierung der Composition-Wurzel).

### Messbasis nach P1 (gemessen 2026-10-03)

Gleicher Aufbau. 1000 Paare in einer eigenen leeren Composition „Baseline 1000“ (Aufbau über den echten
`addClip`-Pfad: 445 s für 2000 Clips, also nicht Teil der Graph-Kosten). „Öffnen“ = Tab-Klick bis Canvas
gemountet; „eingeschwungen“ = bis keine Long Tasks mehr folgen.

| N Paare | Graph-Nodes/Kabel | Projektion | Panel öffnen | Edit, Panel offen | Edit, Panel zu | Projektionen/Edit (zu) | Wiedergabe offen/zu |
|---|---|---|---|---|---|---|---|
| 300 | 312 / – | 6 ms | 925 ms | 264 ms | 124 ms | 1 (0) | 29 / 28 fps |
| 1000 | 1012 / 3010 | 10 ms | 822 ms (gecacht erneut: 101–109 ms) | 348 ms | 173 ms | 1 (0) | 26–32 / 29 fps eingeschwungen |

Befund bei 1000 Paaren (offen, Paket P1c): Beim ersten Öffnen nach dem Aufbau bzw. nach Edits bei
geschlossenem Panel blockierte der Hauptthread bis über 80 s. Ursachen per Long-Animation-Frame und
React-Commit-Hook: Der Worker-Renderer malte die ganze Szene mehrere Sekunden lang, ein Watchdog wertete
ihn als ausgefallen und schaltete auf Software-Malen im Hauptthread um (`tick` 20 s, danach 3 s pro Frame).
Beim Umschalten montierte der DOM-Fallback alle 3010 Kabel (`NodeGraphEdges` 77 s, `NodeGraphFlowSignals`
5,7 s in einem Commit). Die eingeschwungenen Werte oben gelten erst nach diesem Einbruch.

### Messbasis nach P1c/P1d (gemessen 2026-10-03)

P1c: Der Worker quittiert `init` sofort, Paint und Preview-Batches haben keine Ausfallfrist mehr (Ausfall
nur noch bei Fehler oder fehlender Init-Quittung). Der Wechsel zu Software-Malen montiert kein SVG mehr.
Der echte DOM-Fallback zeichnet bei großen Graphen höchstens 256 Kabel im Viewport (ausgewählte, gehoverte
und gezogene bleiben immer erhalten). Der Canvas-Paint schneidet Kabel, Abdeckungen und Signalpunkte auf den
Viewport zu, statt die Gruppenfläche pro Kabel neu zu zerlegen. Neue Messpunkte: `ms-node:paint-nodes`,
`paint-edges`, `paint-covers`, `paint-overlay`. P1d: Eine synchrone Fähigkeitsprüfung des Software-Canvas
(z. B. fehlendes `Path2D`) schaltet sofort auf DOM, damit Karten, Ports und Gruppenköpfe ohne Worker sofort da sind.

| N Paare | Panel öffnen (kalt) | größter Long Task beim Öffnen | Edit, Panel offen | Edit, Panel zu | Öffnen nach Edit bei geschlossenem Panel | Leerlauf offen | Wiedergabe offen/zu |
|---|---|---|---|---|---|---|---|
| 30 | 59 ms | – | 87 ms | 68 ms (0 Projektionen) | – | – | 28 / 28 fps |
| 1000 | Worker-Paint 738 ms, Avoid-Routing 6,2 s im Worker | 109 ms | 454–551 ms | 123 ms | größter Long Task 96 ms (vorher bis > 80 s) | keine Long Tasks | 28 fps |

Renderer blieb in allen Läufen `worker`. Der Edit bei offenem Panel liegt bei 1000 Paaren an der 500-ms-Grenze;
den größten Anteil hat der synchrone Timeline-Edit selbst (2000 Clips, History-Snapshot). 300 Paare wurden
nach P1 gemessen (Tabelle oben), nicht erneut nach P1c.

### Offene Punkte (Stand 2026-10-03)

- Kein Build und kein Commit: Beides wartet auf „build bitte“.
- Vorbestehend rot, nicht aus diesem Plan: `fisheyeFlowLayout`, `nodeCableAvoidance`, `nodeFlowActivity`
  (auf HEAD 517e3be0 rot).
- Im Browser nicht gezeigt, nur per Unit-Test belegt: Export-Audio von Warp und Loop (Resampling, stumme
  Holds) sowie eine positive Beat-Verteilung mit einem langen Audio-Clip als Quelle. Die analysierte
  1,5-s-Quelle hatte zu wenige Beats; die Ablehnung ist korrekt.
- Bei 1000 Paaren liegt ein Edit mit offenem Panel bei 454–551 ms, also an der 500-ms-Grenze. Der größte
  Teil ist der synchrone Timeline-Edit selbst (2000 Clips, History-Snapshot).
- Tonhöhe wird bei Loop mit Speed-Automation und bei Warp nicht erhalten (dokumentiert). Speed-Keyframe-Splits
  rebasen eine Rampe nicht exakt (wie vor diesem Plan).
- Kernel-Verhalten (privates Repo, nicht Editor): Die erste Rückfrage im Chatlauf ging von einer falschen
  Tempo-Map aus, und es gab ein ungefragtes `startMediaTranscription` (Credits 112 → 63).
- Außerhalb des Plans gefunden und nicht angefasst:
  1. In der Sitzung neu angelegte Compositions sind bis zum Reload nicht navigierbar
     („Composition is not in the installed project“, Repository-Navigation).
  2. `.dock-guided-resize-corner` ragt 12 px aus den Dock-Spalten; ein `scrollIntoView` (etwa beim Öffnen
     eines Inspector-Dropdowns) verschiebt dadurch die ganze App. `dock.css` hat fremde, uncommittete Änderungen.
  3. Der Warmup abgeleiteter Waveforms schreibt `audioState` über den Derived-Pfad
     („Derived timeline updates cannot change durable clip field audioState“).
  4. Undo/Redo im Repository-Modus wird bei großen Projekten erst nach Sekunden sichtbar
     (langsame History-Snapshots).
