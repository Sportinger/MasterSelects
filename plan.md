# Effekt-Node-Migration: Bestandsaufnahme und Plan

Stand: 20. September 2026

## Verbindlicher Ausführungsmodus für die Umsetzung

Dieser Plan wird von einem **Astra-Agenten als Orchestrator** ausgeführt. Der Astra-Orchestrator übernimmt primär Analyse, Abhängigkeitsplanung, Zerlegung, Priorisierung, Integration und die intelligenten Entscheidungen an Architekturgrenzen. Die eigentliche Codeumsetzung wird möglichst vollständig an **bis zu drei parallele Codex-Sol-Low-Worker-Lanes** delegiert.

Die folgenden Regeln sind belastbare Arbeitsdefaults, keine Bürokratie um ihrer selbst willen. Astra darf Paketgrößen, Lane-Zuschnitt, Dateigrenzen, Testbündel und die eigene Beteiligung pragmatisch anpassen, wenn dadurch schneller und klarer gearbeitet wird. Maßgeblich bleiben der Schutz fremder Änderungen, eine eindeutige Verantwortung bei tatsächlich kollidierenden Dateien, das Reuse-Gate sowie funktionale und persistente Kompatibilität. Es müssen nicht künstlich drei Lanes beschäftigt werden, wenn die Arbeit eng gekoppelt ist oder Parallelisierung mehr Koordination als Fortschritt erzeugt.

**Primäres Betriebsziel ist hoher Durchsatz bei geringem Token- und Toolaufwand.** Astra gibt nur den für ein Paket notwendigen Kontext weiter, vermeidet wiederholte Bestandsaufnahmen und fasst gleichartige Prüfungen zusammen. Worker sollen Code und gezielte Testfälle liefern, aber normalerweise keine eigenen umfangreichen Testläufe starten. Astra testet mehrere integrierbare Pakete gebündelt, wertet die Resultate einmal aus und verteilt nur konkrete Fehler als kleine Fixaufträge zurück.

### Rollen

#### Astra-Orchestrator

Der Orchestrator:

- liest zuerst `AGENTS.md`, diesen Plan und den aktuellen Git-Status;
- schützt sämtliche fremden Änderungen im gemeinsamen Arbeitsbaum;
- hält die Architekturentscheidungen und das Reuse-Gate dieses Plans verbindlich;
- zerlegt die aktuelle Etappe in kleine, unabhängig ausführbare Arbeitspakete;
- weist jedem Worker einen klaren Datei- und Verantwortungsbereich zu;
- hält bis zu drei Worker-Lanes fortlaufend beschäftigt, solange sichere unabhängige Arbeit vorhanden ist;
- prüft Ergebnisse an Integrationsgrenzen und löst Überschneidungen;
- bündelt die Tests mehrerer fertiger Pakete und führt die notwendigen gezielten Integrationsprüfungen zentral aus;
- übernimmt selbst nur kleine Integrationsänderungen, dringende unblockende Fixes oder Aufgaben, die wegen geteilter Architektur nicht sinnvoll delegierbar sind;
- startet keine Veröffentlichung, keinen Push, kein Release und keinen Versionssprung.

Der Orchestrator soll seine Zeit nicht mit routinemäßiger Implementierung verbringen, wenn eine Worker-Lane diese übernehmen kann. Seine Hauptaufgabe ist, jederzeit die nächsten sinnvollen Pakete vorzubereiten, Abhängigkeiten zu erkennen und fertige Ergebnisse schnell zu integrieren.

Worker-Prompts sollen kurz und paketbezogen sein. Sie nennen Ziel, relevante Dateien oder Module, wichtige Nicht-Ziele, einschlägige Planentscheidungen und Fertig-Kriterien. Bei kleinen, offensichtlichen Paketen ist keine umfangreiche Prompt-Schablone erforderlich. Astra darf wenig Gesprächskontext weitergeben und den benötigten Kontext direkt im Auftrag zusammenfassen.

#### Codex-Sol-Low-Worker

Jeder Worker:

- erhält genau ein begrenztes Paket mit Ziel, erlaubten Dateien, relevanten Verträgen und Fertig-Kriterien;
- liest vor Änderungen `AGENTS.md` sowie die für sein Paket relevanten Abschnitte dieses Plans;
- inspiziert vor Änderungen den aktuellen Git-Status und behandelt nicht selbst erzeugte Änderungen als fremde Arbeit;
- implementiert sein Paket und ergänzt beziehungsweise aktualisiert die unmittelbar relevanten Testfälle; Testläufe übernimmt grundsätzlich Astra gebündelt, außer ein sehr schneller lokaler Einzeltest ist zur sicheren Implementierung unmittelbar nötig;
- verwendet vorhandene Operatoren und Compilerpfade gemäß Reuse-Gate;
- verändert keine Dateien, die einer anderen aktiven Lane zugewiesen sind;
- meldet kurz: geänderte Dateien, Verhalten, hinzugefügte beziehungsweise empfohlene Tests, tatsächlich ausgeführte Schnellprüfungen und mögliche Folgepakete;
- führt keine breit angelegten Reviews fremder Pakete durch, sofern der Orchestrator dies nicht wegen eines konkreten Risikos verlangt;
- pusht und veröffentlicht nichts.

### Drei kontinuierlich befüllte Lanes

Der Orchestrator darf bis zu drei Sol-Low-Worker parallel einsetzen. Die Lanes sollen nicht starr an Themen gebunden werden; nach Abschluss eines Pakets wird eine Lane unmittelbar mit dem nächsten unabhängigen Paket befüllt.

Bevorzugte Aufteilung innerhalb einer Etappe:

1. **Runtime/Compiler-Lane:** Operatorverträge, IR, Lowering, Passplanung und Render-/Compute-Anbindung.
2. **Model/UI-Lane:** Persistenz, Migration, Actions, Inspector, Node-Projektion und Bedienung.
3. **Tests/Compatibility-Lane:** erstellt gezielte Regressionstests, Fixtures und Kompatibilitätsprüfungen; Astra bündelt und startet die eigentlichen Testläufe und verteilt konkrete Fehlschläge als kleine Fixpakete.

