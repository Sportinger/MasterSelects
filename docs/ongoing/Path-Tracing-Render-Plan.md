# Path Tracing in Echtzeit und AI-Denoise für die Native-3D-Szene

Stand: 2026-10-04. **Status: Plan, nichts umgesetzt.**
Ausführung: ein Orchestrator (Claude Code) mit fünf Codex-Lanes, siehe Abschnitt 7.

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
- Lanes arbeiten durch, ohne nach jedem Paket zu testen.
- Geprüft wird gesammelt am Ende einer Wave: eine `tsc`-Runde, ein Vitest-Lauf
  über die benannten Dateien, eine Browser-Sitzung.
- Ein Build nur am Ende des Plans bzw. wenn der Nutzer ihn verlangt.
- Tests gibt es nur dort, wo Mathematik falsch sein kann, ohne dass man es sieht:
  BSDF-Energie, BVH gegen Brute Force, Layout-Spiegel TS ↔ WGSL. Keine Tests, die
  nur die Implementierung nachbilden.

**Leitprinzipien:**
1. **Verträge zuerst.** Datenlayouts, Bind-Group-Konventionen und WGSL-Signaturen
   legt der Orchestrator in Wave 0 fest. Danach arbeiten die Lanes parallel gegen
   diese Verträge, ohne aufeinander zu warten.
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

Alle Werte gelten für das RDNA3-Referenzgerät. Wave 0 misst die Ausgangslage. Sind
Ziele danach unrealistisch, passt der Orchestrator sie im Statusboard an und
begründet es.

| Fall | Ziel |
|---|---|
| Vorschau, Kamera in Bewegung, Szene „Knit Form“, 1080p-Ausgabe | ≥ 30 fps bei Render Scale 0,5; ≥ 20 fps bei 0,67 |
| Vorschau, animiertes Garn (Unravel, Rod-Simulation läuft) | ≥ 20 fps bei Render Scale 0,5 |
| Vorschau, Stillstand | sichtbar konvergiert in ≤ 2 s, danach OIDN-Politur |
| Export 1080p, 256 spp + OIDN | ≤ 20 s pro Frame, zweimal bitgleich |

---

## 4. Architektur

### 4.1 Verzeichnisse und Besitz

```
src/engine/native3d/pathtrace/
  contracts/      Orchestrator   Typen, Byte-Layouts, WGSL-Structs, Bind-Group-Konventionen
  scene/          Lane 1         Primitive packen, Faser-Emission, Layer-Adapter
  bvh/            Lane 1         LBVH-Bau, Refit, TLAS/BLAS, Traversierung, Schnitte
  integrator/     Lane 2         Megakernel, Sampler, AOVs, Kamera-Sampling
  materials/      Lane 2         Chiang-BSDF, GGX/Diffus, Plane- und Voxel-Material
  lights/         Lane 2         Lichtsampling, Environment-Importance
  realtime/       Lane 3         Bewegungsvektoren, ReSTIR DI, SHaRC, Akkumulation, A-SVGF, Upscaler
  denoise/        Lane 4         OIDN-Anbindung
  runtime/        Lane 5         PathTraceRuntime, Szenen-Signatur, Neustart, Stats
```

Jede Datei bleibt unter 700 Zeilen. WGSL-Module werden per String-Komposition
zusammengesetzt, wie in `strandShaders.ts`.

### 4.2 Ablauf pro Frame

