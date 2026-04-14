# Memory

## Three.js Gaussian Splat Debug

Stand: 2026-04-11

### Ziel

Three.js soll Gaussian-Splats in der Shared 3D Scene rendern.

Native Render funktioniert.
Three.js laedt Daten und bekommt den Layer in die Scene, aber der Splat ist aktuell nicht korrekt bzw. teilweise komplett unsichtbar.

### Wichtige Regeln / Setup

- Dev-Server nicht selbst neu starten.
- Der laufende Dev-Server wird ueber `C:\Users\admin\Desktop\Spalts-DevServer.bat` gestartet.
- AI-Bridge laeuft auf `http://localhost:5173`.
- Fuer Debugging wurden `reloadApp`, `captureFrame`, `getStats`, `getTimelineState` und `api/logs` benutzt.

### Bisherige Befunde

- Timeline/Layer kommen korrekt an.
- Der Splat-Clip ist sichtbar und `useNativeRenderer: false`.
- Native Splat-Rendering funktioniert weiterhin.
- Three.js-Renderpfad wird aufgerufen.
- Shared-scene Camera-Clip wird angewendet.
- Das Three.js-Ergebnis wird in den WebGPU-Compositor importiert.
- Ein gecapturter Preview-Frame war komplett leer/schwarz.
- Live-Logs zeigten trotzdem korrekt geladene Splat-Geometrie:
  - Datei: `bonsai-7k.splat`
  - `totalSplats: 1157141`
  - `renderedSplats: 115715`
  - `stride: 10`
- Camera im Probe-Log war spaeter plausibel:
  - `cameraPosition ~ [0, 0, 1.6417]`
  - `cameraDirection ~ [0, 0, -1]`
- Projektion war nicht mehr rein subpixel:
  - `projectedSigmaStats.avgPx ~ 1.87`
  - `projectedSigmaStats.maxPx ~ 13.36`
- Trotzdem blieb `alphaProbe` im Render-Log bei `0`.

### Dateien, die bisher relevant waren

- `C:\Users\admin\Documents\masterselects-spalts\src\engine\three\ThreeSceneRenderer.ts`
- `C:\Users\admin\Documents\masterselects-spalts\src\engine\render\RenderDispatcher.ts`
- `C:\Users\admin\Documents\masterselects-spalts\src\engine\gaussian\core\SplatCameraUtils.ts`
- `C:\Users\admin\Documents\masterselects-spalts\src\engine\gaussian\shaders\gaussianSplat.wgsl`
- `C:\Users\admin\Documents\masterselects-spalts\src\engine\gaussian\loaders\SplatLoader.ts`
- `C:\Users\admin\Documents\masterselects-spalts\src\engine\gaussian\loaders\PlyLoader.ts`

### Bereits gemachte Versuche

#### 1. Broken external renderer rausgenommen

- Der fruehere `gaussian-splat-renderer-for-lam`-Pfad war kaputt und fuer normale Splats unzuverlaessig.
- Er wurde durch einen internen Three.js-Pfad ersetzt.

#### 2. Preview-Compositing repariert

- Das Three.js-Canvas wurde ueber eine 2D-Bridge in den WebGPU-Compositor uebernommen.
- Damit war die Shared Scene grundsaetzlich im Preview sichtbar.

#### 3. Camera fuer Shared Scene angepasst

- Shared-scene Camera-Clips benutzen jetzt eine kleinere Mindestdistanz.
- Ziel war, dass der Splat nicht zu weit weg sitzt.

#### 4. Point-Cloud / Point-Sprite Fallback

- Es gab einen stabilen Punktwolken-Fallback.
- Das war sichtbar, aber kein echter Splat-Look.

#### 5. Instanced-Quad / Ellipse Shader

- Danach wurde ein eigener Three.js-Splat-Shader mit instanced quads gebaut.
- Der Shader benutzte:
  - `instanceCenter`
  - `instanceAxisX`
  - `instanceAxisY`
  - `instanceAxisZ`
  - Gaussian-Falloff im Fragment-Shader
- Ergebnis war noch nicht stabil bzw. teilweise leer.

#### 6. Extra Diagnostics in ThreeSceneRenderer

- Render-Probe eingebaut:
  - NDC center
  - camera position/direction
  - alphaProbe via `readPixels`
  - projected sigma stats
- Das hat gezeigt:
  - Daten sind da
  - Camera ist da
  - Geometrie wird vorbereitet
  - Sichtbarkeit scheitert wahrscheinlich in der eigentlichen Rasterisierung / Conic-Mathe

#### 7. Scale-Boost im Shared Scene Pfad

- `THREE_SHARED_SCENE_SPLAT_SCALE_BOOST = 6`
- Damit wurden die projizierten Splats groesser.
- Trotzdem war der Capture weiter leer.

