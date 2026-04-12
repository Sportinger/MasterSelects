# Agent 4 Report: 3D Camera Controls Bug

## Top Hypotheses (Ranked)

### 1. Dropdown z-index Captures or Blocks Events (80%)
- Composition selector dropdown: z-index: 100
- Quality selector dropdown: z-index: 100
- Both positioned absolute, potentially overlapping canvas area
- Neither has `pointer-events: none` when not visible in CSS
- Events hit invisible dropdown layer instead of canvas

### 2. StatsOverlay Expanded Blocks Top-Right Canvas Area (70%)
- `z-index: 10` (above canvas which has no z-index)
- `cursor: pointer` (interactive) but no explicit `pointer-events`
- When expanded, covers significant portion of canvas
- Events on StatsOverlay → `isCanvasInteractionTarget` returns false → event dropped

### 3. Canvas Wrapper Missing pointer-events: auto (65%)
- `.preview-canvas-wrapper` has NO explicit pointer-events CSS
- Two separate CSS rule blocks (lines 1606 and 8682) — cascade risk
- If parent restricts pointer-events, canvas might not receive events

### 4. Wheel Event Target Detection Fails (60%)
- For wheel events `e.target` might be the wrapper div, not the canvas
- `isCanvasInteractionTarget` might return false for wrapper targets
- `canvasWrapperRef.current?.contains(target)` should pass for self — but Node.contains(self) behavior may vary

### 5. Browser Swallows Middle/Right Button Events (50%)
- Browser's native middle-click and right-click handling
- May consume events before React handlers fire

### 6. Dock Panel overflow: auto Clips Event Bubbling (35%)
- `.dock-panel-content-inner { overflow: auto }` exists in dock CSS
- Low probability of affecting direct event handlers

## Key Insight
Multiple z-index layers (dropdowns at 100, stats at 10, controls at 20) exist above the canvas which has no explicit z-index. When events hit these layers, `isCanvasInteractionTarget` returns false because these elements are OUTSIDE canvasWrapperRef.
