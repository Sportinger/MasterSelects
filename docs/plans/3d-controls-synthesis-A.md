# 3D Camera Controls Bug -- Synthesis Analysis A

Synthesis of 6 independent agent investigations, with every claim verified against the actual source code.

---

## 1. CONSENSUS: Hypotheses Multiple Agents Agree On

### 1a. React `onWheelCapture` passive listener problem (Agents 1, 2, 5) -- 3/6

**Claim:** React 19 (confirmed: `react ^19.2.0` in `package.json`) delegates all event listeners to the document root. Wheel listeners may be registered as passive by modern browsers/React, which silently ignores `e.preventDefault()`. The timeline's `useTimelineZoom.ts` (line 185) explicitly uses `addEventListener('wheel', ..., { passive: false })` and works correctly, while Preview.tsx (line 704) uses React's `onWheelCapture` synthetic handler.

**Code verification:**
- Preview.tsx line 704: `onWheelCapture={handleWheel}` -- confirmed, this is a React synthetic event prop.
- useTimelineZoom.ts line 185: `el.addEventListener('wheel', handleWheel, { passive: false })` -- confirmed, this is a native listener.
- DockTabPane.tsx line 365: `tabBar.addEventListener('wheel', handleWheel, { passive: false })` -- confirmed, another native listener that works.
- handleWheel in Preview.tsx (lines 498-510) calls `e.preventDefault()` -- if the listener is passive, this call is a no-op. The wheel event would still propagate to the browser's default scroll behavior, but the zoom logic itself (lines 502-509) would still execute. So the user would see the page/panel scrolling but the zoom would still apply. This would explain "zoom feels broken" but not "zoom does not work at all."

**Verdict: LIKELY REAL BUG.** The `preventDefault()` being silently ignored would cause the dock panel's scroll container (`dock-panel-content-inner` has `overflow: auto` per dock.css line 328) to scroll simultaneously with the zoom, creating a visually broken experience. The zoom math itself would run, but the competing scroll would make it appear non-functional.

**Confidence: HIGH (8/10)**

---

### 1b. Browser middle-click autoscroll (Agents 1, 2, 5) -- 3/6

**Claim:** Middle mouse button (button 1) triggers the browser's native autoscroll mode, which captures subsequent mouse events. `e.preventDefault()` on a React synthetic `mousedown` may be too late to prevent this.

**Code verification:**
- Preview.tsx lines 594-609: Middle-click (button === 1) is handled with `e.preventDefault()`. However, this is a React synthetic event via `onMouseDownCapture`. The browser's autoscroll is initiated at the native level before React's delegated handler fires.
- No `setPointerCapture()` is used anywhere in the gaussian navigation code.

**Verdict: LIKELY REAL BUG for middle-click pan.** The browser's autoscroll icon would appear and steal mouse events. The user sees the autoscroll cursor instead of panning. This is a well-known browser behavior. The fix requires either a native `addEventListener` for mousedown with `{ passive: false }` or using `setPointerCapture()`.

**Confidence: HIGH (8/10)**

---

### 1c. `gaussianNavEnabled` state fragility / flicker (Agents 1, 3) -- 2/6

**Claim:** `gaussianNavEnabled` depends on 4 conditions (line 305-310), and the cleanup effect (lines 357-369) resets orbiting/panning when it becomes false. Any transient state change cancels the interaction.

**Code verification:**
- Line 305-310: `gaussianNavEnabled = Boolean(isEditableSource && !editMode && selectedGaussianSplatClip && gaussianSplatNavClipId === selectedGaussianSplatClip.id)` -- confirmed, 4 conditions.
- Lines 357-369: When `gaussianNavEnabled` becomes false, orbit and pan are forcefully terminated via `setIsGaussianOrbiting(false)`, `setIsGaussianPanning(false)`, and `endBatch()`.
- The `gaussianNavEnabled` variable is a plain Boolean computed every render, not memoized. However, since it only depends on stable store values, it would only flicker if the underlying values flicker.

**Verdict: REAL DESIGN WEAKNESS, but not a primary cause of "controls don't work."** This is a secondary amplifier -- if any of the 4 conditions transiently becomes false during an interaction, the mid-drag is killed. The most likely trigger is `gaussianSplatNavClipId` falling out of sync (see 1d).

