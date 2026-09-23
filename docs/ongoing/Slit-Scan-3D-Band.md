# Slit Scan als 3D-Band — Konzept und Umsetzungspfad

Stand: 2026-09-23. Planung anhand des aktuellen lokalen Arbeitsstands; keine
Implementierung und keine Aussage über bereits verifizierte DIS-Qualität.
Die DIS-Implementierung wird parallel bearbeitet. Dieses Konzept beschreibt
ihre Verbraucher-Schnittstelle, ohne den laufenden Algorithmus festzulegen.
Private Arbeitsnotiz; nicht Teil eines öffentlichen Source-Snapshots.

## 1. Ziel und zentrale Entscheidung

Das vorhandene Slit-Scan-Bild soll eine räumliche Gestalt bekommen. Aus einer
festgelegten Referenzkamera bleibt das Bild erhalten. Beim Drehen der
Ansicht werden zeitliche Abstände und bewegungsbedingte Verformungen sichtbar.
Korrektes DIS Optical Flow bleibt die Grundlage der bewegungsgeführten Form.

Wir unterscheiden zwei Geometrieverträge:

| Darstellung | Konstruktion | Referenzbild |
| --- | --- | --- |
| **Referenztreue Zeitfläche** | Ein zusammenhängendes Gitter; jeder Punkt bleibt auf seinem Referenz-Sichtstrahl. Zeit und später Flow bestimmen seine Tiefe. | Erhaltung ist konstruktiv möglich und muss am gerenderten Bild geprüft werden. |
| **Freies Bewegungsband** | Streifen folgen über mehrere Quellzeiten verfolgten Bildpunkten. Seitliche Verschiebung, Umfaltung und Überlappung sind erlaubt. | Kein allgemeines Gleichheitsversprechen; Verdeckungen und fehlende Flächen werden Teil des Looks. |

Empfohlene Reihenfolge: zuerst die referenztreue Fläche, danach ihre
DIS-geführte Verformung, anschließend echte Bewegungsbänder. Die erste Stufe
ist ein Geometrie-/Integrationsnachweis, kein Ersatz für den korrekten Flow.

Das ist eine gestaltete Darstellung von Zeit und Bildbewegung, keine
Rekonstruktion realer Szenentiefe. Auch korrekter Flow bestimmt weder die
Tiefe hinter einem Objekt noch eine eindeutige räumliche Krümmung.

## 2. Was der Code bereits liefert — und was fehlt

Die Pfade beziehen sich auf den gelesenen Arbeitsstand inklusive laufender,
teilweise noch ungetrackter Änderungen; vor Implementierung erneut abgleichen.

