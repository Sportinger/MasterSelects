# Path Tracing und AI-Denoise für die Native-3D-Szene (Weave zuerst)

Stand: 2026-10-04. **Status: Plan, nichts umgesetzt.**

**Ziel:** Aus einer Weave-Szene (Garne, Fasern, Light-Clips, 3D-Kamera, Hintergrund)
entstehen Bilder in Offline-Qualität, wie aus Redshift, Arnold oder Cycles:
- Fasern streuen Licht untereinander mehrfach, was weißem Garn den weichen Look gibt.
- Echte Flächenlicht-Schatten, Umgebungslicht aus einer HDRI, saubere Kanten,
  Bewegungsunschärfe und Tiefenschärfe.
- Ein AI-Denoiser, damit dafür nicht tausende Samples pro Pixel nötig sind.

Die Vorschau bleibt interaktiv (Raster). Ein Path-Traced-Modus rechnet progressiv,
sobald das Bild steht, und der Export rendert ihn mit fester Sample-Zahl
deterministisch.

**Leitprinzipien:**

1. **Erst den Raster-Pfad auf HDR heben, dann tracen.** HDR, Tone Mapping und die
   Sub-Sample-Akkumulation im Export braucht der Path Tracer sowieso. Sie verbessern
   aber schon den Raster-Look und lassen sich unabhängig ausliefern.
2. **Eine Szenenbeschreibung, zwei Renderer.** Raster und Path Tracer lesen dieselben
   Layer, dieselben Lichter, dieselbe Kamera und dieselbe Garn-Auswertung, also die
   WGSL-Funktionen aus `StrandScene.wgsl` für Plies, Twist und Fasern. Kein zweites
   Modell der Szene.
3. **Fasern als Kurvenprimitive, nicht als Dreiecke.** Strahlen schneiden runde
   Kegelsegmente (Linear Swept Spheres), keine tessellierten Röhren. Das spart
   Speicher und liefert exakte Silhouetten.
4. **Deterministisch.** Gleiche Szene, gleiches Frame, gleiche Sample-Zahl ergeben
   auf einem Gerät dasselbe Bild. Die Zufallsfolge hängt nur von (Frame, Pixel,
   Sample) ab.
5. **Worker zuerst.** Alles läuft im `worker-gpu-only`-Render-Host, genauso wie heute
   die Strand-Pässe.

---

## 1. Ausgangslage

| Thema | Heute | Ort |
|---|---|---|
| Faser-Geometrie | Kamera-zugewandte Bänder pro Faser, auf der GPU per Vertex Pulling erzeugt (Instanz pro Faser + 4 Flyaway-Kanäle), Catmull-Rom bis 8 Unterteilungen | `src/engine/native3d/passes/StrandPass.ts`, `shaders/StrandScene.wgsl:107-234` |
| Faser-Shading | Kajiya-Kay / gewrapptes Lambert, verschobene R- und TRT-Highlights plus TT (Marschner/Karis), Ambient nur als Randabdunklung | `StrandScene.wgsl:283-352` |
| Schatten | Deep Opacity Maps von einem Licht, Austausch mit Meshes | `strandShadowMaps.ts`, `StrandShadowSample.wgsl` |
| Antialiasing | Hashed / 4x Coverage / Analytic (Kachel-Compute-Raster mit Radix Sort) | `StrandPass.ts:310-336`, `passes/strandRaster/` |
| Szenenziel | `rgba8unorm` + `depth24plus`: kein HDR, kein Tone Mapping, Highlights clippen | `sceneRenderer/constants.ts:2-3` |
| Meshes | nur Lambert, keine Environment Maps | `shaders/MeshPass.wgsl` |
| Lichter | Point, Panel, Environment. Environment trägt eine HDRI-Referenz, geht in die Strand-/Mesh-Beleuchtung aber nur als Ambient-Farbe ein; maximal 4 direkte Lichter pro Strand-Layer | `src/types/light.ts`, `passes/strandLights.ts` |
| Pass-Reihenfolge | Strand-Schatten → Clear → Mesh → Plane → FaceCable → Voxel → Flock → Strands → Splats → transparente Planes | `src/engine/native3d/NativeSceneRuntime.ts:369-440` |
| Export | ein `renderSession.renderFrame` pro Frame, keine Sub-Samples, kein Qualitätsmodus | `src/engine/export/FrameExporter.ts:424-454` |
| Path Tracing, BVH, Denoise, TAA, SSAO | nicht vorhanden | – |

