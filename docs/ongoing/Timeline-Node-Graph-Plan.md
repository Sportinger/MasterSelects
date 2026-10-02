# Timeline als Node-Graph – Konzept

Stand: 2026-10-02. Status: Idee/Konzept, noch nichts implementiert. Ergebnis einer
Diskussion mit dem Nutzer; Performance-Aussagen sind Einschätzungen ohne Messung.

## Idee

Über den bestehenden Clip-Graphen kommt eine oberste Ebene: **die Timeline selbst als
Node-Container**. Darin liegen alle Clips als Nodes (eingeklappt, mit ihren bestehenden
Unter-Nodes), Transition-Nodes, Zeit-Nodes zum Verteilen/präzisen Setzen von Clips,
Geschwindigkeiten sowie das komplette Audio-Routing bis zum Master.

Korrektur der ersten Intuition („Timeline hat als Output nur Zeit“): Der Output der
Timeline ist **Bild + Ton**. Zeit ist das, was die Timeline **nach innen** an ihre
Inhalte gibt.

## Vorbilder

- **Houdini:** Zeit ist kein Kabel, sondern Auswertungskontext (`$T`, `$F`). Der Output
  fragt „Ergebnis bei t“, die Anfrage läuft den Graphen hoch; Time Shift / Time Warp
  schreiben t um, bevor sie ihren Input fragen (**Pull-Modell**: Zeit fließt hoch,
  Bilder fließen runter).
- **Nuke:** TimeOffset, Retime, FrameHold, TimeWarp; AppendClip reiht Clips. In Nuke
  Studio und Resolve/Fusion ist die Timeline ein eigener Editor, jeder Clip öffnet einen
  eigenen Comp – das ist der heutige MasterSelects-Stand.
- **TouchDesigner:** jeder Container (COMP) kann eine eigene lokale Zeit haben,
  Container sind schachtelbar – am nächsten an dieser Idee.

## Modell

```text
┌─ Timeline (Container) ──────────────────────────────────────────┐
│  [Clock t]                                                       │
│     ├─[Time Map: start 4s, in 1.2s, speed 2x]─[Clip A ▸]─┐       │
│     ├─[Time Map: start 9s]────────────────────[Clip B ▸]─┤       │
│     │                         [Transition: A→B]──────────┤       │
│     ├─[Time Map]─[Freeze @ 2s]────────────────[Clip C ▸]─┼─[Video Out]
│     └─[Time Map]──────────────────[Nested Timeline ▸]────┘       │
│                                      (gleiche Struktur, rekursiv)│
│  Audio: Clips ─ Tracks ─ Busse ─ Master ──────────────[Audio Out]│
└──────────────────────────────────────────────────────────────────┘
```

- **Time Map** = Projektion der vorhandenen Clip-Felder `startTime`, `inPoint`,
  `outPoint`, `speed`, `reverse`, Speed-Kurve. Clip in der Timeline ziehen = genau
  diesen Node ändern. Die Timeline ist die grafische Darstellung aller Time Maps –
  **keine zweite Wahrheit**.
- **Zeit-Nodes** auf dem Zeit-Kabel: Offset, Speed, Freeze, Loop, Reverse, Warp (Kurve).
  Mehrfach-Nodes (ein Eingang, viele Ausgänge): Sequence, Distribute, Stagger,
  Snap to Beats, Align to Marker/Speech-Marker, Fit to Duration, Sync (Multicam).
- **Transition** zieht zwei Clips zu ihren jeweiligen gemappten Zeiten und mischt sie;
  Doppelklick öffnet die Transition-Composition (mapped-v3).
- **Nested Timeline** = derselbe Container als Node, mit eigener lokaler Zeit.
- **Clip-Node** = eingeklappte Gruppe des bestehenden Clip-Graphen; Doppelklick öffnet ihn.
- **Audio:** Clip → Track (FX, Volume, Pan) → Sends → Busse → Master (Limiter, LUFS, FX)
  → Out.
