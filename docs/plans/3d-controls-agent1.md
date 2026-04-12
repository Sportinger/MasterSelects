# Agent 1 Report: 3D Camera Controls Bug

## Top Hypotheses (Ranked)

### 1. Browser Autoscroll on Middle-Click (95%)
- Browser's native MMB autoscroll runs at higher priority than React's synthetic events
- `e.preventDefault()` on React synthetic event may be too late
- No explicit `{ passive: false }` registration for mouse/wheel handlers

### 2. Event Target Verification Race Condition (HIGH)
- `isCanvasInteractionTarget(e.target)` at line 312-318 checks `.contains()` against canvasRef and canvasWrapperRef
- StatsOverlay, PreviewBottomControls positioned OUTSIDE canvasWrapperRef but visually over canvas area
- Event target from overlays → check fails → event silently dropped

### 3. gaussianNavEnabled State Flicker (MEDIUM-HIGH)
- Depends on 4 conditions: isEditableSource, !editMode, selectedGaussianSplatClip, gaussianSplatNavClipId match
- Cleanup effect at lines 357-369 RESETS panning/orbiting if gaussianNavEnabled becomes false
- Any transient state change → gaussianNavEnabled false → interaction canceled

### 4. React Synthetic Event passive listener issue (MEDIUM-HIGH)
- Modern browsers default wheel listeners to passive
- React 19's event delegation may not guarantee `{ passive: false }`
- `preventDefault()` would be a no-op
- Compare: DockTabPane.tsx line 365 uses explicit `addEventListener('wheel', ..., { passive: false })`

### 5. Capture Phase Event Delegation (MEDIUM)
- React uses "capture" synthetically via delegation at document root
- Native handlers (autoscroll) run at actual capture phase before React

### 6. Parent Dock Container Event Interception (MEDIUM)
- DockTabPane wheel listener at line 365 may block events

### 7. CSS Overlays with wrong pointer-events (MEDIUM)
- MaskOverlay and SAM2Overlay positioned above canvas with pointer-events: auto

## Key Insight
The cleanup effect (lines 357-369) that cancels orbit/pan when gaussianNavEnabled becomes false is a potential "kill switch" that could prematurely end interactions.