Wiederverwendbar:
- `FlockRadixSort` aus dem Analytic-Raster für Morton-Codes beim BVH-Bau.
- Die Garn-Funktionen in `StrandScene.wgsl` und `strandFieldShader.ts` für die
  Faserpositionen.
- GPU Surface Bind und Rod-Simulation, weil die Mittellinien schon auf der GPU liegen.
- `StrandRaster`-Tests als Muster für Browser-Prüfseiten.

Bereits geplant und hier übernommen: Phase 6 im `Flock-Data-Sculpture-Plan.md`
(HDR, ACES, GTAO, PCSS, „Offline-Qualität“ mit N Sub-Samples, TAA).

---

## 2. Recherche: Stand der Technik (SIGGRAPH 2023–2026)

| Bereich | Methode | Entscheidung |
|---|---|---|
| Faser-BSDF | d'Eon et al. 2011, **Chiang et al. 2016** „A Practical and Controllable Hair and Fur Model“ (pbrt-v4, Arnold, Cycles Principled Hair) | **übernehmen** für den Path Tracer: Farbe → Absorption σa, Rauheit β_m/β_n, Kutikula-Neigung α, IOR 1,55 |
| Mehrfachstreuung im Raster | Zinke et al. 2008 „Dual Scattering Approximation“ | **übernehmen** für den Raster-Look (R2) |
| Strahl–Kurve | Reshetov 2018 „Phantom Ray-Hair Intersector“; NVIDIA 2025 Linear Swept Spheres (RTX Mega Geometry) | **übernehmen** als Software-Schnitt in WGSL. WebGPU hat keine Hardware-Raytracing-Kerne |
| BVH | Karras 2012 LBVH (Morton + Radix Sort), Neubau pro Frame | **übernehmen**, weil die Szene animiert ist. Refit oder PLOC erst bei Bedarf |
| Strick in Echtzeit | Kui Wu et al., SIGGRAPH 2025 „Real-Time Knit Deformation and Rendering“: Licht-Zerlegungen, fast Path-Tracing-Qualität, auch mit Environment Light | **später (R8)** als Vorschau-Look prüfen |
| Neuronale Stoff-Appearance | Real-time Neural Woven Fabric Rendering (2024), Neural Appearance Model for Cloth (2023), Zeltner et al. 2024 Real-time Neural Appearance Models | nicht jetzt. Braucht trainierte Netze pro Material |
| Viele Lichter / Echtzeit-GI | ReSTIR DI/GI/PT (2020–2023), SIGGRAPH 2026 „Real-Time LoD Rendering with ReSTIR“, „Spatio-Temporal Control Variates with ReSTIR“ | **später (R8)**, nur für eine interaktive Path-Traced-Vorschau |
| Sampling | Owen-gescrambeltes Sobol (Burley 2020), Blue-Noise-Seeds | **übernehmen** |
| AI-Denoise (Einzelbild) | Intel Open Image Denoise 2 (U-Net, Color + Albedo + Normal, HDR) | **übernehmen** über `oidn-web` (WebGPU, WGSL-Pipelines, GPU-Puffer rein und raus, FP16 wenn verfügbar, adaptive Kacheln) |
| AI-Denoise (Video) | SIGGRAPH 2026 „Ragged Neighborhood Attention for Spatiotemporal Neural Denoising“ | nicht einsetzbar. Stattdessen genug Samples und stabile Seeds (R7) |
| Echtzeit-Denoise | SVGF / A-SVGF | optional für die progressive Vorschau |

