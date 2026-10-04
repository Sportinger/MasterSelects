# Path Tracing in Echtzeit und AI-Denoise für die Native-3D-Szene

Stand: 2026-10-04. **Status: in Umsetzung (Branch `task/path-tracing`), siehe Statusboard.**
Ausführung: ein Agent baut alles selbst, Phase für Phase, siehe Abschnitt 7.

**Ziel:** Die Native-3D-Szene (Weave-Garne, Meshes, Planes, Light-Clips, 3D-Kamera)
wird physikalisch korrekt path-getract:
- **In der Vorschau interaktiv:** Kamera bewegen, scrubben und abspielen mit
  Path Tracing. Das Bild konvergiert, sobald es steht.
- **Im Export** mit hoher Sample-Zahl, deterministisch und AI-entrauscht.

Weißes Garn bekommt die Mehrfachstreuung zwischen den Fasern, die ihm den weichen Look
gibt. Dazu kommen echte Flächenlicht-Schatten, Umgebungslicht aus HDRIs,
Tiefenschärfe und Bewegungsunschärfe.

**Umfang:** Alles in diesem Plan wird gebaut, ohne MVP-Abkürzungen und ohne
Zeitdruck. Splats sind nicht Teil des Plans; sie bleiben im Raster und werden wie
heute über die Szenentiefe einkomponiert.

**Arbeitsweise: schnell, Prüfungen gesammelt.**
- Durcharbeiten, ohne nach jedem Schritt zu testen.
- Geprüft wird gesammelt am Ende einer Phase: eine `tsc`-Runde, ein Vitest-Lauf
  über die benannten Dateien, eine Browser-Sitzung.
- Ein Build nur am Ende des Plans bzw. wenn der Nutzer ihn verlangt.
- Tests gibt es nur dort, wo Mathematik falsch sein kann, ohne dass man es sieht:
  BSDF-Energie, BVH gegen Brute Force, Layout-Spiegel TS ↔ WGSL. Keine Tests, die
  nur die Implementierung nachbilden.

**Leitprinzipien:**
1. **Schnittstellen zuerst.** Datenlayouts, Bind-Group-Konventionen und
   WGSL-Signaturen stehen in Phase 0 fest. Alle späteren Module bauen dagegen.
2. **Eine Szenenbeschreibung, zwei Renderer.** Raster und Path Tracer lesen dieselben
   Layer, Lichter, Kamera und dieselbe Garn-Auswertung (gemeinsames
   WGSL-Fasermodul). Kein zweites Modell der Szene.
3. **Fasern als Kurvenprimitive.** Strahlen schneiden runde Kegelsegmente, keine
   tessellierten Röhren.
4. **Export deterministisch, Vorschau schnell.** Export: gleiche Szene + Frame +
   Samples = gleiches Bild auf einem Gerät. Die Vorschau darf zeitlich
   wiederverwenden (ReSTIR, Cache, Denoiser).
5. **Worker zuerst.** Alles läuft im `worker-gpu-only`-Render-Host.
6. **Nie still scheitern.** Passt eine Szene nicht in die Gerätegrenzen, sagt das
   UI es und fällt sichtbar auf Raster zurück.

---

## 1. Ausgangslage

| Thema | Heute | Ort |
|---|---|---|
| Faser-Geometrie | Kamera-zugewandte Bänder pro Faser, auf der GPU per Vertex Pulling erzeugt (Instanz pro Faser + 4 Flyaway-Kanäle), Catmull-Rom bis 8 Unterteilungen | `src/engine/native3d/passes/StrandPass.ts`, `shaders/StrandScene.wgsl:107-234` |
| Faser-Shading | Kajiya-Kay / gewrapptes Lambert, R- und TRT-Highlights plus TT (Marschner/Karis), Ambient nur als Randabdunklung | `StrandScene.wgsl:283-352` |
| Schatten | Deep Opacity Maps von einem Licht, Austausch mit Meshes | `strandShadowMaps.ts`, `StrandShadowSample.wgsl` |
| Antialiasing | Hashed / 4x Coverage / Analytic (Kachel-Compute-Raster mit Radix Sort) | `StrandPass.ts:310-336`, `passes/strandRaster/` |
| Szenenziel | `rgba8unorm` + `depth24plus`: kein HDR, kein Tone Mapping | `sceneRenderer/constants.ts:2-3` |
| Meshes | nur Lambert | `shaders/MeshPass.wgsl` |
| Lichter | Point, Panel, Environment (mit HDRI-Referenz, wirkt aber nur als Ambient-Farbe); max. 4 direkte Lichter pro Strand-Layer | `src/types/light.ts`, `passes/strandLights.ts` |
| Pass-Reihenfolge | Strand-Schatten → Clear → Mesh → Plane → FaceCable → Voxel → Flock → Strands → Splats → transparente Planes | `src/engine/native3d/NativeSceneRuntime.ts:369-440` |
| Export | ein `renderSession.renderFrame` pro Frame | `src/engine/export/FrameExporter.ts:424-454` |
| Path Tracing, BVH, Denoise, TAA | nicht vorhanden | – |