**Confidence: MEDIUM (6/10)**

---

### 1d. `gaussianSplatNavClipId` synchronization gap (Agent 3 solo, but related to Agent 1) -- 1.5/6

**Claim:** There is NO useEffect that automatically clears/updates `gaussianSplatNavClipId` when clip selection changes. If the user deselects and reselects a gaussian clip, the ID stored in engineStore might be stale.

**Code verification:**
- engineStore.ts: `gaussianSplatNavClipId` is set ONLY via `setGaussianSplatNavClipId` (line 83).
- TransformTab.tsx line 155: The "Free Nav" button toggles it: `setGaussianSplatNavClipId(gaussianNavEnabled ? null : clipId)`.
- Preview.tsx: There is NO effect that resets `gaussianSplatNavClipId` when `selectedClipId` changes. There is NO effect that sets it automatically.
- Scenario: User clicks "Free Nav" on clip A. Then selects clip B. `gaussianSplatNavClipId` still equals clip A's ID. User reselects clip A -- but if clip A's ID changed (e.g., after undo/redo), `gaussianNavEnabled` becomes false.

**Verdict: REAL GAP but narrow impact.** Under normal usage (no undo/redo of the clip itself), reselecting the same clip preserves IDs. However, this means `gaussianNavEnabled` is false by default and requires the user to manually enable "Free Nav" each session. If the user forgot to click "Free Nav" or assumed it auto-enables, ALL controls would appear broken. This is a UX issue more than a bug.

**Confidence: MEDIUM (5/10)**

---

### 1e. Stale closure in handleWheel reading `selectedGaussianSplatClip.transform.scale.x` (Agents 5, 6) -- 2/6

**Claim:** `handleWheel` captures `selectedGaussianSplatClip` from the React closure. After `updateClipTransform` updates the store synchronously, React re-renders asynchronously. The next wheel event might use the OLD clip's scale value.

**Code verification:**
- handleWheel (line 497-552): `selectedGaussianSplatClip` is in the dependency array (line 548). The handler reads `selectedGaussianSplatClip.transform.scale.x` (line 502).
- `updateClipTransform` updates the Zustand store synchronously. However, the `selectedGaussianSplatClip` reference used in handleWheel comes from `useMemo` which recalculates on re-render. Between store update and re-render, rapid wheel events would read stale data.
- For zoom: `currentZoom = max(0.05, selectedGaussianSplatClip.transform.scale.x || 1)`. If stale, the zoom would reset each tick instead of accumulating. This could make zoom appear to "not work" (each wheel tick would compute new zoom from the SAME old base).

**Verdict: REAL BUG.** Rapid wheel scrolling would effectively multiply from the same base value repeatedly, making zoom appear stuck. The fix is to read the current value via `useTimelineStore.getState().clips.find(...)` instead of from the closure.

**Confidence: HIGH (7/10)**

---

### 1f. DockTabPane wheel listener interference (Agent 2 primary, Agent 1 secondary) -- 2/6

**Claim:** DockTabPane.tsx line 365 registers a native wheel listener on the tab bar that calls `stopPropagation()`, blocking Preview's wheel handler.

**Code verification:**
- DockTabPane.tsx lines 352-366: The handler is attached to `tabBarRef.current` (the tab bar element), NOT the content area. It only fires when `e.ctrlKey` is true (line 353). It calls `e.stopPropagation()` only when Ctrl is held.
- The tab bar is a SIBLING of the panel content, not an ancestor. Preview is rendered inside `dock-panel-content-inner`, not inside the tab bar.
- Wheel events on the Preview canvas would NOT bubble through the tab bar element.

**Verdict: FALSE POSITIVE.** The DockTabPane wheel listener is scoped to the tab bar element only, requires Ctrl key, and is not an ancestor of the preview canvas. It cannot intercept preview wheel events under normal conditions.

**Confidence: DISPROVED (9/10)**

---

### 1g. `isCanvasInteractionTarget` event target check fails for overlay elements (Agents 1, 4) -- 2/6

**Claim:** StatsOverlay, PreviewControls, and dropdowns are positioned above the canvas. Events hitting these elements cause `isCanvasInteractionTarget` to return false, dropping the event.

