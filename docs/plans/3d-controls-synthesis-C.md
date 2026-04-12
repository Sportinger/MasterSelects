# 3D Camera Controls Bug -- Synthesis Report C

## 1. AGREEMENT MATRIX

| Hypothesis | A1 | A2 | A3 | A4 | A5 | A6 | Verdict |
|---|---|---|---|---|---|---|---|
| React 19 passive wheel listener | Medium | High | - | - | **95%** | - | **CONFIRMED ROOT CAUSE** |
| DockTabPane wheel blocks Preview | Medium | **95%** | - | Low | - | - | DEBUNKED (scoped to tabBar + Ctrl-only) |
| Browser MMB autoscroll | **95%** | 80% | - | 50% | 65% | - | PARTIAL (real but secondary) |
| gaussianSplatNavClipId desync | Medium | - | **95%** | - | - | - | DEBUNKED (only 1 caller, toggle is clean) |
| gaussianNavEnabled flicker | High | - | 90% | - | - | - | DEBUNKED (boolean is stable) |
| isCanvasInteractionTarget failure | High | - | - | 60% | - | - | MINOR (overlays above canvas can block but hint/stats have pointer-events:none or are outside capture zone) |
| Zoom damping double-application | - | - | - | - | - | **CONFIRMED** | **REAL BUG** (secondary) |
| Stale closure in handleWheel | - | - | 60% | - | 45% | **HIGH** | **REAL BUG** (secondary) |
| z-index overlay capture | - | - | - | **80%** | - | - | DEBUNKED (preview-stats has z:10 but event bubbles to preview-container via capture) |
| Batch grouping re-render issue | - | - | - | - | 80% | - | LOW IMPACT |
| Missing pointer capture for MMB | - | 55% | - | - | - | - | VALID IMPROVEMENT |

## 2. CODE-VERIFIED FACTS

### FACT 1: React 19 registers wheel listeners as PASSIVE (THE SMOKING GUN)

**File:** `node_modules/react-dom/cjs/react-dom-client.production.js` lines 12390-12406

```javascript
// React 19 event listener registration logic:
listenerWrapper = void 0;
!passiveBrowserEventsSupported ||
  ("touchstart" !== domEventName &&
    "touchmove" !== domEventName &&
    "wheel" !== domEventName) ||
  (listenerWrapper = !0);   // <-- sets listenerWrapper = true for wheel events

isCapturePhaseListener
  ? void 0 !== listenerWrapper
    ? targetContainer.addEventListener(domEventName, eventSystemFlags, {
        capture: !0,
        passive: listenerWrapper  // <-- passive: TRUE for wheel!
      })
    : targetContainer.addEventListener(domEventName, eventSystemFlags, !0)
  // ...
```

**What this means:** When Preview.tsx uses `onWheelCapture={handleWheel}` (line 704), React 19 registers the wheel listener on the root container with `{ capture: true, passive: true }`. A passive listener **cannot call `preventDefault()`** -- the browser ignores it silently.

The `e.preventDefault()` on line 499 of Preview.tsx is a no-op. The browser continues to process the wheel event as a scroll. The handler code runs, but the default action (scrolling the page/panel) is not prevented.

### FACT 2: The Timeline's wheel handler WORKS because it uses native addEventListener

**File:** `src/components/timeline/hooks/useTimelineZoom.ts` line 185:
```javascript
el.addEventListener('wheel', handleWheel, { passive: false });
```

This explicitly opts out of passive mode. Timeline wheel zoom works. Preview wheel zoom does not. Same pattern, different registration method. This is the canonical proof.

### FACT 3: DockTabPane wheel listener is NOT blocking Preview

**File:** `src/components/dock/DockTabPane.tsx` lines 348-367

The native wheel listener is attached to `tabBarRef.current` (the tiny tab bar element), NOT the whole panel. It also has an early-return guard:
```javascript
if (!e.ctrlKey || !activePanel) return;
```

It only fires when Ctrl is held. Without Ctrl, it returns without calling `stopPropagation()`. **Agent 2's #1 hypothesis is wrong.** This listener does not interfere with normal wheel events on the Preview canvas.

### FACT 4: gaussianSplatNavClipId is set ONLY from TransformTab

**File:** `src/components/panels/properties/TransformTab.tsx` line 155:
```javascript
onClick={() => setGaussianSplatNavClipId(gaussianNavEnabled ? null : clipId)}
```

This is the ONLY caller of `setGaussianSplatNavClipId` in the entire codebase (besides the store definition). There is no sync issue, no race condition, no stale ID problem. **Agent 3's #1 hypothesis is wrong.** The toggle is a simple on/off controlled by a single button click. The `gaussianNavEnabled` boolean on line 305-310 of Preview.tsx is stable as long as:
- The clip stays selected
- The user doesn't toggle Free Nav off
- editMode is off