---

## 3. Architektur

```
Layer (Strands, Meshes, Planes, Lights, Kamera)
        │
        ▼
NativeSceneRuntime ──► Raster-Pfad (heute, ab R1 in HDR)
        │
        └─► Path-Tracing-Pfad (ab R4)
              1. Faser-Emission (Compute): Mittellinien → Fasersegmente
                 (gleiche WGSL-Funktionen wie StrandScene)
              2. Szenen-Primitive: Fasersegmente + Mesh-Dreiecke + Plane-Quads
              3. LBVH-Bau (Morton → FlockRadixSort → Karras-Hierarchie → AABBs)
              4. Integrator (Compute): Primärstrahl → Bounces, NEE + MIS
              5. Akkumulation HDR rgba32float + AOVs (Albedo, Normal, Tiefe)
              6. Denoise (oidn-web) → Tone Mapping → Scene-Textur
```

### 3.1 Primitive

- **Fasersegment:** zwei Endpunkte, zwei Radien, Faser-ID und Tangentenkontinuität.
  Bei 32 Byte pro Segment kostet die Standard-Weave mit grob 0,5 bis 1 Mio. Segmenten
  16 bis 32 MB. In R0 gemessen, nicht geschätzt.
- **Dreieck** für Meshes: Normalen interpoliert, Material Lambert ab R4, GGX ab R6.
- **Plane-Quad** für Video- und Bild-Layer: analytischer Schnitt, Textur als Albedo
  oder Emission. Video-Planes leuchten optional selbst.
- **Nicht im ersten Schritt:** Gaussian Splats, Flock-Punkte, Voxel, FaceCables.
  Hybrid: Sie bleiben im Raster und werden über die Primärtiefe des Path Tracers
  einkomponiert. Sie werfen und empfangen dann keine path-getracten Schatten.
  Das Inspector-Badge sagt das.

### 3.2 Faser-Emission statt Vertex Pulling

Der Raster-Pfad erzeugt Fasern pro Frame im Vertex-Shader. Der Path Tracer braucht
sie als Puffer. Ein Compute-Pass ruft dieselben Funktionen auf (Ply-Offsets, Twist,
Fasern, Flyaways, Radius-Felder) und schreibt Segmente.

Die Unterteilung ist eine eigene Path-Tracing-Einstellung und folgt nicht der
Bildschirmgröße. Sonst würden Schatten vom Bildausschnitt abhängen.

Option für später: ein BVH nur über die Garn-Mittellinien, Fasern prozedural erst
beim Schnitt (wie Wu und Yuksel 2017 im Raster). Das spart Speicher bei großen
Geweben, macht die Traversierung aber deutlich teurer.

### 3.3 Integrator

- Unidirektionaler Path Tracer als Megakernel in WGSL, mit fester Tiefe
  (Standard 8, für Fasern 16) und Russian Roulette ab Bounce 3.
- Wavefront erst, wenn Messungen Divergenz als Engpass zeigen.
- Next Event Estimation zu Point-Lichtern (als Kugel mit Diameter), Panel-Lichtern
  (Rechteck-Flächenlicht) und Environment.
- Environment mit Importance Sampling über eine Alias-Tabelle der HDRI-Luminanz.
- MIS mit Power-Heuristik zwischen BSDF- und Lichtsampling.
- Chiang-BSDF mit Sampling der Lobes p = 0 bis 3 plus Restterm. Die Absorption
  kommt aus der Garnfarbe (Chiang-Mapping Farbe → σa) und optional aus Melanin.
- Ohne Lichter gilt dieselbe feste Key-Light-Konvention wie im Raster, damit beide
  Modi gleich aussehen.

### 3.4 Kamera