**Code verification:**
- `isCanvasInteractionTarget` (lines 312-318): Returns true if target is contained in `canvasRef` OR `canvasWrapperRef`.
- StatsOverlay is rendered OUTSIDE `canvasWrapperRef` (line 755 is outside the div at line 763).
- PreviewControls at line 724 is also outside `canvasWrapperRef`.
- StatsOverlay CSS: `z-index: 10`, `cursor: pointer` -- it IS interactive and positioned over the canvas.
- However, the event handlers are on `containerRef` (lines 704-710), which wraps EVERYTHING. The `onWheelCapture` and `onMouseDownCapture` fire at the container level. The `isCanvasInteractionTarget` check then filters events whose target is NOT the canvas.
- Clicking/scrolling on the stats overlay: `e.target` is the stats element, which is NOT inside canvasWrapperRef. The handler would drop this event silently.

**Verdict: REAL but LOW IMPACT.** Events landing on the stats overlay or controls bar are correctly filtered -- you wouldn't expect gaussian camera control when clicking on a UI button. The stats overlay area is small (top-right corner). This could only cause confusion if the user attempts to orbit/zoom with the mouse positioned over the stats badge, which is a corner case.

**Confidence: REAL but MINOR (4/10)**

---

## 2. DISAGREEMENTS

### 2a. Agent 6's "double zoom damping" in pan handler

**Agent 6 Claim:** Pan handler applies `zoomDamping = 1/sqrt(zoom)` (line 413), and SplatCameraUtils ALSO scales pan by zoom, resulting in double application.

**Code verification:**
- Preview.tsx pan handler (lines 413-415): Computes `zoomDamping = 1 / Math.sqrt(Math.max(0.35, zoom))` and applies it to `panScaleX/Y`. This produces a pixel-to-normalized-coordinate conversion that accounts for zoom level.
- SplatCameraUtils.ts lines 69-78: `halfWidth = tan(fov/2) * distance` and `panWorldX = layer.position.x * halfWidth`. The `distance = baseDistance / zoom` (line 61), so `halfWidth` shrinks with increasing zoom.
- In the event handler: pan delta is scaled by `zoomDamping` (inversely proportional to sqrt(zoom)).
- In the camera math: `panWorldX = position.x * halfWidth` where `halfWidth` is inversely proportional to zoom.
- Net effect: pan sensitivity scales as `1/(sqrt(zoom) * zoom) = 1/zoom^1.5`.

**Who is right:** Agent 6 is PARTIALLY right. There IS a double-application of zoom to pan, but it's not "applied twice identically." The event handler applies `1/sqrt(zoom)` damping, and the camera math applies `1/zoom` via the distance relationship. The combined effect is `1/zoom^1.5`, which is MORE aggressive than either alone. At zoom=4 (zoomed in), pan sensitivity is 1/8th of normal, making pan feel "stuck." At zoom=0.25 (zoomed out), pan sensitivity is 8x, causing wild overshoot.

**Verdict: REAL MATH BUG.** The `zoomDamping` in the event handler should be removed since the camera math already handles zoom-dependent pan scaling. Or the camera math should use raw position values with the handler providing the only zoom compensation. Currently they fight each other.

---

### 2b. Agent 4's dropdown z-index blocking events

**Agent 4 Claim:** Dropdown elements (z-index: 100) block canvas events even when not visually open.

**Code verification:**
- The composition selector dropdown is conditionally rendered (only when `selectorOpen` is true). When closed, the element is not in the DOM.
- Quality selector is also conditionally rendered.
- These dropdowns cannot block events when they are not rendered.

**Verdict: FALSE POSITIVE.** Agent 4 was wrong -- the dropdowns are conditionally rendered, not hidden with CSS. They cannot block events when closed.

---

### 2c. Agent 3's Set iteration order non-determinism

**Agent 3 Claim:** `[...selectedClipIds][0]` has non-deterministic ordering that could cause `selectedGaussianSplatClip` to become null.

**Code verification:** JavaScript Set iteration order IS deterministic -- it follows insertion order (per the ES2015+ spec). `[...selectedClipIds][0]` always returns the first-inserted element.

**Verdict: FALSE POSITIVE.** Set iteration is deterministic. Agent 3 was wrong about this specific mechanism, though the underlying concern about `selectedClipId` changes is valid via other paths (user clicking different clips).