```
Layer (Strands, Meshes, Planes, Voxel, Flock, FaceCables, Lights, Kamera)
  │
  ├─ Raster-Pfad (Engine „Raster“, ab Wave 1 in HDR)
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
  zieht der Orchestrator in Wave 0 aus `StrandScene.wgsl` in ein gemeinsames Modul
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

- **Fasern:** Chiang-BSDF mit Lobes p = 0 bis 3 plus Restterm. Absorption aus der
  Garnfarbe; Rauheit, Neigung und IOR am Strand Render.
- **Meshes:** Diffus + GGX (Rauheit, Metallic) als OpenPBR-Teilmenge, Basisdaten aus
  den MeshPass-Materialien.
- **Planes:** diffus mit Textur, Alpha als Durchlässigkeit, optional Emission.
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
  Path-Tracing-Parameter am Strand Render bilden sich auf das Raster-Shading ab,
  damit beide Modi ähnlich aussehen.

### 4.9 Bedienung

- **Render Engine** (Raster / Path Traced) an der Composition. Der Export übernimmt
  sie, das Export-Panel kann überschreiben.
- **Vorschau:** Umschalter und Render Scale im Preview-Panel. Einblendung mit spp,
  ms pro Frame und Status. Optional Render Region.
- **Strand Render:** Gruppe „Path Tracing“ (Fiber Roughness, Cuticle Tilt, IOR,
  Absorption aus Farbe oder Melanin, Subdivision).
- **3D-Kamera:** Exposure, Tone Mapping, f-Stop, Fokusdistanz, Shutter.
- **UI-Regeln:** Inspector-Primitive (`ResolveInspectorSection`,
  `ResolveInspectorNumberRow`, `InspectorSelect`) und Pointer-Fokus-Hygiene nach
  AGENTS.md Abschnitt 9.
- **AI-Agent:** keine Änderung. Er bearbeitet Strand-Render-Werte schon über
  `editOperatorGraph`.

### 4.10 Geräte und Grenzen

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

## 5. Wave 0: Orchestrator allein

Ohne Lanes, weil alles Folgende davon abhängt:

1. **Verträge** in `pathtrace/contracts/`:
   - `ptTypes.ts`: Settings, Frame-Eingaben (Kamera aktuell + vorher, Jitter,
     Frame-Index, Zeit, Shutter), AOV-Satz, Engine-Typ.
   - `ptLayouts.ts`: Byte-Layouts für Primitive, BVH-Knoten, Instanzen, Lichter,
     Materialien, Treffer, Reservoir, Cache-Eintrag.
   - `PtCommon.wgsl`: Structs als Spiegel der Layouts.
   - Bind-Gruppen: 0 Frame, 1 Szene/BVH, 2 Lichter/Materialien, 3 Ausgaben.
   - **Signaturen mit Stub-Rümpfen**, damit jede Lane sofort kompiliert:
     - `pt_trace_closest(ray) -> PtHit`,
     - `pt_trace_transmittance(ray, tmax) -> f32`,
     - `pt_bsdf_eval/sample/pdf`,
     - `pt_sample_light`,
     - `pt_cache_query/update`.
     Jede Lane ersetzt nur die Rümpfe ihrer eigenen Funktionen.
2. **Fasermodul extrahieren**: `shaders/StrandFiberGeometry.wgsl` aus
   `StrandScene.wgsl`, verhaltensgleich.
3. **Referenzszenen** als Prüfseite `tests/browser/pathtrace-check.html`:
   - Standard-Weave mit Key-Light,
   - Knit Form mit Panel-Licht und Navy-Hintergrund,
   - Kreuzknoten auf Boden mit HDRI.
   Zeitmessung und Readback-Prüfung.
4. **Ausgangsmessung**: Segmentzahlen, Speicher, Raster-Zeiten → Statusboard.
5. **Codex-Probe**: ein Mini-Paket, das in `pathtrace/runtime/` eine Datei anlegt.
   Damit sind Sandbox-Flags, Schreibrecht und Bericht geprüft (Abschnitt 7.2).
6. Eine Prüfrunde für Wave 0: `tsc -b`, Layout-Spiegeltest, Prüfseite lädt, die
   `weave-*-check`-Seiten bleiben unverändert. Commit.

---

## 6. Waves und Pakete

Fünf Lanes laufen parallel, je ein Worker pro Lane. Innerhalb einer Lane laufen die
Pakete nacheinander. Abhängigkeiten zwischen Lanes gehen nur über die Verträge und
Stubs, deshalb wartet keine Lane innerhalb einer Wave auf eine andere.

| Lane | Thema | Schreibbereich |
|---|---|---|
| **L1 Geometrie** | Emission, Primitive, BVH, Traversierung | `pathtrace/scene/`, `pathtrace/bvh/` |
| **L2 Licht & Material** | Sampler, BSDFs, Lichter, Integrator | `pathtrace/integrator/`, `pathtrace/materials/`, `pathtrace/lights/` |
| **L3 Echtzeit** | Bewegungsvektoren, ReSTIR, SHaRC, Akkumulation, A-SVGF, Upscaler | `pathtrace/realtime/` |
| **L4 Bild** | HDR-Umstellung, Tone Mapping, Raster-Look, OIDN | `pathtrace/denoise/`, `sceneRenderer/constants.ts`, `sceneRenderer/targets.ts`, `SceneTextureComposite.wgsl`, `StrandScene.wgsl` (nur Shading), `MeshPass.wgsl`, `StrandCoverageTargets.ts`, `passes/strandRaster/`, neues `native3d/ibl/` |
| **L5 Integration** | Runtime, Worker, Export, Settings, UI, Doku | `pathtrace/runtime/`, `NativeSceneRuntime.ts`, `sceneRenderer/drawPlan.ts`, `workerGpuNativeSceneProjection.ts`, `src/engine/export/`, Typen/Stores für Composition, Kamera, Strand Render (`geometryProgram*.ts`, `curveOperators.ts`), UI-Komponenten, `docs/Features/` |

### Wave 1: Grundlagen

| Paket | Inhalt |
|---|---|
| L1-1 | Faser-Emission (Compute) über das gemeinsame Fasermodul, LOD-Hashing, Segment-Puffer |
| L1-2 | LBVH-Bau: Morton → `FlockRadixSort` → Karras-Hierarchie → AABB bottom-up; Refit |
| L2-1 | Sobol/Owen + Blue Noise; Chiang-BSDF in WGSL plus TS-Referenz (eval/sample/pdf) |
| L2-2 | GGX/Diffus, Plane- und Voxel-Material, Alpha |
| L3-1 | Bewegungsvektoren aus aktueller und vorheriger Kamera und Objektbewegung; Reprojektion und zeitliche Akkumulation gegen den AOV-Vertrag |
| L4-1 | HDR-Umstellung aller Native-Pässe, Tone Mapping und Belichtung im Composite |
| L5-1 | Settings, Typen, Persistenz und UI-Felder (Engine, Kamera, Strand Render „Path Tracing“, Export Render Quality) |

**Prüfung Wave 1:**
- `tsc -b`.
- Vitest: Chiang-Energie (White Furnace), LBVH gegen Brute Force auf Zufallsstrahlen
  mit CPU-Referenz, Layout-Spiegel.
- Eine Browser-Sitzung: Weave-Prüfseiten in HDR, neue UI-Felder (Pointer- und
  Tastaturfokus).
- Commit pro Lane.

### Wave 2: Kern

| Paket | Inhalt |
|---|---|
| L1-3 | Traversierung (Stack, `pt_trace_closest`, `pt_trace_transmittance`), Schnitte für Fasersegment, Dreieck, Quad |
| L1-4 | Zweistufiges BVH (BLAS pro Layer, TLAS pro Frame), Mesh- und Plane-Upload, Neubau-/Refit-Politik, Puffer-Aufteilung |
| L2-3 | Lichtsampling (Point, Panel, Environment mit Alias-Tabelle), NEE + MIS |
| L2-4 | Megakernel-Integrator: Bounces, Russian Roulette, Firefly-Klemmung, AOVs, Tiefenschärfe, Shutter-Zeit |
| L3-2 | ReSTIR DI (Kandidaten, zeitlich, räumlich, Sichtbarkeit über `pt_trace_transmittance`) |
| L4-2 | OIDN über `oidn-web`: Gewichte im eigenen Asset-Pfad, GPU-Puffer, Kacheln, FP16-Fallback; Lizenzen prüfen und in `LICENSING.md` eintragen |
| L5-2 | `PathTraceRuntime`: Szenen-Signatur, Akkumulations-Neustart, Verzweigung in `NativeSceneRuntime`, Worker-Projektion, Debug-Ansichten (Albedo, Normale, Tiefe, BVH-Heatmap) |

**Prüfung Wave 2:**
- `tsc -b`.
- Vitest: Schnitttests gegen CPU-Referenz, MIS-Gewichte.
- Eine Browser-Sitzung im Editor mit dem Weave-Projekt: Path Traced zeigt ein
  konvergierendes Bild, Debug-Ansichten stimmen, Raster unverändert.
- Commit.

### Wave 3: Echtzeit, Export, Look

| Paket | Inhalt |
|---|---|
| L1-5 | Weitere Layer: FaceCables und Flock-Kurven als Fasersegmente, Flock-Punkte als Kugeln, Voxel als Boxen |
| L2-5 | Bewegungsunschärfe mit Refit pro Unterzeit, Simulation interpoliert; deterministische Export-Seeds |
| L3-3 | SHaRC: Hash-Gitter, Update-Pass, Abfrage am Pfadende, Zellgröße nach Distanz |
| L3-4 | A-SVGF faserbewusst; temporaler Upscaler mit Render Scale |
| L4-3 | Raster-Look: Dual Scattering, IBL für Strands und Meshes, Abbildung der PT-Parameter |
| L5-3 | Export: Render Quality (Raster-Sub-Samples und Path Traced), adaptives Sampling, Zeitlimit, OIDN, Fortschritt mit Restzeit |

**Prüfung Wave 3:**
- `tsc -b`.
- Vitest nur für neue Mathematik (Cache-Hash, Varianzschätzung).
- Eine Browser-Sitzung:
  - Kamerafahrt und Unravel-Playback in Path Traced mit fps-Messung gegen
    Abschnitt 3,
  - kurzer Export zweimal mit Vergleich auf Bitgleichheit,
  - Raster mit HDR-Look.
- Commit.

### Wave 4: Vorschau fertig und Leistung

| Paket | Inhalt |
|---|---|
| L1-6 | Traversierungsleistung: Stack im Workgroup-Speicher, Strahlsortierung, BVH-Qualität (Treelet/SAH); Wavefront-Variante nur, wenn die Messung Divergenz zeigt |
| L2-6 | Abgleich der Faser-Mehrfachstreuung gegen Referenzbilder mit hoher spp; Rauheits- und Absorptions-Presets für typische Garne |
| L3-5 | Stillstands-Akkumulation ohne Bias, Übergang Bewegung ↔ Stillstand ohne Sprung |
| L4-4 | OIDN-Politur im Stillstand (Modell „small“), Firefly-Behandlung der Denoise-Eingaben |
| L5-4 | Vorschau-UX: Umschalter, Presets, Einblendung, Render Region, Fallback-Hinweise; Feature-Seite `docs/Features/Path-Tracing.md`, `Weave.md`, `3D-Layers.md`, README |

**Prüfung Wave 4 = Abnahme gesamt:**
- `tsc -b`, gesammelter Vitest-Lauf aller Path-Tracing-Testdateien.
- Eine Browser-Sitzung mit allen Zielen aus Abschnitt 3 und dem Vergleich Raster ↔
  Path Traced an festen Frames.
- Export der Referenzszene.
- `npm run build` einmal am Ende (oder wenn der Nutzer ihn verlangt).
- Commit, Plan-Status auf „umgesetzt“.

Fehler aus einer Prüfung werden als Fix-Pakete in die nächste Wave oder sofort als
einzelnes Paket der betroffenen Lane nachgeschoben. Erneut geprüft wird nur das, was
der Fix berührt.

---

## 7. Orchestrierung

### 7.1 Rollen

- **Orchestrator (Claude Code):**
  - schreibt die Verträge (Wave 0) und als Einziger Änderungen daran,
  - schneidet die Pakete und dispatcht die Worker,
  - prüft gesammelt pro Wave und committet,
  - führt das Statusboard (8).
  Er implementiert nur Wave 0 und kleine Integrationsreparaturen selbst.
- **Worker (Codex):** setzen je ein Paket in ihrem Schreibbereich um und
  berichten. Sie committen nie und ändern keine Verträge. Brauchen sie eine
  Vertragsänderung, melden sie das im Bericht.

### 7.2 Dispatch

- Modell **`gpt-6.1-sol`**, Reasoning **`low`** als Standard. Eskalation auf
  `medium` nur für ein Paket, das zweimal an der Prüfung gescheitert ist. Das wird
  im Statusboard vermerkt.
- Paket als Datei unter
  `C:\Users\admin\AppData\Local\Temp\claude\…\scratchpad\pt-packets\`, per stdin
  übergeben, im Hintergrund gestartet:

```powershell
Get-Content <paket.md> -Raw | codex exec -m gpt-6.1-sol -c model_reasoning_effort=low `
  -s workspace-write -C C:\Users\admin\Documents\MasterSelects-Public -o <bericht.md> -
```