| Vorhandener Baustein | Bedeutung für das Vorhaben |
| --- | --- |
| [slitScanEffectGraph.ts](../../src/services/operators/slitScanEffectGraph.ts), [slitScanTimeMapGraph.ts](../../src/services/operators/slitScanTimeMapGraph.ts) | Die externe Zeitmap ist nur ein Eingang. Profil, zusätzliche Zeitfelder, Bandquantisierung und Schutz formen den tatsächlichen Delay. Keine zweite Umsetzung dieser Formeln im 3D-Renderer. |
| [temporalDemandGraph.ts](../../src/services/operators/temporalDemandGraph.ts) | `temporalGraphQueries` identifiziert History-Sampler; `temporalDemandGraph(graph, samplerId)` liefert deren tatsächliche UVs in RG und Delay in B. Guter Ausgangspunkt für einen numerischen Geometrieeingang. A ist hier konstant 1, noch keine Sample-Gültigkeit. |
| [slitScanRgbTimeGraph.ts](../../src/services/operators/slitScanRgbTimeGraph.ts) | RGB kann getrennte Zeitabfragen haben; Alpha bleibt an der Basisabfrage. Ein Ausgabepixel hat dann keine einzige physikalisch interpretierbare Quellzeit. |
| [temporalClipSource.ts](../../src/effects/time/temporalClipSource.ts), [hybridTemporalWindow.ts](../../src/effects/time/hybridTemporalWindow.ts) | Quellzeitabbildung einschließlich Trim, Geschwindigkeit, Reverse, Zeitfaktor und diskreter PTS/Interpolation. Diese Semantik gehört weiterhin dem Temporal-Runtime. |
| [SourceMotionHistory.ts](../../src/effects/time/SourceMotionHistory.ts), [DisMotionCache.ts](../../src/effects/time/DisMotionCache.ts) | DIS auf benachbarten Original-PTS, gebundene Analysefenster und gerätegebundene Ressourcen. Bereits ein Verbraucher des gemeinsamen Source-Frame-Pfads. |
| [motionImageOperators.ts](../../src/services/operators/motionImageOperators.ts), [sourceMotionSampling.ts](../../src/services/operators/sourceMotionSampling.ts) | `image.source-motion`: RG = UV-Geschwindigkeit pro Graph-Delay-Sekunde, B = Konfidenz, A = Gültigkeit. Interne Quellsekunden werden über Metadaten in diese Graph-Uhr überführt. |
| [motionDeformationMath.ts](../../src/services/operators/motionDeformationMath.ts) | Lokales Dehnungsmaß aus Flow und Delay-Gradient; liefert maximale/minimale Dehnung, Konfidenz und vorzeichenbehaftete Determinante. Noch keine Geometrie und keine Hauptdehnungsrichtung. |
| [LayerSpaceEffectRenderer.ts](../../src/engine/native3d/sceneRenderer/LayerSpaceEffectRenderer.ts) | Rendert Effekte vor der 3D-Projektion in eine Objekttextur. Der aktuelle `applyEffects`-Aufruf reicht keinen `TemporalClipSource` weiter; die Übergabe muss explizit ergänzt werden. |
| [SceneLayerCollector.ts](../../src/engine/scene/SceneLayerCollector.ts), [NativeSceneRenderer.ts](../../src/engine/native3d/NativeSceneRenderer.ts) | Bestehende Integration für Plane, Voxel und Face Cables. Ein dynamisches Slit-Scan-Gitter ist noch kein unterstützter Szenentyp. |

Verbindliche Grundlage: [Temporal frame access](../architecture/Temporal-Frame-Access.md).
`SourceFrameService` und `TemporalFrameUploader` wiederverwenden. Kein eigener
Decoder pro Gitterpunkt, kein Lesen aus vorherigen Playback-Frames.
`image.sample-history` allein aktiviert außerhalb von Slit Scan noch keinen
deterministischen Quellzeitpfad.

## 3. Ein gemeinsamer Frame-Vertrag für Farbe, Zeit und Bewegung

Vorgeschlagen ist ein gerätegebundenes Frame-Paket des Slit-Scan-Owners.
Es ist eine neue Schnittstelle, kein bereits vorhandener Typ:

- **Identität:** Clip-/Effektinstanz, ausgewerteter Graph, Parameterstand,
  Ausgabezeit, Quellabbildung, Stabilisierung und Qualitätsstufe.
- **Farbe:** fertiges Slit-Scan-RGBA am definierten Effektstapel-Punkt,
  einschließlich Mix und Glättung, ohne Diagnose-Overlays.
- **Abfragefeld:** Ausgabe-UV `p`, tatsächliche Sample-UV `q(p)` und
  Graph-Delay `d(p)` der explizit ausgewählten Basisabfrage.
- **Zeitabbildung:** gewünschte Quellzeit sowie tatsächlich verwendete
  PTS-Beiträge/Gewichte aus dem Temporal-Runtime; Current-Input separat
  kennzeichnen. Nicht aus einem Grauwert oder gerundeter FPS zurückrechnen.
- **Bewegungsfeld:** Flow, Konfidenz, Gültigkeit, Koordinaten-/Uhrdefinition
  und Analyseidentität. Abfrage bei `q(p)` und dem passenden Delay.
- **Bereitschaft:** vollständig, wird vorbereitet oder Fehler; Eigentümer
  und Lebensdauer der GPU-Ressourcen sind ausdrücklich festgelegt.

Abfragefelder sind numerische Float-Daten ohne Farbkorrektur, Tonemapping
oder Clamping auf Anzeige-RGB. Präzision am maximalen Zeithorizont prüfen;
lange absolute PTS nicht unbesehen in Half-Float ablegen. Das bestehende
Demand-Graph-Ergebnis beschreibt einen Wunsch, noch nicht alle diskreten
Beiträge, aus denen der Temporal-Sampler die Farbe rekonstruiert.