### FACT 5: isCanvasInteractionTarget uses container capture, making overlay hits work

**File:** `src/components/preview/Preview.tsx` lines 700-710

The `onWheelCapture` and `onMouseDownCapture` are on `preview-container` (the outermost div). Because they use capture phase, they fire BEFORE the event reaches child elements. The `isCanvasInteractionTarget` check (lines 312-318) tests whether the event.target is within `canvasWrapperRef` or `canvasRef`.

The StatsOverlay (line 755) and PreviewBottomControls (line 847) are siblings of canvasWrapperRef, NOT children. So events on those elements would fail `isCanvasInteractionTarget`. However:
- `preview-edit-hint` has `pointer-events: none` in CSS (line 8679)
- `preview-stats` has `z-index: 10` and `cursor: pointer` but is positioned at top-right corner, not over the main canvas area in most cases

This means in typical usage the target IS the canvas or its wrapper. **But if the stats overlay is expanded and covers the canvas area, events there WILL fail the check.** This is a minor edge case, not the main bug.

### FACT 6: Zoom damping IS applied twice in pan calculation

**Agent 6 is correct.** In Preview.tsx lines 413-415:
```javascript
const zoomDamping = 1 / Math.sqrt(Math.max(0.35, zoom));
const panScaleX = (2 / Math.max(1, effectiveResolution.width)) * zoomDamping;
```

Then in SplatCameraUtils.ts lines 60-78:
```javascript
const zoom = Math.max(0.01, layer.scale.x || 1);
const distance = baseDistance / zoom;
// ...
const halfWidth = halfHeight * aspect;  // halfHeight = tan(fov*0.5) * distance
const panWorldX = layer.position.x * halfWidth;
```

The camera already accounts for zoom via `distance = baseDistance / zoom`, which feeds into `halfWidth`. The event handler ALSO scales pan input by `zoomDamping = 1/sqrt(zoom)`. The net effect is pan is scaled by `zoom * (1/sqrt(zoom)) = sqrt(zoom)` rather than being 1:1. At high zoom this makes pan feel sluggish; at low zoom it overshoots. But this doesn't make pan "not work" -- it makes it feel wrong.

### FACT 7: Stale closure in handleWheel reads old clip data

**Agent 6 is correct.** In Preview.tsx line 502:
```javascript
const currentZoom = Math.max(0.05, selectedGaussianSplatClip.transform.scale.x || 1);
```

`selectedGaussianSplatClip` is captured from the closure at callback creation time. After `updateClipTransform` updates the store, React schedules a re-render, but the NEXT wheel event may fire before the re-render completes. It reads the OLD `scale.x`, computes a new zoom from it, and writes that -- effectively overwriting the previous update. With rapid scrolling, zoom appears unresponsive because updates are lost.

### FACT 8: React version is indeed 19.2.0

**File:** `package.json` line 36: `"react": "^19.2.0"`

Confirmed. React 19's passive wheel listener behavior is in play.

### FACT 9: MMB pan uses setIsGaussianPanning + window listeners (correct pattern)

The middle-button pan handler (lines 594-608) calls `setIsGaussianPanning(true)`, which triggers a useEffect (lines 404-438) that attaches `window.addEventListener('mousemove', ...)` and `window.addEventListener('mouseup', ...)`. This is the correct pattern for window-level mouse tracking. However, the initial `mousedown` is captured via React's `onMouseDownCapture` handler. For MMB (button 1), the browser's default autoscroll feature can interfere because React's synthetic event `preventDefault()` fires in the delegated handler, which may be too late to prevent the native autoscroll from activating.

## 3. DEBUNKED CLAIMS

### DEBUNKED: "DockTabPane wheel listener blocks Preview" (Agent 2, 95%)

**Wrong.** The listener is on `tabBarRef` only (the small tab strip at the top of each panel group). It also guards on `e.ctrlKey` -- without Ctrl held, it does nothing and does NOT call `stopPropagation()`. This has zero effect on Preview wheel events.

### DEBUNKED: "gaussianSplatNavClipId sync issue" (Agent 3, 95%)

**Wrong.** There is exactly ONE caller of `setGaussianSplatNavClipId` -- the "Free Nav" toggle button in TransformTab. There is no effect that clears it, and none is needed. The ID is set explicitly by user action and stays until toggled off. The `gaussianNavEnabled` check (line 305-310) is stable.

### DEBUNKED: "gaussianNavEnabled flicker on every render" (Agent 3, 90%)

**Wrong.** The value `gaussianNavEnabled` is a plain Boolean computed from 4 stable store values. It doesn't flicker unless one of those values actually changes. The useEffect cleanup (lines 357-369) only fires when `gaussianNavEnabled` actually transitions to false. There is no oscillation.