- Die 3D-Kamera bekommt Blende (f-Stop) und Fokusdistanz; das Raster ignoriert sie
  vorerst. Tiefenschärfe über Dünnlinsen-Sampling.
- Bewegungsunschärfe über Shutter-Zeit: jedes Sample bekommt eine Zeit im
  Shutter-Intervall (siehe R3).

---

## 4. Phasen

### R0 – Messbasis und Referenzszenen

- Drei Referenzszenen als Browser-Prüfseiten
  (`tests/browser/pathtrace-reference-check.html`):
  1. Standard-Weave mit Key-Light,
  2. Knit Form mit Panel-Licht und Navy-Hintergrund (wie das offene Projekt),
  3. Kreuzknoten auf Boden mit Environment-HDRI.
- GPU-Zeitmessung über Timestamp Queries, wenn verfügbar. Fasersegment-Zahl und
  Speicherbedarf pro Szene protokollieren.
- Zielgerät: RDNA3 (wie in `Weave.md`), dazu ein schwächeres Gerät zum Gegenprüfen.

Abnahme: Tabelle mit Segmentzahlen, Speicher und Raster-Zeiten. Damit sind die
Schätzungen in R4 durch Messwerte ersetzt.

### R1 – HDR-Szene und Tone Mapping

- `SCENE_COLOR_FORMAT` → `rgba16float` für alle Native-Pässe. Blending,
  Alpha-to-Coverage und Analytic Resolve müssen damit funktionieren.
- Tone Mapping beim Übergang in den Compositor (`SceneTextureComposite.wgsl`): AgX
  als Standard, ACES und Neutral als Optionen. Belichtung (EV) an der 3D-Kamera.
- Die Klemmung auf 8 in `StrandScene.wgsl:351` entfällt oder wird zur
  Firefly-Klemmung.
- Speicher: rund doppelt so viel Szenenziel, bei 4K etwa 33 statt 17 MB.

Abnahme: Standard-Weave sieht bei EV 0 und neutralem Tone Mapping innerhalb einer
kleinen Toleranz aus wie heute. Highlights clippen nicht mehr hart. Die
Weave-Prüfseiten bleiben grün.

### R2 – Raster-Look-Upgrade (schneller sichtbarer Gewinn)

- **Dual Scattering** (Zinke 2008) im Strand-Shader: globale Vorwärtsstreuung aus
  der Deep Opacity Map (Dichte entlang des Lichtwegs) plus lokale Rückstreuung
  ersetzt die Randabdunklung als „Ambient“.
- **Environment-Licht als IBL:** die HDRI des Environment-Lichts als
  SH-Irradiance für Lambert und Fasern, dazu eine vorgefilterte Mip-Kette für den
  R-Lobe. Meshes bekommen dieselbe Umgebung.
- Optional GTAO auf Mesh- und Strand-Tiefe (Flock-Plan 6.2).

Abnahme: Vergleichsbilder der drei Referenzszenen vorher/nachher, weißes Garn ohne
Plastik-Look. Strand-Pass-Kosten in der Vorschau steigen höchstens um 30 %.

### R3 – Offline-Akkumulation im Export (Flock-Plan 6.5)

- Neue Export-Option **„Render Quality“** im Export-Panel mit den Stufen
  Preview / High / Final und der Sample-Zahl N.
- Pro Frame N Sub-Renders mit:
  - Sub-Pixel-Jitter (Halton 2,3),
  - Licht-Jitter auf Panel-Fläche und Point-Durchmesser für weiche Schatten,
  - Shutter-Zeiten für Bewegungsunschärfe,
  - Linsen-Offset für Tiefenschärfe.
- Akkumulation in `rgba32float`, danach Tone Mapping.
- Bewegungsunschärfe braucht Szenenauswertung zu Zwischenzeiten. Cloth und Rod
  laufen mit 60 festen Schritten pro Sekunde. Zwischenzeiten werden zwischen den
  beiden benachbarten Schritten interpoliert; es gibt keine neue Simulation und
  keinen neuen Checkpoint. Thread Along und Felder sind analytisch und werden
  direkt ausgewertet.
