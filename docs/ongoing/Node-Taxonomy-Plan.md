# Node-Katalog: Kategorien, Benennung und Zusammenfassung

Stand: 2026-09-26. Arbeitsplan, noch nichts umgesetzt. Grundlage ist ein
vollständiger Dump von `getAgentNodeCatalog()`: 493 Einträge. Neu dazu kommen die
beiden Temporal-Smooth-Nodes (`f6bef294`).

Ziel: ein Katalog, in dem Nutzer und der In-App-Agent jeden Node über **einen**
verständlichen Namen und **eine** logische Kategorie finden. Dasselbe Konzept
heißt überall gleich. Interna bleiben verborgen.

---

## 1. Ist-Zustand

### 1.1 Zahlen

| Quelle | Einträge | Bemerkung |
|---|---|---|
| Operatoren (`EFFECT_OPERATORS`) | 302 (+3 Legacy gefiltert) | 264 hinzufügbar, 41 intern, 49 davon Kompositionen |
| Effekte (`EFFECT_REGISTRY`) | 102 | **keiner hat eine Beschreibung** |
| Flock | 38 | eigener, brauchbarer Kategorienbaum |
| Audio-Effekte | 24 | 9 Kategorien, 2 davon mit nur einem Eintrag |
| Color-Graph | 11 | Resolve-artige Knoten |
| Controls („Parameter sources“) | 9 | Beschreibungen wiederholen nur das Label |
| Clip-Graph-Stufen (builtin) | 7 | |

- Die 264 hinzufügbaren Operatoren ergeben nur **165 Familien**. Allein `math.*` hat 100 IDs; Clamp gibt es 12-mal, Mix 11-mal, Multiply 11-mal.
- Operator-Kategorien sind heute schlicht das ID-Präfix. So entstehen ~48 Kategorien, davon **20 mit genau einem Eintrag**.
- Kontexte gibt es 16, teils als Mischformen („Local image graphs + Audio samples“).

### 1.2 Wie heute gruppiert wird – sechs Oberflächen, sechs Regeln

| Oberfläche | Datei | Gruppierung |
|---|---|---|
| Catalog-Button | `workspace/NodeCatalog.tsx` | Kontext-Filter; zeigt Family/Execution/State/Implementation |
| Kontextmenü „Effect Nodes“ | `workspace/NodeContextMenu.tsx` | Effekt-Kategorie als rohe ID („glyph“) |
| Reusable-Nodes-Menü | `workspace/ReusableNodeMenu.tsx` | fest verdrahtete Präfixliste; `field.*` fehlt, `math.*` landet unter „Coordinates“ |
| Inspector „Add node…“ | `workspace/OperatorParameters.tsx` | flache Liste (~136), ungruppiert |
| Drag-to-connect | `services/nodeGraph/connectionNodeCatalog.ts` | ID-Präfix klein („math“) neben „Reusable nodes“ und „Clip“ |
| Effekt-Picker | `properties/EffectCatalogPicker.tsx` | Effekt-Kategorie als rohe ID; `CATEGORY_INFO` wird nirgends benutzt |

Die Node-Karten beschriften ihren Typ über eine Map in
`effectGraphProjection.ts` mit 14 Präfixen. Alles andere (color, vector, convert,
coordinates, sampling, fisheye, glyph, field …) heißt dort „Effect“.

### 1.3 Probleme nach Schwere

**Sehr schlecht**
1. Der Catalog-Button zeigt Compiler-Interna (`pass-boundary`, `compiler-owned`, `unknown`) und interne bzw. Legacy-Nodes („Materialized Resource“, „Legacy RGB Invert“).
2. Jede Typvariante ist ein eigener Eintrag, zum Beispiel 37 Audio-Mathe-Permutationen. Nur das Add-Menü fasst sie zusammen.
3. Keiner der 102 Effekte hat eine Beschreibung. Effekt-Kategorien erscheinen als rohe IDs.
4. **Kontext-Bug:** In `operatorContext()` landet alles, was keiner Liste angehört, auf dem Fallback „Face Cables“. Betroffen sind die sechs `analog.*`-Stufen des Analog Signal Lab, `values.number`, `values.oscillator`, `geometry.voronoi-seeds`, `geometry.jump-flood`, `field.read-nearest-seed` und `depth.*`.
5. Node-Karten zeigen für die meisten Operatoren „Effect“.

**Schlecht**
- Drei Mathe-Welten (Bild, Voxel/Face Cables, Controls) mit abweichenden Labels: „Min“/„Minimum“, „Sin“/„Sine“, „Abs“/„Absolute Value“, „Fract“/„Fraction“.
- Kontexte sind nach einzelnen Effekten benannt („Face Cables“, „Voxel Relief“) statt nach Domänen.
- Die Effekt-Kategorien passen nicht zum Aussehen:
  - Pixelate steht unter Distort, Sharpen unter Stylize, Pixel Sort unter Analog.
  - Glyph enthält „Brand Generator“ und „Tag Pills“, Geometry enthält Stickerei und Teppich.
- Gleiche Konzepte tragen verschiedene Namen: Value/Constant, Oscillator/LFO, „Time“/„Timeline Time“/„Source Time“, dreimal Gravity/Drag/Turbulence.

**Mittel**
- Stil der Labels gemischt: „Plane geometry“ gegenüber „Wireframe Material“, „Split VEC2“, „Divide (IEEE)“.
- Vendor-Name im Label: „MediaPipe Face Tracker“.
- Kryptische Namen wie „Rom1“, „Subject“, „Motion Lab“, „Divide X“.

### 1.4 Strukturfunde, die den Plan prägen

- **Effekt-Engines:** Viele Effekte haben identische Parametersätze. Das sind Stil-Varianten einer gemeinsamen Engine, verteilt über fünf Kategorien.
  - **Two-Tone Pattern** (Scale, Amount, Angle, Ink, Paper [, Speed]): 30 Effekte, von Halftone und Riso über Crystal und Holo bis Bricks und Outline.
  - **Glyph Mosaic** (Cell Size, Ramp, Font, Weight …): 19 Effekte, von ASCII bis Word Mosaic und Contour Type.
  - **Tracking Overlay** (Amount, Overlay, Speed): 8 Effekte, darunter CCTV, HUD Tracker, Stardust und Rain Reveal.