---

## 3. VERIFIED BUGS (Confirmed by code reading)

### Bug 1: CRITICAL -- React synthetic `onWheelCapture` is likely passive
- **File:** `src/components/preview/Preview.tsx` line 704
- **Evidence:** React 19 delegates wheel events to the document root. Chrome treats wheel listeners on document/window as passive by default since Chrome 73+. The `e.preventDefault()` on line 499 and 515 would be silently ignored.
- **Impact:** Browser scrolls the dock panel content (`overflow: auto`) simultaneously with zoom, making zoom appear broken.
- **Fix:** Replace `onWheelCapture={handleWheel}` with a native `useEffect` + `addEventListener('wheel', ..., { passive: false })` on `containerRef.current`, identical to the pattern used in `useTimelineZoom.ts`.

### Bug 2: HIGH -- Browser autoscroll steals middle-click events
- **File:** `src/components/preview/Preview.tsx` lines 594-609
- **Evidence:** `e.preventDefault()` on React synthetic `onMouseDownCapture` for button 1. React's delegated handler fires after the browser has already initiated autoscroll mode.
- **Impact:** Middle-click pan is completely broken -- the browser's autoscroll icon appears and steals all subsequent mouse events.
- **Fix:** Add native `addEventListener('mousedown', ..., { passive: false })` to the canvas container, preventing default before the browser processes it. Or use `setPointerCapture(e.pointerId)` on the pointerdown event.

### Bug 3: HIGH -- Stale closure in handleWheel zoom accumulation
- **File:** `src/components/preview/Preview.tsx` line 502
- **Evidence:** `selectedGaussianSplatClip.transform.scale.x` is read from the closure, not from the current store state. Rapid wheel events between re-renders all compute from the same base zoom.
- **Impact:** Zoom appears to "not respond" -- each wheel tick overwrites the previous with an almost-identical value computed from the same stale base.
- **Fix:** Replace `selectedGaussianSplatClip.transform.scale.x` with `useTimelineStore.getState().clips.find(c => c.id === selectedGaussianSplatClip.id)?.transform.scale.x`.

### Bug 4: MEDIUM -- Double zoom compensation in pan handler
- **File:** `src/components/preview/Preview.tsx` lines 413-415 combined with `src/engine/gaussian/core/SplatCameraUtils.ts` lines 60-78
- **Evidence:** Event handler applies `1/sqrt(zoom)` damping. Camera math applies `1/zoom` via distance. Combined: `1/zoom^1.5` sensitivity scaling.
- **Impact:** Pan is extremely sluggish at high zoom and overshoots at low zoom. Not "broken" but "feels broken."
- **Fix:** Remove `zoomDamping` from the event handler (lines 413-415), letting the camera math handle zoom-dependent pan scaling naturally.

### Bug 5: LOW -- No stale closure protection in handleMouseDown
- **File:** `src/components/preview/Preview.tsx` lines 568-574, 599-605
- **Evidence:** `selectedGaussianSplatClip.transform.position.x/y/z` and `rotation.x/y/z` are read from the closure at mousedown time. These should be current but could theoretically be one render behind.
- **Impact:** Very minor -- only affects the initial values captured at drag start. The drag itself uses refs correctly.

---

## 4. FALSE POSITIVES (Disproved by code reading)

### FP1: DockTabPane wheel listener blocks Preview (Agent 2)
- The listener is on the TAB BAR element, not the panel content. It requires Ctrl key. It is not an ancestor of the canvas. **Cannot intercept preview events.**

### FP2: Dropdown z-index blocking events (Agent 4)
- Dropdowns are conditionally rendered via React state (`selectorOpen`, `qualityOpen`). When closed, they are **not in the DOM**. Cannot block anything.

### FP3: Set iteration non-determinism (Agent 3)
- JavaScript Set iteration follows insertion order per spec. `[...selectedClipIds][0]` is deterministic.

### FP4: CSS pointer-events cascade issue (Agent 4)
- `.preview-canvas-wrapper` has no `pointer-events` restriction. `.preview-container` has no `pointer-events` restriction. Children receive events normally. The `.preview-edit-hint` has `pointer-events: none` correctly. The `.mask-overlay-svg` has `pointer-events: auto` but only renders when `maskEditMode !== 'none'`.