**Zeitdefinition:** Für das erste Relief verwenden wir relative Quellzeit:

```text
s_now = temporalSourceTime(source, source.localTime)
s_req(p) = temporalSourceTime(source, source.localTime - F * d(p))
age(p) = s_now - s_req(p)
```

`F` ist der durch den Temporal-Owner aufgelöste Zeitfaktor. `source.localTime`
ist bereits dessen Uhr, nicht ungeprüft die Timeline-Sekunde. Die Formel
beschreibt die gewünschte kontinuierliche Abfrage; tatsächliches Hold,
Sampling und Current-Input bleiben Runtime-Semantik. Reverse darf negative
`age` erzeugen. Bei Speed-Rampen ist `F * d` kein Ersatz für Quellzeit.

Die kontinuierliche Zeitfläche darf zwischen diskreten Farbsamples glatt
verlaufen. Eine spätere Diagnose kann tatsächliche Sample-Alter zeigen;
diese Darstellungen nicht stillschweigend vermischen.

**Mehrdeutige Fälle:**

- RGB-Zeitversatz: zunächst Basis-/Alpha-Abfrage für Geometrie, fertiges RGB
  für Farbe. Dies ist eine ausgewiesene Gestaltungsregel, keine gemeinsame
  Quellzeit aller Kanäle. Getrennte RGB-Flächen sind ein späteres Experiment.
- Mix mit dem aktuellen Bild und räumliche Glättung mischen Beiträge.
  Geometrie bleibt an der Basisabfrage; aus finalem RGBA wird keine Zeit geraten.
- Benutzerdefinierte Graphen: Sampler über eine stabile explizite Referenz
  auswählen. Bei fehlendem/mehrdeutigem Bezug Status anzeigen, nicht den
  ersten Knoten oder ausschließlich die generierte ID `history` verwenden.
- Stabilisierung: Farbe, Sample-UV, Flow und Referenzprojektion müssen dieselbe
  Koordinatendefinition benutzen. Roh-Flow nicht mit stabilisierten Bildern mischen.

## 4. Referenztreue Geometrie

Ein rechteckiges, zunächst regelmäßig unterteiltes Gitter wird in den
Bildkoordinaten der Referenzkamera aufgespannt. `p` ist die Ausgabe-UV,
**nicht** die möglicherweise veränderte Sample-UV `q(p)`.

Allgemeine Konstruktion, auch für orthografische Kameras:

```text
P(p) = O_ref(p) + lambda(p) * R_ref(p)
lambda(p) = lambda_base(p) + k_time * age(p) + k_flow * h_flow(p)
```

`O_ref/R_ref` sind Ursprung und Richtung des Referenzstrahls in einem
festgelegten lokalen Raum. Bei Perspektive teilen die Strahlen den
Kameraursprung; bei Orthografie unterscheiden sich ihre Ursprünge.
`lambda_base` trifft die unverformte Bildebene. `k_time` definiert
Weltraumeinheiten pro Quellsekunde; keine automatische Min/Max-Normalisierung
pro Frame, die beim Scrubben die Tiefe pumpen lässt.

Die gespeicherte Referenzprojektion bleibt im lokalen Objektraum verankert.
Objekt-/Cliptransformation und aktuelle Ansichtskamera werden danach
angewendet. Orbitieren verändert ausschließlich die Ansicht. Die
Referenzansicht wird nicht pro Frame oder beim Orbit neu eingefangen.
Die Bildgleichheit gilt bei übereinstimmender Referenzansicht und Platzierung;
eine spätere Objektbewegung ist eine beabsichtigte Bildänderung.

### Die Strahlbedingung allein reicht nicht für Bildgleichheit

- Im Fragmentshader aus der interpolierten lokalen Position erneut mit der
  Referenzmatrix projizieren und **nach** homogener Division die Farb-UV
  bilden. Gewöhnliche perspektivisch interpolierte Vertex-UVs können bei
  unterschiedlicher Tiefe innerhalb eines Dreiecks vom Referenzbild abweichen.
