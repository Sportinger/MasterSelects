# Timeline Node Graph – Umsetzungsplan

Stand: 2026-10-02. Status: überarbeiteter Plan, nicht implementiert.

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

Clip-Nodes sind zunächst Referenzen mit stabiler Clip-ID, Kurzinfo und Mini-Balken.
Der Clip-Untergraph wird erst beim Öffnen aufgebaut. Anfangs öffnet Doppelklick die
vorhandene Clip-Ansicht; Inline-Aufklappen kommt nur bei nachgewiesenem UX-Nutzen hinzu.

Kabel haben eine eindeutige Bedeutung: Referenz, Spurzuweisung, Transition oder
unterstütztes Routing. Zeitlich benachbarte Clips werden nicht als Bildverarbeitungskette
`Clip A → Clip B` verkabelt. Bestehende Beziehungen ohne Editierunterstützung bleiben
als solche erkennbar und nicht frei umsteckbar.

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
- Breadcrumb unterscheidet Workspace-Navigation und das tatsächliche Öffnen einer
  verschachtelten Composition. Navigation verwendet deren vorhandenen Lebenszyklus.
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

Je Phase nach abgeschlossener Implementierung gezielt prüfen:

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