- **Duplikat:** Rom1 ist laut Quellcode eine eingefrorene Kopie von Acuarela, mit identischen Parametern.
- **Zwillinge:** Mehrere Effekte existieren zusätzlich als Operator: Hue Shift, Contrast, Invert, Vignette, RGB Split/Chromatic Aberration und Fisheye mit 15 `fisheye.*`.
- **Effekt-Bauteile:** Viele Kompositionen sind Innenteile eines einzelnen Effekts, zum Beispiel „Eight Sample Offsets“, „Frame Coordinate Modes“ oder „Phosphor Stripes“. Für normale Nutzer sind sie Rauschen.
- **Flock als Vorbild:** Flock hat bereits einen guten Baum: Population, Simulation, Behavior, Guidance, Selection, Values, Render, Output.

---

## 2. Leitregeln (gelten für jedes der drei Systeme)

| # | Regel |
|---|---|
| R1 | **IDs bleiben stabil.** Gespeicherte Projekte, Agent-Tools und der Kernel-Katalog hängen an IDs. Umbenannt werden nur Label, Kategorie und Metadaten. Echte ID-Änderungen gibt es nur mit Alias-Migration. |
| R2 | **Labels:** Englisch, Title Case, ein Nomen für das, was herauskommt („Luminance“, „Edge Strength“). Keine Typ-Suffixe (der Typ ist ein Badge), keine Vendor-Namen, kein „Legacy“, „IEEE“ oder „Materialize“. Mathe wird ausgeschrieben (Minimum, Absolute, Sine). |
| R3 | **Eindeutigkeit:** Ein Label ist innerhalb einer Domäne eindeutig. Gleiches Konzept heißt in allen Domänen gleich; verschiedene Konzepte heißen nie gleich. |
| R4 | **Beschreibung ist Pflicht:** ein Satz, was der Node tut, plus Wertebereich oder Einheit, wo relevant. Effekte eingeschlossen. |
| R5 | **Typvarianten = ein Eintrag.** Menüs und Katalog zeigen die Familie; die konkrete Variante folgt aus der Verkabelung oder einer Option. |
| R6 | **Sichtbarkeit in drei Stufen:** `public` (Standardmenüs), `advanced` (Effekt-Bauteile und Compiler-nahe Bausteine, hinter einem „Advanced“-Schalter), `internal` (nie in Menüs). |
| R7 | **Kategoriengröße:** Zielgröße 4–20 Einträge. Ausnahmen nur für Standardbegriffe wie „Keying“ oder „Time“. |
| R8 | **Effekt vs. Baustein:** Ein Effekt ist ein fertiger Look, ein Baustein ist eine Funktion. Beide dürfen gleich heißen, wenn sie dasselbe tun; Suchtreffer tragen dann ein Badge „Effect“ oder „Node“. |
| R9 | **Synonyme/Tags:** Jeder Eintrag bekommt Suchbegriffe (LFO → Oscillator, Lerp → Mix, If → Switch, Key → Mask). Das hilft Nutzern und dem Agenten. |
| R10 | **Eine Quelle:** Label, Kategorie, Sichtbarkeit, Tags und Beschreibung liegen als Metadaten an der Registry. Alle sechs Oberflächen nutzen einen gemeinsamen Menü-Builder. |

---

## 3. Funktionsklassen – das gemeinsame Vokabular

Jeder Eintrag bekommt genau eine feine **Funktionsklasse**. Die drei Systeme in
Abschnitt 6 sind nur verschiedene Anordnungen dieser Klassen. Die Inventur in
Abschnitt 4 gilt deshalb für alle drei Systeme gleichermaßen.

| Klasse | Bedeutung | Beispiele |
|---|---|---|
| IN / OUT | Eingänge, Quellen, Ausgänge, Anker | Input Frame, Output, Video Source |
| VAL | Konstante Werte | Value, Boolean, Color Value |
| TIME | Zeitquellen | Time |
| OSC | periodische Quellen | Oscillator, Sine Wave |
| ARITH | Grundrechenarten | Add … Clamp, Power, Square Root |
| ROUND | Runden und Wiederholen | Floor, Fraction, Round, Mirror Repeat |
| TRIG | Winkel | Sine … Arctangent 2, Degrees to Radians |
| SHAPE | Interpolation und Kurven | Mix, Step, Smoothstep, Gaussian Falloff, Remap |
| LOGIC | Vergleichen und Verzweigen | Greater Than, And, Switch |
| VEC | Vektor-Struktur | Split/Combine Vector, Length, Dot Product |
| CONV | Typ-Adapter | RGBA ↔ Image, Scalar → Vector |
| COLOR | Farbe ändern oder messen | Luminance, Saturation, RGB → HSV |
| KEY | Maske und Key | Mask Overlay, künftige Key-Operatoren |
| UV | Koordinaten | UV, Rotate UV, Cartesian ↔ Polar |
| LENS | Optik | Lens Projection, Radial Curvature |
| SAMPLE | Bild lesen | Sample Image, Load Pixel |
| FILTER | Nachbarschaft und Kanten | Kernel Sum, Derivative, Edge Strength |
| CACHE | Render-Pass-Grenze | Cache Image |
| TEMP | Zeitlicher Zustand | Temporal Smooth, Previous Output, Sequence |
| MOTION | Bewegungsanalyse | Optical Flow, Source Motion |
| PATTERN | Rauschen, Muster, Felder, Zellen | Value Noise, Bayer Pattern, Voronoi Seeds |
| GLYPH | Schrift und Glyphen | Text Atlas, Cell Grid |
| ANALOG | Analoges Videosignal | PAL Encode … Display |
| GEO / MAT / CAMLIGHT / RENDER | 3D-Szene | Plane, Surface Material, Orbit Camera |
| SIM | Kräfte, Kollision, Simulation | Gravity, Mesh Collision, Cable Simulation |
| TRACK | Tracking, Tiefe, gespeicherte Analysen | Face Tracker, Depth Estimation |
| SPLAT / FLOCK-* | domänenspezifisch | siehe 4.10 und 4.11 |
| CTRL | Parameter antreiben | Keyframes, Audio Envelope |
| GRADE | Color-Graph | Primaries, Color Wheels |
| CLIP | Clip-Stufen | Source, Transform, Mask |

