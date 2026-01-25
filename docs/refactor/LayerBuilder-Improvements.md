# LayerBuilder Performance & Code Quality Improvements

## Overview

This document identifies specific optimizations to implement during the LayerBuilder refactoring. These improvements will reduce CPU usage, memory allocations, and code complexity.

---

## 1. Eliminate Duplicate Store Reads

### Problem
`useMediaStore.getState()` is called **4 times** per frame:
- Line 96: `buildLayersFromStore()`
- Line 194: Inside nested comp handling
- Line 384: `preloadUpcomingNestedCompFrames()`
- Line 868: `syncAudioElements()`

### Solution
Read store once at entry point, pass as parameter:

```typescript
// BEFORE (current)
buildLayersFromStore(): Layer[] {
  const mediaState = useMediaStore.getState(); // Read 1
  // ... later in nested comp handling
  const mediaStore = useMediaStore.getState(); // Read 2 (redundant!)
}

// AFTER (optimized)
buildLayersFromStore(): Layer[] {
  const ctx = this.createFrameContext(); // Single read
  return this.buildLayers(ctx);
}

private createFrameContext(): FrameContext {
  return {
    timeline: useTimelineStore.getState(),
    media: useMediaStore.getState(),
    playheadPosition: this.getPlayheadPosition(),
    now: performance.now(),
  };
}
```

**Impact:** ~3 fewer store reads per frame = smoother 60fps

---

## 2. Cache Filtered Arrays

### Problem
Same filter operations repeated multiple times per frame:

```typescript
// Called in buildLayersFromStore()
const videoTracks = tracks.filter(t => t.type === 'video' && t.visible !== false);

// Called AGAIN in syncAudioElements()
const audioTracks = tracks.filter(t => t.type === 'audio');
const videoTracks = tracks.filter(t => t.type === 'video');

// clipsAtTime calculated 3x:
const clipsAtTime = clips.filter(c =>
  playheadPosition >= c.startTime &&
  playheadPosition < c.startTime + c.duration
);
```

### Solution
Compute once in FrameContext:

```typescript
interface FrameContext {
  // Raw data
  clips: TimelineClip[];
  tracks: TimelineTrack[];

  // Pre-computed (lazy, cached)
  _clipsAtTime?: TimelineClip[];
  _videoTracks?: TimelineTrack[];
  _audioTracks?: TimelineTrack[];
  _clipsByTrackId?: Map<string, TimelineClip>;
}

// Lazy getter with caching
get clipsAtTime(): TimelineClip[] {
  if (!this._clipsAtTime) {
    this._clipsAtTime = this.clips.filter(c =>
      this.playheadPosition >= c.startTime &&
      this.playheadPosition < c.startTime + c.duration
    );
  }
  return this._clipsAtTime;
}

// Even better: Map for O(1) track lookup
get clipsByTrackId(): Map<string, TimelineClip> {
  if (!this._clipsByTrackId) {
    this._clipsByTrackId = new Map();
    for (const clip of this.clipsAtTime) {
      this._clipsByTrackId.set(clip.trackId, clip);
    }
  }
  return this._clipsByTrackId;
}
```

**Impact:**
- 3 fewer `clips.filter()` calls per frame
- 2 fewer `tracks.filter()` calls per frame
- O(1) clip lookup by track instead of O(n)

---

## 3. Eliminate Duplicate mediaFile Lookups

### Problem
Same file lookup done twice in same method:

```typescript
// Line 876-878
const mediaFile = mediaStore.files.find(
  f => f.name === clip.name || clip.mediaFileId === f.id
);

// Line 885-887 (5 lines later!)
const mediaFileForClip = mediaStore.files.find(
  f => f.name === clip.name || clip.mediaFileId === f.id
);
```

### Solution
1. Remove duplicate call
2. Use Map for O(1) lookup:

```typescript
// In FrameContext
get mediaFileMap(): Map<string, MediaFile> {
  if (!this._mediaFileMap) {
    this._mediaFileMap = new Map();
    for (const file of this.media.files) {
      this._mediaFileMap.set(file.id, file);
      if (file.name) {
        this._mediaFileMap.set(file.name, file);
      }
    }
  }
  return this._mediaFileMap;
}

// Usage: O(1) instead of O(n)
const mediaFile = ctx.mediaFileMap.get(clip.mediaFileId)
  || ctx.mediaFileMap.get(clip.name);
```

**Impact:** O(1) vs O(n) for every clip's media file lookup

---

