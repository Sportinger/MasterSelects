# Agent 6 Report: 3D Camera Controls Bug

## Top Hypotheses (Ranked)

### 1. Zoom Damping Applied Twice in Pan Calculation (CONFIRMED BUG)
- Preview.tsx lines 413-415: pan handler applies `zoomDamping = 1/sqrt(zoom)` to pan scale
- SplatCameraUtils.ts lines 76-81: camera math ALSO scales pan by zoom (distance/zoom → halfWidth)
- Zoom applied TWICE: once reducing pan scale, once in camera → pan appears broken at non-1x zoom
- At high zoom: pan seems unresponsive. At low zoom: overshoots
- **This is a real math bug but may not explain "fails entirely"**

### 2. Stale Clip Object in Wheel Zoom Handler (HIGH)
- handleWheel reads `selectedGaussianSplatClip.transform.scale.x` from closure
- After updateClipTransform, store updates synchronously but React re-render is async
- Next wheel event uses OLD clip reference → zoom accumulation is wrong
- First zoom after selection might use stale value
- **Fix: Use `get()` to read current clip directly from store**

### 3. Incomplete Transform Merge in clipSlice (MEDIUM)
- updateClipTransform spreads partial updates: `{ ...c.transform.scale, ...transform.scale }`
- If initial scale missing `y` field → undefined propagates
- DEFAULT_TRANSFORM guarantees `scale: { x: 1, y: 1 }` but project import might not

### 4. effectiveResolution Instability During Pan (LOW)
- Pan useEffect depends on effectiveResolution width/height
- If composition resolution changes during pan → listeners unmounted/remounted → events lost

### 5. Camera Math is Correct (VERIFIED)
- SplatCameraUtils rotation, pan, projection matrices are mathematically correct
- LayerBuilderService correctly avoids double radians conversion

## Key Insight
The pan handler has a MATHEMATICAL BUG: zoom damping is applied twice (once in event handler, once in camera matrix builder). This doesn't make pan "not work" but makes it feel broken at non-1x zoom levels — user drags but nothing seems to happen because the scale is wrong.

Additionally, the stale closure for wheel zoom means rapid scrolling accumulates incorrectly — the zoom seems to "not respond" because it keeps reading the old value.
