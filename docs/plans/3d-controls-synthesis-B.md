# 3D Camera Controls Bug -- Synthesis Report B

Independent consensus analysis of 6 investigation agent reports, verified against source code.

---

## 1. CONSENSUS: Hypotheses Multiple Agents Agree On

### A. React `onWheelCapture` cannot call `preventDefault()` (passive listener problem)
**Agents: 1, 2, 5** (3 agents)

Preview.tsx line 704 uses `onWheelCapture={handleWheel}`. React 19 (confirmed: `"react": "^19.2.0"` in package.json) delegates events to the document root. Modern Chrome treats wheel listeners on `document`/`window` as passive by default, meaning `e.preventDefault()` at Preview.tsx line 499 and 515 would be silently ignored.

**Verification:** Confirmed. Multiple other components in the codebase already work around this by using native `addEventListener('wheel', ..., { passive: false })`:
- `DockTabPane.tsx:365` (tab bar Ctrl+wheel zoom)
- `useTimelineZoom.ts:185` (timeline scroll)
- `SlotGrid.tsx:222` (slot grid scroll)
- `ImageCropper.tsx:199` (image cropper zoom)

The Preview component is the ONLY place that relies on React's `onWheelCapture` for a handler that calls `preventDefault()`. This is the most consistent cross-codebase evidence of a real bug.

### B. `gaussianNavEnabled` state flicker / synchronization weakness
**Agents: 1, 3, 6** (3 agents)

`gaussianNavEnabled` depends on 4 conditions (Preview.tsx lines 305-310):
```
isEditableSource && !editMode && selectedGaussianSplatClip && gaussianSplatNavClipId === selectedGaussianSplatClip.id
```

The cleanup effect at lines 357-369 cancels orbiting/panning whenever `gaussianNavEnabled` becomes false. Any transient falsy state kills an in-progress interaction.

**Verification:** Confirmed the code structure. The `gaussianSplatNavClipId` is ONLY set explicitly by the "Free Nav" toggle button in TransformTab.tsx line 155. There is NO automatic synchronization -- if the user selects a different clip then re-selects the gaussian clip, `gaussianSplatNavClipId` still holds the old value which matches, so this actually works correctly for single-clip scenarios. However, if the clip is deleted and re-added, the IDs would differ and `gaussianNavEnabled` would be permanently false.

### C. Browser middle-click autoscroll interferes with MMB pan
**Agents: 1, 2, 5** (3 agents)

Middle mouse button (button 1) triggers browser's native autoscroll feature. The `handleMouseDown` at line 560 calls `e.preventDefault()` on the React synthetic event, but this may not prevent the native autoscroll which captures at a higher priority. Without `setPointerCapture()`, subsequent mousemove events can be stolen by the autoscroll mechanism.

**Verification:** Confirmed. The code does `e.preventDefault()` on the React synthetic `mousedown` event (line 596), but does NOT use `setPointerCapture()`. The native autoscroll is triggered by middle-click on the underlying document before React's delegated handler fires.

### D. Stale closure in handleWheel reads old zoom value
**Agents: 3, 5, 6** (3 agents)

`handleWheel` (line 497) reads `selectedGaussianSplatClip.transform.scale.x` from closure. After `updateClipTransform` updates the store synchronously, React's async re-render means the next wheel event still uses the OLD clip reference. Rapid scrolling accumulates incorrectly.

**Verification:** Confirmed. Line 502: `const currentZoom = Math.max(0.05, selectedGaussianSplatClip.transform.scale.x || 1)`. This reads from the closure-captured `selectedGaussianSplatClip`, not from `useTimelineStore.getState()`. Consecutive wheel events within the same render cycle will all read the same stale zoom value, causing zoom to feel unresponsive or jerky.

### E. Overlay elements outside `canvasWrapperRef` block `isCanvasInteractionTarget`
**Agents: 1, 4** (2 agents)