Diese Aufteilung ist nur ein Startpunkt. Wenn etwa Runtime und UI dieselben Dateien berühren würden, teilt der Orchestrator stattdessen nach Effektfamilien oder nach vollständig getrennten Dateigrenzen. Eine freie Lane darf vorbereitende, unabhängige Arbeit der nächsten Etappe übernehmen, aber keine noch unentschiedene Architektur vorwegnehmen.

### Arbeitsvorrat und Nachfüllen

Der Orchestrator hält eine kurze Ready Queue mit Paketen, deren Voraussetzungen erfüllt sind. Für jedes Paket stehen fest:

- Ziel und sichtbares Ergebnis;
- expliziter Datei-/Modulbereich;
- vorausgesetzte Entscheidungen und Operatorverträge;
- Reuse-Prüfung;
- minimale relevante Tests;
- Integrations- und Fertig-Kriterien.

Sobald ein Worker fertig ist, prüft der Orchestrator dessen Kurzbericht und Diff auf Integrationsrisiken und befüllt die Lane sofort neu. Er wartet nicht auf den Abschluss aller drei Lanes, wenn bereits neue unabhängige Arbeit verfügbar ist.

### Schneller Prüf- und Review-Takt

Ziel ist eine schnelle, belastbare Umsetzung ohne redundante Review-Schleifen:

- Worker schreiben oder aktualisieren die kleinsten Tests, die ihr Verhalten tatsächlich abdecken, und nennen Astra die passenden Testdateien.
- Worker starten normalerweise keine Testläufe. Erlaubt sind nur sehr schnelle Einzelprüfungen, wenn sie unmittelbar für die Implementierung benötigt werden.
- Astra sammelt fertige kompatible Pakete und führt deren ausdrücklich benannte Tests in einem gemeinsamen Lauf aus.
- Bestandene Tests werden nicht wiederholt, solange spätere Änderungen ihre Aussage nicht invalidiert haben.
- Mehrere fertige, kompatible Pakete dürfen in einem gezielten Typecheck-/Build-Lauf zusammen geprüft werden.
- Der finale `npm run build` erfolgt einmal auf dem endgültigen build-relevanten Stand vor dem zugehörigen Commit; keine Zwischen-Builds ohne konkreten Grund.
- Es wird niemals die vollständige Vitest-Suite `npm run test` ausgeführt. Nur ausdrücklich benannte relevante Testdateien sind erlaubt.
- Reviews erfolgen risikobasiert: Architekturgrenzen, Persistenzmigrationen, Compilersemantik, Zustandsverhalten und Preview-/Export-Divergenzen werden geprüft; triviale isolierte Änderungen erhalten keine zusätzliche Vollreview-Runde.
- Bei einem klar lokalisierten Testfehler erhält bevorzugt derselbe Worker einen gezielten Fixauftrag. Ein neuer breit angelegter Review-Worker wird dafür nicht gestartet.
- Dokumentation und Tests dürfen parallel zur Runtime entstehen, sobald der Vertrag stabil genug ist.

### Token- und Kommunikationsdisziplin

- Astra übergibt keine vollständigen Gesprächsverläufe, wenn ein kurzer selbstständiger Paket-Prompt genügt.
- Worker lesen nur `AGENTS.md`, die relevanten Planabschnitte und die für das Paket notwendigen Dateien.
- Keine Lane wiederholt die vollständige Bestandsaufnahme oder fasst bereits entschiedene Architektur erneut zusammen.
- Zwischenberichte erfolgen nur bei einem echten Blocker, einer notwendigen Grenzänderung oder einem abgeschlossenen Paket.
- Toolausgaben werden auf relevante Fehlerzeilen, geänderte Pfade und kurze Resultate begrenzt.
- Diffs werden gezielt nach zugewiesenen Pfaden geprüft; keine wiederholten repositoryweiten Reviews ohne konkreten Anlass.
- Astra fasst mehrere Worker-Ergebnisse, Testresultate und kleine Folgeentscheidungen jeweils in einer kompakten Integrationsmeldung zusammen.
- Ein Worker soll bei einer klaren Aufgabe implementieren statt zunächst einen ausführlichen eigenen Plan zu verfassen.

### Gemeinsamer Arbeitsbaum und Dateibesitz

- Vor jeder parallelen Welle weist der Orchestrator möglichst nicht überlappende Datei- und Modulbereiche zu. Kleine vorhersehbare Überschneidungen sind erlaubt, wenn ein eindeutiger Integrationsbesitzer feststeht.
- Muss ein Integrationsfile von mehreren Paketen geändert werden, bearbeitet es nur eine benannte Integrations-Lane oder der Orchestrator nach Abschluss der Zulieferungen.
- Worker dürfen fremde Änderungen weder zurücksetzen noch formatieren, verschieben oder in ihren Commit aufnehmen.
- Keine Lane verwendet `git add .`, `git add -A` oder `git commit -a`.
- Vor einem Commit wird das beabsichtigte Repository gemäß `AGENTS.md` geprüft. Es wird ausschließlich mit expliziten, selbst geänderten Pfaden gestaged.
- Konflikte werden vor weiteren Änderungen an den Orchestrator gemeldet; Worker lösen keine unklaren Überschneidungen eigenmächtig.

### Übergabeformat eines Worker-Pakets

Jeder Worker liefert einen kompakten Abschlussbericht in diesem Format:

```text
Paket:
Ergebnis:
Geänderte Dateien:
Reuse/Erweiterungen:
Tests:
Offene Grenze oder nächster sinnvoller Schritt:
```

Der Bericht soll kurz bleiben. Vollständige Logs, allgemeine Code-Reviews und Wiederholungen des Plans sind nicht erwünscht.

### Stop- und Eskalationsregeln

Der Orchestrator stoppt eine Lane oder ordnet neu zu, wenn:

- sich der Datei-/Verantwortungsbereich mit fremder aktiver Arbeit überschneidet;
- eine notwendige Architekturentscheidung noch nicht getroffen ist;
- der Worker einen parallelen Operator- oder Parameterkatalog anlegt;
- ein Paket einen zusätzlichen GPU-Pass ohne nachgewiesene Barriere einführt;
- bestehende Projekt-, Keyframe-, Preview- oder Exportkompatibilität ungeklärt bleibt;
- ein spezialisierter Renderer ohne begründeten Bedarf ersetzt statt adaptiert wird.