- **Video-Compositing** bleibt der Layer-Stack (Spuren mit Blend-Modes). Freier
  Cross-Clip-Datenfluss (Clip A als Matte für Clip D) ist ein separates, großes Projekt
  (RenderDispatcher / LayerCollector) und nicht Teil dieses Konzepts.

## Bedienung: zwei Ebenen

**Klick auf einen Clip** → normale Clip-Ansicht wie heute:

```text
[Source] → Transform → Masks → Color → Effects → [Clip Output]
```

**Klick auf freie Stelle in der Timeline** → eine Ebene höher, Timeline-Ansicht:

```text
            ┌─[Clip A ▸]──┐
[Time] ─────┼─[Clip B ▸]──┼─[Video-Stack]──── texture ─┐
            ├─[Clip C ▸]──┘   (Spuren V1..Vn)           ├─[Timeline Output]
            └─[Musik ▸]───────[A1]─[Master]─── audio ───┘
```

- Beide Ebenen haben dieselbe Form: links rein (Source bzw. Time), rechts raus
  (Clip Output bzw. Timeline Output). Der Nodes-Panel-Modus „Active“ folgt heute
  schon der Auswahl; leere Auswahl = Timeline.
- **Video-Stack** zwischen Clips und Output: ein Eingang pro Spur in Spurreihenfolge,
  mit Blend-Modes (wer liegt über wem). Audio: Spur-Nodes → (später Busse) → Master.
- **Zeit-Kabel standardmäßig unsichtbar** (wie Houdini: jeder Clip bekommt die Zeit
  implizit). Sichtbar nur dort, wo ein Zeit-Node dazwischensitzt (Speed, Freeze,
  Sequence, Snap to Beats) – so sieht man, welche Clips gesteuert sind.
- **Navigation:** Breadcrumb `Timeline › Intro-Comp › Clip B`; Doppelklick auf
  Clip-Node öffnet seinen Graphen (= Klick auf Clip in der Timeline); Klick auf
  `Timeline` im Breadcrumb oder auf freie Timeline-Fläche geht hoch. Verschachtelte
  Composition = wieder ein Container mit eigenem Time und Output.
- **Layout:** Clip-Nodes standardmäßig nach Zeit (x) und Spur (y), Time links, Output
  rechts – die eigene Timeline, nur mit Kabeln.

## Clip-Aufbau: Media → Slice → Speed → Place

Ausgeschriebene Form eines Clips, 1:1 auf die heutigen Clip-Felder abgebildet (keine
neue Datenhaltung):

```text
[Media: interview.mp4]          ganzes Video
     ▼
[Slice: in 12.4s – out 18.0s]   → inPoint / outPoint
     ▼
[Speed: 2× / reverse / Kurve]   → speed, reverse, Speed-Kurve
     ▼
[Place: Start 4.0s, Spur V1]    → startTime, trackId
     ▼
   (Effekte …) → Video-Stack
```

- Reihenfolge ist fest, weil sie Bedeutung trägt: Slice schneidet in Quellzeit, Speed
  ändert danach die Länge, Place setzt das Ergebnis auf die Timeline.
- **Eingeklappt (Standard):** ein Clip-Node mit zwei Mini-Balken (welcher Teil der
  Quelle / wo auf der Timeline) plus Kurzinfo `2× · V1 · 4.0s`. Grund: 300 Clips ×
  4 Nodes = 1200 Nodes wären unlesbar und langsam.
- **Aufgeklappt** (Pfeil am Node, bestehender Gruppen-Mechanismus): die vier Nodes
  einzeln.
- **Ein Media-Node, mehrere Slices:** ein in 8 Stücke geschnittenes Interview = ein
  Media-Node mit 8 Kabeln. Split erzeugt einen weiteren Slice am selben Media-Node.
- **Verteil-Nodes ersetzen Place** (siehe unten); Zeit-Effekte (Loop, Freeze, Warp)
  sitzen zwischen Slice und Place.