- Material zunächst unbeleuchtet, ohne Normalen-Look, Schatten oder Tonemapping.
  Farbraum, Alpha, Filterung, Pixelzentren und Compositing müssen zum 2D-Pfad passen.
- Tiefen begrenzen: keine Punkte hinter der Referenzkamera, keine Near-/Far-
  Clipping-Verluste. Projektionsabdeckung muss lückenlos und eindeutig bleiben.
- Zunächst keine seitliche Verlagerung, Dicke oder zusätzlichen Rückflächen.
  Für Orbit kann dieselbe dünne Fläche beidseitig sichtbar sein; ihre Rückseite
  zeigt die Textur gespiegelt und ist keine rekonstruierte Objektansicht.
- Zeit-Sprünge erzeugen im einfachen Gitter steile Verbindungsflächen.
  Spätere Trennkanten brauchen eine explizite Topologieregel; Aufschneiden
  darf nicht unbemerkt Löcher ins Referenzbild erzeugen.

Auch eine stark verformte Fläche dieses Typs bleibt aus der Referenzkamera
einwertig. Echte Schleifen mit mehreren Flächen auf demselben Referenzstrahl
sind damit nicht allgemein darstellbar.

## 5. Welche Rolle DIS bei der Form spielt

### Lokale Verformung zuerst

Der aktuelle Deformationsknoten benutzt, bei identischer UV-Abbildung:

```text
J = I + velocity_pixels * gradient(delay)^T
stretch = inverse singular values of J
```

Flow und Delay-Gradient müssen zur selben Uhr und Auflösung gehören. Die
Quellzeitfläche oben benutzt Quellsekunden; der aktuelle Knoten benutzt
Graph-Delay-Sekunden. Nicht den Zeitfaktor ein zweites Mal anwenden.

Das Maß beschreibt eine lokale Slit-Scan-Verzerrung unter seinen Annahmen,
keine Materialphysik. Für beliebige vorgeschaltete UV-Warps ersetzt der
räumliche Jacobian von `q(p)` die Identitätsannahme; auch Gradienten und Flow
müssen passend transformiert werden. Erste Flow-Geometrie daher auf
verifizierte Abbildungen begrenzen und andere Graphen kenntlich machen.

Vorschlag für den ersten Flow-Look:

1. Zeitfläche als stabile Grundform.
2. Begrenztes Signal aus der logarithmischen maximalen Dehnung ableiten;
   Konfidenz und Gültigkeit gewichten die Stärke.
3. Räumlich glätten, ohne über ungültige Bereiche, deutliche Flow-Grenzen oder
   Zeitsprünge hinweg fremde Bewegung zu verschmieren.
4. Dieses skalare Signal als `h_flow` ausschließlich entlang der Referenzstrahlen
   auf die Grundform addieren. Positive/negative Auslenkung ist eine Look-Wahl,
   keine aus DIS rekonstruierte Tiefe.

Die bestehende Dehnung ist auf 64 begrenzt; nahe Singularitäten kein riesiges
Mesh erzeugen. `det(J) <= 0` als Umfaltungs-/Unsicherheitsindikator gesondert
behandeln. Wenig Konfidenz fällt auf die Zeitfläche zurück, nicht auf zufällig
fortgeschriebene Bewegungswerte. Stillstand mit gültigem Flow bleibt von
fehlender Analyse unterscheidbar.

Erst nach diesem Nachweis entscheiden, ob Richtungsinformation zusätzlich
anisotrope Glättung oder eine räumliche Biegelösung steuert. Flow-Richtung ist
nicht automatisch die Hauptdehnungsrichtung; der heutige Deformationsknoten
liefert diese Richtung noch nicht.

### Echte Bewegungsbänder danach

Für einen zusammenhängenden Verlauf müssen Punkte über Zeit verfolgt werden:

```text
x_(i+1) = x_i + deltaTime_i * velocity(x_i, sourceTime_i)
```

Hier sind echte Quellzeitpaare und Quellgeschwindigkeiten gemeint. Das ist eine
diskrete Trajektorie mit Begrenzung der Integrationsschritte. Ein lokaler
Vektor am letzten Pixel genügt nicht. Rückwärtsverfolgung braucht rückwärtige
Korrespondenzen bzw. eine kontrollierte Inversion; Vorwärts-Flow am selben UV
einfach zu negieren ist dafür im Allgemeinen nicht ausreichend.