`StatsOverlay` is rendered OUTSIDE `canvasWrapperRef` (at line 755 vs wrapper at 762). It has `z-index: 10` and `cursor: pointer` (CSS line 1526) with NO `pointer-events: none`. When the user wheels/clicks on the StatsOverlay area, `isCanvasInteractionTarget(e.target)` returns false because `.contains()` fails.

**Verification:** Confirmed. StatsOverlay, PreviewControls (z-index: 20), and PreviewBottomControls (z-index: 20) are all outside `canvasWrapperRef`. Events hitting these elements fail the target check. However, this is a partial issue -- the controls deliberately need to be clickable, so only the StatsOverlay (which covers a variable area when expanded) is a realistic interaction conflict.

---

## 2. DISAGREEMENTS: Where Agents Contradict Each Other

### A. DockTabPane wheel listener as primary blocker
**Agent 2 ranks this #1 (95%)** -- claims DockTabPane's native wheel listener fires before React's delegated handler and blocks events via `stopPropagation()`.

**Agent 1 ranks this #6 (MEDIUM)** -- mentions it as a possibility.

**Other agents do not mention it.**

**Verdict: Agent 2 is WRONG about this being a primary cause.** The DockTabPane wheel listener (line 352-363) is attached to `tabBarRef.current` -- the narrow tab bar element at the top of each dock panel. It ONLY activates when `e.ctrlKey` is true. The Preview canvas is inside `dock-panel-content-inner`, which is a sibling of the tab bar, not a descendant. Wheel events on the canvas do not bubble through the tab bar. Furthermore, even if they did, the early return on `!e.ctrlKey` means non-Ctrl wheel events pass through unaffected. This is NOT a contributing factor.

### B. Double zoom damping in pan calculation
**Agent 6 identifies this as a CONFIRMED BUG** -- claims zoom damping is applied twice (once in Preview.tsx event handler, once in SplatCameraUtils).

**No other agent mentions this.**

**Verdict: Agent 6 is PARTIALLY RIGHT but overstates the impact.** Preview.tsx lines 413-415 apply `zoomDamping = 1/sqrt(zoom)` to convert pixel delta to normalized pan coordinates. SplatCameraUtils.ts lines 69-78 compute `halfWidth = tan(fov/2) * distance` where `distance = baseDistance / zoom`. So the camera math does scale pan by `1/zoom` (via `distance`), and the event handler also scales by `1/sqrt(zoom)`. Combined effect: pan sensitivity scales as `1/(zoom * sqrt(zoom)) = 1/zoom^1.5`. Whether this is a "bug" or intentional non-linear damping is debatable -- it makes pan less sensitive at high zoom, which could feel intentionally like a "precision mode." However, the asymmetry is unusual and likely unintentional.

### C. Root cause priority
- **Agents 1, 5:** Passive wheel listener is the #1 issue
- **Agent 3:** State synchronization is the #1 issue
- **Agent 2:** DockTabPane interception is the #1 issue
- **Agent 4:** Z-index/overlay blocking is the #1 issue
- **Agent 6:** Math bug is the top finding

**Verdict:** The passive wheel listener issue (Agents 1, 5) has the strongest code evidence and explains the most user-visible symptoms.

---

## 3. VERIFIED: Claims Confirmed by Code Reading

| Claim | Source | Code Location | Status |
|-------|--------|---------------|--------|
| React 19.2.0 in use | Agent 5 | package.json line 36 | CONFIRMED |
| `onWheelCapture` used (not native listener) | Agents 1, 2, 5 | Preview.tsx line 704 | CONFIRMED |
| Other components use native `addEventListener('wheel', ..., {passive: false})` | Agent 5 | useTimelineZoom.ts:185, SlotGrid.tsx:222, DockTabPane.tsx:365, ImageCropper.tsx:199 | CONFIRMED |
| `gaussianNavEnabled` depends on 4 conditions | Agents 1, 3 | Preview.tsx lines 305-310 | CONFIRMED |
| Cleanup effect cancels orbit/pan on `gaussianNavEnabled` false | Agents 1, 3 | Preview.tsx lines 357-369 | CONFIRMED |
| `setGaussianSplatNavClipId` only called from TransformTab toggle | Agent 3 | TransformTab.tsx line 155 (only call site) | CONFIRMED |
| `handleWheel` reads zoom from closure, not store | Agent 6 | Preview.tsx line 502 | CONFIRMED |
| No `setPointerCapture()` for middle-click pan | Agent 2 | Preview.tsx lines 594-609 | CONFIRMED |
| StatsOverlay outside `canvasWrapperRef` with z-index 10 | Agent 4 | Preview.tsx line 755 vs 762; App.css line 1525 | CONFIRMED |
| `preview-edit-hint` has `pointer-events: none` | Agent 4 | App.css line 8679 | CONFIRMED |
| Camera math in SplatCameraUtils is correct | Agent 6 | SplatCameraUtils.ts (full review) | CONFIRMED |
| `dock-panel-content-inner` has `overflow: auto` | Agents 2, 4 | dock.css line 328 | CONFIRMED |

