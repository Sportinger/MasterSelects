# Agent 2 Report: 3D Camera Controls Bug

## Top Hypotheses (Ranked)

### 1. DockTabPane Wheel Listener Blocks Preview (95%)
- `src/components/dock/DockTabPane.tsx` line 365: `tabBar.addEventListener('wheel', handleWheel, { passive: false })`
- This NATIVE listener fires in capture phase BEFORE React's delegated `onWheelCapture`
- If it calls `stopPropagation()`, React's handler never executes
- **This is the #1 suspect for wheel zoom failure**

### 2. Browser Middle-Click Autoscroll (80%)
- MMB triggers browser autoscroll which captures mouse events
- Window-level mousemove listener (Preview.tsx line 431) never fires because autoscroll took control
- `preventDefault()` on React synthetic mousedown may not prevent native autoscroll

### 3. React 19 Capture Phase Delegation Timing (75%)
- React 19 delegates ALL capture events to document root
- Native `addEventListener` on intermediate elements fires FIRST
- DockTabPane's native listener → fires before → Preview's React handler

### 4. Scroll Container Interference (60%)
- dock.css: `.dock-panel-content-inner { overflow: auto }` creates scroll container
- Scroll containers may intercept/delay wheel events

### 5. Missing Pointer Capture for Middle-Click (55%)
- No `setPointerCapture()` used for middle-click pan
- Without pointer capture, events can be lost to other elements

## Key Insight
DockTabPane uses NATIVE addEventListener for wheel events while Preview uses React's onWheelCapture. React 19's event delegation means the native listener always wins in timing conflicts.
