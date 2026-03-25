# 3D Camera Controls — Konsens-Analyse

**6 Research-Agents → 3 Synthese-Agents → 1 Konsens**

---

## ÜBEREINSTIMMUNG (alle 3 Synthese-Agents einig)

### ROOT CAUSE #1: React 19 registriert Wheel-Listener als PASSIVE (KRITISCH)

**Confidence: 95% | Agents: A1, A2, A5, Synthesis A, B, C**

`Preview.tsx` Zeile 704 nutzt `onWheelCapture={handleWheel}`. React 19 (`"react": "^19.2.0"`) registriert intern **alle wheel-Listener als passive**. Synthesis-Agent C hat dies direkt im React-Quellcode verifiziert:

```javascript
// react-dom-client.production.js (Zeilen 12390-12406):
"wheel" !== domEventName || (listenerWrapper = !0);  // passive = TRUE für wheel!
targetContainer.addEventListener(domEventName, handler, { capture: true, passive: true });
```

**Konsequenz:** `e.preventDefault()` (Preview.tsx Zeile 499) ist ein **stiller No-Op**. Der Browser scrollt trotzdem das Panel (`dock-panel-content-inner` hat `overflow: auto`). Der Zoom-Code läuft zwar, aber das gleichzeitige Scrollen macht es visuell kaputt.

**Beweis:** Jede ANDERE Stelle im Codebase nutzt bereits native `addEventListener`:
- `useTimelineZoom.ts:185` → `addEventListener('wheel', ..., { passive: false })` → **FUNKTIONIERT**
- `DockTabPane.tsx:365` → `addEventListener('wheel', ..., { passive: false })` → **FUNKTIONIERT**
- `SlotGrid.tsx:222` → `addEventListener('wheel', ..., { passive: false })` → **FUNKTIONIERT**
- `ImageCropper.tsx:199` → `addEventListener('wheel', ..., { passive: false })` → **FUNKTIONIERT**
- `Preview.tsx:704` → `onWheelCapture={...}` (React delegiert) → **KAPUTT**

Preview ist die EINZIGE Stelle die noch React's synthetischen Wheel-Handler nutzt.

---

### ROOT CAUSE #2: Stale Closure im Wheel-Handler (HOCH)

**Confidence: 85% | Agents: A3, A5, A6, Synthesis A, B, C**

`handleWheel` (Zeile 502) liest `selectedGaussianSplatClip.transform.scale.x` aus der Closure. Nach `updateClipTransform` updated der Store synchron, aber React re-rendert async. Schnelles Scrollen: alle Events im selben Render-Zyklus lesen den GLEICHEN alten Zoom-Wert → Zoom "hängt".

---

### ROOT CAUSE #3: Browser-Autoscroll fängt Mittelklick ab (HOCH)

**Confidence: 80% | Agents: A1, A2, A5, Synthesis A, B, C**

`e.preventDefault()` auf dem React-synthetischen `mousedown` (Zeile 596) feuert über Event-Delegation am Document-Root — **zu spät** um den nativen Autoscroll des Browsers zu verhindern. Kein `setPointerCapture()` genutzt → Browser zeigt Autoscroll-Cursor und fängt alle folgenden Mouse-Events ab.

---

### ROOT CAUSE #4: Doppelte Zoom-Dämpfung beim Pan (MITTEL)

**Confidence: 70% | Agents: A6, Synthesis A, B, C**

Event-Handler (Zeile 413): `zoomDamping = 1/sqrt(zoom)` × Camera-Math (SplatCameraUtils.ts Zeile 61): `distance = baseDistance/zoom`. Kombiniert: Pan-Sensitivität skaliert mit `1/zoom^1.5`. Bei Zoom 4x ist Pan 8× gedämpft → fühlt sich "kaputt" an.

---

## WIDERLEGTE HYPOTHESEN (alle 3 Synthese-Agents einig)