- Scheitert die Sandbox mit „cannot enforce split writable root sets“, kommen
  `-c sandbox_workspace_write.exclude_tmpdir_env_var=true -c
  sandbox_workspace_write.exclude_slash_tmp=true` dazu. Die Codex-Probe in Wave 0
  entscheidet das.
- `resume` nicht verwenden. Folgepakete werden als neue, eigenständige Pakete
  dispatcht.
- Höchstens 5 Worker gleichzeitig (einer pro Lane), alle im selben Working Tree,
  Schreibbereiche disjunkt.
- Bei „usage limit“ bis zur genannten Zeit warten, dann neu dispatchen. Nicht in
  einer Schleife wiederholen.

### 7.3 Paketvorlage

```text
Du bist Worker für Paket <ID> (Lane <L>). Erweitere den Umfang nicht.
Ziel: <ein Satz>
Zuerst lesen: docs/ongoing/Path-Tracing-Render-Plan.md Abschnitt <x>,
  src/engine/native3d/pathtrace/contracts/*, <weitere Dateien>
Erlaubter Schreibbereich: <Pfade> – NUR diese Dateien anlegen/ändern.
Verboten: contracts/, Schreibbereiche anderer Lanes, Löschen/Zurücksetzen
  fremder Dateien, rm/git clean/git restore/git checkout, Commits.
Vertrag: <Signaturen/Layouts, die einzuhalten sind>
Tests: nur <genannte Mathematik-Tests>, sonst keine. Bekannte Fixture-Fallen: <…>
Prüfung: einmal am Ende `node ./node_modules/typescript/bin/tsc -b --pretty false`,
  Fehler in deinem Bereich beheben. Kein Vitest, kein Build, kein Browser.
Bericht: geänderte Dateien, tsc-Ergebnis (nur Fehlerzeilen), Vertragswünsche,
  bemerkte Probleme außerhalb des Bereichs (melden, nicht beheben).
Abbrechen und berichten, wenn: der Vertrag nicht reicht oder fremde Dateien
  geändert werden müssten.
```