---

## 4. Inventur: Entscheidung pro Node

**Aktionen:**
- **K** – behalten
- **R** – umbenennen
- **F** – in Familie X zusammenfassen: ein Menüeintrag; die ID bleibt als Variante
- **A** – advanced: Effekt-Bauteil
- **I** – intern: nie in Menüs
- **KX** – Kontext-Fix
- **P** – Zweck prüfen

### 4.1 Werte, Zeit, Ein-/Ausgänge

| ID | heute | neu | Aktion | Klasse |
|---|---|---|---|---|
| `values.number` | Value | Value | K, KX (heute „Face Cables“) | VAL |
| `values.integer` | Value | Value (Integer) | F→Value | VAL |
| `values.boolean` | Boolean | Boolean | K | VAL |
| `values.color` | Color | **Color Value** | R (Kollision mit „Color“-Stufe) | VAL |
| `values.choice` | Choice | – | I | VAL |
| `math.constant` (Voxel) | Constant | **Value** | R | VAL |
| `control:values.number` | Constant | **Value** | R | VAL |
| `flock.value` | Value | Value | K | VAL |
| `values.oscillator` | Oscillator | Oscillator | K, KX | OSC |
| `control.lfo` | LFO | **Oscillator** | R, Tag „LFO“ | OSC |
| `flock.oscillator` | Oscillator | Oscillator | K | OSC |
| `signal.sine-gain.scalar` | Sine Gain | **Sine Wave** | R, A (CRT-Bauteil) | OSC |
| `image.timeline-time` | Timeline Time | **Time** | R | TIME |
| `control.time` | Time | Time | K | TIME |
| `flock.time` | Source Time | **Time** | R | TIME |
| `image.frame` | Video / image frame | **Input Frame** | R (Anker) | IN |
| `image.normalized-uv` | Normalized Coordinates | **UV** | R | UV |
| `image.resolution` | Image Resolution | **Resolution** | R | IN |
| `image.output` | Image Output | **Output** | R (Anker) | OUT |
| `scene.output` | Clip output | **Output** | R | OUT |
| `audio.input` / `audio.output` | Audio Input/Output | K | K (Anker) | IN/OUT |
| `image.named-input`, `image.resource-input`, `image.temporal-history` | – | – | I | CACHE |

### 4.2 Mathe (100 IDs → ~28 Einträge)

Alle Familien werden je ein Menüeintrag. Bild-, Audio-, Voxel- und
Control-Varianten sind Varianten derselben Familie; die Labels werden angeglichen.

| Familie (IDs) | heute | neu | Klasse |
|---|---|---|---|
| Add (`math.add.*` 3 Bild + 3 Audio, `math.add` Voxel, Control) | Add | Add | ARITH |
| Subtract (7) | Subtract | Subtract | ARITH |
| Multiply (11, inkl. `*-scalar`-Varianten) | Multiply / „Multiply Image by Scalar“ / „… RGB …“ / „… Vector …“ | **Multiply** | ARITH |
| Divide (`divide-ieee.*` 9, `math.divide`) | „Divide (IEEE)“, „Divide by Scalar (IEEE)“, „Divide RGB by Scalar“ | **Divide** (IEEE-Verhalten nur in der Beschreibung) | ARITH |
| Power (3) | Power | Power | ARITH |
| `math.exp.scalar` | Exponential | Exponential | ARITH |
| `math.exp2.scalar` | Exp2 | **Power of Two** | ARITH |
| `math.sqrt.scalar` | Square Root | K | ARITH |
| `math.reciprocal.scalar` | Reciprocal | K | ARITH |
| Absolute (`math.abs.*` + Voxel) | Absolute Value / Abs | **Absolute** | ARITH |
| Minimum / Maximum (je 5–6) | Minimum / Min, Maximum / Max | **Minimum / Maximum** | ARITH |
| Clamp (12, inkl. „Clamp RGB by Scalars“) | Clamp | Clamp | ARITH |
| Floor (4) | Floor | K | ROUND |
| Fraction (`math.fract.*` 3) | Fract / Fraction | **Fraction** | ROUND |
| `math.round-even.scalar` | Round to Even | **Round** (Regel „to even“ in der Beschreibung) | ROUND |
| Mirror Repeat (`math.mirror-repeat.scalar` + `coordinates.mirror-repeat.vec2`) | 2× Mirror Repeat | **eine Familie** | ROUND |
| Sine / Cosine (+Audio, Voxel „Sin“) | Sine / Sin | **Sine / Cosine** | TRIG |
| `math.tan.scalar` / `math.atan.scalar` | Tangent / Arctangent | K | TRIG |
| `math.atan2.scalar` | Atan2 | **Arctangent 2 (Y, X)** | TRIG |
| `convert.degrees-to-radians.scalar` | Degrees to Radians | K, Klasse → TRIG | TRIG |
| Mix (11) | Mix | Mix | SHAPE |
| `math.mix-components.rgb` | Mix Components | **Mix per Channel** | SHAPE |
| `math.step.scalar` / `math.smoothstep.scalar` | Step / Smoothstep | K | SHAPE |
| `math.gaussian.scalar` | Gaussian | **Gaussian Falloff** | SHAPE |
| `control.remap`, `flock.remap` | Remap | K | SHAPE |

### 4.3 Logik, Vergleich, Verzweigung