Wiederverwendbar:
- `FlockRadixSort` für Morton-Codes.
- Die Garn-Funktionen aus `StrandScene.wgsl` und `strandFieldShader.ts`.
- GPU Surface Bind und Rod-Simulation: die Mittellinien liegen schon auf der GPU.
- Die Browser-Prüfseiten `tests/browser/weave-*-check.*` als Muster.

Dieser Plan ersetzt die Phase 6 im `Flock-Data-Sculpture-Plan.md` (HDR, ACES,
Offline-Qualität) für die Native-Szene.

---

## 2. Stand der Technik (SIGGRAPH 2016–2026) und Entscheidungen

| Bereich | Methode | Entscheidung |
|---|---|---|
| Faser-BSDF | Chiang et al. 2016 (pbrt-v4, Arnold, Cycles Principled Hair) | **übernehmen**: Farbe → Absorption σa, β_m/β_n, Kutikula-Neigung α, IOR 1,55 |
| Strahl–Kurve | Reshetov 2018 Phantom Intersector; NVIDIA 2025 Linear Swept Spheres | **übernehmen**, als Software-Schnitt in WGSL (keine RT-Kerne in WebGPU) |
| BVH | Karras 2012 LBVH, Refit bei gleicher Topologie, zweistufig (BLAS/TLAS) | **übernehmen** |
| Faser-LOD | Zhu et al. 2022 Fur-LoD-Aggregation; SIGGRAPH 2026 „Real-Time LoD Rendering with ReSTIR“ | **übernehmen**: stochastische Faservereinfachung in der Vorschau, passend zum Hashed-Modus |
| Direktes Licht in Echtzeit | ReSTIR DI (Bitterli 2020), zeitlich + räumlich | **übernehmen** |
| Indirektes Licht in Echtzeit | SHaRC (NVIDIA 2024, Spatially Hashed Radiance Cache, ohne Tensor-Kerne) | **übernehmen**: Pfade enden im Cache, das liefert die lange Mehrfachstreuung im Garn billig |
| Echtzeit-Denoise | A-SVGF (Schied 2018), demoduliert mit Albedo | **übernehmen**, faserbewusst (siehe 4.6) |
| Sub-Pixel-Fasern im G-Buffer | SIGGRAPH 2026 „Real-Time Neural Hair G-Buffer Anti-Aliasing“ | als Referenz für das Kantenproblem; neuronal erst bei Bedarf |
| Upscaling | eigener temporaler Upscaler in WGSL nach dem FSR-2-Prinzip (MIT) | **übernehmen**: Render Scale 0,5–1 |
| AI-Denoise Export / Stillstand | Intel OIDN 2 über `oidn-web` (WebGPU, GPU-Puffer rein und raus, FP16 optional) | **übernehmen** |
| Sampling | Owen-gescrambeltes Sobol (Burley 2020), Blue Noise | **übernehmen** |
| Raster-Mehrfachstreuung | Zinke 2008 Dual Scattering | **übernehmen**, für den Raster-Modus |
| Strick in Echtzeit | Kui Wu et al. 2025 „Real-Time Knit Deformation and Rendering“ | Referenz für Licht-Zerlegungen; nicht gebaut |
| Neuronale Stoffmodelle, neuronale Video-Denoiser | 2023–2026 | nicht gebaut: brauchen trainierte Netze bzw. sind nicht im Browser einsetzbar |

---

## 3. Leistungsziele

Alle Werte gelten für das RDNA3-Referenzgerät. Phase 0 misst die Ausgangslage. Sind
Ziele danach unrealistisch, werden sie im Statusboard angepasst und begründet.

| Fall | Ziel |
|---|---|
| Vorschau, Kamera in Bewegung, Szene „Knit Form“, 1080p-Ausgabe | ≥ 30 fps bei Render Scale 0,5; ≥ 20 fps bei 0,67 |
| Vorschau, animiertes Garn (Unravel, Rod-Simulation läuft) | ≥ 20 fps bei Render Scale 0,5 |
| Vorschau, Stillstand | sichtbar konvergiert in ≤ 2 s, danach OIDN-Politur |
| Export 1080p, 256 spp + OIDN | ≤ 20 s pro Frame, zweimal bitgleich |

---

## 4. Architektur

### 4.1 Verzeichnisse

```
src/engine/native3d/pathtrace/
  contracts/      Typen, Byte-Layouts, WGSL-Structs, Bind-Group-Konventionen
  scene/          Primitive packen, Faser-Emission, Layer-Adapter
  bvh/            LBVH-Bau, Refit, TLAS/BLAS, Traversierung, Schnitte
  integrator/     Megakernel, Sampler, AOVs, Kamera-Sampling
  materials/      Chiang-BSDF, GGX/Diffus, Plane- und Voxel-Material
  lights/         Lichtsampling, Environment-Importance
  realtime/       Bewegungsvektoren, ReSTIR DI, SHaRC, Akkumulation, A-SVGF, Upscaler
  denoise/        OIDN-Anbindung
  runtime/        PathTraceRuntime, Szenen-Signatur, Neustart, Stats
```