### 7.4 Ablauf pro Paket (leichtgewichtig)

Nach jedem Bericht, ohne Tests:
1. Prüfen, ob die Dateien wirklich geändert wurden (Änderungszeit im
   Schreibbereich). Berichte allein reichen nicht.
2. Mit `git status --short` auf Löschungen und Schreibzugriffe außerhalb des
   Bereichs achten.
3. Diff überfliegen, ob der Vertrag eingehalten ist.
4. Nächstes Paket der Lane sofort dispatchen.

Tests, Browser und Commits passieren gesammelt am Wave-Ende (Abschnitt 6).

### 7.5 Commits

- Pro Lane und Wave ein Commit mit expliziten Pfaden
  (`git commit -- <pfade>`), einzeiliger Conventional-Commit-Text auf Englisch,
  z. B. `feat(pathtrace): add LBVH build and refit`.
- Vorher prüfen, dass `origin` auf `Sportinger/MasterSelects` zeigt. Fremde
  Änderungen anderer Agenten bleiben unberührt.
- Kein Push ohne Auftrag des Nutzers.

---

## 8. Statusboard

Pflegt nur der Orchestrator.

| Paket | Lane | Wave | Status | Commit | Notiz |
|---|---|---|---|---|---|
| W0 Verträge, Fasermodul, Prüfseite, Messung, Codex-Probe | O | 0 | offen | – | – |
| L1-1 … L5-4 | – | 1–4 | offen | – | – |