| Hypothese | Agent | Warum widerlegt |
|-----------|-------|----------------|
| DockTabPane Wheel-Listener blockiert Preview | A2 (95%) | Listener ist auf Tab-Bar-Element, nicht Panel-Content. Braucht Ctrl-Key. Canvas ist in Sibling-Subtree. |
| Dropdown z-index fängt Events ab | A4 (80%) | Dropdowns nur im DOM wenn `*Open` state true. Werden gar nicht gerendert wenn geschlossen. |
| gaussianSplatNavClipId Sync-Problem | A3 (95%) | Nur EIN Aufrufer (TransformTab Toggle). Einfacher On/Off-Switch. IDs bleiben stabil. |
| Set-Iteration nicht-deterministisch | A3 (70%) | JS Set-Iteration ist per Spec insertion-order. Deterministisch. |
| gaussianNavEnabled flackert | A1, A3 | Boolean aus 4 stabilen Store-Werten. Flackert nicht wenn Werte stabil sind. |

---

## WARUM DER VORHERIGE FIX NICHT FUNKTIONIERT HAT

Wir hatten `isCanvasInteractionTarget` verbreitert. Aber das Target-Checking ist **nicht das Hauptproblem**. Die Events ERREICHEN den Handler und der Code LÄUFT. Das Problem ist:
1. `preventDefault()` ist wirkungslos (passive listener) → Browser scrollt trotzdem
2. Zoom liest stale Werte → scheint nicht zu reagieren
3. Mittelklick wird vom Browser-Autoscroll abgefangen

---

## FIX-PLAN (Priorität)

### Fix 1: Native Wheel-Listener mit `{ passive: false }` (KRITISCH)

`onWheelCapture` entfernen, stattdessen `useEffect` + `addEventListener`:

**Datei:** `src/components/preview/Preview.tsx`

```typescript
// Ref-Pattern um Abhängigkeiten stabil zu halten:
const handleWheelRef = useRef(handleWheel);
handleWheelRef.current = handleWheel;

useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  const handler = (e: WheelEvent) => handleWheelRef.current(e as any);
  container.addEventListener('wheel', handler, { passive: false });
  return () => container.removeEventListener('wheel', handler);
}, []);

// JSX: onWheelCapture={handleWheel} ENTFERNEN
```

### Fix 2: Fresh State im Wheel-Handler (HOCH)

```typescript
// Zeile 502 — VORHER (stale closure):
const currentZoom = Math.max(0.05, selectedGaussianSplatClip.transform.scale.x || 1);

// NACHHER (frischer Store-Read):
const freshClip = useTimelineStore.getState().clips.find(
  c => c.id === selectedGaussianSplatClip.id
);
const currentZoom = Math.max(0.05, freshClip?.transform.scale.x || 1);
```

### Fix 3: Native Mousedown für MMB-Autoscroll-Prevention (HOCH)

```typescript
useEffect(() => {
  const container = containerRef.current;
  if (!container || !gaussianNavEnabled) return;

  const preventMiddleClick = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault(); // Verhindert Autoscroll
  };

  container.addEventListener('mousedown', preventMiddleClick, { passive: false });
  return () => container.removeEventListener('mousedown', preventMiddleClick);
}, [gaussianNavEnabled]);
```

### Fix 4: Doppelte Zoom-Dämpfung im Pan entfernen (MITTEL)

```typescript
// Zeilen 413-415 — VORHER:
const zoomDamping = 1 / Math.sqrt(Math.max(0.35, zoom));
const panScaleX = (2 / Math.max(1, effectiveResolution.width)) * zoomDamping;
const panScaleY = (2 / Math.max(1, effectiveResolution.height)) * zoomDamping;

// NACHHER (Camera-Math handelt Zoom bereits):
const panScaleX = 2 / Math.max(1, effectiveResolution.width);
const panScaleY = 2 / Math.max(1, effectiveResolution.height);
```

---

## ZUSAMMENFASSUNG

| # | Problem | Betrifft | Confidence |
|---|---------|----------|-----------|
| 1 | Passive Wheel-Listener (React 19) | Wheel-Zoom | 95% |
| 2 | Stale Closure im Wheel-Handler | Wheel-Zoom | 85% |
| 3 | Browser-Autoscroll bei Mittelklick | MMB-Pan | 80% |
| 4 | Doppelte Zoom-Dämpfung | Pan-Gefühl | 70% |

**Fix 1 allein löst wahrscheinlich das Hauptproblem (Wheel-Zoom).
Fix 1 + Fix 3 zusammen lösen beide gemeldeten Symptome.**