---

## 4. DISPROVED: Claims That Are Wrong Based on Actual Code

### A. "DockTabPane wheel listener blocks preview wheel events" (Agent 2, #1 hypothesis at 95%)
**DISPROVED.** The native wheel listener is on `tabBarRef.current` -- the small tab header bar. It only fires on Ctrl+wheel. The preview canvas sits inside `dock-panel-content-inner`, a sibling subtree, not a descendant of the tab bar. Wheel events on the canvas never pass through the tab bar element. This cannot block gaussian zoom.

### B. "NO useEffect exists to clear gaussianSplatNavClipId when selection changes" causes permanent breakage (Agent 3, #1 at 95%)
**PARTIALLY DISPROVED.** Agent 3 claims the IDs "might not match" on reselection. But `gaussianSplatNavClipId` stores a specific clip ID. When the user re-selects the SAME gaussian clip, the stored ID still matches that clip's ID. The IDs only go out of sync if the clip is deleted and re-created. For the common case (select gaussian, toggle Free Nav, deselect, reselect), the state is fine. This is a minor edge case, not a primary root cause.

### C. "Dropdown z-index captures or blocks events" (Agent 4, #1 at 80%)
**LARGELY DISPROVED.** The composition selector and quality selector dropdowns only exist in the DOM when `selectorOpen` or `qualityOpen` state is true (lines 206, 211). When closed, they don't render. When open, the user is interacting with the dropdown, not trying to orbit. This is not a cause of normal 3D control failures.

### D. "selectedClipId Set ordering non-determinism" (Agent 3, #3 at 70%)
**DISPROVED.** JavaScript `Set` iteration order is insertion order (per spec). `[...selectedClipIds][0]` consistently returns the first inserted element. There is no non-determinism. Rapid selection changes update the Set contents, not the iteration behavior.

### E. "React 19 makes wheel listeners passive" (claimed as a React 19-specific change, Agents 1, 5)
**NUANCED.** This is NOT a React 19-specific change. Chrome has treated wheel/touchmove listeners on `document` and `window` as passive by default since Chrome 56 (2017). React has always delegated events to the root, so this has been an issue since at least React 17's event delegation change. However, the claim that `onWheelCapture` results in a passive listener is CORRECT in practice -- React does not pass `{passive: false}` when registering its delegated wheel listener on the root. The framing as "React 19 specific" is misleading, but the underlying problem is real.

---

## 5. ROOT CAUSE RANKING

Based on code verification, here is my independent ranking of root causes:

### Rank 1: Passive wheel listener -- `preventDefault()` silently fails (CRITICAL)
**Confidence: 95%**

`onWheelCapture={handleWheel}` on Preview.tsx line 704 results in React delegating the wheel listener to the document root without `{passive: false}`. Chrome's passive-by-default behavior means `e.preventDefault()` at line 499 is a no-op. The browser scrolls the `dock-panel-content-inner` (which has `overflow: auto`) instead of zooming the gaussian splat. This explains why wheel zoom "doesn't work" -- the zoom math executes, but the page also scrolls, causing visual confusion and potentially triggering re-renders that reset state.

Evidence: Every other scroll-sensitive component in the codebase uses native `addEventListener` with `{passive: false}`.