- Fortschrittsanzeige verschachtelt: Frame i/N → Sample s/S → Encode, jeweils mit
  Restzeit.

Abnahme: Export der Referenzszene 2 mit N = 16 ist bitgleich bei zwei Läufen
(gleiches Gerät). Keine Treppen an dünnen Fasern. Bewegungsunschärfe beim Unravel
sichtbar.

### R4 – Path-Tracer-Kern

- Module unter `src/engine/native3d/pathtrace/`, jedes unter 700 Zeilen:
  - `PathTraceRuntime.ts` (Ablauf, Ressourcen, Neustart der Akkumulation),
  - `pathTraceScene.ts` (Primitive packen),
  - `FiberSegmentEmitter.ts` + `FiberSegmentEmit.wgsl`,
  - `LbvhBuilder.ts` + `Lbvh.wgsl`,
  - `PathTraceIntegrator.wgsl` mit Includes für `FiberBsdf.wgsl` (Chiang),
    `LightSampling.wgsl`, `Sobol.wgsl`, `Intersect.wgsl`,
  - `pathTraceAovs.ts`.
- Das Szenen-Signal entscheidet, ob die Akkumulation neu startet: Kamera,
  Layer-Signaturen, Lichter, Zeit. Dafür die vorhandenen Programmsignaturen aus
  `strandBuffers.ts` nutzen.
- Puffergrenzen prüfen (`maxStorageBufferBindingSize`). Ist die Szene zu groß,
  wird sie aufgeteilt oder der Path Tracer klar abgelehnt, mit Hinweis im UI.
  Nie still auf Raster zurückfallen, ohne es anzuzeigen.
- CPU-Referenz in TypeScript für kleine Szenen: Strahlschnitt, BSDF-Auswertung,
  Energieerhaltung (White Furnace). Mit Vitest geprüft.

Abnahme:
- White-Furnace-Test der Chiang-BSDF (Energie ≤ 1, ≈ 1 bei σa = 0).
- BVH-Traversierung gleich CPU-Brute-Force auf zufälligen Strahlen.
- Referenzszenen konvergieren sichtbar gegen ein Bild mit hoher Sample-Zahl.
- Gemessene Kosten pro Sample in 1080p für die drei Szenen.
- Arbeitshypothese, die R0 und R4 prüfen: einige 100 Mio. Strahlen pro Sekunde auf
  RDNA3, also 64 spp in 1080p in wenigen Sekunden pro Frame.

### R5 – Path-Traced-Vorschau

- Umschalter **Raster / Path Traced** in der Vorschau (Preview-Panel, neben dem
  Qualitätsmenü).
- Beim Abspielen und Scrubben bleibt Raster aktiv. Steht das Bild, wird pro
  Animationsframe ein Sample-Budget von etwa 8 ms akkumuliert, bis die Ziel-Sample-
  Zahl erreicht ist. Danach Denoise (R7) und Stillstand ohne GPU-Last.
- Anzeige: Samples, Zeit, Status (z. B. „Splats im Raster“).
- Optional Render Region (Rechteck aufziehen) wie in Cycles.

Abnahme: Im sichtbaren Editor-Tab startet die Akkumulation nach einer Kamerafahrt
neu. Playback bleibt so flüssig wie ohne den Modus. Pointer- und Tastatur-Fokus der
neuen Bedienelemente sind sauber (AGENTS.md Abschnitt 9).

### R6 – Path-Traced-Export und Materialien

- „Render Quality: Path Traced“ im Export mit Samples pro Pixel und optional
  adaptivem Sampling: Varianz pro Pixel, Stopp bei Schwelle oder Zeitlimit pro
  Frame.
- Die Shutter-Zeit pro Sample kommt aus R3. Bewegungsunschärfe ist im Path Tracer
  physikalisch: das BVH wird pro Shutter-Zeit gebaut, oder Segmente bekommen
  Start- und Endposition (zweistufig, zuerst der einfache Weg mit wenigen Zeiten).