### DEBUNKED: "Dropdown z-index captures events" (Agent 4, 80%)

**Partially wrong.** The composition and quality dropdowns are only in the DOM when their respective `*Open` state is true. When closed, they don't render at all. Even when open, they are positioned outside the canvas area.

### DEBUNKED: "selectedClipId Set ordering non-determinism" (Agent 3, 70%)

**Irrelevant.** JavaScript Set iteration order IS insertion order (per spec). And even if it weren't, the first element from `selectedClipIds` would still be a valid clip. This doesn't cause gaussianNavEnabled to break.

## 4. THE REAL ROOT CAUSE (Multi-Bug)

### Primary Bug: React 19 Passive Wheel Listener

**Severity: CRITICAL -- This is why wheel zoom "doesn't work"**

`onWheelCapture={handleWheel}` on line 704 of Preview.tsx registers the wheel handler as a passive listener because React 19 always marks wheel, touchstart, and touchmove as passive for performance. The `e.preventDefault()` call on line 499 is silently ignored.

The consequence:
1. User scrolls wheel over the preview canvas
2. handleWheel fires correctly, updates the gaussian splat zoom in the store
3. But the browser ALSO processes the wheel event as a page/panel scroll
4. The dock-panel-content-inner div (which has `overflow: hidden` but its parent chain may have scrollable areas) scrolls
5. The visual result: the zoom update is applied but the panel also scrolls, making it feel broken, or the page scrolls away from the preview

This is confirmed by the fact that the Timeline uses `addEventListener('wheel', ..., { passive: false })` and zoom works there.

### Secondary Bug A: Stale Closure in handleWheel

**Severity: MEDIUM -- Zoom feels unresponsive during rapid scrolling**

`handleWheel` reads `selectedGaussianSplatClip.transform.scale.x` from the closure. With rapid wheel events, multiple events fire before React re-renders, so they all read the SAME old zoom value and produce nearly identical outputs. The zoom appears to "stick" or lag.

Fix: Read current clip state from the store directly with `useTimelineStore.getState()`.

### Secondary Bug B: Pan Zoom Damping Applied Twice

**Severity: LOW -- Pan feels wrong at non-1x zoom**

The event handler applies `zoomDamping = 1/sqrt(zoom)` to pixel-to-normalized-unit conversion, and then the camera math (`buildSplatCamera`) applies zoom again via `distance = baseDistance / zoom` which affects `halfWidth`/`halfHeight`. The net effect is pan displacement is not proportional to mouse movement at non-default zoom levels.

Fix: Remove the `zoomDamping` from the event handler, since the camera math already handles zoom scaling.

### Secondary Bug C: MMB Browser Autoscroll Not Prevented

**Severity: MEDIUM -- Middle-click pan sometimes triggers browser autoscroll instead**

The `onMouseDownCapture` handler calls `e.preventDefault()` on the React synthetic event, but this may not prevent the browser's native middle-click autoscroll feature because the synthetic event delegates to the document root. A native `mousedown` listener with `{ passive: false }` directly on the canvas container would be more reliable.

## 5. IMPLEMENTATION PLAN

### Fix 1: Replace React onWheelCapture with native addEventListener (CRITICAL)

**File:** `src/components/preview/Preview.tsx`

**Step 1:** Remove `onWheelCapture` from the JSX (line 704):

```tsx
// BEFORE (line 704):
onWheelCapture={handleWheel}

// AFTER:
// (remove this prop entirely)
```

**Step 2:** Add a useEffect to register a native wheel listener with `{ passive: false }`:

After the existing `gaussianNavEnabled` cleanup effect (after line 369), add:

```tsx
// Native wheel listener — React 19 registers wheel as passive, preventing
// preventDefault(). We need { passive: false } so zoom doesn't scroll the page.
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;

  const handleNativeWheel = (e: WheelEvent) => {
    if (gaussianNavEnabled && selectedGaussianSplatClip && isCanvasInteractionTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      scheduleGaussianWheelBatchEnd();

      // Read FRESH state to avoid stale closure (Fix 2)
      const freshClip = useTimelineStore.getState().clips.find(
        c => c.id === selectedGaussianSplatClip.id
      );
      const currentZoom = Math.max(0.05, freshClip?.transform.scale.x || 1);
      const zoomFactor = Math.exp(-e.deltaY * 0.0025);
      const nextZoom = Math.max(0.05, Math.min(40, currentZoom * zoomFactor));

      updateClipTransform(selectedGaussianSplatClip.id, {
        scale: { x: nextZoom, y: nextZoom },
      });
      engine.requestRender();
      return;
    }

    if (!editMode || !containerRef.current) return;

    e.preventDefault();

    if (e.altKey) {
      setViewPan(prev => ({
        x: prev.x - e.deltaY,
        y: prev.y
      }));
    } else {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zf = e.deltaY > 0 ? 0.9 : 1.1;

      setViewZoom(prev => {
        const newZoom = Math.max(0.1, Math.min(150, prev * zf));
        setViewPan(prevPan => {
          const containerCenterX = (containerRef.current?.clientWidth ?? 0) / 2;
          const containerCenterY = (containerRef.current?.clientHeight ?? 0) / 2;
          const worldX = (mouseX - containerCenterX - prevPan.x) / prev;
          const worldY = (mouseY - containerCenterY - prevPan.y) / prev;
          return {
            x: mouseX - worldX * newZoom - containerCenterX,
            y: mouseY - worldY * newZoom - containerCenterY,
          };
        });
        return newZoom;
      });
    }
  };

  container.addEventListener('wheel', handleNativeWheel, { passive: false });
  return () => container.removeEventListener('wheel', handleNativeWheel);
}, [
  editMode,
  gaussianNavEnabled,
  isCanvasInteractionTarget,
  scheduleGaussianWheelBatchEnd,
  selectedGaussianSplatClip,
  updateClipTransform,
]);
```