Ausgangsmessung (Wave 0):

| Szene | Fasersegmente | Speicher | Raster ms (GPU) |
|---|---|---|---|
| Standard-Weave | – | – | – |
| Knit Form | – | – | – |
| Kreuzknoten | – | – | – |

---

## 9. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Software-Traversierung zu langsam für die Ziele | Faser-LOD, Render Scale, L1-6, Wavefront; Ziele nach Wave-0-Messung anpassen |
| Speichergrenzen bei großen Geweben | Puffer aufteilen, kompakte Segmente (16-Bit-Offsets relativ zum Garn), sichtbare Ablehnung |
| Fasern unter Pixelgröße verwischen im Denoiser | Tangenten-/Material-Kanten, Coverage-gewichtete Albedo, höhere spp im Stillstand |
| Fireflies durch TRT-Lobes und kleine Lichter | MIS, ReSTIR, Klemmung indirekter Beiträge |
| Flackern im Export-Denoise | genug spp, gleiche Scramble-Seeds pro Pixel |
| HDR-Umstellung bricht bestehende Pässe | L4-1 als eigenes Paket, Weave-Prüfseiten am Ende von Wave 1 |
| Worker-Berichte stimmen nicht | Änderungszeit-Prüfung (7.4), gesammelte Tests am Wave-Ende |
| Vertragslücken blockieren Lanes | Worker melden statt improvisieren; der Orchestrator ergänzt zwischen den Paketen |

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