Jede Datei bleibt unter 700 Zeilen. WGSL-Module werden per String-Komposition
zusammengesetzt, wie in `strandShaders.ts`.

### 4.2 Ablauf pro Frame

```
Layer (Strands, Meshes, Planes, Voxel, Flock, FaceCables, Lights, Kamera)
  │
  ├─ Raster-Pfad (Engine „Raster“, ab Phase 1 in HDR)
  │
  └─ Path-Tracing-Pfad (Engine „Path Traced“)
       1. Faser-Emission (Compute): Mittellinien → Fasersegmente
          (gemeinsames Fasermodul, LOD abhängig vom Modus)
       2. BLAS-Update pro Layer: Refit bei gleicher Topologie, sonst Neubau
          (LBVH); TLAS über Instanzen jedes Frame
       3. Primärstrahlen → G-Buffer: Tiefe, Normale/Tangente, Albedo,
          Bewegungsvektor, Material-ID
       4. Direktes Licht: Vorschau ReSTIR DI (zeitlich + räumlich); Export NEE + MIS
       5. Indirektes Licht: Pfad mit Russian Roulette; Vorschau endet im
          SHaRC-Cache, Export läuft voll
       6. Vorschau: zeitliche Akkumulation → A-SVGF → Upscaler
          Export und Stillstand: Akkumulation → OIDN
       7. Tone Mapping → Scene-Textur. Splats werden darüber per Tiefe
          einkomponiert (wie heute)
```

### 4.3 Primitive

| Primitiv | Quelle | Schnitt |
|---|---|---|
| Fasersegment (runder Kegel, 2 Endpunkte + 2 Radien) | Strands, FaceCables, Flock-Kurven | analytisch, Phantom-Stil |
| Dreieck | Meshes, 3D-Text, Modelle (gleiche Daten wie `MeshPass`) | Möller-Trumbore, wasserdicht |
| Quad mit Textur und Alpha | Video- und Bild-Planes | analytisch, Alpha als Any-Hit |
| Kugel | Flock-Punkte | analytisch |
| Box | Voxel | Slab-Test, instanziert |

Das BVH arbeitet nur mit Bounding Boxes und kennt die Primitivtypen nicht. Die
Traversierung bietet zwei Abfragen: „nächster Treffer“ und „Durchlässigkeit bis
tmax“ (Schattenstrahlen durch Alpha und dünne Fasern).

### 4.4 Fasern

- Die WGSL-Funktionen für Ply-Offsets, Twist, Fasern, Flyaways und Radius-Felder
  kommen in Phase 0 aus `StrandScene.wgsl` in ein gemeinsames Modul
  `shaders/StrandFiberGeometry.wgsl`. Raster und Emission nutzen es beide.
- **Unterteilung** ist eine eigene Path-Tracing-Einstellung und hängt nicht von der
  Bildschirmgröße ab.
- **LOD in der Vorschau:** Entfernte Garne behalten einen gehashten Anteil ihrer
  Fasern, die entsprechend breiter werden. Der Faseranteil bleibt pro Garn über die
  Frames stabil.
- **Export:** alle Fasern.
- Die Topologie bleibt gleich, solange sich nur Positionen ändern (Cloth, Rod,
  Thread Along). Dann reicht ein Refit. Neubau, wenn die SAH-Kosten über eine
  Schwelle steigen oder sich die Topologie ändert.

### 4.5 Material, Licht, Kamera

- **Fasern:** Chiang-BSDF mit Lobes p = 0 bis 3 plus Restterm. Parameter aus dem
  Node `Fiber Material` (4.10), pro Punkt variierbar; ohne Material aus der Color
  des Strand Render.
- **Meshes:** Diffus + GGX (Rauheit, Metallic) als OpenPBR-Teilmenge, Basisdaten aus
  den MeshPass-Materialien und den neuen `material.surface`-Feldern (4.10).
- **Planes:** diffus mit Textur, Alpha als Durchlässigkeit, Rauheit, Metallic und
  Emission aus `material.surface`.
- **Voxel:** diffus mit Zellfarbe. **Flock-Punkte:** diffus mit Partikelfarbe.
- **Lichter:**
  - Point als Kugel mit Diameter.
  - Panel als Rechteck-Flächenlicht.
  - Environment mit HDRI und Alias-Tabelle; ohne HDRI als Farbe.
  - Ohne Lichter die feste Key-Light-Konvention des Rasters.
  - Keine Begrenzung auf 4 Lichter.
- **Kamera:** Belichtung (EV), Tone Mapping (AgX Standard, ACES, Neutral), f-Stop,
  Fokusdistanz, Shutter. Tiefenschärfe über Dünnlinsen-Sampling, Bewegungsunschärfe
  über eine Zeit pro Sample im Shutter-Intervall.