- Die Timeline bleibt das beste Werkzeug für das *Wo* (Zeit ist horizontal am
  klarsten), der Graph zeigt das *Warum*. Gesteuerte Clips bekommen in der Timeline
  eine Markierung; Klick springt zum steuernden Node.

## Freiheit: Ports, LFOs, Verteiler, Keyframes

### Jeder Zeit-Wert ist ein Port

`Slice.in`, `Slice.out`, `Speed`, `Place.start` haben Eingänge. Unverbunden gilt der
eingetippte bzw. in der Timeline gezogene Wert; verbunden kann alles steuern, was eine
Zahl liefert:

```text
[LFO 0.5 Hz]──┐
[Keyframes]───┼─[Math +]──→ Place.start
[Beats]───────┘
```

Vorbild im Code: prozedurale Parameter-Quellen und Keyframe-Nodes im Clip-Graphen
(steuern dort heute Farb-/Effekt-Parameter) – wird auf Zeit-Parameter übertragen.

### Zwei Arten von „automatisch“

- **A) Verteilen (Layout), Uhr = Clip-Index i:** z. B. Clip i startet bei
  `i × 0.5s + LFO(i) × 0.2s`. Ergebnis: feste Positionen, normal in der Timeline
  sichtbar (wie MoGraph-Effektoren in Cinema 4D). Für Schnitt die nützlichere Variante.
- **B) Bewegen (Abspielen), Uhr = Abspielzeit t:** Clip hat keine feste Position, er
  „wabert“ in der Zeit = Time-Warp (Quellzeit = f(t)). Timeline zeigt einen Bereich mit
  Kurve statt festem Block.

Beides erlaubt, beides bleibt eine reine Funktion (Zufall immer mit Seed). Der Node
legt fest, ob seine Uhr i oder t ist.

### Verteiler-Node (ein oder viele Clips, auch mehrfach)

```text
[Slice A]─┐
[Slice B]─┼─[Verteiler]──→ Video-Stack
[Slice C]─┘  Anzahl: 12   Modus: Reihe / Raster / Beats / Marker
             Abstand ← [LFO über i]
             Reihenfolge: der Reihe nach / zufällig (Seed) / Ping-Pong
```

- Ein Clip + Anzahl 12 = derselbe Ausschnitt zwölfmal (Cloner).
- Mehrere Clips = reihum / nach Regel verteilt.
- Verteiler sind verkettbar (erst auf Beats, dann pro Clip LFO-Versatz).
- **Instanzen standardmäßig virtuell:** keine 12 echten Clips im Store; Timeline zeigt
  Geister-Clips. **Materialize** macht echte, unabhängige Clips daraus.
- **Manuelles Ziehen** einer Instanz speichert eine Korrektur *für diese Instanz* am
  Verteiler; sie überlebt spätere LFO-/Regeländerungen.

### Keyframes

Keyframes sind eine weitere Wert-Quelle: ein Kurven-Node mit **Zeit-Eingang**.
Entscheidend ist die angeschlossene Uhr:

| Uhr | Bedeutung | Wann sinnvoll |
|---|---|---|
| **Clip-lokal** (Standard) | Keyframes wandern mit dem Clip | wie heute |
| **Timeline** | bleiben an absoluter Zeit | Musikvideo: Effekt auf Takt 32, egal welcher Clip dort liegt |
| **Quelle** | kleben am Inhalt | Slip-Edit: Effekt bleibt auf der Geste |
| **Instanz i** | Kurve über Clip-Nummer | „Verteilungskurve“, z. B. Abstände werden enger |

- Keyframes auf `Place.start` mit Uhr i = verteilen, mit Uhr t = beim Abspielen bewegen.
- Keyframes auf `Speed` mit Uhr t = heutige Speed-Kurve.
- Die Zeitebenen Quelle / Clip / Composition trennt `TransitionSourceMap` schon heute.

### Grenzen

- **Keine Kreise:** ein Clip darf seine Position nicht aus dem eigenen Ton ableiten
  (vorhandene Zyklus-Prüfung).