Normale lokale Testfehler, kleine Typfehler oder klar begrenzte Integrationsprobleme sind kein Grund, die gesamte Etappe anzuhalten. Sie werden als gezielte Fixpakete in die nächste freie Lane gegeben.

## Ziel und Leitplanken

Alle verbleibenden Effekte sollen schrittweise als bearbeitbare, verschachtelbare Node-Gruppen abgebildet werden. Der Graph muss die reale Verarbeitung bestimmen. Eine dekorative Gruppe um einen unveränderten Blackbox-Effekt gilt nicht als Migration.

Granulare Nodes dürfen zu effizienten GPU-Pässen kompiliert werden; eine Verbindung erzeugt nicht automatisch einen Renderpass. Bestehende Renderer, Shader und spezialisierte Algorithmen bleiben erhalten und werden durch Compiler-Adapter angesteuert. Parameter, Keyframes, Undo/Redo, Speichern/Laden, Vorschau und Export müssen dieselbe kanonische Definition verwenden. Bestehende Projekte und ihr Erscheinungsbild bleiben kompatibel.

Es werden keine parallelen Effektkataloge, Parameterkopien oder weiteren Sonder-Node-Systeme aufgebaut.

## Verbindliches Reuse-Gate vor jeder Umsetzung

Vor jedem neuen oder erweiterten Operator muss der umsetzende Agent nachweisen, dass vorhandene Operatoren und Implementierungen geprüft wurden. Dieses Gate gehört zur Definition of Done jeder Etappe und darf nicht mit dem Hinweis übersprungen werden, ein lokaler Shader sei schneller anzupassen.

Für jeden benötigten Berechnungsschritt ist in der jeweiligen Umsetzung festzuhalten:

1. **Semantik:** Welche Operation wird tatsächlich benötigt, einschließlich Datentyp, Wertebereich, Farbraum, Einheiten, Alpha-Verhalten, Zeit- und Zustandssemantik?
2. **Bestandssuche:** Welche vorhandenen Operatoren, Shaderfunktionen, Compilerpfade und spezialisierten Algorithmen wurden geprüft?
3. **Reuse-Entscheidung:** Wird ein vorhandener Operator unverändert wiederverwendet, um eine typisierte Variante erweitert oder bewusst nicht verwendet?
4. **Abgrenzung:** Falls ein neuer Operator nötig ist, welche konkrete semantische oder technische Inkompatibilität verhindert die Erweiterung eines bestehenden Operators?
5. **Konsolidierung:** Welche bisherigen lokalen Implementierungen können nach erfolgreicher Migration auf die gemeinsame Implementierung abgesenkt werden?

### Operatorfamilien statt Duplikate

- Gleiche Operationen bilden eine gemeinsame semantische Familie. Beispiel: Add, Multiply, Clamp, Mix und Invert besitzen gemeinsame Definition, UI-Metadaten und Tests.
- Unterschiedliche Datentypen werden als explizite typisierte Varianten derselben Familie gespeichert, beispielsweise `math.multiply.scalar`, `math.multiply.vec3` und `math.multiply.field`.
- Typisierte Varianten dürfen getrennte GPU-Lowering-Regeln besitzen, sollen aber Registry-Metadaten, Validierung, Inspector-Verhalten und – soweit semantisch möglich – dieselbe pure Referenzimplementierung teilen.
- Ein neuer Operator darf nicht allein deshalb entstehen, weil er in einem anderen Effekt, Shader oder Node-System benötigt wird.
- Unterschiedliche Namen bei gleicher Semantik werden als Alias beziehungsweise Migration auf einen kanonischen Operator behandelt, nicht als dauerhaft parallele Operatoren.
- Eine Zusammenführung ist verboten, wenn Einheiten, Farbräume, Zustandsmodell, Präzision oder Fehlerverhalten verschieden sind. In diesem Fall bleiben getrennte typisierte Varianten mit dokumentierter Grenze bestehen.

### Laufende Operator-Matrix

Der Operatorbestand wird als eine aus den echten Registries erzeugte Matrix gepflegt, nicht als zweiter handgeschriebener Katalog. Sie muss mindestens ausweisen:

- kanonische Operatorfamilie und typisierte Varianten;
- unterstützte Signaltypen, Formate, Wertebereiche und Einheiten;
- ausführende Backends und Fusionsfähigkeit;
- Zustandsklasse und Invalidation;
- aktuelle Nutzer wie Color, Voxel, Flock, Face Cables und Effektfamilien;
- noch lokale Implementierungen, die später konsolidiert werden müssen.

Der bestehende Node Catalog soll diese Informationen aus den Registries darstellen. Fehlende Registry-Felder werden dort ergänzt, statt eine separate Plan-Tabelle als technische Wahrheit zu führen.

### Reuse-Abnahmekriterien je Effekt oder Familie

- [ ] Registry und Quellcode wurden nach semantisch gleichen Operationen durchsucht.
- [ ] Die Umsetzung nennt wiederverwendete, erweiterte und neue Operatoren ausdrücklich.
- [ ] Neue Operatoren enthalten eine dokumentierte Begründung, warum Erweiterung nicht ausreicht.
- [ ] Gemeinsame Operationen besitzen domainübergreifende Vertragstests.
- [ ] Es existiert nur eine kanonische Parameterdefinition pro Operatorvariante.
- [ ] Lokale Shader-Helfer werden, wo möglich, vom gemeinsamen Compiler erzeugt oder über ein gemeinsames Lowering verwendet.
- [ ] Voxel, Flock, Color, Face Cables und Bildgraphen erhalten keine gleichbedeutenden neuen Math-/Vector-Operatoren.
- [ ] Der Node Catalog zeigt die neue oder erweiterte Fähigkeit aus der echten Registry.
- [ ] Performancevergleiche bestätigen, dass die Konsolidierung keine unnötigen Pässe oder Materialisierungen erzeugt.

## Bestätigter aktueller Stand