- **Bewegungsunschärfe:** BLAS-Refit pro Shutter-Unterzeit, im Export mit
  4–8 Unterzeiten. Simulationen interpolieren zwischen ihren 60-Hz-Schritten,
  neue Simulationsschritte gibt es dafür nicht.

### 4.6 Echtzeitpfad

- **Render Scale** 0,5 / 0,67 / 1. 1–2 spp pro Frame, Blue-Noise-Seeds.
- **ReSTIR DI:** Kandidaten aus allen Lichtern und dem Environment, zeitliche
  Wiederverwendung über Bewegungsvektoren, räumliche Wiederverwendung mit
  Normalen-/Tangenten-/Tiefen-Abgleich, Sichtbarkeitsstrahl am Ende.
- **SHaRC:**
  - Pfade ab Bounce 2 enden im Hash-Gitter-Cache.
  - Ein Teil der Pfade läuft weiter und trainiert den Cache.
  - Die Zellgröße folgt der Kameradistanz.
- **Akkumulation:** Reprojektion mit Abgleich von Tiefe und Material-ID. Die
  Historie wird bei Freilegung verworfen.
- **A-SVGF:**
  - Beleuchtung durch Albedo geteilt, Varianzschätzung, À-trous-Filter.
  - Bei Fasern gelten Tangente und Material-ID als Kantenkriterium, nicht die
    Normale. Sub-Pixel-Fasern bekommen eine Coverage-gewichtete G-Buffer-Albedo,
    damit der Filter sie nicht verwischt.
- **Upscaler:** temporal, mit Jitter-Folge, Begrenzung der Historie über die
  Farbspanne der Nachbarn und Schärfung.
- **Stillstand:** 1 spp pro Frame weiter in einen Akkumulationspuffer ohne ReSTIR-
  und Cache-Bias, bis das Sample-Ziel erreicht ist. Dann einmal OIDN (Modell
  „small“) und Ruhe ohne GPU-Last.

### 4.7 Exportpfad

- **Render Quality** im Export-Panel:
  - Raster: N Sub-Samples mit Jitter, Licht-Jitter, Shutter, Linse.
  - Path Traced: Samples pro Pixel, adaptives Sampling (Varianzschwelle),
    Zeitlimit pro Frame, Denoise an/aus.
- Seeds: Sobol-Index aus (Frame, Pixel, Sample), deterministisch.
- **OIDN** (Modell „standard“, HDR) mit Albedo- und Normalen-AOVs. Gegen Flackern:
  gleicher Scramble-Seed pro Pixel über alle Frames, genug Samples.
- Fortschritt verschachtelt: Frame i/N → Sample s/S → Denoise → Encode, mit
  Restzeit.

### 4.8 HDR für den Raster-Pfad

- `SCENE_COLOR_FORMAT` → `rgba16float` für alle Native-Pässe, inklusive
  Coverage- und Analytic-Resolve.
- Tone Mapping und Belichtung beim Übergang in den Compositor
  (`SceneTextureComposite.wgsl`), für Raster und Path Tracing gleich.
- Raster-Look: Dual Scattering für Strands, Environment als IBL
  (SH-Irradiance + vorgefilterte Mip-Kette) für Strands und Meshes. Die
  Fiber-Material-Parameter bilden sich auf das Raster-Shading ab,
  damit beide Modi ähnlich aussehen.

### 4.9 Bedienung

- **Render Engine** (Raster / Path Traced) an der Composition. Der Export übernimmt
  sie, das Export-Panel kann überschreiben.
- **Vorschau:** Umschalter und Render Scale im Preview-Panel. Einblendung mit spp,
  ms pro Frame und Status. Optional Render Region.
- **Nodes:** Fiber Material, Strand Render und `material.surface` wie in 4.10.
- **3D-Kamera:** Exposure, Tone Mapping, f-Stop, Fokusdistanz, Shutter.
- **UI-Regeln:** Inspector-Primitive (`ResolveInspectorSection`,
  `ResolveInspectorNumberRow`, `InspectorSelect`) und Pointer-Fokus-Hygiene nach
  AGENTS.md Abschnitt 9.
- **AI-Agent:** kein neues Tool. Er findet die neuen Nodes über den Katalog und
  bearbeitet sie über `editOperatorGraph`.

### 4.10 Nodes

Material und Darstellung werden im Node-Graphen getrennt. Rendereinstellungen
werden keine Nodes.

**Neuer allgemeiner Node `Fiber Material`** (Weave-Graph, Domain `geometry`, Kategorie
„Shading“):
- Eingang: Curves.
- Ausgang: Curves mit Material.
- Parameter: Color, Absorption-Modus (aus Farbe / Melanin), Melanin, Rauheit
  längs (β_m) und quer (β_n), Cuticle Tilt, IOR. Dazu Coat Tint für die
  R-Reflexion, eine Mischung für den matten Restanteil und Fuzz für die
  Flyaways.