- Mesh-Material von Lambert auf GGX und Diffus mit Rauheit und Metallic (OpenPBR-
  Teilmenge). Plane-Emission für Video-Layer als Lichtquelle.
- Seeds: Sobol-Index aus (Frame, Pixel, Sample), deterministisch und wiederholbar.

Abnahme: Export Referenzszene 2 mit 256 spp, zweimal bitgleich auf einem Gerät.
Fortschritt und Restzeit stimmen auf 20 % genau.

### R7 – AI-Denoise (OIDN)

- Abhängigkeit `oidn-web` (laut Projektseite MIT). Die OIDN-Gewichte liegen
  separat; die Lizenz der Gewichte vor dem Einbau prüfen. Erwartet wird
  Apache-2.0, beides wäre mit AGPL-3.0 vereinbar. Eintrag in `LICENSING.md`.
- Die Gewichte (HDR-Variante, „small“ für die Vorschau, „standard“ für den
  Export) werden lazy aus dem eigenen Bundle bzw. Asset-Pfad geladen, nicht von
  einer fremden Domain.
- Eingaben direkt als GPU-Puffer: Farbe HDR, Albedo und Normalen aus dem ersten
  Treffer. Bei Fasern die Faser-Normale senkrecht zur Tangente in Blickrichtung.
- Video-Stabilität:
  1. genug Samples (Standard 64 im Export),
  2. Sample-Folge pro Pixel über die Frames korreliert (gleicher Scramble-Seed pro
     Pixel), damit das Rauschen nicht „kocht“,
  3. optional ein zeitlicher Abgleich mit Bewegungsvektoren, nur wenn 1 und 2
     nicht reichen.
- FP16 nur, wenn `shader-f16` vorhanden ist; sonst FP32.

Abnahme:
- Referenzszene 2 mit 16 spp + Denoise ist visuell nahe an 1024 spp, gemessen
  per FLIP- oder SSIM-Zahl, die in R0 festgelegt wird.
- Ein 3-Sekunden-Export ohne sichtbares Flackern bei statischer Kamera.
- Denoise-Zeit pro 1080p-Frame gemessen.

### R8 – Später, nur bei Bedarf

- ReSTIR DI für Szenen mit vielen Lichtern, wenn die interaktive Path-Traced-
  Vorschau das braucht.
- Strick-Look in Echtzeit nach Kui Wu et al. 2025 für die Raster-Vorschau.
- Prozedurale Fasern beim Schnitt (Abschnitt 3.2) für sehr große Gewebe.
- Splats und Flock-Punkte im Path Tracer (Splat Ray Tracing, 3DGRT 2024).
- Wavefront-Integrator, falls der Megakernel durch Divergenz limitiert ist.

---

## 5. Bedienung

- **Strand Render:** neue Gruppe „Path Tracing“ mit Fiber Roughness (β_m, β_n),
  Cuticle Tilt, IOR, Absorption (aus Farbe oder Melanin) und Subdivision für den
  Path Tracer. Im Raster werden die Werte auf die bestehenden Highlight-Parameter
  abgebildet, damit beide Modi ähnlich aussehen.
- **3D-Kamera:** Exposure, Tone Mapping, f-Stop, Fokusdistanz, Shutter.
- **Export-Panel:** Render Quality (Preview / High / Final / Path Traced), Samples,
  Denoise an/aus, Zeitlimit pro Frame.
- Alle neuen Felder mit den Inspector-Primitiven (`ResolveInspectorSection`,
  `ResolveInspectorNumberRow`, `InspectorSelect`). Pointer-Fokus-Hygiene nach
  AGENTS.md Abschnitt 9.