- **Zufall immer mit Seed** – Vorschau = Export.
- **Instanzen kosten Decode:** 12 Instanzen desselben Videos zu verschiedenen Zeiten =
  bis zu 12 Lesepositionen. Time Stack löst das mit GPU-Frame-Cache → wiederverwenden.
  Für Live meldet der Prüfer das vorher.

## Spuren als Nodes

Spuren bekommen eigene Nodes, weil sie echte Verarbeitung haben. **Das Kabel vom Clip
in einen Spur-Node ist die Zuweisung** (`trackId`) – Spur als Node und Zuweisung am Clip
sind dieselbe Änderung.

```text
Zeile V2:  [Clip D ▸]──[Clip E ▸]────────────────────────────▶[Track V2 · FX]─┐
Zeile V1:  [Clip A ▸]──[Transition]──[Clip B ▸]──[Clip C ▸]──▶[Track V1 · FX]─┼─[Video-Stack]─▶ Output
Zeile A1:  [Dialog ▸]──────────[Dialog 2 ▸]──────────────────▶[Track A1 · EQ]─┬─[Master]─────▶ Output
Zeile A2:  [Musik ▸]─────────────────────────────────────────▶[Track A2]──────┘
```

- **Video-Spur:** wählt, welcher ihrer Clips gerade aktiv ist (auf einer Spur höchstens
  einer, außer während einer Transition), Sichtbarkeit, Stack-Reihenfolge, später
  Spur-Effekte.
- **Audio-Spur:** Volume, Pan, Mute/Solo, FX, Sends (existiert in `TrackAudioState`).
- Jede Zeile = eine Spur; Spur-Node am rechten Zeilenende, Clip-Kabel gebündelt –
  keine 100 Einzelkabel, sieht aus wie die Timeline.
- **Transitions gehören auf die Spur-Ebene** (zwischen zwei Nachbarn derselben Spur).
- Clip auf andere Spur ziehen = Kabel umstecken.
- **Video-Spur-Effekte** gibt es heute nicht (nur Audio-Spur-FX). Wäre ein neues
  Render-Feature: Spur einzeln rendern, dann in den Stack mischen – ein zusätzlicher
  Pass, aber nur für Spuren mit Effekten.

## Aufwand und Nutzen

Architektonisch nicht zu viel, weil fast alles eine Ansicht auf bestehende Daten ist.
Zu viel wird es nur, wenn alles gleichzeitig gebaut wird oder Schneiden in Nodes
vorausgesetzt wird. **Die Timeline bleibt das Hauptwerkzeug**, die Node-Ebene ist eine
zusätzliche, optionale Ansicht.

| Teil | Aufwand | Nutzen |
|---|---|---|
| Ansicht mit Spuren, Clips und Durchklicken | mittel | Überblick, Basis für alles |
| Audio-Busse und Routing | mittel | hoch, besser als jeder Mixer |
| Verteiler, LFO, Snap to Beats | mittel | hoch, das kann keine Timeline |
| Virtuelle Instanzen, Clips die beim Abspielen in der Zeit wandern | hoch | Nische, aber einzigartig |
| Video-Spur-Effekte | mittel bis hoch | solide, auch ohne Nodes nützlich |

Empfehlung: mit der Ansicht starten, danach entscheiden, wie weit es geht.

## AI-Agent: Vorteile und Grenzen

Der Graph macht den Agenten **nicht kreativer**: welcher Take, wo die Geschichte einen
Schnitt braucht, hängt von Analysen (Transcript, Gesichter, Szenenschnitte, Beats) und
vom Modell ab. Er verbessert, **wie zuverlässig, nachvollziehbar und schnell** der Agent
umsetzt und ändert.

### Vorteile

1. **Ändern statt neu bauen.** Heute: Beat-Schnitt = ~50 Einzelschritte (`moveClip`,
   `splitClip`, `setClipSpeed` …), jede Änderung wieder 50. Mit Graph: ein Parameter am
   Verteiler. Feedback-Runden schneller, seltener Abbruch mittendrin.