- Color, Rauheit und Melanin kommen optional **pro Punkt** über Felder (Ramp
  entlang Curve Param, Noise, Math), genauso wie heute die Radius-Felder der Yarn
  Profile.
- Für den Raster-Pfad werden die Werte auf die bestehenden Highlight-Parameter
  abgebildet (4.8); für den Path Tracer gelten sie als Chiang-Parameter.
- Mehrere Fiber Materials in einem Graphen sind erlaubt, etwa über Strand-Index
  oder Selektion. Jede Kurve trägt eine Material-ID.
- Presets im Node: Wolle, Baumwolle, Seide, Synthetik, Haar (Schritt 4.3 kalibriert
  sie).
- Der Node ist allgemein: Haare, Gras und Kabel nutzen ihn später genauso.

**Strand Render** bleibt der Ausgabe-Node:
- Width, Antialiasing und neu **Subdivision** für den Path Tracer.
- Ohne vorgeschaltetes Fiber Material gilt wie bisher seine Color. Bestehende
  Projekte sehen unverändert aus.
- Mit Fiber Material ist Color ausgegraut und als „vom Material“ beschriftet.

**`material.surface`** (Scene-Graph der Planes, `clip.nodeGraph.scene`) bekommt:
- Roughness, Metallic, Emission (Farbe + Stärke) und Emission aus Textur.
- Die Standardwerte (Roughness 1, Metallic 0, Emission 0) erhalten das heutige
  Aussehen.
- Meshes ohne Scene-Graph nutzen dieselben Felder über ihr Clip-Material.

**Bewusst keine Nodes:**
- Render Engine, Samples, Render Scale und Denoise sind Einstellungen der
  Composition bzw. des Exports.
- Lichter und Kamera bleiben Clips.

**Pflichten für jeden neuen oder geänderten Node:**
- Registrierung und Validierung: `geometryProgram.ts` und
  `geometryProgramValidation.ts` prüfen feste Schlüssel und brauchen die neuen
  Felder bzw. die neue Stufe. Dazu `sceneGraph.ts` für `material.surface`.
- Persistenz: Feldklassifizierung im Project-Repository. Laufzeit-Handles nie in
  die Projektdaten.
- Katalogtexte, damit der AI-Agent die Nodes über `searchNodeCatalog` findet. Die
  Bearbeitung läuft über `editOperatorGraph`, ohne neues Tool.
- Material-Werte lassen sich über Value-Nodes im Effects-Tab einblenden und
  keyframen.
- Einordnung laut `Node-Taxonomy-Plan.md`: Fiber Material und `material.surface`
  unter „Shading“, Strand Render unter „Output & Render“.
- Doku: `Node-Catalog.md`, `Weave.md`, `3D-Layers.md`.
- Standard-Weave-Graph: Fiber Material (Preset Wolle) zwischen Flyaways und
  Surface Bind. Neue Projekte bekommen es, bestehende bleiben unverändert.

### 4.11 Geräte und Grenzen

- `maxStorageBufferBindingSize` prüfen, große Szenen auf mehrere Puffer aufteilen.
  Was trotzdem nicht passt, lehnt der Path Tracer mit Hinweis ab.
- Lange Dispatches (Export, hohe spp) in Kacheln von höchstens etwa 50 ms GPU.
  Sonst setzt der Treiber das Gerät zurück (TDR).
- `shader-f16` nur, wenn vorhanden.
- Linux/Mesa: Ergebnis auslesen, nie stillen Erfolg annehmen
  (`docs/Features/Linux-Mesa-GPU.md`).
- HMR: GPU-Ressourcen hängen an der bestehenden `NativeSceneRuntime` und überleben
  HMR wie die übrigen Pässe.

---

## 5. Phase 0: Grundlagen

Alles Folgende baut darauf auf:

1. **Gemeinsame Typen und Layouts** in `pathtrace/contracts/`:
   - `ptTypes.ts`: Settings, Frame-Eingaben (Kamera aktuell + vorher, Jitter,
     Frame-Index, Zeit, Shutter), AOV-Satz, Engine-Typ.
   - `ptLayouts.ts`: Byte-Layouts für Primitive, BVH-Knoten, Instanzen, Lichter,
     Materialien, Treffer, Reservoir, Cache-Eintrag.
   - Fasersegmente tragen von Anfang an eine Material-ID und Attributplätze
     pro Punkt (Farbe, Rauheit, Melanin), interpoliert entlang des Segments.
     Material-Tabelle für Fasern (Chiang-Parameter) und Oberflächen (Rauheit,
     Metallic, Emission).
   - `PtCommon.wgsl`: Structs als Spiegel der Layouts.
   - Bind-Gruppen: 0 Frame, 1 Szene/BVH, 2 Lichter/Materialien, 3 Ausgaben.
   - Feste WGSL-Schnittstellen, gegen die die späteren Module gebaut werden:
     - `pt_trace_closest(ray) -> PtHit`,
     - `pt_trace_transmittance(ray, tmax) -> f32`,
     - `pt_bsdf_eval/sample/pdf`,
     - `pt_sample_light`,
     - `pt_cache_query/update`.