### Rank 2: Stale closure in handleWheel zoom accumulation (HIGH)
**Confidence: 85%**

`selectedGaussianSplatClip.transform.scale.x` at line 502 reads from the closure-captured clip object. After `updateClipTransform` writes the new zoom to the store, the next wheel event (within the same React render cycle) still reads the OLD zoom value. This causes zoom to appear sluggish or stuck: multiple scroll ticks may all compute the same "next zoom" from the same stale base.

### Rank 3: Browser middle-click autoscroll steals MMB pan events (HIGH)
**Confidence: 80%**

The `e.preventDefault()` on the React synthetic mousedown event may not prevent the browser's native autoscroll behavior, which is triggered at the native event level before React's delegated handler fires. Without `setPointerCapture()`, subsequent mousemove events during panning can be captured by the autoscroll mechanism instead of reaching the window-level listener.

### Rank 4: Pan zoom-damping applied twice (MEDIUM)
**Confidence: 70%**

The event handler applies `zoomDamping = 1/sqrt(zoom)` (line 413), and `buildSplatCamera` independently scales pan by `distance = baseDistance/zoom` (SplatCameraUtils.ts line 61), resulting in total damping of `~1/zoom^1.5`. At high zoom levels, this makes pan appear unresponsive. At low zoom, pan overshoots. While not a total failure, it degrades the user experience significantly.

### Rank 5: StatsOverlay blocking canvas interaction target check (LOW-MEDIUM)
**Confidence: 50%**

When StatsOverlay is expanded, it covers a significant portion of the top-right canvas area. Wheel/click events on this overlay fail `isCanvasInteractionTarget()`, silently dropping the interaction. This is a real but narrow issue -- it only affects the specific area under the overlay.

### Rank 6: gaussianNavEnabled cleanup effect race (LOW)
**Confidence: 30%**

The cleanup effect (lines 357-369) that cancels orbit/pan when `gaussianNavEnabled` transitions to false could theoretically interrupt an in-progress drag if a transient re-render causes the boolean to flicker. However, the four conditions are relatively stable during active interaction, making this unlikely in practice.

---

## 6. FIX PLAN: Concrete Code Changes in Priority Order

### Fix 1: Replace `onWheelCapture` with native `addEventListener` (CRITICAL)
**File:** `src/components/preview/Preview.tsx`

Add a `useEffect` that attaches a native wheel listener with `{passive: false}` to the container element, replacing the React `onWheelCapture` prop.

```typescript
// Replace onWheelCapture={handleWheel} on the container div with:
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;

  const nativeWheelHandler = (e: WheelEvent) => {
    // Convert native event handling -- same logic as current handleWheel
    // but using native event, so preventDefault() actually works
    handleWheelNative(e);
  };

  container.addEventListener('wheel', nativeWheelHandler, { passive: false });
  return () => container.removeEventListener('wheel', nativeWheelHandler);
}, [/* deps matching current handleWheel deps */]);
```

Remove `onWheelCapture={handleWheel}` from the JSX div.

Note: The wheel handler callback must be extracted to a ref or stable callback since it has many dependencies. Use a ref pattern:
```typescript
const handleWheelRef = useRef(handleWheel);
handleWheelRef.current = handleWheel;

useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  const handler = (e: WheelEvent) => handleWheelRef.current(e as unknown as React.WheelEvent);
  container.addEventListener('wheel', handler, { passive: false });
  return () => container.removeEventListener('wheel', handler);
}, []);
```

Alternatively, refactor `handleWheel` to accept a native `WheelEvent` directly and drop the `React.WheelEvent` typing.

### Fix 2: Read current zoom from store instead of closure (HIGH)
**File:** `src/components/preview/Preview.tsx`

In `handleWheel`, replace the stale closure read with a direct store read:

```typescript
// Line 502 -- BEFORE:
const currentZoom = Math.max(0.05, selectedGaussianSplatClip.transform.scale.x || 1);

// AFTER:
const freshClip = useTimelineStore.getState().clips.find(c => c.id === selectedGaussianSplatClip.id);
const currentZoom = Math.max(0.05, freshClip?.transform.scale.x || 1);
```