| ID | heute | neu | Aktion |
|---|---|---|---|
| `compare.greater.scalar` | Greater Than | K | K |
| `logic.and.boolean` | And | K | K |
| `select.scalar`, `select.vec2`, `control.select.scalar`, `control.select.image` | Select / Select Vector 2 / Select Scalar / Select Image | **Switch** | F: eine Familie (Value/Vector/Image). „eager“ oder „lazy“ wählt der Compiler; im UI gibt es nur einen Eintrag. |
| `image.derivative.{auto,fine,coarse}.scalar` | Auto/Fine/Coarse Scalar Derivative | **Derivative** (Option Präzision) | F, A |

### 4.4 Vektor und Konvertierung

| ID | heute | neu | Aktion |
|---|---|---|---|
| `vector.split.vec2/3/4` | Split VEC2/3/4 | **Split Vector** | F |
| `vector.combine.vec2/3/4` | Combine VEC2/3/4 | **Combine Vector** | F |
| `vector.split.rgba` / `vector.combine.rgba` | Split/Combine RGB + Alpha | K | K |
| `image.rgb-split` / `image.rgb-combine` | Legacy … | – | I |
| `vector.normalize.vec2` | Normalize Vector | **Normalize** | R |
| `vector.length.vec2` / `vector.dot.vec2` | Length / Dot Product | K | K |
| `vector.unit-direction.scalar` | Unit Direction | **Direction from Angle** | R |
| `vector.reduce-min.rgb` / `.vec2`, `vector.reduce-max.rgb` | Minimum RGB / Minimum / Maximum RGB | **Smallest / Largest Component** | F, R (heute kollidiert „Minimum“ mit Mathe) |
| `convert.*` (10 Typ-Adapter: Image↔RGBA, Vector↔RGB, Scalar→Vec2/Vec4/RGB, Alpha↔Scalar) | 10 Einzelnamen | **Convert** (eine Familie; Quelle und Ziel folgen aus der Verkabelung) | F, A. Wird beim Verbinden ohnehin automatisch eingefügt. |
| `convert.rgb-to-hsv` / `hsv-to-rgb` | RGB to HSV / HSV to RGB | K, Klasse → COLOR | K |

### 4.5 Farbe und Maske

| ID | heute | neu | Aktion |
|---|---|---|---|
| `color.luminance-rec601.rgb`, `color.luminance-rec709.rgb`, `color.luminance-rec709.image`, `image.luminance` (Voxel) | Rec.601 / Rec.709 / Rec.709 Image Luminance / Luminance | **Luminance** (Option Rec.709 / Rec.601) | F |
| `color.invert.rgb` | Legacy RGB Invert | – | I |
| `color.hue-shift.rgb` | Hue Shift | K (Zwilling des Effekts) | K |
| `color.luma-saturation.rgb` | Luma Saturation | **Saturation** | R |
| `color.contrast-pivot.rgb` | Contrast Around Midgray | **Contrast** | R |
| `color.soft-bright-pass` | Soft Bright Pass | **Bright Pass** | R |
| `color.sobel-magnitude` + `field.sobel` | Sobel Magnitude / Edge Strength Field | **Edge Strength** | F, Klasse → FILTER |
| `color.rgb-stripe-mask` | RGB Stripe Mask | **Phosphor Stripes** | R, A (CRT-Bauteil) |
| `image.mask-overlay` | Mask Overlay | K | K, Klasse KEY |

### 4.6 Koordinaten und Optik

| ID | heute | neu | Aktion |
|---|---|---|---|
| `coordinates.rotate.vec2` | Rotate Coordinates | **Rotate UV** | R |
| `coordinates.centered-scale.vec2` | Scale From Center | **Scale UV** | R |
| `coordinates.integer-cell-origin.vec2` | Integer Cell Origin | **Cell Origin** | R |
| `coordinates.cartesian-to-polar.vec2` / `polar-to-cartesian.vec2` | K | K | K |
| `coordinates.divide-x.vec2` | Divide X | ? | P, A |
| `coordinates.radial-curvature.vec2` | Radial UV Curvature | **Radial Curvature** | R, Klasse LENS |
| `coordinates.restore-lens.vec2` | Restore Lens Coordinates | K | A, LENS |
| `optics.project-radius.scalar` / `unproject-radius.scalar` | Project/Unproject Radius | K | K, LENS |
| `fisheye.lens`, `fisheye.chroma`, `fisheye.vignette`, `fisheye.lens-coverage` | Lens Projection / Chromatic Aberration / Vignette / Lens Coverage | K / K / **Lens Vignette** / K | public, LENS |
| die übrigen 11 `fisheye.*` (Edge Sampling, Frame Edges, Lens Resolve, Eight Sample Offsets, Image to Lens Coordinates, Projection Model, Radius Curve and Zoom, Frame Coordinate Modes, Frame Coverage, Combine Chromatic Channels, Average Samples) | – | Labels bleiben | A (Fisheye-Bauteile) |

### 4.7 Abtasten, Filter, Cache

| ID | heute | neu | Aktion |
|---|---|---|---|
| `image.sample` | Sample Image | K | K |
| `sampling.clamped-image` | Clamped Image Sample | Sample Image (Option „Clamp UV“) | F |
| `image.load-pixel-clamped` | Load Pixel | K | A |
| `image.kernel-index` / `-grid-reduce` / `-rect-reduce` | Kernel Index / Kernel Grid Reduce / Rectangular Kernel Reduce | **Kernel Index / Kernel Sum (Grid) / Kernel Sum (Rect)** | F „Kernel“, A |
| `sampling.texel-offset`, `sampling.gaussian-weight`, `sampling.normalize-rgba`, `sampling.bounded-count` | … „Normalize Weighted RGBA“ … | **Normalize by Weight** (sonst K) | A (Blur-Bauteile) |
| `image.materialize` | Materialize Image | **Cache Image** (Beschreibung: „eigener Render-Pass“) | R, A |
| `image.segment-sort-luma`, `image.quadtree-partition`, `data.decode-byte-pixel`, `source.memory-window`, `glyph.atlas` | – | – | I |