2. **Regeln aus mehreren Analysen kombinieren** – hier entsteht echt besserer Schnitt:
   ```text
   [Beats ← Musik] ──────────────┐
   [Wortgrenzen ← Transcript] ───┼─[Snap: auf Beat, nie mitten im Wort]─→ Track
   [Gesicht sichtbar ← Face] ────┘
   ```
   Statt im Kopf zu rechnen und 50 Positionen zu setzen (Fehler wie Schnitt mitten im
   Wort), ist die Regel explizit, deterministisch und gilt weiter, wenn sich Musik oder
   Clips ändern.
3. **Versteht frühere Schnitte:** sieht „8 Clips aus dem Interview, auf Beats der
   Musik“ statt 8 Startzeiten – auch bei vom Nutzer gebauten Strukturen.
4. **Prüfen vor dem Anwenden:** fehlende Eingänge, Kreise, falsche Typen fängt der
   Compiler ab, bevor etwas in der Timeline landet; ein Undo-Schritt statt 50.
5. **Vorlagen:** „Intro → 3 Highlights auf Beats → Outro mit Logo“ als Graph speicherbar
   und auf neues Material anwendbar; Varianten (16:9 / 9:16, 30 s / 60 s) aus derselben
   Struktur.
6. **Weniger Kosten:** weniger Tool-Aufrufe, kompaktere Zustände → weniger Tokens/Credits.

### Grenzen

- **Interview-Schnitt nach Inhalt** („stärkste Aussagen, Ähs raus“): bestes Werkzeug
  ist das Transcript (Schnitt über Text); der Graph ist nur das Ergebnis.
- **Besten Take auswählen:** Analyse und Urteil, keine Struktur.
- **Einzelne kleine Änderungen** („Clip 3 um 2 s kürzen“): direktes Tool bleibt schneller.
- **Schlechte Regeln bleiben schlecht:** Agent muss das Ergebnis weiter ansehen (Frames
  an Schnittstellen, Schnitt-Vorschau).

### Einordnung

Der Agent behält seine einfachen Tools für einfache Sachen und nutzt den Graphen für
Strukturen und Regeln. Größter Nutzen: Musikvideos, Montagen, Social-Formate,
Multicam-Regeln, Vorlagen, Live-Cues. Beim klassischen Story-Schnitt ist der
Transcript-Weg wichtiger. Nach ADR-001: Graph-Operationen als atomare Editor-Tools,
die Planung, *welche* Struktur gebaut wird, im Kernel.

## Was im Code schon da ist

- Node-Workspace ist eine Projektion mit Bindings, die in die echten Felder
  zurückschreiben (`src/types/nodeGraph.ts`). `NodeGraphOwner` kennt bisher nur
  `kind: 'clip'` → um `'composition'` erweitern.
- Composition-eigener Graph als Präzedenzfall: `sharedSceneGraphs` auf der Composition
  (`src/types/sharedSceneGraph.ts`).
- Gruppen mit typisierten Boundary-Ports beim Einklappen → Clip als Gruppe fast gratis.
- Signaltypen `'time'`, `'timeline'` und `'clip'` (zeitadressierbares Video) existieren
  bereits in `src/signals/types.ts`.
- Pull-Zeit existiert schon: `SourceFrameService`, `TransitionSourceMap` v2 mit drei
  Zeitebenen (Quellzeit, Clip-Animationszeit, Composition-Zeit), `speedIntegration.ts`.
- Transitions: `transitionIn` / `transitionOut` am Clip, Transition-Compositions.
- Audio: `TrackAudioState` (Volume, Pan, FX, Sends), `MasterAudioState` (Limiter, LUFS,
  FX). Sends haben `targetBusId`, aber **Busse als Entitäten fehlen** (Renderer setzt
  `'unknown'`) → echtes Bus-Routing ist neu.