## 4. Extract Repeated Clip Time Calculation

### Problem
This exact pattern appears **5 times**:

```typescript
const clipLocalTime = playheadPosition - clip.startTime;
const currentSpeed = getInterpolatedSpeed(clip.id, clipLocalTime);
const absSpeed = Math.abs(currentSpeed);
const sourceTime = getSourceTimeForClip(clip.id, clipLocalTime);
const initialSpeed = getInterpolatedSpeed(clip.id, 0);
const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
const clipTime = Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
```

### Solution
Extract to helper with memoization:

```typescript
interface ClipTimeInfo {
  clipLocalTime: number;
  sourceTime: number;
  clipTime: number;
  speed: number;
  absSpeed: number;
}

// Cache per clip per frame
private clipTimeCache = new Map<string, ClipTimeInfo>();

getClipTimeInfo(clip: TimelineClip, ctx: FrameContext): ClipTimeInfo {
  const cacheKey = `${clip.id}_${ctx.frameNumber}`;

  let info = this.clipTimeCache.get(cacheKey);
  if (info) return info;

  const clipLocalTime = ctx.playheadPosition - clip.startTime;
  const speed = ctx.timeline.getInterpolatedSpeed(clip.id, clipLocalTime);
  const absSpeed = Math.abs(speed);
  const sourceTime = ctx.timeline.getSourceTimeForClip(clip.id, clipLocalTime);
  const initialSpeed = ctx.timeline.getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  const clipTime = Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));

  info = { clipLocalTime, sourceTime, clipTime, speed, absSpeed };
  this.clipTimeCache.set(cacheKey, info);

  // Clear old entries
  if (this.clipTimeCache.size > 100) {
    this.clipTimeCache.clear();
  }

  return info;
}
```

**Impact:**
- 4 fewer `getInterpolatedSpeed()` calls per clip
- 1 fewer `getSourceTimeForClip()` call per clip
- Cleaner code, single source of truth

---

## 5. Reduce Object Allocations in Hot Path

### Problem
Creating new position/rotation objects every frame:

```typescript
// This creates 3 new objects per layer, 60 times per second
position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
scale: { x: transform.scale.x, y: transform.scale.y },
rotation: {
  x: (transform.rotation.x * Math.PI) / 180,
  y: (transform.rotation.y * Math.PI) / 180,
  z: (transform.rotation.z * Math.PI) / 180,
},
```

### Solution
Reuse objects when values unchanged:

```typescript
// Cache last transform per layer
private layerTransformCache = new Map<string, {
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number };
  rotation: { x: number; y: number; z: number };
  sourceTransform: any; // Reference to check if changed
}>();

private getLayerTransform(layerId: string, transform: Transform) {
  const cached = this.layerTransformCache.get(layerId);

  // If transform reference unchanged, reuse cached objects
  if (cached && cached.sourceTransform === transform) {
    return cached;
  }

  // Create new objects only when transform changed
  const result = {
    position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
    scale: { x: transform.scale.x, y: transform.scale.y },
    rotation: {
      x: (transform.rotation.x * Math.PI) / 180,
      y: (transform.rotation.y * Math.PI) / 180,
      z: (transform.rotation.z * Math.PI) / 180,
    },
    sourceTransform: transform,
  };

  this.layerTransformCache.set(layerId, result);
  return result;
}
```

**Impact:**
- ~90% fewer object allocations during static scenes
- Less GC pressure = fewer frame drops

---

## 6. Unified Audio Sync Handler

### Problem
Nearly identical code for 4 audio sources (~80 lines each):
1. Audio track clips (lines 781-864)
2. Audio proxies for video clips (lines 871-992)
3. Video element audio (lines 1002-1027)
4. Nested comp mixdown (lines 1046-1114)

### Solution
Extract common audio sync logic:

```typescript
interface AudioSyncTarget {
  element: HTMLAudioElement | HTMLVideoElement;
  clip: TimelineClip;
  isMuted: boolean;
  canBeMaster: boolean;
}

private syncAudioElement(
  target: AudioSyncTarget,
  ctx: FrameContext,
  state: AudioSyncState
): void {
  const { element, clip, isMuted, canBeMaster } = target;
  const timeInfo = this.getClipTimeInfo(clip, ctx);

  // Set pitch preservation
  this.setPitchPreservation(element, clip.preservesPitch !== false);

  const shouldPlay = ctx.isPlaying && !isMuted && !ctx.isDraggingPlayhead && timeInfo.absSpeed > 0.1;

  if (ctx.isDraggingPlayhead && !isMuted) {
    this.handleAudioScrub(element, timeInfo.clipTime, ctx);
  } else if (shouldPlay) {
    this.handleAudioPlayback(element, timeInfo, clip, canBeMaster, state);
  } else {
    this.pauseIfPlaying(element);
  }
}
```