Note: The edit-mode zoom path also uses functional state updates (`setViewZoom(prev => ...)`) to avoid capturing stale `viewZoom`/`viewPan` in the closure, since this listener won't re-register on every zoom change.

**Step 3:** Remove the old `handleWheel` useCallback entirely (lines 497-552), since it's no longer referenced.

### Fix 2: Fresh state read in wheel handler (included in Fix 1 above)

Already addressed in the native wheel handler above. The key change is:
```javascript
// BEFORE (stale closure):
const currentZoom = Math.max(0.05, selectedGaussianSplatClip.transform.scale.x || 1);

// AFTER (fresh read):
const freshClip = useTimelineStore.getState().clips.find(c => c.id === selectedGaussianSplatClip.id);
const currentZoom = Math.max(0.05, freshClip?.transform.scale.x || 1);
```

### Fix 3: Remove double zoom damping from pan handler

**File:** `src/components/preview/Preview.tsx`, lines 413-415

```typescript
// BEFORE:
const zoomDamping = 1 / Math.sqrt(Math.max(0.35, zoom));
const panScaleX = (2 / Math.max(1, effectiveResolution.width)) * zoomDamping;
const panScaleY = (2 / Math.max(1, effectiveResolution.height)) * zoomDamping;

// AFTER (camera math already accounts for zoom via distance/halfWidth):
const panScaleX = 2 / Math.max(1, effectiveResolution.width);
const panScaleY = 2 / Math.max(1, effectiveResolution.height);
```

### Fix 4: Native mousedown listener for MMB preventDefault

**File:** `src/components/preview/Preview.tsx`

Add a native `mousedown` listener alongside the React one to ensure middle-click autoscroll is prevented before the browser activates it:

```tsx
// Prevent browser middle-click autoscroll on the preview container
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  if (!gaussianNavEnabled) return;

  const preventMiddleClick = (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  container.addEventListener('mousedown', preventMiddleClick, { passive: false });
  return () => container.removeEventListener('mousedown', preventMiddleClick);
}, [gaussianNavEnabled]);
```

### Fix 5 (Optional): Fresh state read for orbit/pan mousedown handlers

**File:** `src/components/preview/Preview.tsx`, handleMouseDown callback

Similar stale-closure risk: `selectedGaussianSplatClip.transform.position` and `.rotation` are captured at callback creation. For orbit/pan, this matters less because the values are only read once at mousedown (not continuously like wheel). But for correctness:

```typescript
// In handleMouseDown, where pan/orbit starts, read fresh clip state:
const freshClip = useTimelineStore.getState().clips.find(c => c.id === selectedGaussianSplatClip.id);
if (!freshClip) return;
// Use freshClip.transform.position/rotation/scale instead of selectedGaussianSplatClip.transform
```

## 6. PRIORITY ORDER

1. **Fix 1+2** (native wheel listener + fresh state) -- This is the critical fix. Without it, wheel zoom is fundamentally broken in React 19.
2. **Fix 4** (native mousedown for MMB) -- Prevents the most common MMB failure mode.
3. **Fix 3** (remove double damping) -- Math correctness for pan.
4. **Fix 5** (fresh state for orbit/pan) -- Defensive improvement.

## 7. WHY THE PREVIOUS FIX DIDN'T WORK

The user reported that "broadening isCanvasInteractionTarget" did not fix the problem. This is consistent with our analysis: `isCanvasInteractionTarget` is NOT the root cause. The events DO reach the handler, and the handler DOES run. The problem is that `e.preventDefault()` is silently ignored because React 19 registered the listener as passive. The zoom updates are applied to the store but the browser also scrolls the panel, creating the appearance that "nothing happens" or that controls are broken.
