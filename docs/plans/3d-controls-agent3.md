# Agent 3 Report: 3D Camera Controls Bug

## Top Hypotheses (Ranked)

### 1. Missing State Synchronization Effect (95%)
- `gaussianNavEnabled` requires `gaussianSplatNavClipId === selectedGaussianSplatClip.id`
- NO useEffect exists to clear `gaussianSplatNavClipId` when selection changes
- Scenario: User has gaussian clip → clicks elsewhere → `gaussianSplatNavClipId` stays stale → re-selects gaussian → IDs might not match → `gaussianNavEnabled = false`
- **ALL controls fail when gaussianNavEnabled is false**

### 2. gaussianNavEnabled Flicker on Every Render (90%)
- `gaussianNavEnabled` is a simple Boolean, not memoized
- Recalculates on every render
- If any dependency changes between render and event handler execution → false
- Cleanup effect at lines 357-369 cancels orbit/pan when gaussianNavEnabled goes false

### 3. selectedClipId Set Ordering Non-Determinism (70%)
- Line 75: `[...selectedClipIds][0]` — Set iteration order = insertion order
- Rapid selection changes could cause `selectedGaussianSplatClip` to become null
- Even with gaussian clip in selection, ordering might put a different clip first

### 4. handleMouseDown Stale Closure (60%)
- `selectedGaussianSplatClip` captured at callback definition time
- If clip changes between handler definition and mouse event → stale data
- React recreates callbacks on dep change but timing gap exists

### 5. Refs Storing Stale clipId (55%)
- `gaussianOrbitStart.current.clipId` stored in refs
- If clip deselected/reselected AFTER mousedown but BEFORE mousemove → ref has wrong clipId

### 6. TransformTab Button Doesn't Trigger Preview Re-render (35%)
- "Free Nav" button in TransformTab sets `gaussianSplatNavClipId`
- Preview should re-render but timing unclear

## Key Insight
The `gaussianSplatNavClipId` synchronization is the weakest link. There's NO effect that keeps it in sync with the selected clip. If it falls out of sync, `gaussianNavEnabled` becomes false and ALL controls stop working until the user re-toggles "Free Nav".