### 4.8 Zeit und Bewegung

| ID | heute | neu | Aktion |
|---|---|---|---|
| `image.temporal-smooth` / `.scalar` | Temporal Smooth | K (neu) | K |
| `image.sample-history` | Sample Input History | **Sample Past Frame** | R |
| `image.frame-history` | Frame History | **Previous Output** | R (bleibt an Feedback-Effekte gebunden) |
| `feedback.decay-max-rgba` | Decay & Max RGBA | **Decay Trail** | R, A |
| `image.sequence-index/blend/reduce` | Sequence Index/Blend/Reduce | K | F „Sequence“, A |
| `image.source-motion`, `image.optical-flow`, `motion.temporal-deformation`, `field.motion` | K | K | K, MOTION |
| `image.motion-consistency` | Motion Field Consistency | **Motion Confidence** | R |
| `image.directional-smooth` | Directional Smoothing | **Directional Smooth** | R |

### 4.9 Muster, Felder, Glyphen, Analog

| ID | heute | neu | Aktion |
|---|---|---|---|
| `noise.hash2d.vec2` | Hash 2D | **Random (Hash)** | R |
| `field.noise2d` | Smooth Value Noise 2D | **Value Noise** | R |
| `pattern.bayer4.vec2` | Bayer 4×4 | **Bayer Pattern** | R |
| `field.image-channel`, `field.normalize`, `field.combine` | Image Channel / Normalize Field / Combine Fields | K | K, im Reusable-Menü ergänzen |
| `geometry.voronoi-seeds`, `geometry.jump-flood`, `field.read-nearest-seed` | Voronoi Seeds / Jump Flood / Read Nearest Seed | K / **Distance Field (Jump Flood)** / K | KX, Klasse PATTERN („Cells“) |
| `glyph.text-atlas` | Text Atlas | K | K |
| `glyph.cell-grid` / `tone-index` / `sample` | Glyph Cell Grid / Tone to Glyph Index / Glyph Sample | **Cell Grid / Tone to Glyph / Sample Glyph** | R |
| `glyph.atlas-alpha` | Glyph Atlas Alpha | **Atlas Alpha** | R, A |
| `analog.pal-encode`, `rf-channel`, `vhs-transport`, `receiver-analyze`, `pal-decode`, `display-resolve` | … „Display Resolve“ | K … **Display** | KX (heute „Face Cables“), Klasse ANALOG |

### 4.10 3D, Voxel, Face Cables, Splat

| ID | heute | neu | Aktion |
|---|---|---|---|
| `geometry.plane` | Plane geometry | **Plane** | R |
| `geometry.primitive` + `box`/`sphere`/`cylinder` | Primitive/Box/Sphere/Cylinder geometry | **Primitive** (Form-Option) | F |
| `geometry.source` | Source geometry | **Clip Geometry** | R |
| `geometry.face` / `geometry.depth` | Landmarks to face mesh / Depth to mesh | **Face Mesh / Depth Mesh** | R |
| `geometry.merge-surface` | Stitch Surfaces | K | K |
| `geometry.grid` / `geometry.instances` | Grid points / Instance on points | **Grid Points / Instance on Points** | R |
| `geometry.voxel`, `geometry.marching-squares-topology` | – | – | I |
| `material.surface` / `material.wireframe` | Surface material / Wireframe Material | **Surface Material** / K | R |
| `texture.image` / `texture.uv` | Image texture / UV transform | **Image Texture / UV Transform** | R |
| `camera.orbit` / `light.relief` | Orbit camera / Relief lighting | **Orbit Camera / Relief Light** | R |
| `scene.mesh` | Mesh | **Mesh Object** | R |
| `scene.render`, `render.voxel`, `render.cables` | 3D render / Relief render / Cable rendering | **3D Render / Relief Render / Cable Render** | R, I (Anker) |
| `scene.clip-transform`, `scene.transform` | 2× Clip Transform | Clip Transform | I (je Domäne einer) |
| `forces.gravity/drag/turbulence/wind` | … „Turbulence Force“ | **Gravity / Drag / Turbulence / Wind** | R |
| `splat.gravity/drag/turbulence` | Gravity Force / Particle Drag / Turbulence Force | **Gravity / Drag / Turbulence** | R (später eine gemeinsame Kraft-Familie) |
| `collision.mesh` / `simulation.rope` | Mesh collision / Cable simulation | **Mesh Collision / Cable Simulation** | R |
| `collision.face`, `collision.surface`, `surface.hybrid` | Legacy | – | I |
| `depth.calibrate` / `depth.estimate` | Depth calibration / estimation | **Depth Calibration / Depth Estimation** | R, KX |
| `tracking.face` | MediaPipe Face Tracker | **Face Tracker** | R |
| `tracking.smooth` / `tracking.anchors` | Smooth Landmarks / Face anchors | K / **Face Anchors** | R |
| `source.face-landmarks` / `source.saved-depth` / `media.source` | Saved face landmarks / Saved scene depth / Video source | **Face Landmarks (Saved) / Scene Depth (Saved) / Video Source** | R |
| Splat (20) | „Splat Size Clamp“, „Splat Scale“ … | ohne „Splat“-Präfix: **Size Clamp, Scale, Rotation, Color & Alpha, Selection, Attribute Noise, Particle Simulation, Camera Fade, Sphere Crop, Merge Branches, Cleanup, Rays, Particle System, Mesh Overlay**; `splat.source` → **Source** | R. Splat-Unterkategorien: Source, Transform, Attributes, Simulation, Crop & Fade, Surface & Render |

### 4.11 Flock (38) – Baum bleibt, nur Feinschliff