Der aktuelle öffentliche Feldvertrag liefert noch keinen frei adressierbaren
bidirektionalen Trajektorienvertrag. Dass DIS intern beide Richtungen für
Konsistenz prüft, bedeutet nicht, dass beide als dauerhafte Ressourcen vorliegen.
Diese Erweiterung wäre später mit dem Flow-Owner abzustimmen.

Ein echtes Band braucht außerdem eine Saatlinie `x(s, t0)` und eine Regel,
welche Zeiten/Streifen seine Fläche bilden. Für einen linearen Scan ist eine
Linie quer zur Scanrichtung ein sinnvoller Start. Beliebige Zeitmaps besitzen
Verzweigungen, geschlossene Konturen und kritische Punkte; sie ergeben nicht
automatisch ein einziges Band. Daher zunächst nur definierte Scanprofile.

Bei Occlusion, Bildaustritt, Schnitt oder verlorener Korrespondenz endet ein
Segment. Lücken nicht durch erfundene Objektverbindungen schließen. Vor einer
Umsetzung klären: Breite, neue Segmente, Rückseiten, Überlappung, Alpha und
Texturherkunft. Objektweises Tiefensortieren des heutigen Szenenpfads löst
Selbstüberlappung transparenter Banddreiecke noch nicht.

## 6. Integration in den Renderpfad

```text
Clip + ausgewerteter Graph + TemporalClipSource
                  |
        bestehender Slit-Scan-Owner
        /              |             \
  fertige Farbe   Abfrage/Zeitfeld   DIS-Feld
        \              |             /
          konsistentes Frame-Paket
                  |
       Gitteraufbau / Tiefenverformung
                  |
       nativer Szenenpass + Ansichtskamera
                  |
       nachfolgende Effekte / Compositing
```

Ein Renderpass für das Gitter im bestehenden nativen WebGPU-Szenenrenderer
ist das Ziel. Keine zweite Three.js-/Canvas-Szene neben dem Editor einführen.
Ein isolierter GPU-Prototyp darf die Projektion vorab prüfen, ersetzt aber
nicht die spätere Prüfung im echten Editor.

Konkrete Integrationsarbeiten:

1. Slit-Scan-Owner um einen ausdrücklich angeforderten Geometrieausgang
   erweitern. Farb- und Geometrieabfrage müssen dieselben ausgewerteten
   Eingänge verwenden; gemeinsame Materialisierung nutzen, wo möglich.
2. Wertbasierten `TemporalClipSource` bis zur Szenenvorbereitung durchreichen;
   Quellmasken, Render-Scope und Exportvorbereitung ebenfalls erhalten.
   `LayerSpaceEffectRenderer` heute nicht als bereits vollständigen Pfad behandeln.
3. Für Slit Scan einen klaren Übergang von Bild zu Geometrie definieren:
   vorherige Effekte und Current-Input wie bisher auswerten, Slit-Scan-Farbe
   genau einmal erzeugen, danach projizieren. Historische Frames behalten
   dabei ihre bestehende Originalquellen-Semantik.
4. Nachfolgende Effekte in der ersten Version nach der Projektion auswerten.
   Der exakte Vergleich bezieht sich auf den Slit-Scan-Ausgang vor diesen
   Effekten. Keine automatische Umordnung beliebiger Effektstapel.
5. Szenen-Layer-Typ, Collector, Renderfähigkeit und Draw-Plan erweitern;
   in [sceneEffectRouting.ts](../../src/engine/scene/sceneEffectRouting.ts)
   sicherstellen, dass der konsumierte Slit-Scan-Effekt nicht erneut läuft.
6. Referenzkamera, Geometrieparameter, Samplerreferenz und Schema-Version als
   Werte speichern; GPU-Texturen, Buffer, Decoder und Leases im Runtime-Owner.
   Mesh deterministisch neu aufbauen. HMR, Device-Loss und Clip-Löschung
   müssen Besitzer und Ressourcen sauber erneuern bzw. freigeben.