- Voxel Relief und Face Cables besitzen echte gespeicherte Operatorgraphen, deren Verbindungen die Verarbeitung bestimmen.
- Flock besitzt einen separaten echten Graph-Compiler.
- Color Nodes bestimmen die Farbverarbeitung, verwenden aber weiterhin ein eigenes Datenmodell und einen spezialisierten Pipeline-Compiler.
- Der gemeinsame Node-Canvas vereinheitlicht Darstellung, Navigation und Verbindungsprüfung, noch nicht alle Ausführungsmodelle.
- Die übrigen registrierten Effekte erscheinen weiterhin als monolithische Effektknoten.
- Zahlen und Text werden als echte UI-Elemente dargestellt. Feste Werte sind editierbar; verbundene Werte dienen als berechnete Anzeige.
- Voxel-Feldarithmetik wird als Registerprogramm in denselben GPU-Pass kompiliert. Granularität bedeutet dort keinen Pass pro Node.
- Math-Operationen sind in Voxel und Flock auswählbar, beruhen aber noch nicht auf einem vollständig gemeinsamen Operatorvertrag.

## 1. Effektbestand und Reifegrad

`src/effects/index.ts` registriert aktuell 100 öffentliche Effekte und einen internen Renderbaustein. Die Kategorien `time` und `transition` enthalten derzeit keine registrierten Effekte.

| Familie | Registrierte Effekte | Zustand |
|---|---|---|
| Color | brightness, contrast, exposure, hue-shift, invert, levels, saturation, temperature, vibrance | monolithisch; brightness/contrast/saturation/invert zusätzlich Inline-Sonderfälle |
| Blur | box-blur, gaussian-blur, motion-blur, radial-blur, zoom-blur | monolithisch, teilweise Mehrpass |
| Distort | bulge, fisheye, kaleidoscope, mirror, pixelate, rgb-split, twirl, wave | monolithisch |
| Stylize | acuarela, edge-detect, glow, grain, pixel-particle-disintegrate, posterize, rom1, scanlines, sharpen, threshold, vignette, voxel-relief | Voxel Relief zerlegt; elf weitere monolithisch |
| Generate | memory-leak | monolithisch, mit Byte-Textur und Zustand |
| Keying | chroma-key | monolithisch |
| Halftone | dither, dither-studio, halftone, pattern-halftone, riso, riso-glow, paper-print, pixel-poster, tone-geometry, cross-stitch, glitch-grid, scatter-mosaic, drift-lines | monolithisch |
| Analog | glitch, crystal, glass-dispersion, ribbon-scan, crt-screen, film-prism, wave-lines, holo, analog-signal-lab | monolithisch; Signal Lab hat spezialisierten Compute-Modus |
| Pixel | blockify, block-mosaic | monolithisch |
| Glyph | ascii, ascii-ghost, dither-text, word-mosaic, matrix, pixel-code, number-field, grid-glyph, capsule-cloud, inscribe, data-hatch, glyph-matrix, symbol-matrix, retro-matrix, pixel-dither, brand-generator, ui-collage, stitch-poster | monolithisch; gemeinsame Glyph-Factory und Atlas vorhanden |
| Geometry | voronoi, pixel-sort, quadtree-zoom, contour, contour-map, contour-type, vector-tiling, crosshatch, embroidery, kilim, outline, bricks | monolithisch; erste vier Compute-Effekte |
| Tracking | subject, tracked-scene, hud-tracker, cctv, kinetic-trace, rain-reveal, stardust, hand-particles, surface-overlay, face-cables | Face Cables zerlegt; neun weitere monolithisch |
| Intern | terrain-overlay | spezialisierter Terrain-Renderpfad, kein öffentlicher Katalogeffekt |

### Tatsächliche Ausführungspfade

1. **Fullscreen-Effekte:** `src/effects/EffectsPipeline.ts` lädt Shader und Uniformpacker. Die meisten Effekte erzeugen mindestens einen Fullscreen-Pass.
2. **Inline-Effekte:** brightness, contrast, saturation und invert werden im Composite-Pfad ohne eigenen Effektpass verarbeitet. Diese Optimierung muss erhalten bleiben.
3. **Mehrpass/Feedback:** Blur, Glow und Feedback-Effekte verwenden Ping-Pong-Texturen beziehungsweise vorherige Frames. `passes` und `usesFeedback` sind ausführungsrelevant.
4. **Compute:** `src/effects/ComputeEffectRuntime.ts` unterstützt Single-Pass Compute, Jump Flood und Analog Signal. Voronoi, Pixel Sort, Quadtree Zoom, Contour und Analog Signal Lab benötigen diese Backends.
5. **Particle Render:** Pixel Particle Disintegrate verwendet einen spezialisierten Renderer.
6. **Tracking/Terrain:** Tracking-Effekte verwenden Landmark-Buffer, Feedback oder `DenseTerrainPipeline`.
7. **Voxel Relief:** `compileVoxelGraph` erzeugt einen Plan für 2D-Raymarching und Native-3D-Voxel-Rendering.
8. **Face Cables:** Der Operatorgraph beeinflusst Tracking, Oberflächenaufbau, Kräfte, Kollision, Simulation und Bake. Physikänderungen benötigen weiter ein Rebake.
9. **Flock:** Der Compiler erzeugt Werte-DAG, Selektionen, Simulation, Verhalten, Trails und Renderzweige samt Invalidation und Hashes.
10. **Color Nodes:** `ColorPipeline` führt Primary-Nodes fusioniert in einem GPU-Pass aus. Das Modell ist noch getrennt von `effect.params.operatorGraph`.

### Reifegrad der Node-Systeme

| System | Bewertung | Begründung |
|---|---|---|
| Voxel Relief | bereits zerlegt | Graph kompiliert Luminanz, Math, Geometrie, Material, Kamera und Licht in bestehende Renderer |
| Face Cables | bereits zerlegt | Graph steuert Bake, Kräfte, Kollision und Rendering |
| Flock | bereits zerlegt, eigene Domain | vollständiger Graph-Compiler mit eigenem GPU-Solver |
| Color Nodes | teilweise vereinheitlicht | echter Graph und GPU-Fusion, aber separates persistentes Modell |
| 3D Scene | teilweise integriert | Plane/Source Geometry, Material, Transform und Render sind ausführbar; Modelle/Splats/Flock/Voxel liegen außerhalb dieses Executors |
| Stabilization | teilweise integriert | verschachtelte Projektion mit Bypass und Keyframes, auf Bake-Daten spezialisiert |
| AI Custom Nodes | separates ausführbares System | Sandbox/Worker; keine Grundlage für native Effektoperatoren |
| übrige 98 Effekte | monolithisch | Image-in/Image-out-Knoten ohne innere ausführbare Operatorstruktur |