- Zeit-Signale als Eingänge: Beats/Onsets (`event`), Transcript, Speech-Marker,
  Tempo-Map, Multicam-Gruppen / Audio-Sync.
- Node-Workspace hat bereits einen **Node graph source**-Selector → neue Quelle
  „Timeline“ statt eigenem Panel.
- Agent-Infrastruktur: Codex Direct streamt Graph-Aufbau als einzelne Node-, Kabel- und
  Parameter-Operationen (jeweils Policy, Undo, Audit); `operatorGraphAgentView.ts`
  faltet große Graphen kompakt für den Agenten – nötig auch für 300-Clip-Timelines.
- Video-Spuren haben keinen Effekt-Stack (`TimelineTrack` in `src/types/timeline.ts`);
  nur Audio-Spuren über `TrackAudioState.effectStack`.

## Harte Regel

Zeit darf nur eine **reine, vorhersagbare Funktion von t** sein (Offset, Speed, Kurve,
Freeze, Loop, Beat-Positionen aus vorberechneten Analysen). Nicht erlaubt: Zeit abhängig
von gerenderten Pixeln oder Laufzeit-Feedback. Grund: Decoder-Prefetch, Scrubbing in
beide Richtungen und frame-identischer Export.

Der Zeit-Graph wird beim Editieren zu einer Zeit-Abbildung pro Clip kompiliert. Die
Render-Loop bleibt unverändert und wertet **nie** den Graphen pro Frame aus.

## Performance (Einschätzung, ungemessen)

- **Playback/Export: gleich schnell**, solange kompiliert wird. t → t' pro Clip kostet
  Mikrosekunden. Echte Kosten bleiben das Dekodieren; Freeze/Loop/Reverse/Warp erzeugen
  Seeks – wie heute bei Reverse oder Speed-Kurven.
- **Langsamer nur bei falscher Bauweise:** generischer Graph-Interpreter pro Frame
  (Allokationen, GC, Traversal).
- **Editieren: minimal mehr Arbeit.** Neukompilierung muss inkrementell sein (nur
  betroffene/nachgelagerte Clips); keine Neuberechnung + Store-Subscriptions über die
  ganze Timeline bei jeder Mausbewegung.
- **Node-Ansicht = echtes Risiko:** 300–1000 Clip-Nodes statt heute 10–40. Braucht LOD
  nach Zoom (Mini-Karten, Kabel bündeln, nur Sichtbares mounten). Darf nicht mit dem
  Playhead re-rendern. Geschlossen kostet sie nichts.
- **Mögliche Gewinne:** Reine Zeitfunktionen erlauben exaktes Vorausladen der nächsten
  Quell-Frames (auch bei Loop/Warp) und schnelles Aussortieren inaktiver Clips per
  Intervall. Vorher prüfen, wie gut der heutige Prefetch ist.

## Live-Mode

Ziel: Live-Video-Shows, bei denen Performance absolut im Vordergrund steht.

- **Kompilieren der Zeit allein macht Playback nicht schneller**, sondern verhindert
  nur, dass Nodes es langsamer machen. Echte Kosten: Decode, GPU-Upload,
  Effekt-Durchgänge.
- **Wo Nodes echt schneller machen:**
  1. **Effekte zu einem Shader zusammenfassen.** Existiert im Kleinen: der Operator
     Graph Compiler (`docs/Features/Operator-Graph-Compiler.md`) macht aus einem
     Effekt-Graphen eine WGSL-Funktion ohne zusätzliche Passes. Ausweiten auf ganze
     Effekt-Ketten = weniger Passes, Zwischen-Texturen, Bandbreite.
  2. **Vorausplanen** (wichtigster Punkt für Live): Der Graph beschreibt vollständig,
     was wann gebraucht wird. Vor der Show: Decoder für nächste Cues vorwärmen, erste
     Frames auf der GPU; alle Shader/Pipelines vorab kompilieren (kein Ruckeln beim
     ersten Auftreten); GPU-Speicher fest reservieren; Unveränderliches einmal
     vorberechnen.
  3. **Show-Prüfer:** z. B. „Cue 7 braucht drei 4K-Decoder gleichzeitig plus
     Freeze-Sprung – schafft dein Rechner nicht, vorrendern?“