| Kategorie | Einträge | Änderung |
|---|---|---|
| Population | Emitter, Merge Emitters | – |
| Simulation | Simulation | – |
| Behavior | Flock Rules, Attractor, Vortex, Turbulence, Drag, Wind, Cruise Speed, Cluster Anchors, Compose Behavior | Kräfte später mit `forces.*` teilen (Wind tut das schon) |
| Guidance | Path, Follow Path, Obstacle, Boundary | – |
| Selection | Select Group, Select ID Fraction, Select Region, Select Speed, Select Age, Combine Selections | „Select ID Fraction“ → **Select Fraction** |
| Values | Value, Math, Remap, Oscillator, Source Time, Audio Level, Palette | „Source Time“ → **Time** |
| Render | Points, Instances, Neighbor Links, Trails, Curves, Endpoint Glyphs, Velocity Vectors | – |
| Output / Groups | Scene Output, Group | – |

### 4.12 Controls (9), Color-Graph (11), Clip-Stufen (7)

| Bereich | Änderungen |
|---|---|
| Controls | Kontextname „Parameter sources“ → **Controls**. Constant → **Value**, LFO → **Oscillator**, Audio envelope → **Audio Envelope**. Echte Beschreibungen, heute zum Beispiel „add on two scalar values.“ |
| Color-Graph | Corrector → **Primaries**, Wheels → **Color Wheels**, Source → **External Source** (Kollision mit Clip-Source). Parallel/Layer/Key Mixer, Splitter, Combiner und Alpha Output bleiben. |
| Clip-Stufen | Color → **Color Grade** (Kollision mit Color Value und der Kategorie Color), Keyframe Node → **Keyframes**, AI Node → **AI**. |

### 4.13 Audio-Effekte (24): 9 Kategorien → 6

| neu | Einträge |
|---|---|
| Level & Channels | Volume, Pan, Normalize, Polarity Invert, Mono Sum, Channel Swap, Stereo Split |
| EQ & Filter | EQ → **Graphic EQ**, Parametric EQ, High Pass Filter → **High Pass**, Low Pass Filter → **Low Pass** |
| Dynamics | Compressor, Limiter, Expander, Noise Gate, De-esser |
| Repair | Hum Notch, De-click, Noise Reduction, Spectral Gate |
| Time & Space | Delay, Reverb |
| Character & Advanced | Saturation, Audio Math Graph → **Audio Math** |

---

## 5. Effekte (102)

### 5.1 Stil-Familien (Engines)

| Engine | Effekte | Umgang |
|---|---|---|
| Two-Tone Pattern (30) | Halftone, Pattern Halftone, Dithering, Dither Studio, Riso, Riso Glow, Pixel Press, Pixel Poster, Tone Geometry, Cross Stitch, Scatter Mosaic, Drift Lines, Glitch Grid, CRT Screen, Crystal Glass, Film Prism, Glass Pixel Dispersion, Glitch, Holo, Ribbon Scan, Wave Lines, Block Mosaic, Blockify, 3D Toy Bricks, Knitted Embroidery, Outline, Contour Map, Crosshatch, Kilim Carpet, Vector Engraving | Einzeln im Picker behalten (Looks mit Thumbnail). Im Inspector erscheint zusätzlich **„Style ▾“**, mit dem man innerhalb der Engine wechselt, ohne neu hinzuzufügen. |
| Glyph Mosaic (19) | ASCII, ASCII Ghost, Brand Generator, Tag Pills, Data Hatching, Dither Text, Glyph Matrix, Grid Glyph, Inscribe, Matrix Rain, Number Field, Pixel Code, Pixel Dither Glow, Retro Matrix, Stitch Poster, Symbol Matrix, Creative UI Collage, Word Mosaic, Contour Type | wie oben |
| Tracking Overlay (8) | CCTV, HUD Tracker, Rain Reveal, Stardust, Motion Lab, Hand Particles, Trace Motion, Subject | wie oben |
| Acuarela = Rom1 | Acuarela, Rom1 | Rom1 wird ein Preset von Acuarela; die ID bleibt als Alias. |

### 5.2 Neue Effekt-Kategorien – vollständige Zuordnung

| Kategorie | Effekte (Umbenennung in Klammern) |
|---|---|
| **Color & Tone** (11) | Brightness, Contrast, Exposure, Levels, Saturation, Vibrance, Temperature, Hue Shift, Invert, Posterize, Threshold |
| **Blur & Sharpen** (6) | Box Blur, Gaussian Blur, Motion Blur, Radial Blur, Zoom Blur, Sharpen |
| **Light & Stylize** (5) | Glow, Vignette, Edge Detect, Acuarela, Rom1 (→ Acuarela-Preset) |
| **Lens & Distort** (11) | Fisheye Lens, Bulge/Pinch (→ Bulge & Pinch), Twirl, Wave, Kaleidoscope, Mirror, RGB Split, Crystal Glass, Glass Pixel Dispersion (→ Glass Dispersion), Film Prism, Holo |
| **Pixel & Mosaic** (8) | Pixelate, Block Mosaic, Blockify, Quadtree Zoom, Scatter Mosaic, Pixel Poster, Pixel Sort, Voronoi |
| **Print & Halftone** (8) | Halftone, Pattern Halftone, Dithering, Dither Studio, Riso, Riso Glow, Pixel Press (→ Paper Print), Tone Geometry |
| **Lines & Engraving** (7) | Crosshatch, Vector Engraving, Contour, Contour Map, Outline, Wave Lines, Drift Lines |
| **Textile & Craft** (4) | Knitted Embroidery (→ Embroidery), Kilim Carpet, Cross Stitch, Stitch Poster |
| **Text & Glyph** (18) | ASCII, ASCII Ghost, Glyph Matrix, Symbol Matrix, Retro Matrix, Matrix Rain, Grid Glyph, Number Field, Pixel Code, Word Mosaic, Inscribe, Dither Text, Data Hatching, Pixel Dither Glow (→ Dither Glow), Contour Type; Untergruppe Layouts: Brand Generator, Tag Pills, Creative UI Collage |
| **Analog & Glitch** (8) | Analog Signal Lab, CRT Screen, Scanlines, Film Grain, Glitch, Glitch Grid, Ribbon Scan, Memory Leak |
| **Keying** (1) | Chroma Key (Ausnahme zu R7; weitere Key-Arten folgen, siehe Abschnitt 9) |
| **Time** (3) | Slit Scan, Time Stack, Trace Motion (→ Motion Trails) |
| **Tracking & Overlays** (8) | Face Cables, Hand Particles, HUD Tracker, CCTV Surveillance (→ CCTV), Subject (→ Subject Highlight), Motion Lab (→ Tracked Scene), Stardust, Rain Reveal |
| **3D & Particles** (4) | Voxel Relief, Splat Exploration, 3D Toy Bricks (→ Toy Bricks), Pixel Particle Disintegrate |