- AI-Agent: Er bearbeitet die Strand-Render-Werte bereits über `editOperatorGraph`.
  Ein eigenes Tool für die Export-Qualität kommt erst, wenn jemand es braucht, und
  dann als atomares Tool. Orchestrierung bleibt im Kernel (ADR-001).

---

## 6. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Software-Traversierung in WGSL zu langsam für feine Fasern | R0/R4 messen. Fasern prozedural (3.2), Unterteilung senken, Wavefront |
| Speichergrenzen (`maxStorageBufferBindingSize`, oft 128 MB bis 2 GB) | Puffer aufteilen, Segment-Format komprimieren (16-Bit-Offsets relativ zum Garn), klare Ablehnung im UI |
| Hohe Varianz durch spiegelnde TRT-Lobes und kleine Lichter (Fireflies) | MIS, Klemmung indirekter Beiträge, Denoise |
| Denoise flackert in Videos | Abschnitt R7: Samples, korrelierte Seeds, optional zeitlicher Abgleich |
| Raster und Path Tracer sehen unterschiedlich aus | Gemeinsame Parameter, Referenz-Vergleichsbilder pro Phase |
| Geräte ohne `shader-f16` oder mit Timeouts bei langen Dispatches (TDR) | Arbeit in Kacheln von maximal etwa 50 ms GPU, FP32-Fallback |
| Linux/Mesa-Silent-Failures | Ergebnis auslesen und prüfen. Nie stillen Erfolg annehmen (`Linux-Mesa-GPU.md`) |
| HDR-Umstellung (R1) bricht bestehende Pässe | R1 einzeln ausliefern, alle `weave-*-gpu-check.html` erneut prüfen |

---

## 7. Offene Fragen

1. Wo sitzt der Schalter Raster/Path Traced: pro 3D-Kamera-Clip (keyframebar nicht
   nötig) oder pro Composition? Vorschlag: an der Composition, Export übernimmt ihn.
2. Sollen Video-Planes standardmäßig Licht abgeben (Emission) oder nur angestrahlt
   werden? Vorschlag: angestrahlt, Emission als Option.
3. Sample-Zahl der Stufen High und Final: Vorschlag 16 und 64 mit Denoise.
4. Splats in Path-Traced-Szenen: Hybrid (Vorschlag) oder ausgrauen?

---

## 8. Quellen

- Chiang, Bitterli, Tappan, Burley: *A Practical and Controllable Hair and Fur Model
  for Production Path Tracing*, EGSR 2016.
- Zinke, Yuksel, Weber, Keyser: *Dual Scattering Approximation for Fast Multiple
  Scattering in Hair*, SIGGRAPH 2008.
- Karras: *Maximizing Parallelism in the Construction of BVHs, Octrees, and k-d
  Trees*, HPG 2012.
- Reshetov, Luebke: *Phantom Ray-Hair Intersector*, HPG 2018.
- Wu, Yuksel: *Real-time Fiber-level Cloth Rendering*, I3D 2017.
- Kui Wu et al.: *Real-Time Knit Deformation and Rendering*, SIGGRAPH 2025,
  https://kuiwuchn.github.io/rtstitch.html
- *Real-time Neural Woven Fabric Rendering*, https://arxiv.org/abs/2406.17782
- *Neural Appearance Model for Cloth Rendering*, https://arxiv.org/abs/2311.04061
- Burley: *Practical Hash-based Owen Scrambling*, JCGT 2020.
- Bitterli et al.: *Spatiotemporal Reservoir Resampling* (ReSTIR), SIGGRAPH 2020.
- SIGGRAPH 2026 Papers (ReSTIR LoD, Spatiotemporal Neural Denoising),
  https://keenancrane.github.io/siggraph-papers-schedule/
- Intel Open Image Denoise, https://www.openimagedenoise.org/
- `oidn-web` (OIDN auf WebGPU), https://github.com/pissang/oidn-web
- three-gpu-pathtracer, WebGPU-Denoiser-Hook,
  https://github.com/gkjohnson/three-gpu-pathtracer/pull/849