#### 8. Native Shader-Idee in Three portiert

- Der Three.js-Shader wurde spaeter naeher an den nativen WGSL-Ansatz gebracht:
  - 2D covariance
  - conic inversion
  - radius aus Eigenwerten
- Auch dieser Stand war noch nicht der Durchbruch.

### Aktueller Verdacht

Der Fehler sitzt sehr wahrscheinlich nicht mehr in:

- Datei-Import
- Layer-Sync
- Preview-Compositing
- Camera-Clip-Auswahl

Der Fehler sitzt wahrscheinlich in einem dieser Punkte:

- falsche Interpretation der Splat-Achsen / Quaternion-Konvention
- falsche Screen-Space-Projektion im Three-Shader
- falsches Clip/NDC-Verhalten in der Vertex-Ausgabe
- Alpha bleibt effektiv 0 oder wird komplett verworfen
- Rasterisierung passiert, aber nicht an der erwarteten Position / Groesse

### Was beim naechsten Versuch zuerst pruefen

1. In `ThreeSceneRenderer.ts` den Fragment-Shader testweise auf harte, sichtbare Ellipsen ohne Gaussian stellen.
2. Testweise `gl_FragColor = vec4(1,0,0,1)` fuer ein paar Splats erzwingen, um Rasterisierung sicher zu beweisen.
3. Min/Max/Avg von `instanceOpacity` und Achsenlaengen direkt nach dem Laden loggen.
4. Testweise `depthTest = false` fuer den Splat-Materialpfad setzen.
5. Testweise nur sehr wenige Splats rendern, z. B. die ersten `128`, damit gezielter debuggt werden kann.
6. Wenn moeglich alten funktionierenden Three.js-Splat-Stand / Commit / Branch wiederfinden und gegen `ThreeSceneRenderer.ts` diffen.

### Nuetzlicher Stand aus den Logs

- `Three.js splat geometry prepared` war ein guter Marker.
- `Three.js splat render probe` war ebenfalls hilfreich.
- Wenn dort `projectedSigmaStats` groesser als deutlich unter `1px` ist und der Capture trotzdem leer bleibt, ist der Fehler eher Shader/Raster statt Camera-Distanz.

### Letzter bekannte Commit aus diesem Arbeitsstrang

- `c935db85` - `Fix Three.js shared scene import path`

### Kurzfazit

Die Baustelle ist inzwischen eng eingegrenzt:
Three.js Shared Scene, Layer und Camera sind grundsaetzlich da.
Das offene Problem ist das korrekte Screen-Space-Splat-Rasterizing im Three.js-Pfad.

## Three.js Splat Effector

Stand: 2026-04-12

### Ziel

Ein neuer Timeline-Clip `splat-effector` soll Three.js-Splats live zur Laufzeit beeinflussen.
Native Gaussian-Splats bleiben unberuehrt.

### Implementierter Stand

- Neuer Media-/Clip-Typ `splat-effector`
- Eigener Property-Tab `Effector`
- Effector-Clips sind nicht rendernd und wirken nur als Scene-Controller
- Aktive Effector-Clips werden im `RenderDispatcher` direkt aus der Timeline gesammelt
- Der Three.js-Splat-Shader bekommt pro Frame bis zu `8` aktive Effectors als Uniforms
- Erste Modi:
  - `repel`
  - `attract`
  - `swirl`
  - `noise`

### Wichtige technische Entscheidung

Keine persistente Physik-Simulation.
Der Effekt ist prozedural und deterministisch aus:

- Clip-Laufzeit
- Clip-Transform
- Effector-Settings

Damit bleibt Scrubbing stabil und reproduzierbar.

### Relevante Dateien

- `C:\Users\admin\Documents\masterselects-spalts\src\types\splatEffector.ts`
- `C:\Users\admin\Documents\masterselects-spalts\src\stores\timeline\splatEffectorClipSlice.ts`
- `C:\Users\admin\Documents\masterselects-spalts\src\components\panels\properties\SplatEffectorTab.tsx`
- `C:\Users\admin\Documents\masterselects-spalts\src\engine\render\RenderDispatcher.ts`
- `C:\Users\admin\Documents\masterselects-spalts\src\engine\three\ThreeSceneRenderer.ts`

### Aktuelle Grenzen

- Effectors wirken aktuell global auf alle Three.js-Splats
- Noch kein Targeting auf einzelne Splat-Clips / Gruppen
- Radius ist aktuell kugelfoermig ueber `max(scale.x, scale.y, scale.z)` approximiert
- Sorting der Splats bleibt auf dem vorhandenen Approx-Pfad und kennt die live deformierte Position nicht exakt

### Verifikation

- `npm run -s build` laeuft grün
- Bekannte Projektwarnungen (`mp4box`, chunk-size) bleiben unveraendert