Die Kategorie `transition` in `CATEGORY_INFO` entfällt, weil sie leer ist.
Alle 102 Effekte bekommen eine Ein-Satz-Beschreibung (R4).

---

## 6. Drei Systeme

Alle drei nutzen die Inventur aus Abschnitt 4 und 5. Sie unterscheiden sich
darin, **wonach die oberste Ebene sortiert** ist.

### System A – Funktionsbaum (Blender/Houdini-Stil)

Ein globaler Baum nach Node-Funktion, in jedem Graph gleich. Kategorien ohne
passende Nodes werden in der jeweiligen Domäne ausgeblendet. Effekte haben einen
eigenen Baum (5.2).

```text
Nodes
├─ Input & Output     IN, OUT (Input Frame, UV, Resolution, Video Source, Output …)
├─ Values             VAL, TIME, OSC
├─ Math               ARITH | ROUND | TRIG | SHAPE (Unterordner)
├─ Logic & Switch     LOGIC
├─ Vector & Convert   VEC, CONV
├─ Color & Mask       COLOR, KEY
├─ Coordinates & Lens UV, LENS
├─ Sampling & Filter  SAMPLE, FILTER, CACHE
├─ Time & Motion      TEMP, MOTION
├─ Patterns & Fields  PATTERN
├─ Text & Glyph       GLYPH
├─ Analog Signal      ANALOG
├─ Geometry           GEO (inkl. Splat-Geometrie)
├─ Shading            MAT, CAMLIGHT
├─ Simulation         SIM (+ Flock-Behavior, Splat-Partikel)
├─ Tracking & Depth   TRACK
├─ Rendering          RENDER (+ Flock-Render)
└─ Controls           CTRL
```

- **Pro:** ein Vokabular für alles. Wer „Math“ einmal kennt, findet es überall. Leicht zu pflegen: neuer Node → Klasse wählen, fertig.
- **Contra:** 18 Oberkategorien, viele davon in einer Domäne leer oder winzig. Domänenlogik geht verloren: Flock und Splat werden über Simulation, Rendering und Geometry zerstreut, der gute Flock-Baum verschwindet.

### System B – Domäne → Funktion (kontextabhängig, codenah)

Die Wurzel ist der **aktuelle Graph**, automatisch gewählt; der Nutzer sieht nie
fremde Domänen. Jede Domäne hat einen kuratierten Baum mit 5–9 Kategorien.
Überlappende Kategorien tragen dieselben Namen.

```text
Bild-Graph (Effekte)          3D-Graph (Surfaces, Voxel, Face Cables)
├─ Inputs                     ├─ Inputs & Sources (Clip Geometry, Saved Depth …)
├─ Values & Time              ├─ Values & Math
├─ Math                       ├─ Geometry
├─ Logic, Vector & Convert    ├─ Shading (Material, Texture, Camera, Light)
├─ Color & Mask               ├─ Tracking & Depth
├─ Coordinates & Lens         ├─ Forces & Simulation
├─ Sampling & Filter          └─ Output & Render
├─ Time & Motion
├─ Patterns, Text & Signal    Splat-Graph: Source, Transform, Attributes,
└─ (Advanced: Effekt-Bauteile)  Simulation, Crop & Fade, Surface & Render

Flock: bestehender Baum (4.11)   Audio: Effekte (4.13) + Sample Math
Color Grade: Anker, Correct, Mix & Split, Output
Controls: Values, Time, Oscillator, Keyframes, Audio Envelope, Math
Clip: Stufen + Effekte (5.2)
```

- **Pro:** kurze Listen (≤10 Kategorien) ohne irrelevante Einträge. Passt 1:1 zu den bestehenden Executor-Grenzen (`addableEffectOperators`, Flock-Registry, Audio). Der Flock-Baum bleibt.
- **Contra:** Der Katalog-Browser braucht einen Domänen-Umschalter. Ohne Disziplin driften die Namen zwischen Domänen auseinander; dagegen helfen R3 und ein Test. Nutzer müssen wissen, in welchem Graph sie sind (ist praktisch immer offensichtlich).

### System C – Absicht zuerst (Resolve/After-Effects-Stil)

Die Wurzel ist das, was der Nutzer **erreichen** will. Effekte und Bausteine
stehen gemischt dort, wo sie demselben Ziel dienen. Ein Eintrag darf in bis zu
zwei Absichten stehen (Multi-Homing über Tags).

```text
├─ Looks               alle Effekte nach 5.2
├─ Adjust Color        Color-Effekte, Luminance, Saturation, HSV, Color Grade
├─ Key & Mask          Chroma Key, Mask Overlay, Temporal Smooth (Value), Step/Smoothstep
├─ Blur & Filter       Blur-Effekte, Kernel, Edge Strength, Derivative
├─ Distort & Lens      Distort-Effekte, UV-Nodes, Lens-Nodes
├─ Time & Motion       Time-Effekte, Temporal Smooth, Past Frame, Optical Flow
├─ Track & 3D          Tracking-Effekte, 3D-Nodes, Splat, Depth
├─ Particles           Flock, Splat-Partikel, Forces
├─ Text & Pattern      Glyph-Effekte und -Nodes, Noise, Patterns
├─ Audio               Audio-Effekte, Sample Math
├─ Drive Parameters    Controls (Oscillator, Keyframes, Audio Envelope …)
└─ Build               Values, Math, Logic, Vector & Convert, Sampling, Advanced
```