2. **Fasermodul extrahieren**: `shaders/StrandFiberGeometry.wgsl` aus
   `StrandScene.wgsl`, verhaltensgleich.
3. **Referenzszenen** als Prüfseite `tests/browser/pathtrace-check.html`:
   - Standard-Weave mit Key-Light,
   - Knit Form mit Panel-Licht und Navy-Hintergrund,
   - Kreuzknoten auf Boden mit HDRI.
   Zeitmessung und Readback-Prüfung.
4. **Ausgangsmessung**: Segmentzahlen, Speicher, Raster-Zeiten → Statusboard.

**Prüfung Phase 0:**
- `tsc -b`.
- Layout-Spiegeltest.
- Prüfseite lädt; die `weave-*-check`-Seiten bleiben unverändert.
- Commit.

---

## 6. Phasen 1–4

Ein Agent arbeitet die Schritte der Reihe nach ab, ohne nach jedem Schritt zu
testen. Am Ende jeder Phase wird gesammelt geprüft und committet. Zwischen den
Schritten reicht es, Diffs zu lesen.

### Phase 1: Grundbausteine

| Schritt | Inhalt |
|---|---|
| 1.1 | HDR-Umstellung aller Native-Pässe (inkl. Coverage- und Analytic-Resolve), Tone Mapping und Belichtung im Composite |
| 1.2 | Settings, Typen, Persistenz und UI-Felder (Engine, Kamera, Export Render Quality) |
| 1.3 | Faser-Emission (Compute) über das gemeinsame Fasermodul, LOD-Hashing, Segment-Puffer |
| 1.4 | LBVH-Bau: Morton → `FlockRadixSort` → Karras-Hierarchie → AABB bottom-up; Refit |
| 1.5 | Sobol/Owen + Blue Noise; Chiang-BSDF in WGSL plus TS-Referenz (eval/sample/pdf) |
| 1.6 | GGX/Diffus, Plane- und Voxel-Material, Alpha |
| 1.7 | Nodes nach 4.10: Fiber Material (Stufe, Felder pro Punkt, Material-IDs, Presets), Strand Render (Subdivision, Color-Verhalten), `material.surface` (Roughness, Metallic, Emission); Validierung, Persistenz, Katalogtexte, Taxonomie, Standardgraph; Raster liest das Fiber Material sofort |

**Prüfung Phase 1:**
- `tsc -b`.
- Vitest: Chiang-Energie (White Furnace), LBVH gegen Brute Force auf Zufallsstrahlen
  mit CPU-Referenz, Layout-Spiegel.
- Vitest: Validierung und Persistenz der neuen Node-Felder (alte Projekte laden
  unverändert).
- Eine Browser-Sitzung: Weave-Prüfseiten in HDR, neue UI-Felder (Pointer- und
  Tastaturfokus), Fiber Material im Node-Editor mit Ramp pro Punkt.
- Commit.

### Phase 2: Path-Tracing-Kern

| Schritt | Inhalt |
|---|---|
| 2.1 | Traversierung (Stack, `pt_trace_closest`, `pt_trace_transmittance`), Schnitte für Fasersegment, Dreieck, Quad |
| 2.2 | Zweistufiges BVH (BLAS pro Layer, TLAS pro Frame), Mesh- und Plane-Upload, Neubau-/Refit-Politik, Puffer-Aufteilung |
| 2.3 | Lichtsampling (Point, Panel, Environment mit Alias-Tabelle), NEE + MIS |
| 2.4 | Megakernel-Integrator: Bounces, Russian Roulette, Firefly-Klemmung, AOVs, Tiefenschärfe, Shutter-Zeit |
| 2.5 | `PathTraceRuntime`: Szenen-Signatur, Akkumulations-Neustart, Verzweigung in `NativeSceneRuntime`, Worker-Projektion, Debug-Ansichten (Albedo, Normale, Tiefe, BVH-Heatmap) |
| 2.6 | OIDN über `oidn-web`: Gewichte im eigenen Asset-Pfad, GPU-Puffer, Kacheln, FP16-Fallback; Lizenzen prüfen und in `LICENSING.md` eintragen |

**Prüfung Phase 2:**
- `tsc -b`.
- Vitest: Schnitttests gegen CPU-Referenz, MIS-Gewichte.
- Eine Browser-Sitzung im Editor mit dem Weave-Projekt: Path Traced zeigt ein
  konvergierendes Bild, Debug-Ansichten stimmen, Raster unverändert.
- Commit.

### Phase 3: Echtzeit, Export, Look