### FP5: effectiveResolution instability during pan (Agent 6)
- The pan useEffect (lines 404-438) does include `effectiveResolution.width/height` in its dependency array. If resolution changed during a drag, the effect would re-run, removing and re-adding the window-level listeners. But composition resolution never changes during a mouse drag interaction. **Theoretically possible but practically never happens.**

### FP6: `Node.contains(self)` behavior varies (Agent 4)
- `Node.contains()` returns `true` when called with the node itself as argument. This is standardized behavior across all modern browsers. Not an issue.

---

## 5. RANKED FIX LIST

Ordered by likelihood of fixing the user-reported problem ("3D camera controls don't work"):

### Fix 1: Replace React `onWheelCapture` with native `addEventListener` (CRITICAL)
**Likelihood of fixing wheel zoom: 90%**

```typescript
// In a useEffect, replace onWheelCapture:
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  el.addEventListener('wheel', handleWheelNative, { passive: false });
  return () => el.removeEventListener('wheel', handleWheelNative);
}, [handleWheelNative]);
```
Remove `onWheelCapture={handleWheel}` from the JSX. This is the exact pattern used successfully in `useTimelineZoom.ts` and `DockTabPane.tsx`.

### Fix 2: Replace React `onMouseDownCapture` with native mousedown for MMB (HIGH)
**Likelihood of fixing middle-click pan: 85%**

Register a native mousedown handler that calls `preventDefault()` before the browser can initiate autoscroll. Combined with `setPointerCapture()` for reliable event delivery during drag.

### Fix 3: Fix stale closure in handleWheel zoom (HIGH)
**Likelihood of fixing zoom accumulation: 80%**

Read the current zoom value from `useTimelineStore.getState()` instead of the closure-captured `selectedGaussianSplatClip`. This ensures rapid wheel events accumulate correctly.

### Fix 4: Remove double zoom damping from pan handler (MEDIUM)
**Likelihood of fixing pan responsiveness: 70%**

Remove `zoomDamping` calculation (lines 413-415) from the pan mousemove handler. The camera matrix builder in `SplatCameraUtils.ts` already correctly adjusts pan world-space magnitude based on zoom (via `distance / zoom` affecting `halfWidth`).

### Fix 5: Add `useEffect` to sync `gaussianSplatNavClipId` with selection (LOW)
**Likelihood of fixing "controls suddenly stop": 40%**

Add an effect that clears `gaussianSplatNavClipId` when the selected clip changes away from the nav clip:

```typescript
useEffect(() => {
  if (gaussianSplatNavClipId && selectedGaussianSplatClip?.id !== gaussianSplatNavClipId) {
    useEngineStore.getState().setGaussianSplatNavClipId(null);
  }
}, [selectedClipId, gaussianSplatNavClipId, selectedGaussianSplatClip?.id]);
```

This prevents stale nav state from persisting. However, this is more of a UX improvement than a bug fix since the user must explicitly click "Free Nav" anyway.

### Fix 6: Memoize `gaussianNavEnabled` to prevent cleanup effect churn (LOW)
**Likelihood of fixing mid-interaction cancellation: 20%**

Wrap the `gaussianNavEnabled` computation in `useMemo` to ensure it only changes when its actual inputs change, reducing the chance of the cleanup effect (lines 357-369) firing spuriously.

---

## Summary

The **primary root cause** is almost certainly **Fix 1** (passive wheel listener). This is the classic React 19 + Chrome passive event trap. The timeline solved it with native `addEventListener`, the dock panel solved it with native `addEventListener`, but the preview still uses React's synthetic handler. This single fix likely resolves the most-reported symptom.

The **secondary root cause** for middle-click pan is **Fix 2** (browser autoscroll stealing events). Together, Fixes 1 and 2 address both wheel zoom and middle-click pan -- the two most visible failure modes.

**Fix 3** (stale closure) is a real correctness bug that would cause zoom to feel "stuck" even if `preventDefault()` were working. It should be fixed alongside Fix 1.

**Fix 4** (double zoom damping) is a math bug that makes pan feel wrong at non-1x zoom. It's real but secondary to the event delivery issues.

Fixes 5 and 6 are defensive improvements that prevent edge cases but are unlikely to be the primary cause of the user's report.