This ensures each consecutive wheel event reads the actual current zoom value, even within the same React render cycle.

### Fix 3: Prevent browser autoscroll on middle-click + add pointer capture (HIGH)
**File:** `src/components/preview/Preview.tsx`

In `handleMouseDown`, for button 1 (middle click):

```typescript
// After e.preventDefault() for MMB (line 596):
if (e.nativeEvent.target instanceof Element) {
  (e.nativeEvent.target as Element).setPointerCapture(e.nativeEvent.pointerId);
}
```

Also add a native `mousedown` listener with `{passive: false}` on the container (same pattern as Fix 1) to ensure `preventDefault()` fires before the browser initiates autoscroll. React's delegated mousedown may fire too late.

Additionally, add to the preview container CSS:
```css
.preview-container {
  /* Prevents browser autoscroll icon on middle-click */
  overflow: hidden; /* already set */
}
```

And add `onPointerDown` with `setPointerCapture` for the middle-click case to guarantee event delivery.

### Fix 4: Remove double zoom-damping from pan (MEDIUM)
**File:** `src/components/preview/Preview.tsx`

Remove the `zoomDamping` from the pan mousemove handler. The camera math in `buildSplatCamera` already accounts for zoom via `distance = baseDistance / zoom`, which scales `halfWidth` and `halfHeight` proportionally. The event handler should only convert pixel deltas to normalized coordinates without additional zoom scaling:

```typescript
// Lines 413-415 -- BEFORE:
const zoomDamping = 1 / Math.sqrt(Math.max(0.35, zoom));
const panScaleX = (2 / Math.max(1, effectiveResolution.width)) * zoomDamping;
const panScaleY = (2 / Math.max(1, effectiveResolution.height)) * zoomDamping;

// AFTER:
const panScaleX = (2 / Math.max(1, effectiveResolution.width));
const panScaleY = (2 / Math.max(1, effectiveResolution.height));
```

Test thoroughly: the pan sensitivity should now feel consistent at all zoom levels.

### Fix 5: Make StatsOverlay pass through pointer events when not directly interacted with (LOW)
**File:** `src/App.css`

```css
.preview-stats {
  pointer-events: auto; /* keep interactive for click-to-toggle */
}
```

This is already the default, but to prevent the expanded overlay from blocking canvas interactions, consider making only the toggle button interactive:

```css
.preview-stats-expanded {
  pointer-events: none;
}
.preview-stats-expanded .preview-stats-toggle {
  pointer-events: auto;
}
```

Or alternatively, add `isCanvasInteractionTarget` to also accept targets within the `containerRef` that have the `preview-stats` class -- but this is more invasive.

### Fix 6 (Optional): Read fresh clip data in handleMouseDown (LOW)
**File:** `src/components/preview/Preview.tsx`

Similar to Fix 2, read fresh transform data from the store at mousedown time rather than from the closure:

```typescript
// In handleMouseDown, before accessing selectedGaussianSplatClip.transform:
const freshClip = useTimelineStore.getState().clips.find(
  c => c.id === selectedGaussianSplatClip!.id
);
if (!freshClip) return;
// Use freshClip.transform instead of selectedGaussianSplatClip.transform
```

This prevents rare stale-closure issues when the clip data changes between the callback's creation and execution.

---

## Summary

The primary root cause is **Fix 1 (passive wheel listener)** -- it explains why wheel zoom silently fails and matches the pattern seen across the entire codebase where every other component already uses native `addEventListener` with `{passive: false}`. Fix 2 (stale zoom closure) and Fix 3 (MMB autoscroll) are secondary but real issues that compound the user experience problem. Fix 4 (double damping) is a math bug that makes pan feel sluggish at high zoom levels.

The DockTabPane hypothesis (Agent 2's #1) and the dropdown z-index hypothesis (Agent 4's #1) are definitively ruled out by code analysis. The state synchronization hypothesis (Agent 3's #1) is real but edge-case-only for the common workflow.