| Schritt | Inhalt |
|---|---|
| 3.1 | Bewegungsvektoren aus Kamera- und Objektbewegung, Reprojektion, zeitliche Akkumulation |
| 3.2 | ReSTIR DI (Kandidaten, zeitlich, räumlich, Sichtbarkeit über `pt_trace_transmittance`) |
| 3.3 | SHaRC: Hash-Gitter, Update-Pass, Abfrage am Pfadende, Zellgröße nach Distanz |
| 3.4 | A-SVGF faserbewusst; temporaler Upscaler mit Render Scale |
| 3.5 | Bewegungsunschärfe mit Refit pro Unterzeit, Simulation interpoliert; deterministische Export-Seeds |
| 3.6 | Export: Render Quality (Raster-Sub-Samples und Path Traced), adaptives Sampling, Zeitlimit, OIDN, Fortschritt mit Restzeit |
| 3.7 | Weitere Layer: FaceCables und Flock-Kurven als Fasersegmente, Flock-Punkte als Kugeln, Voxel als Boxen |
| 3.8 | Raster-Look: Dual Scattering, IBL für Strands und Meshes, Abbildung der PT-Parameter |

**Prüfung Phase 3:**
- `tsc -b`.
- Vitest nur für neue Mathematik (Cache-Hash, Varianzschätzung).
- Eine Browser-Sitzung:
  - Kamerafahrt und Unravel-Playback in Path Traced mit fps-Messung gegen
    Abschnitt 3,
  - kurzer Export zweimal mit Vergleich auf Bitgleichheit,
  - Raster mit HDR-Look.
- Commit.

### Phase 4: Vorschau fertig und Leistung

| Schritt | Inhalt |
|---|---|
| 4.1 | Stillstands-Akkumulation ohne Bias, Übergang Bewegung ↔ Stillstand ohne Sprung; OIDN-Politur im Stillstand (Modell „small“) |
| 4.2 | Traversierungsleistung: Stack im Workgroup-Speicher, Strahlsortierung, BVH-Qualität (Treelet/SAH); Wavefront-Variante nur, wenn die Messung Divergenz zeigt |
| 4.3 | Abgleich der Faser-Mehrfachstreuung gegen Referenzbilder mit hoher spp; Kalibrierung der Fiber-Material-Presets (Wolle, Baumwolle, Seide, Synthetik, Haar) |
| 4.4 | Vorschau-UX: Umschalter, Presets, Einblendung, Render Region, Fallback-Hinweise |
| 4.5 | Doku: `docs/Features/Path-Tracing.md`, `Weave.md`, `3D-Layers.md`, `Node-Catalog.md`, README |

**Prüfung Phase 4 = Abnahme gesamt:**
- `tsc -b`, gesammelter Vitest-Lauf aller Path-Tracing-Testdateien.
- Eine Browser-Sitzung mit allen Zielen aus Abschnitt 3 und dem Vergleich Raster ↔
  Path Traced an festen Frames.
- Export der Referenzszene.
- `npm run build` einmal am Ende (oder wenn der Nutzer ihn verlangt).
- Commit, Plan-Status auf „umgesetzt“.

---

## 7. Arbeitsweise

- **Ein Agent baut alles selbst.** Keine Codex-Worker, keine parallelen Lanes, keine
  Subagenten für die Implementierung.
- **Reihenfolge:** Phasen und Schritte wie in Abschnitt 6. Ein Schritt darf
  vorgezogen werden, wenn er für einen anderen gebraucht wird.
- **Zwischen den Schritten:** keine Tests, kein Build, kein Browser; Diffs lesen
  reicht.
- **Am Phasenende:** gesammelte Prüfung wie oben. Erneut geprüft wird nur, was ein
  Fix berührt.
- **Commits:** am Phasenende, bei großen Phasen auch nach fertigen Teilblöcken. Mit
  expliziten Pfaden (`git commit -- <pfade>`), einzeiliger Conventional-Commit-Text
  auf Englisch, z. B. `feat(pathtrace): add LBVH build and refit`.
  - Vorher prüfen, dass `origin` auf `Sportinger/MasterSelects` zeigt.
  - Fremde Änderungen anderer Agenten bleiben unberührt.
  - Kein bekannt kaputter Zwischenstand.
  - Kein Push ohne Auftrag.
- **Rückfragen** nur bei echten Blockern, die nur der Nutzer lösen kann.
- **Plan aktuell halten:** Statusboard (Abschnitt 8) nach jeder Phase, Befunde und
  angepasste Ziele mit Begründung.

---

## 8. Statusboard