## 7. Determinismus, Qualität und Ressourcen

- Gleiche Zeit, Parameter und Qualität ergeben dieselbe Geometrie unabhängig
  von Seek-Reihenfolge, Playback-Geschichte und vorheriger Orbitansicht.
  Keine Glättung gegen den zufällig zuletzt gerenderten Frame. Spätere zeitliche
  Glättung braucht ein explizites Quellzeitfenster oder feste Checkpoints.
- Farbe, Zeit und Flow nur als konsistentes Paket präsentieren. Während neuer
  Analyse entweder das vollständige vorige Paket mit Vorbereitungsstatus halten
  oder eine ausdrücklich gekennzeichnete Zeitfläche derselben Zeit zeigen.
  Niemals alte Tiefe mit neuem Bild kombinieren.
- Export wartet für aktivierte Flow-Verformung auf die benötigten Ressourcen
  und Fehler werden gemeldet. Kein stiller Export der Ersatzdarstellung.
  Eine explizit gewählte reine Zeitfläche braucht hingegen keinen Flow.
- Farb-, Feld- und Mesh-Auflösung sind getrennte Qualitätsachsen. Ein dichteres
  Gitter erzeugt keine zusätzliche Flow-Information. Preview/Export bei gleicher
  Qualitätsstufe vergleichen; höhere Qualität darf die Abbildung nicht wechseln.
- Erstes Gitterbudget als Messstart: ca. 256 × 144 Zellen bei 16:9, konfigurierbare
  Obergrenze. Weniger bei kleinen Bildern. Kein Dreieckspaar pro 4K-Pixel.
  Später adaptive Unterteilung nur bei belegtem Bedarf an Zeit-/Flow-Kanten.
- Zusätzliche Float-Felder und Mesh-Buffer im Gesamtbudget neben Farbhistorie,
  DIS-Atlas und Scratch berücksichtigen. Keine zweite komplette Video-Historie.
  Nur begrenzte Readbacks für Tests/Diagnose; normale Geometrie auf der GPU.
- Orbit ändert keine Analyseidentität. Tiefenstärke verändert nur Geometrie;
  Flow-Paare bleiben wiederverwendbar. Graph/Delay ändern Auswahl und Geometrie,
  nicht automatisch die gemessenen Paare. Quelle, Analysequalität oder
  Stabilisierung invalidieren dagegen die betroffenen Analysedaten.
- Ein vollständiger Fenster-/Qualitätswechsel darf die laufende Berechnung
  abbrechen. Verbrauchte Ressourcen bis zum Ende eingereichter GPU-Arbeit halten.

## 8. Bedienung

Optionaler 3D-Modus am vorhandenen Slit-Scan-Effekt; bestehende Projekte bleiben
ohne Migration des Looks in 2D. Erste Bedienelemente:

- Darstellung: 2D / Zeitfläche; später Bewegungsband.
- Zeittiefe und Tiefenrichtung; Flow-Verformung nach erfolgreichem DIS-Nachweis.
- Geometrieglättung getrennt von der heutigen Bildglättung.
- Zur Referenzansicht zurückkehren; vorhandene Szenennavigation für Orbit.
- Qualitätsstufe und klarer Status für fehlende Quelle, Vorbereitung oder
  nicht unterstützte Sampler-/Koordinatenkombination.

Referenzkamera und Vorschau-Orbit sind getrennt. Vorschau-Orbit darf keine
Exportkamera überschreiben. Gespeicherte Szenenkamera ist für Export maßgeblich;
eine Übernahme der Ansicht muss ausdrücklich über die vorhandene Kamerabedienung
erfolgen. Diagnoseansichten für Zeit, Konfidenz und Gitter bleiben preview-only.

Inspector über `ResolveInspectorSection`, `ResolveInspectorNumberRow` und
`InspectorSelect`; keine eigene Formularsprache. Pointer-Fokus und
Tastaturnavigation bei der Umsetzung mitprüfen.

## 9. Arbeitspakete mit prüfbaren Ergebnissen