- **Live ≠ Export:** Export will Durchsatz (ein langsamer Frame ist ok), Live will einen
  garantierten schlechtesten Fall (jeder Frame pünktlich, nie ein Hänger).
- Live-Mode heißt deshalb vor allem verbieten oder vorziehen: keine unvorbereiteten
  Seeks, keine Proxy-Wechsel, keine Shader-Kompilierung oder Analysen während der Show,
  feste Auflösung, alles vorgeladen.
- **Zusammenhang:** Der Timeline-Container mit eigener lokaler Zeit ist fast schon ein
  Live-Cue – ein Trigger startet seine Uhr. Passt zum Slot Grid
  (`docs/Features/Slot-Grid.md`), dessen Layer A–D schon eigene Uhren haben.
  Live-Show und Node-Timeline = dasselbe Modell, linear abgespielt oder per Trigger
  gestartet.

## Phasen (Vorschlag)

1. **Timeline-Container als Ansicht:** Owner `'composition'`, leere Auswahl → Ebene
   „Timeline“ im Nodes-Panel, Breadcrumb-Navigation, Time-Node links, Video-Stack und
   Master, Timeline Output rechts, Spur-Nodes am Zeilenende, Clips als eingeklappte
   Nodes mit Mini-Balken, Layout nach Zeit/Spur, LOD für große Timelines, kompakte
   Agent-Ansicht des Timeline-Graphen.
2. **Clip aufklappbar** in Media → Slice → Speed → Place als Write-through auf die
   bestehenden Clip-Felder; ein Media-Node für mehrere Slices.
3. **Audio-Routing editierbar:** Bus-Entitäten, Sends als Kabel, Track/Master-FX als Nodes.
4. **Transitions und Zeit-Effekte als Nodes** (Speed, Freeze, Loop, Warp).
5. **Zeit-Werte als Ports + Verteiler:** Keyframe-/LFO-/Math-/Beat-Quellen auf
   Zeit-Parameter, Uhren (clip-lokal, Timeline, Quelle, Instanz i, Abspielzeit t),
   Verteiler mit virtuellen Instanzen, Materialize, Korrekturen pro Instanz,
   „gesteuert“-Markierung in der Timeline. Jeder Operator ist ein atomares,
   deterministisches Editor-Tool mit einem Undo-Schritt; mehrstufige Orchestrierung
   liegt laut ADR-001 im Kernel.
6. **Live-Mode:** Vorausplanung (Decoder vorwärmen, Pipelines vorkompilieren, Speicher
   reservieren), Show-Prüfer, Cue = Container mit eigener Uhr, Anbindung Slot Grid;
   Effekt-Ketten-Fusion über den Operator Graph Compiler.
7. **Video-Spur-Effekte** (Spur einzeln rendern, nur bei Spuren mit FX).
8. **Später/optional:** Cross-Clip-Compositing als Datenfluss.

## Empfehlungen (noch nicht vom Nutzer bestätigt)

- Zeit-Operatoren bleiben **dauerhaft verbunden**; das Ergebnis wird immer in
  Clip-Felder bzw. Zeit-Abbildungen kompiliert.
- Manuelles Ziehen eines gesteuerten Clips speichert eine **Korrektur pro Instanz** am
  steuernden Node (überlebt Regeländerungen); Materialize löst Instanzen komplett.

## Offene Entscheidungen

- Busse: eigene Spurart in der Timeline oder nur im Graph/Mixer sichtbar?
- Darstellung von Uhr-t-gesteuerten Clips (Time-Warp) in der Timeline: Bereich mit
  Kurve – genaue Gestaltung offen.
- Limits für virtuelle Instanzen (Anzahl, Decode-Budget) im Normal- und Live-Mode.
