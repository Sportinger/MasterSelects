# Agent 5 Report: 3D Camera Controls Bug

## Top Hypotheses (Ranked)

### 1. React 19 onWheelCapture Uses Passive Listener (95% CRITICAL)
- Preview.tsx line 704: `onWheelCapture={handleWheel}`
- React 19 (package.json: react 19.2.0) delegates wheel events to document root
- React may auto-attach wheel listeners as PASSIVE for performance
- Passive listeners CANNOT call `preventDefault()` — silently ignored
- **Compare: Timeline.tsx line 185 uses `addEventListener('wheel', ..., { passive: false })` and WORKS**
- This explains why wheel zoom fails: browser scrolls despite handler executing

### 2. Batch Grouping Triggers State Re-renders (80%)
- `scheduleGaussianWheelBatchEnd()` calls `startBatch('Gaussian zoom')`
- `startBatch()` captures history snapshot → deepClone of timeline state
- `endBatch()` creates final snapshot → triggers React re-render
- During re-render, `selectedGaussianSplatClip` reference changes → stale closure

### 3. scheduleGaussianWheelBatchEnd Timer Edge Cases (70%)
- Timer is 180ms — rapid wheel events reschedule
- `endBatch` fires during wheel processing → creates NEW batch
- Oscillating batch state interferes with `updateClipTransform` propagation

### 4. MMB/RMB Event Prevention Issues (65%)
- No `touch-action: none` CSS on preview-container
- handleContextMenu and handleAuxClick only preventDefault but don't stopPropagation
- Browser native MMB pan or RMB context menu may interfere

### 5. Stale Closure in handleWheel Dependencies (45%)
- Long dependency array, selectedGaussianSplatClip in deps
- Clip might be stale between rapid wheel events

### 6. Scroll Competition from Ancestor Elements (30%)
- dock-tab-bar has `overflow-x: auto`
- Wheel events could bubble up and hit scrollable parent

## Key Insight
The Timeline component uses `addEventListener('wheel', ..., { passive: false })` (native listener) and wheel zoom WORKS there. Preview uses React's `onWheelCapture` (delegated, potentially passive) and wheel zoom FAILS. This is the smoking gun.