| Stufe | Ergebnis | Abnahmekriterium |
| --- | --- | --- |
| **A — Datenvertrag** | Basis-Sampler, Zeit-/UV-Raum und Frame-Paket festlegen; DIS-Owner-Vertrag nach dessen Abschluss abgleichen. | Identische Abfragen im bestehenden 2D-Pfad und Geometriefeld, einschließlich Custom-UV, RGB-Basis und Schutz. |
| **B — Projektionsnachweis** | Synthetisches Farbbild + bekannte Tiefenfläche, unbeleuchteter Gitterpass. Noch keine Flow-Abhängigkeit. | Referenzbild-Differenz prüfen, Perspektive und Orthografie, starke Tiefenwechsel, Alpha und Bildränder. Eine bloße flache 2D-Abkürzung zählt nicht als Mesh-Nachweis. |
| **C — Echte Zeitfläche** | Slit-Scan-Farbe und Zeitfeld im Editor, Szenenübergabe und Speicherung. | Direkter Seek = sequenzieller Playback-Zeitpunkt; Orbit zurück = Referenz; Reload und Export erhalten Form/Kamera. |
| **D — DIS-geführte Fläche** | Begrenzte, konfidenzgewichtete Verformung aus verifiziertem Flow. | Stillstand bleibt ruhig; bekannte Translation hat korrekte Richtung/Skalierung; Occlusion erzeugt keine Spitzen; Flow-Stärke 0 entspricht C. |
| **E — Freie Bänder** | Separater Versuch mit Saatlinie und Trajektorien für ein definiertes Scanprofil. | Stabile Segmentidentität, kontrollierter Abbruch bei Verlust, dokumentierte Verdeckung; kein Referenztreue-Versprechen. |

DIS-Freigabe vor D: synthetische Translation in beiden Achsen, Subpixelbewegung,
größere Bewegung, texturarme Bereiche, Occlusion und Schnitte. Richtung,
Geschwindigkeitseinheit, PTS-Abstand und Konfidenz/Gültigkeit numerisch prüfen.
Die konkrete Genauigkeitsschwelle mit dem DIS-Ergebnis festhalten; ein optisch
ruhiges Band allein beweist keinen korrekten Flow.

Gemeinsame Regressionen für C/D: Reverse und Speed-Rampen, VFR, Clipanfang/-ende,
Zeitfaktor, Stabilisierung samt Tracking-Lücke, RGB-Zeiten, Schutzmasken,
angehaltene Parameteränderungen sowie asynchrone Bereitstellung nach Seek.
Für die erste Vergleichsmessung gleiche Auflösung und Farbeinstellungen,
maximalen/mittleren Pixelfehler und Alpha-Abdeckung protokollieren. Exakte
Gleichheit ist ein Prüfziel, kein vorab belegtes Ergebnis; unvermeidliche
Raster-/Filtertoleranzen erst anhand des echten Pfads festlegen.

Vor Produktabschluss gezielte Tests, Live-Prüfung im autorisierten lokalen
Editor und finaler Build. Feature-Dokumentation/README erst mit tatsächlich
eingeführtem Verhalten aktualisieren. Für diese Planänderung genügen
Quellabgleich, Diff- und Linkprüfung.

## 10. Bewusst noch offene Gestaltungsfragen

1. Soll der bevorzugte Flow-Look lokale Streckung als Ausbeulung zeigen oder
   langfristig die Bewegung als räumlichen Verlauf erzählen? Der Plan ermöglicht
   beides; D prüft das erste, E das zweite.
2. Sollen spätere freie Bänder das fertige Slit-Scan-Bild tragen oder entlang
   ihrer Trajektorien Originalframes abtasten? Das sind unterschiedliche Looks
   und Ressourcenverträge. Zunächst bleibt die fertige Bildtextur maßgeblich.
3. Wann braucht ein Nutzer getrennte Streifen statt einer geschlossenen Fläche?
   Erst mit konkretem Look festlegen, nicht aus jedem Delay-Sprung automatisch
   eine topologische Trennung machen.

Nächster sinnvoller Implementierungsschritt nach dieser Planung wäre A/B.
Er ist von der laufenden DIS-Korrektur weitgehend unabhängig; D beginnt erst
mit deren verifiziertem Ergebnis. In diesem Dokument wurde nichts implementiert.