## 2. Wiederverwendbare Operatoren

### Vorhanden

- Skalare: Constant, Add, Subtract, Multiply, Divide, Power, Min, Max, Abs, Sin, Clamp.
- Zeitabhängige Werte: Value und Oscillator; in Flock zusätzlich Time, Audio und Remap.
- Bild/Textur: `image.frame`, `texture.image`, `texture.uv`, Luminanz.
- Material: Textur, RGB-Tint und Opacity.
- Geometrie: Plane, Source Geometry, Face Mesh, Depth Mesh, Surface Stitch, Grid Points, Box und Box-Instancing.
- Szene: Mesh, Clip Transform und Scene Render.
- Simulation: Wind, Gravity, Drag, Rope sowie der Flock-Solver.
- Tracking: Face Tracking, Landmark-Smoothing, Anchors, Depth Estimate, gespeicherte Landmarks und Tiefe.
- Gemeinsame Portverträge, Zyklusprüfung, Einzeleingangsersetzung und Gruppenprojektion.

### Fehlende gemeinsame Fähigkeiten

#### Skalare

- Mix, Smoothstep, Step, Floor, Ceil, Fract, Mod, Exp2, Log2, Sqrt, Distance und Noise.
- Range-/Domain-Verträge wie normalized, signed, pixels, degrees und seconds.
- Ein gemeinsames Math-Repertoire für Voxel, Flock und Bildgraphen.

#### RGB und Vektoren

- vec2/vec3/vec4, Split, Combine und Swizzle.
- komponentenweises Add, Multiply, Clamp, Mix und Power.
- Dot, Length, Normalize sowie Matrix-/Transformoperatoren.
- RGB zu HSV/HSL und zurück, Luminanz und Temperatur/Tint.
- RGB-Invert als `1 - RGB`; Alpha bleibt standardmäßig unverändert.
- explizite Verträge für lineare/Display-Farbe und Premultiplied Alpha.

#### Bildfelder

- Koordinatenfelder, Pixelgröße, Resolution, Gradient/Sobel, Neighborhood Sampling und Convolution.
- Threshold, Posterize, Quantize und Distance Field.
- deterministisches Noise mit Seed und Zeit.
- Masken als eigenes Signal statt impliziter Alpha-Nutzung.

#### Texturen und Bilder

- Sample Texture, Channel Extract/Combine, UV Warp, Border Mode und Filter Mode.
- Mixer, Masked Blend und Mehrfacheingänge.
- Feedback-/History-Textur mit definierter Reset- und Seek-Semantik.
- explizite Mehrpassbarrieren und Compilerentscheidung zwischen Fusion und materialisierter Textur.

#### Geometrie

- gemeinsame Grundform-Node mit Dropdown `Box | Kugel | Zylinder`.
- allgemeiner Mesh Transform.
- Normals/Tangents, Merge/Join und instanzierbare Geometrieverträge.
- Geometry-Asset-Referenz für File Load.
- getrennte Verträge für Triangle Mesh, Point Cloud und Gaussian Splat.

#### Simulation und Zustand

- deklarative Lebensdauer: frame-local, temporal, clip-local, baked, seek-resettable.
- unterschiedliche Verträge für Feedback, Partikel, Flock und Rope.
- Invalidation für Analyse, Simulation, Geometrie, Appearance und Pipeline-Topologie.
- deterministische Preview-/Export-Zeit und Seed-Behandlung.

## 3. Universelle Source-/Asset-Node und Custom Geometry

Vorhandene Importpfade unterstützen Mesh-Modelle über OBJ/FBX/GLTF/GLB sowie Gaussian-Splat- beziehungsweise Point-Cloud-nahe Formate über PLY/SPLAT/KSPLAT/SPZ/SOG/LCC. Modelle und Splats besitzen getrennte Native-3D-Renderer.

**Entschieden:** Es wird keine zweite File-Node neben der vorhandenen Source-Node aufgebaut. Die bestehende Source-Node wird zum gemeinsamen universellen `source.asset`-Operator. Sie kann entweder die Quelle des aktuellen Clips (`clip-source`) oder eine ausdrücklich gewählte Media-Pool-/Dateireferenz (`media-asset`) verwenden. Titel, Vorschau und sichtbare Ausgangsports werden aus dem erkannten Asset-Descriptor abgeleitet.

Primäre Ausgänge kommen direkt aus dem zuständigen bestehenden Importer. Bereits vorhandene Analyseartefakte werden ebenfalls angeboten; teure abgeleitete Ausgänge wie Face Landmarks, Transkript, Beats oder Spektrum werden nur bei Bedarf erzeugt beziehungsweise aus vorhandenen Artefakten gelesen. Dateien mit mehreren Streams dürfen mehrere Ausgänge liefern, beispielsweise Video gleichzeitig als Bild und Audio.

Die Source-/Asset-Node darf keine `File`-, Blob-, Object-URL- oder GPU-Handles speichern. Sie speichert nur eine portable Assetreferenz, den erkannten Typ sowie Importer-ID und Importer-Version. Vorgeschlagene portable Ausgänge:

```text
Source / Media Asset
  -> mesh-asset-reference
  -> point-cloud-asset-reference
  -> gaussian-splat-asset-reference
```

Typisierte Adapter:

```text
Mesh Asset -> Mesh Geometry -> Mesh/Material -> Scene Render
Point Cloud Asset -> Point Renderer
Splat Asset -> Gaussian Splat Renderer
```

Eine Konvertierung zwischen Splats, Punkten und Triangle Meshes ist eine eigene Operation und darf nicht implizit erfolgen. Beim Wechsel der Quelle bleiben kompatible Verbindungen erhalten. Inkompatible Verbindungen werden sichtbar ungültig beziehungsweise getrennt behandelt und niemals still auf einen anderen Datentyp umgedeutet.

