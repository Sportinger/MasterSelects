# Agent Timeline Analysis Index

Status: Planung und Kostenprüfung  
Stand: 2026-07-26  
Ziel: Ein schneller, versionierter und bereichsweise abfragbarer Analyseindex,
der einem Agenten sagt, **wann was im Bild und Ton passiert**, ohne das gesamte
Video oder alle Screenshots in den Kontext laden zu müssen.

## 1. Entscheidung

MasterSelects bekommt logisch **eine gemeinsame Agent Timeline**, physisch aber
keine immer weiter wachsende monolithische JSON-Datei.

Stattdessen besteht sie aus:

1. einem kleinen, versionierten Manifest pro Quelldatei,
2. bereits vorhandenen sowie neuen Analyse-Sidecars,
3. einer zusammengeführten, zeitlich begrenzten Query-Ansicht für Agenten,
4. einer Projektion von Quellzeit auf Clip- und Composition-Zeit,
5. einem visuellen Analysis Workspace mit kompakter Multi-Lane-Timeline und
   synchronisierten Szenenkarten einschließlich Transkript.

Das ist nach außen die gewünschte „eine JSON-Timeline“, bleibt intern aber
inkrementell aktualisierbar. Schnitte neu zu analysieren invalidiert dadurch
nicht Transkript, Gesichter, OCR oder Audio-Artefakte.

Bildinhalt und Rohquellen-Audio liegen dauerhaft in **Quellzeit**. Trimmen,
Slip, Geschwindigkeit, Reverse, Wiederverwendung derselben Datei und mehrere
Clips werden erst beim Abfragen auf die Timeline projiziert. Audio- oder
Qualitätsereignisse, die Gain, Speed, Clip-FX oder Composition-Mix bewerten,
haben dagegen ausdrücklich die Domäne `clip-rendered` oder
`composition-rendered` plus State-Hash. So wird Quellenanalyse nicht unnötig
pro Clip-Instanz wiederholt, ohne gerenderte Zustände fälschlich als
Quellwahrheit zu behandeln.

## 2. Warum das günstig erreichbar ist

Ein großer Teil der nötigen Rohdaten existiert bereits:

| Vorhandene Fähigkeit | Heutiger Stand | Günstige Erweiterung |
|---|---|---|
| Schnitte | framegenau, 160×90, Proxy-Piggyback und separater Scan | Shot-Grenzen und repräsentative Frame-Zeitpunkte in den Index übernehmen |
| Fokus und Bewegung | 2 fps in `clipAnalyzer`; CPU-Fallback mit regionalen Metriken | vorhandene Samples in Zeitspannen verdichten |
| Optical Flow | WebGPU berechnet bei 160×90 mittlere X/Y-Bewegung, Kohärenz, Abdeckung und Richtungshistogramm, verwirft sie aber im heutigen `MotionResult`; der CPU-Fallback hat keine Richtung | persistierbares Resultat und CPU-Parität entwickeln, dann zu Pan/Tilt/Static aggregieren |
| Gesichter | YuNet-Boxen und Landmarks, SFace-Gruppierung, Appearance-Ranges; Continue über getrennte Ranges ist wegen kollidierender Personen-IDs derzeit deaktiviert | Bildaufteilung direkt ableiten; für partielle Ranges zuerst Identity-Merge definieren |
| Transkript | Wörter, Zeitpunkte, Sprecher, Konfidenz und Provenienz; derzeit als vollständige Datei gelesen | Sprecherwechsel projizieren und für lange Quellen range-fähig indizieren |
| Audio | persistierte Waveform-Pyramide, Loudness Envelope, Peaks und Spektrogramm; Silence/Transient sind bisher Helfer, keine eigenen Sidecars | vorhandene Artefakte nutzen; Silence/Transienten nur nach gemessenem, wiederverwendbarem Extraktionspfad |
| Analyse-Cache | mehrere versionierte Artefakte, aber uneinheitliche Fingerprints und teils monolithische JSON-Dateien | gemeinsamer Manifest-/Shard-Index mit Adaptern, nicht bloß ein Verweis auf die alten Dateien |

Der wichtigste Architekturgrundsatz lautet deshalb:

> **Einmal dekodieren, viele Merkmale ableiten.**

Ein Decode-Coordinator verteilt Frames gemäß der benötigten Kadenz: Der
framegenaue Cut-Scan sieht jeden Frame, teurere Metriken bekommen nur ihre
1-/2-fps-Samples oder vorgefilterte Kandidaten. Treffen Zeitpunkte zusammen,
verwenden alle Consumer denselben kleinen Frame. Ein gemeinsamer Audio-Decode
speist Loudness, Peaks, Stille, Spektralmerkmale und optionale Klassifikation.
Reine Fusion startet überhaupt keinen Decode.

### 2.1 Architektur-Voraussetzungen

„Günstig“ gilt für viele **Merkmale**, noch nicht automatisch für ihre heutige
Speicherung und Zusammenführung. Vor der ersten Agent-Query müssen vier
Grundlagen gelöst werden:

1. **Range-Speicher:** Focus/Faces und Transcript werden heute als vollständige
   JSON-Dateien gelesen. Lange Quellen brauchen zeitlich sortierte Shards plus
   kleinen Intervallindex. Ein Adapter darf alte Artefakte weiter lesen; neue
   60-Minuten-Analysen dürfen nicht bei jeder Range-Query komplett geparst
   werden.
2. **Kanonische Projektion:** Source→Timeline ist one-to-many. Variable
   Speed-Keyframes können Richtung wechseln oder bei Speed 0 stehen,
   Transition-Comps haben eigene Source-Maps, Nested Comps erzeugen Pfade, und
   mehrere Quellen können gleichzeitig sichtbar sein. Ein zentraler Mapper
   erzeugt deshalb Mapping-Segmente und `occurrenceId`/`compositionPath`, statt
   jedes Ereignis per Sampling einzeln zu invertieren.
3. **Face-Identity über Shards:** Runtime-SFace-Embeddings reichen nicht für
   resumierbare Ranges. Vorher ist zu entscheiden: lokal gespeicherte,
   datenschutzklar dokumentierte Identity-Prototypen mit ID-Remap, oder
   sourceweite Re-Clusterung. Bis dahin ist der Face-Kanal nicht partiell
   resumierbar.
4. **Source Identity:** Die bestehenden Caches verwenden unterschiedliche
   Fingerprints. Ein gemeinsamer Dienst erzeugt zunächst einen günstigen
   Fingerprint aus Metadaten plus gestreamt gelesenen Sample-Chunks und
   optional einen starken gestreamten Vollhash. Große Dateien dürfen dafür
   nicht vollständig per `arrayBuffer()` im RAM materialisiert werden.

Diese Grundlagen sind Phase 0B und Teil des Kostenbenchmarks, keine später
verdeckte Infrastrukturarbeit.

## 3. Was ausdrücklich nicht in den Standardlauf gehört

- keine semantische Beschreibung jedes Frames,
- kein Vision-Language-Modell über das vollständige Video,
- kein OCR auf jedem Frame,
- keine Active-Speaker-Neuralanalyse über Bereiche mit nur einer Person oder
  ohne Sprache,
- keine Screenshots oder Base64-Bilder im Agent-JSON,
- kein vollständiger Neulauf, wenn kompatible Artefakte im Cache liegen,
- keine versteckte Hochskalierung der 160×90-Analyse auf Originalauflösung.

Semantische „Szenen“ können zunächst günstig aus Schnitten, wiederkehrenden
Kamera-Setups, Sprecherwechseln, längerer Stille und Musikwechseln zu
Scene-Blocks gruppiert werden. Ein Sprach- oder Vision-Modell kann später
optional **nur einen ausgewählten Bereich** mit wenigen Schlüsselbildern
zusammenfassen.