| Phase | Status | Commit | Notiz |
|---|---|---|---|
| 0 Grundlagen | erledigt | `9030f149` | Verträge in `pathtrace/contracts/`, `StrandFiberGeometry.wgsl` extrahiert, Prüfseite `pathtrace-check.html`; Weave-Prüfseiten unverändert grün |
| 1 Grundbausteine | erledigt | Phase-1-Commit | HDR-Szene (`rgba16float`) mit Tone-Map-Pass; Standard + 0 EV ist bitgleich zum alten 8-Bit-Ziel (Weave-Prüfseiten zeigen identische Zahlen). Splat-Pipelines sind formatabhängig. Composition `renderSettings`, Kamera-Linse (Exposure, Tone Mapping, f-Stop, Fokus, Shutter, keyframebar), Export Render Quality, alles persistiert. Faser-Emission, GPU-LBVH mit Refit und SAH-Schätzung (Knoten für Knoten gleich zur CPU-Referenz, `pathtrace-kernels-check.html`), Sobol/Owen und Blue Noise, Chiang-BSDF (White Furnace grün), GGX/Diffus. Fiber Material als Render-Eigenschaft statt Kurvenstufe, damit die GPU-Ketten für Stoff und Seile erhalten bleiben; das Raster liest Farbe und Rauheit pro Punkt. `material.surface` mit Roughness, Metallic und Emission. Befund: Hidden-Primitive brauchen in der Traversierung einen expliziten Leer-Test der Bounds. |
| 2 Path-Tracing-Kern | offen | – | – |
| 3 Echtzeit, Export, Look | offen | – | – |
| 4 Vorschau fertig und Leistung | offen | – | – |

Ausgangsmessung (Phase 0):

| Szene | Fasersegmente | Speicher | Raster ms (GPU) |
|---|---|---|---|
| Standard-Weave | 12 288 Kurven-, 466 944 PT-Segmente (Unterteilung 2) | 49,9 MB (Segmente + BVH) | 7,73 |
| Knit Form | 6 720 Kurven-, 295 680 PT-Segmente | 31,6 MB | 3,67 |
| Kreuzknoten | 840 Kurven-, 31 920 PT-Segmente | 3,4 MB | 1,25 |

Gemessen auf AMD RDNA3 (Chrome, Timestamp-Queries um die Szenen-Submission), 1920×1080,
`tests/browser/pathtrace-check.html`. Raster-Stücke: Standard-Weave 1,87 Mio., Knit Form 1,03 Mio.
Befund: Die Segmentzahlen liegen bei unter 0,5 Mio. pro Szene; ein LBVH darüber passt bequem in
den Speicher. Die Ziele aus Abschnitt 3 bleiben vorerst unverändert; die erste echte Prüfung ist
die fps-Messung am Ende von Phase 3.

---

## 9. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Software-Traversierung zu langsam für die Ziele | Faser-LOD, Render Scale, Schritt 4.2, Wavefront; Ziele nach der Messung in Phase 0 anpassen |
| Speichergrenzen bei großen Geweben | Puffer aufteilen, kompakte Segmente (16-Bit-Offsets relativ zum Garn), sichtbare Ablehnung |
| Fasern unter Pixelgröße verwischen im Denoiser | Tangenten-/Material-Kanten, Coverage-gewichtete Albedo, höhere spp im Stillstand |
| Fireflies durch TRT-Lobes und kleine Lichter | MIS, ReSTIR, Klemmung indirekter Beiträge |
| Flackern im Export-Denoise | genug spp, gleiche Scramble-Seeds pro Pixel |
| HDR-Umstellung bricht bestehende Pässe | Schritt 1.1 zuerst, Weave-Prüfseiten am Ende von Phase 1 |
| Gesammelte Prüfung findet Fehler spät | Diffs zwischen den Schritten lesen, Fixes nur gezielt nachprüfen |

---

## 10. Quellen

- Chiang, Bitterli, Tappan, Burley: *A Practical and Controllable Hair and Fur Model
  for Production Path Tracing*, EGSR 2016.
- Reshetov, Luebke: *Phantom Ray-Hair Intersector*, HPG 2018.
- Karras: *Maximizing Parallelism in the Construction of BVHs, Octrees, and k-d
  Trees*, HPG 2012.
- Bitterli et al.: *Spatiotemporal Reservoir Resampling* (ReSTIR), SIGGRAPH 2020.
- Schied et al.: *Gradient Estimation for Real-Time Adaptive Temporal Filtering*
  (A-SVGF), HPG 2018.
- NVIDIA: *SHaRC – Spatially Hashed Radiance Cache*, 2024.
- Zhu et al.: *Practical Level-of-Detail Aggregation of Fur Appearance*,
  SIGGRAPH 2022.
- Zinke, Yuksel, Weber, Keyser: *Dual Scattering Approximation for Fast Multiple
  Scattering in Hair*, SIGGRAPH 2008.
- Burley: *Practical Hash-based Owen Scrambling*, JCGT 2020.
- Kui Wu et al.: *Real-Time Knit Deformation and Rendering*, SIGGRAPH 2025,
  https://kuiwuchn.github.io/rtstitch.html
- SIGGRAPH 2026 Papers (ReSTIR LoD, Spatiotemporal Neural Denoising),
  https://keenancrane.github.io/siggraph-papers-schedule/
- *Real-Time Neural Hair G-Buffer Anti-Aliasing*, https://arxiv.org/abs/2605.17557
- Intel Open Image Denoise, https://www.openimagedenoise.org/;
  `oidn-web`, https://github.com/pissang/oidn-web
- AMD FidelityFX Super Resolution 2 (MIT), als Vorlage für den temporalen Upscaler.