## 4. Priorisierte Etappen

### Etappe 0: gemeinsame Compilergrenze

- kanonischen Effektgraph-Vertrag definieren, ohne harte Beschränkung auf Face Cables und Voxel Relief;
- Operatoren nach Signaltyp, Zustandsklasse, Invalidation und Fusionseigenschaften beschreiben;
- Compiler-Ausgabe als Passplan gestalten: fusionierte Pixel-/Feldprogramme plus explizite Materialisierungsbarrieren;
- Legacy-Parameter und Property-IDs bis zur sicheren Migration erhalten;
- Preview, Wiedergabe und Export aus demselben Plan speisen.

Betroffene Kerndateien: `effectGraphOwner.ts`, `effectGraph.ts`, `EffectsPipeline.ts`, `operatorRegistry.ts`.

### Etappe 1: elementare Farb- und Pixeloperatoren

Zuerst invert, brightness, contrast und saturation, danach exposure, levels, temperature, vibrance und hue-shift. Diese Effekte schaffen RGB-/Vektor-/Farbraumgrundlagen und vier davon besitzen bereits einen fusionierten Inline-Pfad.

### Etappe 2: Punktoperationen und einfache Muster

Threshold, Posterize, Vignette, Scanlines, Grain, Pixelate, Mirror, RGB Split, Blockify und Block Mosaic. Dabei entstehen UV-, Channel-, Quantize-, Noise- und Maskenoperatoren.

### Etappe 3: Filter und Neighborhood Sampling

Box Blur, Gaussian Blur, Motion Blur, Radial Blur, Zoom Blur, Sharpen, Edge Detect, Glow und Acuarela. Diese Etappe führt Kernel-/Convolution-Nodes und Passbarrieren ein. Glow verwendet Blur und Blend wieder.

### Etappe 4: UV-Verzerrung

Wave, Twirl, Bulge, Fisheye, Kaleidoscope und komplexere Analog-Displacements. Grundlage sind UV- und Samplingoperatoren aus Etappe 2.

### Etappe 5: Raster, Halftone und Glyph

Alle Halftone-, Riso-, Pixel-Poster- und Glyph-Effekte. Gemeinsame Bausteine: Cell Grid, Luminanz, Quantisierung, Pattern/Shape, Glyph Ramp, Glyph Atlas, Palette und Composite.

### Etappe 6: Compute-Geometrie

Voronoi, Pixel Sort, Quadtree Zoom und Contour. Die Graphen bestimmen Algorithmus, Seeds, Schwellen, Resolve und Ausgabe; Jump Flood und Sort bleiben spezialisierte Backends.

### Etappe 7: Tracking, Feedback und Zustand

Subject, Motion Lab, HUD Tracker, CCTV, Kinetic Trace, Rain Reveal, Stardust, Hand Particles, Memory Leak und Feedback-Varianten. Voraussetzung ist eine explizite State-/Seek-/Reset-Semantik.

### Etappe 8: Native 3D und Datei-Geometrie

- Grundform-Node Box/Kugel/Zylinder;
- Mesh File Load;
- getrennte Point-Cloud- und Splat-Verträge;
- Adapter zu bestehenden Model-, Point- und Splat-Renderern;
- Scene-Graph-Unterstützung für diese Quelltypen.

### Separates UI-Arbeitspaket: Rechtsklick-Marquee

- Pointer-Down startet Distanzmessung.
- Bewegung über dem Drag-Schwellenwert startet Mehrfachauswahl.
- Pointer-Up ohne Drag öffnet das Kontextmenü.
- Nach einem Auswahl-Drag wird das nachfolgende Kontextmenü unterdrückt.
- Pointer Capture, Touch/Pen-Abgrenzung und `focus-visible` werden getestet.

## 5. Zielgruppen und Fertig-Kriterien

### Farbkorrektur

**Gruppe:** Input -> Farboperationen -> Clamp/Output. Levels ergänzt Black/White Normalize; Hue Shift verwendet Farbraumoperatoren.

**Neu:** RGB/Vector Math, Channel Split/Combine, Color Space, Mix und Clamp.

**Ausführung:** Composite-Inlinecompiler und ColorPipeline gemeinsam nutzen, keinen zweiten Farbshaderkatalog schaffen.

**Risiken:** Operationsreihenfolge, Clamp-Punkte, Farbraum und Alpha-Parität.

**Fertig:** Golden-Pixel-Parität, Legacy-Laden, identische Keyframe-Zeit und keine zusätzlichen Pässe für die bisherigen Inline-Effekte.

### Pixel, einfache Stylize- und Muster-Effekte

**Gruppe:** Input -> UV/Cell Grid -> Sample -> Quantize/Pattern/Noise -> Color/Blend -> Output.

**Neu:** Pixel Grid, Quantize, Pattern Shape, seeded Noise und Time.

**Risiken:** Pixelkoordinaten, Auflösung, animierte Seeds und Aliasing.

**Fertig:** identische Ausgabe bei gleicher Auflösung/Zeit und ein fusionierter Pass für lokale DAGs.

### Blur, Filter und Glow

**Gruppe:** Kernel Setup -> Horizontal/Directional Sample -> optionale Zwischentextur -> Vertical/Resolve -> Blend.

**Neu:** Convolution/Kernel, separable Blur, Directional Samples und Pass Barrier.

**Risiken:** Bandbreite, Randbehandlung, Passanzahl und große Radien.

**Fertig:** minimale Passanzahl, Glow aus Blur+Blend und Preview-/Export-Parität.

### Distort

**Gruppe:** UV Source -> Warp Field -> Sampling -> Output.

**Neu:** Polar Coordinates, Rotate, Repeat/Mirror, Radial Distance und Displacement.

**Risiken:** Filter-/Wrap-Modus und Verhalten außerhalb des Normalbereichs.

**Fertig:** Umleitung oder Bypass verändert die reale Abtastung; Defaultgraph entspricht dem bisherigen Shader.

### Halftone

**Gruppe:** Luminanz -> Cell Grid -> Threshold/Shape/Pattern -> Palette/Ink Composite.

**Neu:** Bayer/Checker Kernel, Screen Angle, Shape SDF und Registration Offset.