## 4. Granularität und Analyseprofile

Granularität muss auf vier Ebenen einstellbar sein:

### 4.1 Bereich

- gesamte Quelldatei,
- nur verwendete Bereiche einer Quelldatei,
- ausgewählte Clips,
- In/Out-Bereich der Timeline,
- einzelne Shots oder eine konkrete Zeitspanne.

Standard für interaktive Nachanalyse ist die aktuelle Auswahl. „Analyze All“
analysiert alle noch fehlenden Bereiche, nicht blind alle Dateien neu.

### 4.2 Zeitliche Dichte

| Kanal | Quick | Balanced | Deep |
|---|---:|---:|---:|
| Schnitte | framegenau, bestehender 160×90-Scan | wie Quick | wie Quick |
| Fokus/Helligkeit/Bewegung | 1 fps | bestehende 2 fps | 4–5 fps nur in Kandidatenbereichen |
| Gesichter | Cache verwenden; sonst 0,5–1 fps, zunächst sourceweit | bestehende 2 fps, zunächst sourceweit | höhere Dichte nur nach Identity-/Range-Gate |
| Kamera-Bewegung | 1 fps vorhandene richtungslose Metrik; Richtung nur bei Plattform-Support | 2 fps nach CPU/WebGPU-Paritätsgate | lokal höher nur an unklaren Übergängen |
| Audio-Hüllkurve | vorhandene Pyramide bzw. grobe Fenster | vorhandenes 0,1-s-Hop-Artefakt | höhere Dichte nur für Diagnose |
| OCR | aus | ein Schlüsselbild pro Shot | Shot-Anfang/Mitte/Ende und nur bei Bildänderung |
| Active Speaker | deterministische Sichtbarkeitsheuristik | wie Quick, mit wiederholten eindeutigen Zuordnungen | A/V-synchrone Mundbewegung oder kleines Modell nur in mehrdeutigen Sprachspannen |
| Audio-Klassen | aus | günstige Heuristiken | optionales kleines Audio-Modell |

Die Werte sind Startkonfigurationen, keine unveränderlichen Konstanten. Ein
Custom-Profil darf Sampling-Rate, Kanäle, räumliche Auflösung und Bereich
einzeln setzen.

### 4.3 Räumliche Auflösung

- 160×90 bleibt Standard für Schnitte, globale Bewegung, Fokus, Helligkeit,
  Freeze und grobe Hashes.
- Gesichtserkennung verwendet ihren bestehenden Analysepfad.
- OCR darf gezielt einen Original- oder Proxy-Keyframe verwenden, aber nie
  einen kontinuierlichen Full-Resolution-Scan.
- Mundbewegung schneidet nur kleine Face-ROIs aus. Das reduziert
  Inferenzkosten, ersetzt aber nicht den nötigen Quellframe-Decode.

### 4.4 Ergebnisdetail

Agent-Abfragen unterscheiden:

- `summary`: verdichtete Scene-Blocks und Warnungen,
- `shot`: ein Datensatz pro Shot,
- `event`: überlappende Sprach-, Personen-, Audio-, OCR- und Qualitätsereignisse,
- `sample`: Rohsamples nur für Diagnose und einen kleinen Zeitbereich.

### 4.5 Bedienung und Kostenvorschau

Der Analysis-Bereich bekommt oberhalb der Kanalbuttons:

- Scope: Source / Used Ranges / Selection / In-Out,
- Profil: Quick / Balanced / Deep / Custom,
- eine kompakte Kostenvorschau,
- `Analyze All` sowie einzelne Kanalbuttons,
- mindestens zwei Button-Spalten bei ausreichender Breite.

Vor dem Start berechnet ein read-only `AnalysisEstimate`:

- gesamte und noch nicht gecachte Quelldauer,
- Anzahl framegenauer Cut-Frames,
- Anzahl sparsamer Metrik- und Face-Samples,
- erwartete OCR-Keyframes,
- wiederverwendbare Artefakte,
- erforderliche Modell-/Sprachpaket-Downloads,
- relative Kostenklasse und, nach Phase 0, eine Zeitspanne aus realen
  Benchmarks desselben Geräts.

Die Schätzung darf Analyse nicht bereits heimlich starten. Bei einem Warm Cache
muss sichtbar sein, dass nur Fusion oder fehlende Ranges laufen.

## 5. Kosten- und Laufzeit-Gates

Vor der Implementierung neuer ML-Kanäle wird in Phase 0 ein reproduzierbares
Benchmark-Korpus angelegt. Absolute Versprechen wären vorher geraten. Gemessen
werden:

- Wall Time und Verhältnis zur Mediendauer,
- Verhältnis zum heutigen Standalone-Scene-Cut-Lauf und separat zum
  Proxy-Piggyback-Lauf,
- CPU-, GPU- und Peak-Memory-Nutzung,
- Fingerprint-I/O und Peak Memory bei großen Quelldateien,
- sequenzieller Decode gegen heutiges seek-basiertes Sparse Sampling,
- Cold Cache gegen Warm Cache,
- Artefaktgröße pro Videominute,
- gecachte Range-Query-Latenz inklusive Shard-Parse und Timeline-Projektion,
- A/V-Synchronität und nötige Kandidaten-Framerate für Active Speaker,
- Windows sowie Linux/Mesa-Software-Fallback,
- kurze, 10-minütige und mindestens 60-minütige Quellen.

Vorgeschlagene relative Budgets:

| Profil | Budget | Produktverhalten |
|---|---|---|
| Quick | höchstens 1,25× der passenden Baseline: Standalone-Cut-Scan oder Proxy-Lauf mit Piggyback | interaktiv, Standard für schnelle Orientierung |
| Balanced | höchstens 2× derselben passenden Baseline | Standard-Hintergrundanalyse |
| Deep | höchstens 5×; darf pausierbar im Hintergrund laufen | explizit gewählt, nicht automatisch |

Cloud-Transkription wird separat ausgewiesen, weil Upload, Provider-Laufzeit und
Kosten nicht mit lokalem Decode vergleichbar sind.

Ein Kanal darf erst in `Balanced`, wenn er auf dem Referenzkorpus sein Budget
einhält und keine unkontrollierte Speicherzunahme zeigt. Schafft er das nicht,
bleibt er `Deep`, On-Demand oder experimentell.

Weitere harte Gates:

- Warm-Cache-Läufe dekodieren keine bereits vollständig abgedeckten Bereiche.
- Jobs sind abbrechbar, resumierbar und melden Fortschritt pro Kanal.
- Standardabfragen liefern höchstens 500 Events und 256 KiB; danach Cursor.
- Keine Agent-Antwort enthält ungefragt Bilder.
- Analyseartefakte tragen Schema-, Analyzer- und Modellversion.
- Artefakte tragen `timeDomain` und bei gerenderten Zuständen den relevanten
  Clip-/Composition-State-Hash.
- Coverage und fehlende Bereiche sind explizit; fehlende Analyse wird nie als
  „kein Ereignis vorhanden“ ausgegeben.

## 6. Die acht Analysekanäle

### 6.1 Sprecher ↔ sichtbare Person / Active Speaker

Das ist die wichtigste noch fehlende Verknüpfung: Ein Transkript kennt
„Speaker 2“, die Face-Analyse kennt „Person 2“, aber beide Identitäten sind
noch nicht zuverlässig verbunden.

Gestufter Pfad:

1. **Deterministisch:** Kein Gesicht bedeutet off-screen. Genau ein stabiles
   Gesicht während eines Sprechersegments erlaubt eine vorläufige Zuordnung.
   Wiederholte eindeutige Überlappungen erhöhen die Konfidenz.