- **Pro:** Einsteiger und der Agent finden nach Aufgabe („ich will die Maske beruhigen“). Effekt und passende Bausteine stehen nebeneinander. Das ist stark für Suche mit Synonymen.
- **Contra:** Die Zuordnung ist oft Ansichtssache und braucht Multi-Homing. Pflege ist teurer, weil jede neue Node eine Absicht braucht. Experten suchen die Mathe-Bausteine unter „Build“ statt direkt.

### 6.4 Vergleich

| Kriterium | A Funktion | B Domäne → Funktion | C Absicht |
|---|---|---|---|
| Einsteiger finden Looks | mittel | gut (Clip: Effekte) | **sehr gut** |
| Experten bauen Graphen | **sehr gut** | sehr gut | mittel |
| Listenlänge pro Menü | lang (18 oben) | **kurz (≤10)** | mittel (12) |
| Konsistenz über Domänen | **sehr gut** | gut (mit R3-Test) | mittel |
| Passt zur Architektur | mittel | **sehr gut** | schwach |
| Agent/Suche | gut | gut | **sehr gut** (Tags) |
| Pflegeaufwand | **niedrig** | niedrig | hoch |
| Umbauaufwand | mittel | **niedrig–mittel** | hoch |

### 6.5 Empfehlung

**System B als Gerüst, mit dem Kategorievokabular aus A und den Tags aus C:**

- Menüs sind ohnehin schon pro Graph gefiltert. B formalisiert das nur und hält die Listen kurz.
- Innerhalb jeder Domäne heißen die Kategorien wie in A („Math“, „Values & Time“, „Color & Mask“ …). Nutzer lernen ein Vokabular.
- Von C kommen die Synonyme und Tags für Suche und Agent, dazu die Look-Kategorien (5.2) für Effekte.
- Der Katalog-Browser zeigt standardmäßig die aktuelle Domäne; „Alle Domänen“ ist umschaltbar.

---

## 7. Umsetzung in Phasen

| Phase | Inhalt | Risiko |
|---|---|---|
| **0 – Entscheidung** | System wählen, offene Punkte aus Abschnitt 8 klären | – |
| **1 – Quick Wins** (ohne Datenmodell) | `CATEGORY_INFO` in Picker und Kontextmenü; interne und Legacy-Nodes aus dem Catalog; Compiler-Felder hinter „Details“; Kontext-Bug in `operatorContext()` beheben; `categoryLabel`-Map vervollständigen; `field.*` ins Reusable-Menü; Label-Umbenennungen aus Abschnitt 4 (nur Labels); Effekt-Umsortierung (5.2) | niedrig; Label-Änderungen betreffen Snapshot-Tests und Agent-Texte, keine IDs |
| **2 – Metadatenmodell** | pro Eintrag `group`, `visibility`, `tags`, `description` (Pflicht) an Operator-, Effekt-, Audio-, Control-, Color- und Flock-Registry; gemeinsamer `buildNodeMenu(domain, visibility)` für alle sechs Oberflächen; Advanced-Schalter | mittel |
| **3 – Zusammenfassen** | Switch-Familie, Primitive, Luminance, Sample Image mit Clamp, Edge Strength, Mirror Repeat, Convert, Derivative, Kernel, Sequence; Kräfte-Labels; Rom1 als Acuarela-Preset; „Style ▾“ für die drei Effekt-Engines | mittel: Familie per Präsentation, IDs bleiben |
| **4 – Tiefer (optional)** | Voxel- und Face-Cables-Mathe und Control-Mathe auf die gemeinsamen Familien heben; eine gemeinsame Kraft-Familie für Forces, Splat und Flock; Effekt-Engines intern auf eine Implementierung mit Style-Parameter | hoch, eigener Plan |

Absicherung ab Phase 1 per Katalog-Test:
- jedes `public`-Label ist innerhalb seiner Domäne eindeutig;
- jeder `public`-Eintrag hat eine Beschreibung;
- keine `internal`-Einträge in Menüs;
- keine Kategorie mit weniger als 3 Einträgen außer freigegebenen Ausnahmen;
- keine Labels mit „Legacy“, „IEEE“ oder Typ-Suffix.

Agent: `buildAgentNodeCatalogText()` gruppiert nach den neuen Kategorien, IDs
bleiben. Der Kernel-Katalog-Digest ist nur betroffen, wenn sich Tool-Schemas
ändern.

---

## 8. Offene Entscheidungen

1. Welches System (Empfehlung: B mit A-Vokabular und C-Tags)?
2. Effekt-Engines: einzelne Looks behalten plus „Style ▾“ (Empfehlung), oder zu einem Effekt pro Engine zusammenlegen?
3. Markante Effektnamen wie „Memory Leak“, „Holo“, „Stardust“: behalten und nur beschreiben, oder sprechend umbenennen?
4. Advanced-Schalter: pro Nutzer gemerkt (Settings) oder pro Graph?
5. Rom1: als Preset von Acuarela weiterführen oder ganz verstecken?
6. `coordinates.divide-x` und die übrigen `fisheye.*`-Bauteile: nur Advanced oder intern?

## 9. Lücken im Katalog (beim Durchgang aufgefallen)

- **Vergleich und Logik:** Es gibt nur Greater Than und And. Es fehlen Less Than, Equal, Or, Not.
- **Keying:** Nur Chroma Key als Effekt, keine Key-Bausteine (Chroma Distance, Luma Key, Difference Key, Spill Suppress).
- **Filter:** kein fertiger Blur-Baustein (nur Kernel-Teile), kein Erode/Dilate für Masken.
- **Rauschen:** nur Value Noise und Hash; Perlin/Simplex/Worley fehlen.
- **Map Range** im Bild-Graph fehlt; Remap gibt es nur bei Controls und Flock.
- **Time** fehlt im 3D-Graph als Baustein.