**Risiken:** Moire, Derivatives und Auflösungsskalierung.

**Fertig:** alle Varianten verwenden einen kleinen gemeinsamen Operatorbestand statt kopierter Shader-Monolithen.

### Glyph

**Gruppe:** Luminanz -> Cell Grid -> Ramp/Character Select -> Glyph Atlas Sample -> Color/Composite.

**Neu:** Glyph Ramp, Text Source, Character Index und Cell Layout.

**Risiken:** Atlas-Caching, dynamische Ramps und Feedback bei ASCII Ghost.

**Fertig:** alle Varianten verwenden denselben Atlas-/Layoutpfad; Text bleibt echte Parameter-/UI-Daten.

### Analog

**Gruppe:** Signal Source -> Scan/Noise/Displacement/Channel Delay -> Mask/Color -> Output. Signal Lab besitzt eine Compute-Untergruppe.

**Neu:** Scan Signal, Temporal Jitter, Channel Delay und Feedback/History.

**Risiken:** Zeitkontinuität, Pausenrendering und Seeking.

**Fertig:** deterministischer Reset/Seek; Compute wird nur bei benötigten Operatoren gewählt.

### Compute-Geometrie

**Gruppe:** Image Field -> Seed/Partition/Sort/Contour -> Resolve -> Output.

**Neu:** typisierte Compute-Stage und Resource Barrier.

**Risiken:** Speicherlimits, Workgroups und atomare Algorithmen.

**Fertig:** spezialisierte Backends bleiben erhalten, werden aber durch Graphverbindungen gesteuert.

### Tracking

**Gruppe:** Frame -> Tracker/Landmarks -> Auswahl/Glättung -> Visualizer/Partikel/Overlay -> Composite.

**Wiederverwendung:** Tracking-, Smooth- und Source-Artifact-Operatoren von Face Cables.

**Neu:** Landmark Selection, Trail/History, Tracking Overlay und Particle Emit from Landmarks.

**Risiken:** fehlende Detektionen, Landmarkvarianten, historische Frames und Worker-Latenz.

**Fertig:** Trackergebnisse werden geteilt statt mehrfach berechnet; Preview und Export stimmen überein.

### Voxel Relief

Bereits weitgehend im Zielzustand. Verbleibend:

- Math-Operationen mit dem gemeinsamen Vertrag konsolidieren;
- Grundform-Auswahl erweitern;
- weitere Primitive im Instancer ermöglichen;
- Feldlimits und GPU-Programmversion explizit migrieren.

### Face Cables

Bereits ausführbar zerlegt. Verbleibend:

- gemeinsame Scalar-/Vector-Operatoren nutzen;
- State-/Bake-Status explizit modellieren;
- Render-/Surface-Ausgänge enger an den Scene Graph anbinden.

Rope-Solver, Bake und gespeicherte Geometrie bleiben spezialisiert.

### Flock

Bereits ausführbar zerlegt. Verbleibend:

- gemeinsame Port-/Math-Semantik angleichen;
- `sharedOperator` zu einem echten gemeinsamen Implementierungsvertrag ausbauen;
- den Flock-Compiler und GPU-Solver erhalten.

### 3D Scene und Custom Geometry

**Gruppe:** File Load/Primitive -> Geometry/Point/Splat -> Material beziehungsweise Splat Appearance -> Transform -> Renderer -> Scene Output.

**Neu:** Primitive Shape Dropdown, Asset Reference, Mesh Geometry, Point Renderer und Splat Renderer Adapter.

**Risiken:** unterschiedliche Datenstrukturen, Splat-Sortierung, File-Lebensdauer, Export-Preload und GPU-Ressourcen.

**Fertig:** nur portable Assetreferenzen werden gespeichert; Preview und Export laden denselben Typ; Runtime-Handles bleiben außerhalb der Stores.

## 6. Offene Architekturentscheidungen

- **Entschieden:** Der kanonische Graph liegt als versioniertes `effect.operatorGraph` direkt am Effekt. `effect.params` bleibt die einzige kanonische Ablage für Effektwerte. Operatordefinitionen stammen ausschließlich aus der Registry. Das bisherige serialisierte `params.operatorGraph` wird nur beim Laden alter Projekte gelesen, validiert und migriert; neue Speicherungen schreiben ausschließlich das neue Feld.
- **Entschieden:** Bestehende Parameter- und Keyframe-Property-IDs bleiben dauerhaft stabil. Nodes referenzieren diese Werte über Bindungen, statt sie zu kopieren. Neue interne Node-Werte bleiben lokale Konstanten. Erst wenn ein Wert animiert oder im Effektinspektor exponiert wird, erhält er eine stabile ID in `effect.params`.
- **Entschieden:** Math-Operationen verwenden eine gemeinsame UI und gemeinsame semantische Operationsnamen, werden im gespeicherten Graphen aber als eindeutig typisierte Varianten geführt, zum Beispiel `math.add.scalar`, `math.add.vec3` und `math.add.field`. Der Editor darf anhand kompatibler Verbindungen die Variante auswählen oder wechseln; der persistierte Graph bleibt eindeutig und ohne Laufzeit-Raten.
- **Entschieden:** Der Compiler fusioniert kompatible Operatoren standardmäßig in einen GPU-Pass. Eine Materialisierungs- beziehungsweise Passbarriere entsteht nur durch Neighborhood-Operationen, temporales Feedback, einen Compute-/Render-Backend-Wechsel, erforderliche Auflösungswechsel, eine explizite Cache-/Zwischentextur-Anforderung oder inkompatible Texturformate beziehungsweise Sample-Modi. Verzweigungen allein erzeugen keinen zusätzlichen Pass; gemeinsame Teilausdrücke werden innerhalb des kompilierten Programms wiederverwendet.
- **Entschieden:** Jeder zustandsabhängige Operator deklariert eine Zustandsklasse: `stateless`, `frame-history`, `simulation` oder `baked`. Seek und Rückwärtssprünge setzen Frame-History zurück. Simulationen werden deterministisch ab dem letzten gültigen Checkpoint oder dem Clipanfang rekonstruiert. Loop-Grenzen verwenden eine gespeicherte Option `reset` oder `continuous`. Undo/Redo und relevante Parameteränderungen invalidieren Zustand ab dem frühesten betroffenen Zeitpunkt. Export beginnt aus einem definierten leeren Zustand und verwendet feste Zeit- und Seed-Werte. Baked-Daten ändern sich ausschließlich durch einen ausdrücklich ausgelösten Bake.
- **Entschieden:** Color Nodes werden direkt auf das gemeinsame kanonische Operatorgraph-Schema und dieselbe Compiler-IR migriert. Das bestehende Design, die Color-Tab-Bedienung, Color-Versionen und fachlichen Workflows bleiben als spezialisierte Ansicht und Aktionen erhalten, sind aber nur noch Editor/Adapter auf denselben Graphen. Es bleibt kein zweites persistentes Color-Graphmodell und keine zweite GPU-Implementierung gemeinsamer Farboperatoren bestehen. Bestehende Color-Projekte werden versioniert und verlustfrei in den kanonischen Graphen migriert.
- **Entschieden:** Die universelle Source-/Asset-Node besitzt dynamische, aber streng typisierte Ausgänge. Mesh, Point Cloud und Gaussian Splat bleiben unterschiedliche Signaltypen; `geometry` ist nur eine UI-Kategorie und kein frei austauschbarer Anschluss. Formatumwandlungen benötigen explizite Operatoren.
- **Entschieden:** `graph.schemaVersion` versioniert die gespeicherte Graphstruktur, `node.operatorVersion` die Semantik des einzelnen Operators und `asset.importerVersion` die Interpretation importierter Quellen. Compiler- und Shader-Cache-Keys werden zur Laufzeit deterministisch aus Graphstruktur, Operatorversionen, Backend, relevanten statischen Parametern und Ausgabeformat berechnet und nicht im Projekt gespeichert. Migrationen laufen schrittweise über bekannte Versionen; ein Migrations- oder Validierungsfehler darf niemals still einen Defaultgraphen einsetzen.

