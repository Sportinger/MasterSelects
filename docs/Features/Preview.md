# Preview & Playback

[← Back to Index](./README.md)

WebGPU preview with RAM caching, multiple panels, and edit mode.

---

## Table of Contents

- [Preview Panel](#preview-panel)
- [Playback Controls](#playback-controls)
- [RAM Preview](#ram-preview)
- [Multiple Previews](#multiple-previews)
- [Edit Mode](#edit-mode)
- [Statistics Overlay](#statistics-overlay)

---

## Preview Panel

### Features
- **Real-time GPU rendering** via WebGPU
- **Aspect ratio preserved** automatically
- **Close button** to hide panel
- **Composition selector** dropdown
- **Edit mode** toggle

### Canvas Registration
```typescript
registerPreviewCanvas()           // Main preview
registerIndependentPreviewCanvas() // Additional previews
unregisterPreviewCanvas()         // Cleanup
```

---

## Playback Controls

### Timeline Toolbar Controls

| Control | Shortcut | Function |
|---------|----------|----------|
| **Stop** | - | Return to time 0 |
| **Play/Pause** | `Space` | Toggle playback |
| **Loop** | `L` | Toggle loop mode |

### In/Out Points

| Shortcut | Action |
|----------|--------|
| `I` | Set In point at playhead |
| `O` | Set Out point at playhead |
| `X` | Clear In/Out points |

### Implementation
```typescript
setInPoint(time)         // Validates against outPoint
setOutPoint(time)        // Validates against inPoint
clearInOut()             // Clear both markers
setInPointAtPlayhead()   // Convenience method
setOutPointAtPlayhead()  // Convenience method
```

---

## RAM Preview

After Effects-style cached preview for smooth playback.

### Configuration
```typescript
RAM_PREVIEW_FPS = 30        // Target frame rate
FRAME_TOLERANCE = 0.04      // 40ms tolerance for seeks
```

### Cache Limits
| Cache Type | Max Frames | Purpose |
|------------|------------|---------|
| Scrubbing | 300 | Individual video frames |
| Composite | 900 | Fully-rendered frames |
| GPU | 60 | High-speed playback |

### Algorithm
1. Enable via "RAM ON/OFF" button
2. Frames render **outward from playhead**
3. Only caches frames where clips exist
4. Skips empty areas
5. 3-retry seeking with verification

### Smart Seeking
```typescript
// Robust video seeking
- Retries up to 3 times
- Verifies position within FRAME_TOLERANCE
- Handles reversed clips properly
```

### Cache Management
```typescript
toggleRamPreviewEnabled()  // Enable/disable
startRamPreview()          // Begin caching
cancelRamPreview()         // Stop caching
clearRamPreview()          // Clear cache
invalidateCache()          // On content change
getCachedRanges()          // For green indicator
```

### Visual Indicator
- Green bar on timeline shows cached ranges
- Progress indicator during caching
- 2-frame gap tolerance for ranges

---

## Multiple Previews

### Adding Preview Panels
1. View menu → Panel visibility
2. Or use "+" button in preview panel

### Composition Selection
Each preview can show different composition:
- Dropdown selector in panel
- "Active" follows current composition
- Or select specific saved composition

### Independent Rendering
```typescript
// Each panel has:
- Own canvas
- Own RAF loop
- Own ping-pong buffers
- Independent composition evaluation
```

### Layout
- Panels appear side-by-side
- Drag to rearrange in dock
- Layout persists on save

---

## Edit Mode

### Enabling Edit Mode
Click "Edit" button in preview panel.

### Layer Selection
- Click layer to select
- Bounding box appears
- Handles at corners/edges

### Drag Operations
| Action | Effect |
|--------|--------|
| Drag center | Move layer position |
| Drag corner | Scale layer |

### Bounding Box
```typescript
calculateLayerBounds()
- Accounts for transforms
- Correct aspect ratio
- Matches shader positioning
```

### Zoom & Pan
| Action | Method |
|--------|--------|
| Zoom | `Shift + Scroll` |
| Pan | `Alt + Drag` |
| Reset | Reset button |

---

## Statistics Overlay

### Compact Mode
- FPS (color-coded: green ≥55, yellow ≥30, red <30)
- Decoder type (WebCodecs/HTMLVideo)
- Frame drops this second
- Output resolution

### Expanded Mode (click to expand)
- FPS / target FPS
- Frame gap (RAF timing)
- Render total time
- Pipeline breakdown bars
- Layer count
- Decoder type
- Drops (last second + total)
- Last drop reason
- Bottleneck identification

### Bottleneck Detection
```
Video Import - GPU texture upload slow
GPU Render - Compositing slow
GPU Submit - Command submission slow
```

---

## Frame Caching

### ScrubbingCache Class

#### Tier 1: Scrubbing Frame Cache
```typescript
cacheFrameAtTime(video, time)  // Cache single frame
getCachedFrame(videoSrc, time) // Retrieve cached
// LRU eviction, max 300 frames
```

#### Tier 2: Last Frame Cache
```typescript
captureVideoFrame(video)       // Persistent frame
getLastFrame(video)            // During seeks
// One per video element
```

#### Tier 3: RAM Preview Composite Cache
```typescript
cacheCompositeFrame(time, imageData)  // Composited frame
getCachedCompositeFrame(time)         // Instant retrieval
hasCompositeCacheFrame(time)          // Existence check
// Max 900 frames, stored as ImageData
```

---

## Composition Rendering

### Service Methods
```typescript
prepareComposition(compositionId)
- Loads all video/image sources
- Waits for canplaythrough
- Handles both active and saved compositions

evaluateAtTime(compositionId, time)
- Returns layers ready for rendering
- Handles clip trimming
- Handles reversed clips
- Builds layer transforms
- Automatic video seeking
```

---

## Performance

### Frame Rate
- 60fps target for preview
- 30fps limit when video playing
- Frame drop detection (1.5x target)

### Optimization
- Skip caching during playhead drag
- Reuse already-cached frames
- Video paused during RAM Preview generation

---

## Related Features

- [Timeline](./Timeline.md) - Main editing interface
- [Export](./Export.md) - Render to file
- [GPU Engine](./GPU-Engine.md) - Rendering details
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

*Source: `src/components/preview/Preview.tsx`, `src/stores/timeline/playbackSlice.ts`, `src/engine/texture/ScrubbingCache.ts`*