2. **Experimentelle ROI-Heuristik:** Nur wenn mehrere Gesichter gleichzeitig
   sichtbar sind, wird Mund-/Untergesichtsbewegung rund um vorhandene
   Face-Landmarks mit dem Sprachsignal verglichen. Die bestehenden 2 fps sind
   dafür nicht robust genug. Kandidaten-Framerate, A/V-Sync und
   Sequenzialdecode werden zuerst benchmarkiert; Face-ROIs sparen
   Inferenzfläche, aber nicht den Frame-Decode.
3. **Optionales Modell:** Nur noch unklare Sprachspannen werden einem kleinen
   Active-Speaker-Modell übergeben. Auch dieser Pfad ist `Deep`, nicht
   `Balanced`.

Light-ASD ist ein möglicher später Kandidat: Das offizielle Projekt beschreibt
ein gegenüber TalkNet deutlich kleineres Modell mit 1,0 Mio. Parametern und
ähnlicher AVA-ActiveSpeaker-Genauigkeit. Der veröffentlichte Pfad ist jedoch
Python/PyTorch-zentriert; ONNX-/Browser-Konvertierung, reale Geschwindigkeit
und Modelllizenzierung müssen vor einer Produktentscheidung separat geprüft
werden. Quellen: [Light-ASD Repository](https://github.com/Junhua-Liao/Light-ASD),
[Paper](https://arxiv.org/abs/2303.04439).

Ergebnis:

- `speakerId`,
- `personId` oder `offscreen`,
- `start`, `end`,
- `confidence`,
- `method: single-face | mouth-motion | model | manual`,
- widersprüchliche Kandidaten.

### 6.2 Wiederkehrende Kamera-Setups

Das ist für Interviews, Shot/Reverse-Shot und Takes sehr wertvoll und sehr
günstig:

- ein repräsentativer Frame pro Shot,
- perceptual/difference hash,
- grobes YCbCr-Farbhistogramm,
- Face-Layout-Signatur aus Anzahl, Position und Größe,
- optional grobe Edge-/Kompositionssignatur.

Diese Signaturen werden geclustert. Dadurch entstehen IDs wie `setup-A`,
`setup-B`, `wide-1`, ohne jeden Frame semantisch zu verstehen. Kandidaten in
benachbarten Shots und sehr kurze Übergangsshots brauchen stärkere Schwellen,
damit ähnliche Gesichter nicht automatisch dasselbe Setup bedeuten.

### 6.3 Shot-Größe und Bildaufteilung

Aus bestehenden Face-Boxen lassen sich günstig ableiten:

- extreme close-up, close-up, medium, medium-wide,
- single, two-shot, group,
- Person links/zentral/rechts,
- Headroom und Randnähe,
- relative Gesichtsgröße und dominantes Gesicht.

Ohne verlässlich erkanntes Gesicht bleibt die Shot-Größe `unknown`. Ein
No-Face-Shot darf nicht automatisch als Wide Shot bezeichnet werden. Eine
spätere Körper-/Pose-Erkennung wäre ein eigener optionaler Kanal, nicht Teil
des ersten Plans.

### 6.4 Kamera-Bewegung

Der vorhandene 160×90-WebGPU-Optical-Flow berechnet schon mittlere
X/Y-Bewegung, Richtungskohärenz und Bewegungsabdeckung. Diese Werte werden
heute nicht vollständig im Analyseartefakt behalten; das Direction Histogram
wird sogar gelesen und verworfen. Der CPU-/Mesa-Fallback hat nur regionale
Differenzstatistik und keine Richtung. Außerdem verursacht der WebGPU-Pfad pro
Sample ein synchronisierendes GPU-Readback.

Günstig ableitbar:

- static,
- pan left/right,
- tilt up/down,
- gleichförmige globale Bewegung,
- unruhig/handheld als geringe Richtungskohärenz mit hoher lokaler Aktivität.

Zoom/Dolly ist schwieriger und wird zunächst nur bei klarer radialer
Expansion/Kontraktion ausgegeben. Rack Focus ist ein Fokusereignis, keine
Kamerabewegung. Unsichere Fälle bleiben `unknown`. „Nahezu kostenlos“ gilt für
die Klassifikation aus bereits vorhandenen WebGPU-Werten, nicht automatisch
für CPU-Parität oder eine höhere Sampling-Dichte.

### 6.5 Audio-Timeline

Die vorhandenen persistenten Waveform-, Loudness-, Peak- und
Spektrogramm-Artefakte liefern bereits:

- Sprache aus dem Transkript,
- Lautheit und Dynamik,
- Clipping-/Peak-Warnungen,
- grobe Musik-/Ambience-/Noise-Kandidaten.

Silence- und Transient-Detektoren existieren, ihre Ergebnisse sind aber noch
keine wiederverwendbaren Sidecars; die heutigen Helfer extrahieren und trimmen
ein vollständiges `AudioBuffer`. Phase 0 misst deshalb, ob diese Merkmale aus
einem gemeinsamen Decode oder bestehenden kompakten Artefakten gewonnen und
persistiert werden können.

Rohquellen-Clipping und Quellstille gehören in `source`. Warnungen nach Gain,
Speed, Clip-FX oder Composition-Mix gehören mit State-Hash in
`clip-rendered` beziehungsweise `composition-rendered`.

`speech`, `music`, `noise`, `applause` oder ähnliche semantische Klassen dürfen
im ersten Schritt heuristisch und mit niedriger Konfidenz markiert werden.
YAMNet ist ein optionaler Deep-Kandidat: Das offizielle Modell arbeitet auf
16-kHz-Mono-Audio und liefert Scores für 521 AudioSet-Klassen sowie Embeddings.
Es wäre aber ein zusätzlicher TensorFlow-/Modellpfad und gehört erst nach einem
Browser-Benchmark ins Produkt. Quellen:
[TensorFlow YAMNet Tutorial](https://www.tensorflow.org/hub/tutorials/yamnet),
[offizielle YAMNet-Dokumentation](https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/README.md).

### 6.6 Qualitätsprobleme

Günstige Warnungen:

- unscharf / Fokusabfall,
- schwarz oder nahezu schwarz,
- über- oder unterbelichtet,
- eingefrorenes Bild über wiederholte Hashes,
- starke globale Erschütterung,
- Audio-Clipping,
- ungewöhnlich leise Bereiche,
- lange unerwartete Stille,
- Dropout-Kandidaten.

Moderate Erweiterungen:

- Rauschen/SNR aus spektralen Statistiken,
- Flicker über periodische Helligkeitsänderung,
- Kompressions-/Blockartefakte nur mit vorsichtiger Konfidenz.

Warnungen sind Vorschläge, keine automatischen Löschentscheidungen. Jeder
Datensatz enthält Messwert, Schwelle, Dauer und Analyzer-Version.

### 6.7 OCR / Text im Bild

OCR ist im Verhältnis zu den anderen Kanälen teuer. Deshalb:

- standardmäßig höchstens ein repräsentativer Keyframe pro Shot,
- weitere Frames nur, wenn sich Textregion oder Bildhash relevant ändert,
- zeitlich identische Texte deduplizieren und zu Spannen verbinden,
- Crop/ROI vor OCR, wenn eine Textregion erkannt werden kann,
- Sprache und Modellpaket explizit konfigurierbar,
- kein OCR auf 160×90, wenn lesbarer Text eine höhere Auflösung benötigt,
- kein OCR auf jedem Frame.

Tesseract.js ist als optionaler Browser-/Worker-Pfad plausibel, weil es
Tesseract als WebAssembly in Browser und Node ausführt. Sprach- und Core-Daten
sollten für reproduzierbare Offline-Nutzung selbst gehostet werden. Quellen:
[Tesseract.js](https://github.com/naptha/tesseract.js/),
[lokale Installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).

Ergebnis:

- normalisierter Text und Originaltext,
- Bounding Box,
- Start/Ende der Sichtbarkeit,
- Konfidenz und Sprache,
- `kind: subtitle | title | lower-third | sign | unknown`,
- Referenz auf den analysierten Keyframe-Zeitpunkt.

Die `kind`-Klassifikation beginnt regelbasiert über Position, Dauer und
Wiederholung; sie behauptet keine semantische Sicherheit.

### 6.8 Redundanz und Takes

Günstige Kandidatenerkennung kombiniert:

- wiederkehrendes Kamera-Setup,
- ähnliche Dauer und Shot-Abfolge,
- Transkript-Ähnlichkeit über Wort-N-Gramme/MinHash,
- gleiche oder ähnliche Schlüsselbild-Hashes,
- dieselben sichtbaren Personen,
- zeitliche Nähe im Rohmaterial.

So können `takeGroupId`, `duplicateGroupId`, Versprecher-/Restart-Kandidaten und
nahezu identische B-Roll-Shots entstehen. Semantische Text- oder Bild-Embeddings
sind optionale Verfeinerung, nicht Voraussetzung.

Die Funktion gruppiert nur. Welcher Take „der beste“ ist, braucht transparente
Kriterien wie Fokus, Audioqualität, Vollständigkeit und manuelle Bewertung.

## 7. Gemeinsames Datenmodell

Das Manifest referenziert vorhandene Artefakte und kleine neue Event-Sidecars:

```ts
interface AgentTimelineManifest {
  schemaVersion: number;
  mediaFileId: string;
  sourceIdentity: {
    strategyVersion: number;
    size: number;
    lastModified: number;
    sampledHash: string;
    strongHash?: string;
  };
  duration: number;
  generatedAt: string;
  profile: 'quick' | 'balanced' | 'deep' | 'custom';
  channels: Record<AgentTimelineChannel, {
    status: 'missing' | 'partial' | 'complete' | 'stale' | 'failed';
    artifacts: Array<{
      artifactRef: string;
      analyzerId: string;
      analyzerVersion: string;
      modelId?: string;
      profile: 'quick' | 'balanced' | 'deep' | 'custom';
      timeDomain: 'source' | 'clip-rendered' | 'composition-rendered';
      stateHash?: string;
      coverage: Array<{ start: number; end: number }>;
    }>;
    error?: string;
  }>;
}
```

`artifactRef` zeigt auf einen zeitlich begrenzten Shard, nicht zwingend auf
eine vollständige Analyse. Der Intervallindex wählt nur überlappende Shards.
Mehrere Profile, Analyzer-Versionen und partielle Ranges können nebeneinander
existieren; die Query wählt deterministisch die kompatibelste Abdeckung.

Alle zusammengeführten Ereignisse folgen einem kleinen gemeinsamen Kern.
Punkt- und Intervallereignisse sind getrennt, damit ein Cut bei halb-offener
Range-Logik nicht verloren geht:

```ts
type AgentEventTime =
  | {
      temporalKind: 'point';
      timeDomain: 'source' | 'clip-rendered' | 'composition-rendered';
      time: number;
      stateHash?: string;
    }
  | {
      temporalKind: 'interval';
      timeDomain: 'source' | 'clip-rendered' | 'composition-rendered';
      start: number;
      end: number;
      stateHash?: string;
    };

interface AgentTimelineEventBase<TType, TData> {
  id: string;
  type: TType;
  time: AgentEventTime;
  confidence: number;
  provenance: Array<{
    analyzerId: string;
    analyzerVersion: string;
    artifactRef?: string;
  }>;
  keyframeSourceTime?: number;
  data: TData;
}

type AgentTimelineEvent =
  | AgentTimelineEventBase<'cut', CutEventData>
  | AgentTimelineEventBase<'shot', ShotEventData>
  | AgentTimelineEventBase<'scene-block', SceneBlockEventData>
  | AgentTimelineEventBase<'speech', SpeechEventData>
  | AgentTimelineEventBase<'person-visible', PersonVisibleEventData>
  | AgentTimelineEventBase<'active-speaker', ActiveSpeakerEventData>
  | AgentTimelineEventBase<'camera-motion', CameraMotionEventData>
  | AgentTimelineEventBase<'audio-activity', AudioActivityEventData>
  | AgentTimelineEventBase<'quality-issue', QualityIssueEventData>
  | AgentTimelineEventBase<'onscreen-text', OnscreenTextEventData>
  | AgentTimelineEventBase<'duplicate-group', DuplicateGroupEventData>;
```

Die konkrete Implementierung verwendet also eine discriminated union mit
kanalspezifischen Daten, keine unkontrollierte allgemeine Payload-Ablage.
Eine Point-Query enthält `start <= time < end`; ein Interval überlappt bei
`event.start < end && event.end > start`.

`confidence` sagt, wie sicher eine Aussage ist. `coverage` sagt, welcher Bereich
überhaupt geprüft wurde. Beides darf nicht vermischt werden.

Runtime-Handles wie `File`, `Blob`, Object URLs, Media-Elemente, `VideoFrame`,
`ImageBitmap` oder GPU-Objekte bleiben außerhalb des dauerhaften Schemas.

### 7.1 Manuelle Korrekturen

Generierte Analyse und Nutzerentscheidungen liegen in getrennten Layern:

- Analyzer-Sidecars dürfen jederzeit passend zu ihrer Version neu entstehen.
- Manuelle Zuordnungen, Ausschlüsse, Labels und bestätigte Take-Gruppen liegen
  in einem kleinen Annotation-Sidecar.
- Die Query fusioniert beide Ebenen; eine gültige manuelle Korrektur hat
  Vorrang und trägt `provenance: manual`.
- Reanalyse überschreibt keine bestätigte Sprecher↔Person-Zuordnung.
- Ist die Source-Identity-Zuordnung nicht mehr gültig, wird die Annotation als
  verwaist gemeldet, nicht still gelöscht.

Face-Tracks innerhalb einer Datei und projektweite Personenidentitäten bleiben
getrennte IDs. Ein projektweites Zusammenführen ist eine explizite, korrigierbare
Operation und kein stiller Nebeneffekt von SFace-Ähnlichkeit.

## 8. Agent-API und Screenshot-Politik

Die primäre Abfrage ist bereichsbegrenzt und paginiert:

```ts
getAgentTimeline({
  scope: {
    compositionId,
    compositionPath,
    clipId,
  },
  start: 38,
  end: 74,
  timeDomain: 'composition',
  granularity: 'shot',
  channels: [
    'shots',
    'speech',
    'people',
    'cameraMotion',
    'audio',
    'quality',
  ],
  includeFrames: false,
  limit: 200,
})
```

`start` und `end` sind niemals implizit: `timeDomain` ist
`source | clip-local | composition`.

Eine Source-Spanne kann null-, ein- oder mehrfach in der angefragten
Composition erscheinen. Die Antwort enthält deshalb nicht nur ein Zeitpaar,
sondern `occurrences[]` mit:

- stabiler `occurrenceId`,
- `compositionPath` durch Nested Comps,
- `mappingSegmentId`,
- projiziertem Punkt oder Teilintervall,
- Richtung und lokaler Geschwindigkeit,
- Referenz auf das kanonische Source- oder Rendered-Event.

Variable Speed, Richtungswechsel, Speed 0 und Transition-Source-Maps teilen
Ereignisse bei Bedarf in mehrere Occurrences. Der autoritative Mapper baut
stückweise Mapping-Segmente einmal pro Timeline-State-Hash und führt danach
Intervall-Joins aus; er invertiert nicht jedes der bis zu 500 Ereignisse erneut
über grobes Sampling.

Antworten enthalten:

- kanonische Event-Zeiten plus alle passenden projizierten Occurrences,
- überlappende Ereignisse,
- Coverage und fehlende Kanäle,
- repräsentative `keyframeSourceTime`-Werte,
- Cursor und Truncation-Information.

Ergänzende Tools:

- `getAgentTimelineCoverage`
- `getAgentTimelineOverview`
- `getAgentSceneDetails`
- `estimateAgentTimelineAnalysis`
- `startAgentTimelineAnalysis`
- `cancelAgentTimelineAnalysis`
- `getAgentTimelineAnalysisStatus`
- vorhandene Frame-Abfrage für konkrete Zeitpunkte

Screenshots werden nicht im Index gespeichert oder ungefragt an einen Agenten
geschickt. Für einen bearbeiteten Bereich fordert der Agent gezielt wenige
Frames an, zum Beispiel Shot-Keyframes mit einem Standardmaximum von acht pro
Aufruf. Der Index sagt ihm, **welche Zeitpunkte relevant sind**.

## 9. Analysis Workspace: visuelle Timeline und Szenenansicht

Die Agent Timeline ist nicht nur ein Maschinenformat. Der Analysis-Tab wird
zur menschlich lesbaren Hauptansicht derselben zusammengeführten Daten:

```text
┌ Analysis actions / scope / profile / cost estimate ┐
├ Compact Analysis Timeline                          ┤
│ Scenes │ Speech │ People │ Motion │ Quality │ Audio│
├ Current/selected scene                             ┤
│ keyframe · time · setup · camera · quality         │
│ clickable people · active/off-screen speaker       │
│ optional description · OCR · other observations   │
│ synchronized transcript with word highlighting    │
└ Virtualized scene list / filters / search          ┘
```

Es gibt damit eine gemeinsame visuelle Wahrheit für Nutzer und Agenten. Die UI
berechnet keine zweite Interpretation der Daten, sondern liest dieselbe
range-begrenzte Fusionsansicht.

### 9.1 Compact Analysis Timeline

Die Mini-Timeline ist ein eigener `AnalysisOverviewTimeline`, nicht eine
Erweiterung der bestehenden `timeline/MiniTimeline.tsx`: Diese zeichnet
Composition-Clip-Rechtecke für Slot-Miniaturen, während die neue Ansicht
zeitbasierte Analyse-Lanes, Dichtewerte und Selektion darstellen muss.

Vorgesehene Lanes:

| Lane | Darstellung bei Zoom-in | Darstellung bei Zoom-out |
|---|---|---|
| Scenes/Shots | Scene-Blocks, Shot-Grenzen, Cut-Marker | zusammengefasste Scene-Blöcke und Cut-Dichte pro Pixel |
| Speech | Sprechersegmente und Wortgrenzen | Sprachabdeckung und Sprecherfarben |
| People | Presence-Ranges, Active-Speaker-Markierung | belegte Zeit und dominante Personen |
| Camera/Motion | Pan/Tilt/Static-Spannen und Motion-Kurve | Min/Max/Avg-Envelope pro Pixel |
| Focus/Quality | Fokuskurve und einzelne Warnungen | Qualitätsseverity und Problem-Dichte |
| Audio | Loudness, Stille, Musik/Noise-Kandidaten | Loudness-Envelope und Aktivitätsklassen |
| Text | OCR-Spannen und Description-Verfügbarkeit | Marker-/Textdichte |

Nicht jeder Kanal braucht permanent eine eigene hohe Lane. Nutzer können Lanes
ein-/ausblenden; auf schmalen Panels werden verwandte Lanes gestapelt oder zu
`Visual`, `People/Text` und `Audio` verdichtet.

Interaktionen:

- Klick setzt den Playhead.
- Klick auf einen Scene-Block selektiert die zugehörige Szenenkarte.
- Drag erzeugt einen temporären Analyse-/Reanalyse-Bereich.
- Wheel/Trackpad zoomt um den Cursor; horizontales Draggen verschiebt den
  sichtbaren Bereich.
- Hover zeigt Zeit, Scene, Sprecher, Personen und Warnungen am Punkt.
- Playhead, ausgewählte Szene und Kartenliste bleiben synchron.
- Auto-Follow pausiert, sobald der Nutzer manuell scrollt oder eine Szene
  festpinnt.

Die Übersicht lädt niemals alle Rohereignisse einer langen Quelle. Dafür
liefert:

```ts
getAgentTimelineOverview({
  scope,
  start,
  end,
  timeDomain: 'composition',
  widthPx,
  visibleLanes,
})
```

eine auf die sichtbare Pixelbreite begrenzte Antwort:

- Scene-/Shot-Spannen,
- pro X-Bin aggregierte Min/Max/Avg-Werte,
- Count-/Severity-Dichten,
- koaleszierte Presence-/Speech-Ranges,
- Coverage- und Missing-Overlays,
- aktiver Playhead/Selection werden lokal darüber gezeichnet.

Für dichte numerische Kanäle entsteht analog zur vorhandenen
Waveform-Pyramide eine lazy erzeugte **Overview-Tile-Pyramide**:

- höhere Level fassen jeweils benachbarte Bins zusammen,
- pro Bin bleiben Min/Max/Avg, Count, höchste Severity und dominante Klasse,
- die Query wählt das Level mit ungefähr einem Bin pro sichtbarem Pixel,
- neue oder invalidierte Analyse-Shards erneuern nur überlappende Tiles,
- sparse Intervallkanäle bleiben im Intervallindex und werden koalesziert,
- Warm-Cache-Zoom/Pan liest nur die betroffenen Tiles.

Overview-Tiles sind rebuildbare Derived Caches, keine neue Datenwahrheit. Ihr
Key enthält Input-Artefakt-IDs, Reducer-Version, Kanal und Zeitdomäne.

Damit kostet „gesamte 60 Minuten anzeigen“ nicht das Laden aller 2-fps-Samples,
Transcript-Wörter oder Face-Appearances.

Mehr als ein Ereignis pro Pixel wird gebinnt, nicht übereinander gemalt. Die
Canvas-Backing-Store-Größe bleibt auf sichtbaren Viewport plus Overscan und
maximal 8192 Pixel pro Dimension begrenzt. Linux/Mesa verwendet
`prefersSoftwareTimelineCanvas()` und einen echten Main-Thread-2D-Fallback.
Worker-Canvas ist nur Optimierung. Ein DOM/SVG-Overlay stellt Fokus, Tooltips
und zugängliche Interaktionsziele bereit.

### 9.2 Szenenhierarchie

Eine „Szene“ in dieser UI ist ein günstiger `scene-block`, der einen oder
mehrere Shots enthalten kann. Wenn Scene-Blocks noch fehlen, fällt die Ansicht
deterministisch auf einen Eintrag pro Shot zurück. Es wird nie künstlich auf
eine teure AI-Szenerkennung gewartet.

Unterschiedliche Analysegrenzen müssen nicht identisch sein:

- Transcript-Wörter werden per Zeitüberlappung zugeordnet.
- Personen und Active Speaker behalten ihre eigenen Presence-Ranges.
- vorhandene AI-Descriptions können über mehrere Shots reichen.
- OCR- und Audioereignisse werden als überlappende Spannen eingeblendet.

Die UI verändert diese Quelldaten nicht, nur um Karten passend zu schneiden.
Ein `SceneView` ist ein on-demand erzeugtes Query-DTO:

```ts
interface AnalysisSceneView {
  id: string;
  boundarySource: 'scene-block' | 'shot-fallback';
  occurrences: ProjectedOccurrence[];
  keyframeSourceTime?: number;
  setup?: SetupSummary;
  camera?: CameraMotionSummary;
  people: ScenePersonSummary[];
  speakerTurns: SceneSpeakerTurn[];
  description?: SceneDescriptionSummary;
  onscreenText: OnscreenTextSummary[];
  audio: SceneAudioSummary;
  qualityIssues: QualityIssueSummary[];
  metricSummary: SceneMetricSummary;
  coverage: Partial<Record<AgentTimelineChannel, CoverageSummary>>;
}
```

Dieses DTO wird nicht als zweite dauerhafte Datenkopie gespeichert. Es wird aus
den versionierten Events und manuellen Annotationen für den angefragten Bereich
zusammengesetzt.

### 9.3 Szenenkarte und Detailbox

Die zentrale Detailbox zeigt die aktuell laufende oder angeklickte Szene. Eine
virtualisierte Liste erlaubt das Durchgehen Szene für Szene, ohne hunderte
vollständige DOM-Karten gleichzeitig zu rendern.

Jede Szenenkarte kann enthalten:

- Start, Ende, Dauer, Scene-/Shot-Nummer und Setup-ID,
- einen lazy geladenen Keyframe, aber nur bei sichtbarer/geöffneter Karte,
- Shot-Größe, Bildaufteilung und Kamerabewegung,
- Focus/Motion-Zusammenfassung und Quality-Warnungen,
- sichtbare Personen als klickbare Face-Chips mit Konfidenz,
- Active Speaker, off-screen oder `unknown`,
- vorhandene Scene Description mit Provenienz und Reanalyse-Aktion,
- OCR-Texte mit Zeitspanne und Position,
- Audiozustand wie Sprache, Stille, Musik, Noise und Loudness,
- kanalweise Coverage-/Missing-Hinweise,
- das zugehörige Transkript.

Face-Chips sind keine dekorativen Avatare:

- Klick filtert Timeline und Szenenliste auf diese Person und springt bei
  erneutem Klick zur nächsten Appearance.
- Kontext-/Detailaktion öffnet die vorhandenen Merge-, Move- und
  Review-Zuordnungen.
- Active-Speaker-Konflikte sind direkt korrigierbar; manuelle Korrekturen
  landen im Annotation-Layer und überleben Reanalyse.
- Bei fehlendem Crop wird kein Full-Frame-Screenshot vorab erzeugt.

Description ist optional. Fehlt sie, bleibt der Bereich leer oder bietet
`Describe this scene`; der normale Analysis-Lauf startet sie nicht
automatisch. Der heutige clipweite Description-Pfad wird langfristig um
bereichsweise Scene-Anfragen ergänzt. Bestehende `sceneDescriptions` werden
über einen Adapter eingeblendet, auch wenn deren Grenzen nicht genau mit den
neuen Scene-Blocks übereinstimmen.

### 9.4 Transkript wird ein Analysekanal

Der eigenständige Transcript-Tab wird nach Funktionsparität in den
Analysis-Workspace migriert. `Transcript` erscheint im Action Center wie
Focus/Motion, Faces, Cuts, Description und die übrigen Kanäle.

Folgende bestehende Fähigkeiten müssen vollständig erhalten bleiben:

- Provider- und Sprachwahl,
- Start, Continue, Cancel und Clear,
- Provider-/Fusion-Fortschritt und Coverage,
- Sprechersegmentierung,
- Suche,
- Wort-Konfidenz und Review-Markierung,
- Click-to-seek,
- aktives Wort während Playback,
- sanftes Auto-Scroll nur außerhalb der Follow-Zone,
- korrekte Source-/Timeline-Projektion bei Speed und Reverse.

In einer Szenenkarte wird das Transkript nach Sprecherturns dargestellt:

```text
Person 2 / Speaker 1  00:41.20–00:44.80
„…das gerade gesprochene Wort wird hervorgehoben…“
```

Ein Wort bleibt anklickbar und setzt den Playhead. Das aktive Wort wird aus der
kanonischen Source-Zeit ermittelt, dann über die gewählte Occurrence auf die
Composition projiziert. Wenn Speaker↔Person bekannt ist, zeigt der Turn
Face-Chip und Personenname; andernfalls bleibt das ehrliche Sprecherlabel.

Für lange Szenen darf die Karte nur die sichtbaren Sprecherturns und Wörter
rendern. Suche arbeitet auf einem Transcript-Index und liefert Treffer plus
Scene-ID; sie verlangt kein vollständiges DOM und keine vollständige
Agent-Antwort.

Audio-only Clips erhalten ebenfalls den Analysis-Workspace. Visuelle Lanes
fehlen dort, Transcript, Speech, Loudness, Silence, Audio Quality und optionale
Audio-Klassen bleiben vollständig nutzbar. Bei verlinktem Video/Audio wird wie
heute die kanonische Transcript-Quelle aufgelöst, aber nur einmal im
Workspace-Modell.

Nach erfolgreicher Migration:

- verschwindet `transcript` als separater Properties-Tab,
- `Analysis` ist für Video- und Audioquellen verfügbar,
- `TranscriptTab` wird erst entfernt, wenn alle Paritätstests grün sind,
- externe Navigation auf den alten Transcript-Tab wird auf
  `Analysis → Transcript` umgeleitet.

### 9.5 Ablösung der heutigen Einzelboxen

Die aktuellen Bereiche werden nicht ersatzlos gelöscht, sondern in die neue
Informationshierarchie überführt:

| Heute | Ziel |
|---|---|
| Current Frame | kompakter Now-Line-Inspector plus Werte in aktiver Szenenkarte |
| Summary | kleine Overview-Counter/Legende; Details als Timeline-Lanes |
| People | Face-Chips, Personenfilter und Appearance-Ranges in Timeline/Karten |
| Needs Review | Quality-/Identity-Events mit Severity und Korrekturaktion |
| AI Scene Description | optionales Description-Feld pro Szene |
| Transcript-Tab | Transcript-Kanal und synchronisierte Sprecherturns pro Szene |

Damit verschwinden die gestapelten, voneinander getrennten Boxen. Action Center
und Progress/Fehler bleiben oben; darunter folgen nur Overview-Timeline und
szenenweise Details.

### 9.6 Komponenten- und Zuständigkeitsgrenzen

`AnalysisTab.tsx` liegt bereits nahe am 700-LOC-Produktlimit und darf nicht um
die neue Oberfläche erweitert werden. Der Umbau ersetzt ihn durch eine dünne
Workspace-Shell:

```text
properties/analysisWorkspace/
  AnalysisWorkspace.tsx
  useAnalysisWorkspaceModel.ts
  AnalysisChannelActions.tsx
  AnalysisOverviewTimeline.tsx
  analysisOverviewPainter.ts
  AnalysisNowInspector.tsx
  AnalysisSceneList.tsx
  AnalysisSceneCard.tsx
  AnalysisSceneTranscript.tsx
  AnalysisPersonChip.tsx
  analysisSceneViewModel.ts
```

Bestehende Transcript-Logik wird extrahiert und wiederverwendet, nicht in die
Scene Card kopiert. Face-Korrekturaktionen bleiben in ihrem bestehenden
Service. Canvas-Drawing, Query-/Projection-Logik, React-Zustand und
Transcription-Orchestrierung bleiben getrennte Verantwortlichkeiten.

### 9.7 UI-Akzeptanzkriterien

- Ein Klick auf Graph, Szene, Person oder Wort setzt/selektiert konsistent.
- Beim Playback wechseln aktive Szene und Wort ohne flackerndes Vollrendern.
- Eine 60-Minuten-Quelle lädt nur sichtbare Overview-Bins und Szenenkarten.
- Missing/Partial Coverage ist in Timeline und Karte sichtbar.
- Kein Face-Crop oder Keyframe wird geladen, bevor er sichtbar oder angefordert
  ist.
- Transcript-Provider, Continue, Suche, Review und Word-Seeking verlieren
  gegenüber dem heutigen Tab keine Funktion.
- Audio-only, linked A/V, Reverse, variable Speed, Nested Comp und mehrfach
  vorkommende Source-Ranges sind abgedeckt.
- Zoom-out sättigt weder Cuts noch OCR/Quality-Marker; alle dichten Ereignisse
  werden pro Pixel gebinnt.
- Linux/Mesa zeigt dieselben Lanes über den Software-Canvas-Pfad.
- Keyboard-Fokus, Tooltips und Screenreader-Labels hängen nicht allein vom
  Canvas ab.

## 10. Pipeline und Job-Graph

```text
Media source
  ├─ frame-accurate 160×90 scan
  │    ├─ cuts
  │    ├─ representative shot frames
  │    └─ cheap per-frame hash when the benchmark permits it
  ├─ sparse metrics sampling (Quick 1 fps / Balanced 2 fps)
  │    ├─ frame hash + freeze/black/exposure
  │    ├─ focus + regional motion
  │    ├─ optical-flow direction/coherence
  │    └─ color/layout signatures
  ├─ sparse face pass
  │    ├─ people + appearance ranges
  │    ├─ framing/layout
  │    ├─ identity reconciliation across shards
  │    └─ ambiguous speech spans → Deep mouth-motion candidates
  ├─ shared audio pipeline
  │    ├─ reuse loudness/peaks/spectrogram when compatible
  │    ├─ persist measured silence/transient derivations
  │    ├─ transcript + diarized speakers
  │    └─ optional audio classifier
  └─ no-decode fusion
       ├─ recurring setups
       ├─ active-speaker mapping
       ├─ scene blocks
       ├─ quality events
       └─ duplicate/take groups
```

Dies ist die Zielarchitektur, nicht der heutige Ausführungspfad. Der aktuelle
Sparse-Pass setzt für jedes 500-ms-Sample `video.currentTime` und wartet auf
`seeked`, während der Cut-Scan sequenziell läuft. Phase 0 vergleicht deshalb
Seek-Sampling mit einem gemeinsamen sequenziellen Decode. Der Coordinator
plant danach Abhängigkeiten statt unabhängige „Analyze“-Läufe zu starten. Ein
Job darf mehrere Consumer bedienen. Bestehende Proxy-Generierung kann den
günstigen Frame-Scan weiterhin nebenbei speisen.

Wichtige Betriebsregeln:

- kompatible Coverage wird übersprungen,
- Teilbereiche können nachgeholt werden, sobald der jeweilige Kanal sein
  Shard-/Identity-Gate erfüllt; Face ist vorher sourceweit,
- Source Identity, State-Hash oder Analyzer-Version invalidiert nur betroffene
  Kanäle,
- optionale schwere Jobs beginnen erst nach ihren günstigen Kandidatenfiltern,
- globale Queue verhindert kollidierende Analysen,
- UI zeigt pro Kanal `queued`, `running`, `cached`, `partial`, `failed`,
- „Analyze All“ erstellt einen Job-Graph und wartet nicht seriell auf
  voneinander unabhängige reine Fusionen.

## 11. Umsetzungsphasen

### Runtime-Persistenz (implementierter Phase-1A-Unterbau)

Fertige lokale Analyse-, Transcript-, Schnitt-, Description- und kompatible
Source-Audio-Zustände werden nun im Hintergrund entprellt in Event-Shards,
Intervallindex, Manifest und zuletzt einen Pointer geschrieben. Die Runtime
speichert ausschließlich die materialisierten Event-DTOs; `File`/`Blob`, DOM-,
Decoder-, Modell- und Embedding-Handles bleiben außerhalb der Persistenz.
Lesen bevorzugt einen validierten Pointer mit identischer Source-Identity und
fällt bei fehlenden, veralteten oder beschädigten Artefakten schreibfrei auf
den bisherigen Live-Adapter zurück. Manuelle/nicht-legacy Artefakte verbleiben
im Manifest, wenn der automatische Snapshot aktualisiert wird.

### Phase 0A — Benchmark und Referenzkorpus

- heutige Cut-, Focus/Motion-, Face- und Audiozeiten erfassen,
- Cold/Warm Cache getrennt messen,
- Referenzclips für Interview, Shot/Reverse-Shot, Handheld, OCR,
  Musik/Rauschen, mehrere/keine Gesichter, VFR und 60 Minuten,
- Timeline-Fälle für variable Speed inklusive Richtungswechsel/Speed 0,
  Transition-Source-Maps, Nested Comps und mehrere sichtbare Quellen,
- Windows und Linux/Mesa prüfen,
- Ergebnis als reproduzierbare Baseline dokumentieren.

Stop-Gate: Keine neue Default-Analyse ohne Baseline.

### Phase 0B — Speicher-, Identity- und Mapping-Grundlagen

- kanonischen, speicherschonenden Source-Identity-Dienst definieren,
- Shard-Format und kleinen Intervallindex für lange Analysekanäle festlegen,
- Read-Adapter für heutige monolithische Focus/Face- und Transcript-Dateien,
- `timeDomain` und State-Hash für Source/Clip/Composition-Artefakte,
- zentralen one-to-many Source/Timeline-Mapping-Service mit
  `occurrenceId`/`compositionPath`,
- Face-Identity-Strategie für partielle Shards einschließlich ID-Remap,
  Datenschutz und manueller Korrekturen entscheiden,
- Point-/Interval-Semantik und halb-offene Range-Queries festschreiben.

Stop-Gate: Keine Behauptung von resumierbaren Face-Ranges, stabilen
projektweiten Personen oder günstigen 60-Minuten-Queries ohne diese Grundlagen.

### Phase 1A — Manifest, Coverage und Range-Query

- gemeinsames Manifest und Schema-Versionierung,
- vorhandene Schnitte und Audio-Artefakte kompatibel referenzieren,
- Focus/Face und Transcript über Adapter lesen und neue lange Ergebnisse in
  zeitlich begrenzte Shards schreiben,
- Shard-Intervallindex und deterministische Coverage-Auswahl,
- one-to-many Source-Time-zu-Timeline-Projektion über den zentralen Mapper,
- paginierte Agent-Abfrage,
- keine neue Pixelanalyse.

Akzeptanz: Ein Agent kann einen ausgewählten Bereich abfragen und erkennt
explizit vollständige, partielle und fehlende Kanäle. Eine gecachte
60-Minuten-Quelle erfordert dafür weder das Parsen aller Face-Events noch eine
per-Event-Sampling-Inversion der Timeline.

### Phase 1B — Analysis Workspace und Transcript-Migration

- dünne `AnalysisWorkspace`-Shell und range-basiertes View Model,
- lazy Overview-Tile-Pyramide für dichte Analysekurven,
- Compact Analysis Timeline zunächst mit Cuts, Speech, Faces, Focus/Motion,
  Audio und Coverage,
- Scene Cards auf Shot-Fallback-Basis,
- virtualisierte Szenenliste und lazy Face-/Keyframe-Crops,
- heutige Transcript-Steuerung, Suche, Sprechersegmente, Review und
  Wort-Highlighting als Transcript-Kanal übernehmen,
- Audio-only und linked A/V unterstützen,
- Current Frame, Summary, People, Needs Review und Description in Overview und
  Szenenkarte integrieren,
- alten Transcript-Tab als temporären Paritäts-Fallback behalten.

Akzeptanz: Timeline, aktive Szene und aktives Wort folgen dem Playback; alle
heutigen Transcript-Funktionen sind vorhanden; eine 60-Minuten-Quelle rendert
nur sichtbare Bins/Karten. Erst danach werden der alte Transcript-Tab und die
ersetzten Einzelboxen entfernt.

### Phase 2 — Günstige Ableitungen

- Optical-Flow-Richtung und Kohärenz persistieren,
- Kamera-Pan/Tilt/Static-Spannen,
- Shot-Größe und Layout aus Face-Boxen,
- schwarze/frozen/exposure/focus Qualitätsereignisse,
- Audio-Loudness/Peak-Events und, nach dem Extraktionsbenchmark,
  Silence/Transient-Sidecars,
- Setup-Clustering aus Shot-Keyframes.

Akzeptanz: Balanced bleibt innerhalb des gemessenen 2×-Budgets.

### Phase 3 — Fusion

- Sprecher-zu-Person-Heuristik,
- off-screen und unklare Sprecher,
- Redundanz-/Take-Gruppen,
- regelbasierte Scene-Blocks.

Akzeptanz: Konfidenzen sind kalibriert; unklare Fälle bleiben unklar.

### Phase 4 — Optionales OCR

- Tesseract.js oder einen gleichwertigen lokalen Worker benchmarken,
- nur Shot-Keyframes/change-triggered,
- Deduplizierung zu Zeitspannen,
- Sprachpakete und Offline-Caching,
- OCR bleibt kanalweise abschaltbar.

Stop-Gate: Kein Balanced-OCR, falls Laufzeit, Downloadgröße oder Speicherbudget
nicht eingehalten werden.

### Phase 5 — Optionale Audio-Klassifikation

- Heuristiken gegen ein kleines Modell auf dem Referenzkorpus vergleichen,
- Modell nur übernehmen, wenn es einen messbaren Nutzen gegenüber vorhandenen
  Spektral-/Transkriptmerkmalen liefert,
- Modell und Klassenmapping versionieren.

### Phase 6 — Optionales Active-Speaker-Modell

- nur beginnen, wenn Heuristikqualität für echte Mehrpersonenfälle nicht reicht,
- A/V-Sync, notwendige Kandidaten-Framerate und sequenziellen Decode auf
  mehrdeutigen Sprachspannen benchmarken,
- ROI-Mundbewegungsheuristik gegen das Kandidatenmodell vergleichen,
- Kandidatenmodell nach ONNX/WebGPU/WASM-Konvertierbarkeit, Lizenz, Modellgröße,
  CPU-Fallback und Genauigkeit bewerten,
- nur vorgefilterte Face-ROIs in Sprachspannen analysieren.

Stop-Gate: Kein kontinuierlicher Full-Video-Modelllauf.

## 12. Validierung

### Qualitätsmetriken

- Cut-/Shot-Grenzen gegen manuell markierte Samples,
- Setup-Clustering: Precision/Recall pro wiederkehrendem Setup,
- Active Speaker: korrekt / off-screen / unknown pro Sprechersegment,
- Kamera-Bewegung: static/pan/tilt/handheld und Richtung,
- OCR: normalisierte Wortgenauigkeit und korrekte Sichtbarkeitsspanne,
- Quality Events: False-Positive-Rate pro Stunde,
- Take-Gruppen: Precision vor Recall; falsche Gruppierung ist teurer als ein
  übersehener Kandidat.

### Systemmetriken

- Zeit pro Medienminute und Profil,
- Peak Memory,
- Fingerprint-Zeit, gelesene Bytes und Peak Memory,
- Artefaktgröße pro Medienminute,
- Range-Query-Latenz, geparste Shards/Bytes und Antwortgröße,
- Overview-Antwortgröße relativ zur sichtbaren Pixelbreite,
- React-Commit-/Canvas-Draw-Zeit während Playback und Zoom,
- Anzahl gleichzeitig gerenderter Scene Cards, Wörter, Face-Crops und
  Keyframes bei einer 60-Minuten-Quelle,
- Cache-Hit-Rate,
- Cancel/Resume ohne Datenverlust,
- korrekte one-to-many-Projektion bei Trim, Slip, variabler Speed,
  Richtungswechsel, Speed 0, Reverse, Clip-Wiederholung, Transitions und Nested
  Comps.

### Regressionen

- bestehende Einzelanalysen funktionieren weiter,
- Proxy-Generierung bleibt nutzbar,
- keine doppelten Jobs durch „Analyze All“ und Einzelbuttons,
- keine Face-ID-Kollision oder verlorene manuelle Zuordnung nach Resume/Shard,
- Point-Cuts erscheinen exakt einmal an definierten Range-Grenzen,
- keine Timeline-Marker-Sättigung bei starkem Zoom-out,
- Playhead, aktive Szene und aktives Wort bleiben bei Playback/Scrub synchron,
- Transcript-Provider, Continue, Suche, Review und Click-to-seek bleiben nach
  Entfernung des alten Tabs funktional,
- Audio-only und linked A/V zeigen denselben Analysis-Workspace ohne
  duplizierte Transcript-Zustände,
- Software-Canvas-Pfad auf Linux/Mesa bleibt erhalten.

## 13. Offene Entscheidungen vor Phase 1

1. Soll `Quick` oder `Balanced` nach Proxy-Generierung automatisch starten?
2. Werden nur verwendete Medienbereiche automatisch analysiert oder die ganze
   Quelldatei, sobald sie erstmals benutzt wird?
3. Wie lange werden optionale OCR-/ML-Artefakte im Cache behalten?
4. Welche Sprachen sollen OCR-Pakete standardmäßig lokal enthalten?
5. Dürfen Cloud-Transkription und lokale Pixelanalyse gemeinsam unter
   „Analyze All“ erscheinen, obwohl Kosten und Datenschutz verschieden sind?
6. Welche Channels darf ein Agent selbst nachfordern, und welche brauchen eine
   Nutzerbestätigung?
7. Dürfen lokale, numerische Face-Identity-Prototypen persistiert werden, oder
   soll bei Teilanalyse stets sourceweit neu geclustert werden?
8. Wann reicht der gestreamte Sample-Fingerprint, und für welche Workflows ist
   zusätzlich ein starker gestreamter Vollhash nötig?

## 14. Empfohlener erster Lieferumfang

Der erste sinnvolle Slice enthält **keine neue schwere KI**, beginnt aber mit
den nicht überspringbaren Phase-0B-Grundlagen:

1. Source Identity, Shard-/Intervallindex und one-to-many Timeline-Mapping,
2. Manifest, Coverage, Adapter für Altartefakte und paginierte Range-Query,
3. bestehende Schnitte, Transkript, Faces, Focus/Motion und Audio fusionieren,
   wobei Faces bis zum Identity-Gate sourceweit bleiben,
4. Compact Analysis Timeline und szenenweise Detailkarten auf Shot-Fallback,
5. Transcript als synchronisierten Analysekanal inklusive Audio-only,
6. alte Summary/People/Review/Description-Boxen nach Parität in die
   Szenenansicht überführen und den separaten Transcript-Tab entfernen,
7. CPU/WebGPU-taugliches Kamera-Resultat und gemessener Samplingpfad,
8. Setup-Clustering,
9. Shot-Größe/Layout,
10. günstige Quality Events,
11. einfache Sprecher↔Person-Zuordnung mit `unknown`,
12. Redundanz-/Take-Kandidaten.

Damit entstehen fast alle für einen Schnitt-Agenten wichtigen Orientierungsdaten
aus vorhandenen oder sehr günstigen Merkmalen, ohne die Kosten der nötigen
Index-/Mapping-Grundlagen zu verschleiern. OCR, Audio-ML und ein echtes
Active-Speaker-Modell bleiben messbare, separat aktivierbare Erweiterungen.