## 7. Erstes klar abgegrenztes Umsetzungspaket

### Paket A: gemeinsame lokale Bildoperator-IR plus Invert

- kanonische Typen für image, rgb, scalar, alpha, uv und mask;
- Operatoren Image Input, RGB Split/Combine, Scalar Constant, Subtract, RGB Invert und Image Output;
- kleiner DAG-Compiler, der lokale Operationen in einen bestehenden GPU-Pass fusioniert;
- Defaultgraph für Invert: `RGB = 1 - RGB`, `Alpha = Alpha`;
- Legacy-Projekte ohne Graph erhalten den Defaultgraph ohne sichtbare Änderung;
- bestehende Effektinstanz, Parameter- und Keyframe-Eigentümerschaft bleibt erhalten;
- Preview, Playback und Export verwenden denselben kompilierten Plan;
- keine Migration weiterer Effekte in diesem Paket.

### Abnahmekriterien Paket A

- Entfernen oder Umleiten von RGB Invert verändert die reale Ausgabe.
- Gegenüber dem bisherigen Inline-Invert entsteht kein zusätzlicher Renderpass.
- Default- und Legacy-Ausgabe sind pixelgleich.
- Graph, Layout und Gruppen überstehen Speichern/Laden und Undo/Redo.
- Feste Zahlen sind sofort editierbar; verbundene Werte sind berechnete Anzeigen.
- Keyframes werden in Preview und Export zu denselben Zeiten ausgewertet.
- Tests decken Graphmigration, Compilerplan, Inline-Fusion, Persistenz und Node-Editing ab.
- Erst danach folgen Brightness, Contrast und Saturation auf derselben Grundlage.

## 8. Fortführbare Checkliste

- [ ] Architekturentscheidungen zu Besitz, Versionierung, Typen und Passbarrieren festhalten
- [ ] gemeinsame Bildoperator-IR und Compilerplan einführen
- [ ] Invert als einzelne Referenzmigration abschließen
- [ ] Brightness, Contrast und Saturation übertragen
- [ ] restliche Farboperatoren migrieren
- [ ] Pixel-/Pattern-/Noise-Grundlagen schaffen
- [ ] Filter-/Mehrpass-Grundlagen schaffen
- [ ] UV-Distort-Familie migrieren
- [ ] Halftone-Familie migrieren
- [ ] Glyph-Familie migrieren
- [ ] Analog-/Feedback-State vereinheitlichen
- [ ] Compute-Geometrie migrieren
- [ ] Tracking-Familie migrieren
- [ ] Voxel, Face Cables und Flock auf gemeinsame Operatorverträge konsolidieren
- [ ] Grundform-Node Box/Kugel/Zylinder implementieren
- [ ] vorhandene Source-Node zum universellen Clip-/Media-Asset-Operator erweitern
- [ ] Assetverträge und dynamische Ports für Mesh, Point Cloud, Splat, Bild, Audio, Text und Daten implementieren
- [ ] Native-3D-Rendereradapter implementieren
- [ ] Rechtsklick-Marquee als separates UI-Paket implementieren
- [ ] pro Etappe Legacy-, Preview-, Export-, Keyframe-, Undo- und Performance-Parität prüfen

## Relevante Quellen im Repository

- `src/effects/index.ts`, `src/effects/types.ts`, `src/effects/EffectsPipeline.ts`, `src/effects/ComputeEffectRuntime.ts`
- `src/services/operators/`, insbesondere `effectGraphOwner.ts`, `effectGraph.ts`, `voxelGraph.ts`, `scalarField.ts`, `sceneGraph.ts`
- `src/services/nodeGraph/`, insbesondere `effectGraphProjection.ts`, `unifiedClipGraph.ts`, `clipGraphDocument.ts`
- `src/services/nodePreview/`
- `src/services/faceCables/cableOperatorGraph.ts`
- `src/services/flock/compiler/flockCompiler.ts`
- `src/engine/color/ColorPipeline.ts`
- `src/engine/scene/` und `src/engine/native3d/`
- `docs/Features/Node-Workspace.md`, `docs/Features/Node-Catalog.md`, `docs/Features/Effects.md`
- Tests zu Effect Registry, Operatorgraphen, Voxel, Flock, Face Cables, Node Preview und Node-Gruppen unter `tests/unit/` und `tests/browser/`