**Impact:**
- ~240 lines → ~80 lines (70% reduction)
- Single place to fix audio bugs
- Easier to add new audio sources

---

## 7. Pre-compute Track Visibility

### Problem
Helper functions defined inside methods, called repeatedly:

```typescript
// Defined inside buildLayersFromStore()
const isVideoTrackVisible = (track: TimelineTrack) => {
  if (!track.visible) return false;
  if (anyVideoSolo) return track.solo;
  return true;
};

// Then called for every track
videoTracks.forEach((track, layerIndex) => {
  const trackVisible = isVideoTrackVisible(track);
  // ...
});
```

### Solution
Pre-compute visibility in FrameContext:

```typescript
interface FrameContext {
  // Pre-computed track visibility
  visibleVideoTrackIds: Set<string>;
  unmutedAudioTrackIds: Set<string>;
}

// Compute once
private computeTrackVisibility(tracks: TimelineTrack[]): {
  visibleVideo: Set<string>;
  unmutedAudio: Set<string>;
} {
  const videoTracks = tracks.filter(t => t.type === 'video');
  const audioTracks = tracks.filter(t => t.type === 'audio');

  const anyVideoSolo = videoTracks.some(t => t.solo);
  const anyAudioSolo = audioTracks.some(t => t.solo);

  const visibleVideo = new Set<string>();
  const unmutedAudio = new Set<string>();

  for (const track of videoTracks) {
    if (track.visible && (!anyVideoSolo || track.solo)) {
      visibleVideo.add(track.id);
    }
  }

  for (const track of audioTracks) {
    if (!track.muted && (!anyAudioSolo || track.solo)) {
      unmutedAudio.add(track.id);
    }
  }

  return { visibleVideo, unmutedAudio };
}

// Usage: O(1) lookup
if (ctx.visibleVideoTrackIds.has(track.id)) {
  // ...
}
```

**Impact:** O(1) visibility check instead of function call with conditionals

---

## 8. Lazy Composition Lookup

### Problem
Looking up composition for every nested comp clip:

```typescript
const composition = mediaStore.compositions.find(c => c.id === clip.compositionId);
const compWidth = composition?.width || 1920;
const compHeight = composition?.height || 1080;
```

### Solution
Add to FrameContext with Map:

```typescript
get compositionMap(): Map<string, Composition> {
  if (!this._compositionMap) {
    this._compositionMap = new Map(
      this.media.compositions.map(c => [c.id, c])
    );
  }
  return this._compositionMap;
}

// Usage
const composition = ctx.compositionMap.get(clip.compositionId);
```

---

## Summary of Improvements

| Optimization | Lines Saved | Performance Gain |
|--------------|-------------|------------------|
| Single store read | 10 | 3 fewer getState() |
| Cached filtered arrays | 20 | 5 fewer filter() |
| Media file Map | 15 | O(1) vs O(n) lookup |
| Clip time memoization | 40 | 5x fewer calculations |
| Object reuse | 30 | 90% fewer allocations |
| Unified audio sync | 160 | 70% less code |
| Pre-computed visibility | 20 | O(1) checks |
| Composition Map | 5 | O(1) lookup |

**Total:** ~300 lines saved, significantly better performance

---

## Implementation Priority

1. **High Impact, Low Risk:**
   - Single store read (FrameContext)
   - Media file Map lookup
   - Pre-computed track visibility

2. **High Impact, Medium Risk:**
   - Clip time memoization
   - Unified audio sync handler

3. **Medium Impact, Low Risk:**
   - Cached filtered arrays
   - Composition Map
   - Object reuse

---

## Metrics to Track

Before and after refactoring, measure:

1. **Frame time:** `performance.now()` around `buildLayersFromStore()`
2. **Cache hit rate:** Already tracked, should improve
3. **GC pauses:** Chrome DevTools Performance tab
4. **Memory usage:** Heap snapshots

Target improvements:
- Frame build time: < 1ms (currently ~2-3ms)
- Cache hit rate: > 80% (currently ~60%)
- GC pauses: < 10ms (currently occasional 20ms+)

---

*Created: January 2026*
