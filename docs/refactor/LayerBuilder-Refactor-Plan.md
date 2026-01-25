# LayerBuilder Refactoring Plan

## Current State

**File:** `src/services/layerBuilder.ts`
**Lines:** 1505
**Problem:** God object with 7+ distinct responsibilities

## Analysis

### Current Responsibilities

| Responsibility | Lines | Methods |
|----------------|-------|---------|
| Playhead State | 10-22 | `playheadState` object |
| Layer Caching | 49-169 | Cache invalidation, hit/miss tracking |
| Layer Building | 83-369 | `buildLayersFromStore()` |
| Nested Comp Preloading | 375-518 | `preloadUpcomingNestedCompFrames()`, `primeUpcomingNestedCompVideos()` |
| Video Sync | 529-673 | `syncVideoElements()` |
| Audio Sync | 675-1124 | `syncAudioElements()` (450 lines!) |
| Video Layer Building | 1129-1279 | `buildVideoLayer()` |
| Nested Layer Building | 1284-1501 | `buildNestedLayers()` |

### Complexity Issues

1. **Audio Sync** (450 lines) - Handles:
   - Audio track clips
   - Audio proxies for video clips
   - Varispeed scrubbing
   - Audio master clock
   - Nested composition mixdown
   - Mute/solo state

2. **Nested Composition** logic spread across:
   - `buildNestedLayers()` (218 lines)
   - `preloadUpcomingNestedCompFrames()` (72 lines)
   - `primeUpcomingNestedCompVideos()` (62 lines)

3. **Proxy Handling** interleaved in multiple methods

---

## Target Architecture

```
src/services/layerBuilder/
├── index.ts                 # Re-exports, singleton
├── PlayheadState.ts         # High-frequency playhead position (~30 lines)
├── LayerCache.ts            # Layer caching logic (~100 lines)
├── VideoSyncService.ts      # Video element sync (~150 lines)
├── AudioSyncService.ts      # Audio sync + master clock (~300 lines)
├── NestedCompService.ts     # Nested comp building + preloading (~250 lines)
├── ProxyLayerBuilder.ts     # Proxy frame layer building (~150 lines)
├── LayerBuilderService.ts   # Main orchestrator (~200 lines)
└── types.ts                 # Shared types (~50 lines)
```

**Estimated:** 1505 → ~1230 lines (18% reduction + much better organization)

---

## Phase 1: Extract PlayheadState

### Move to `PlayheadState.ts`

```typescript
// src/services/layerBuilder/PlayheadState.ts

export interface PlayheadStateData {
  position: number;
  isUsingInternalPosition: boolean;
  playbackJustStarted: boolean;
  masterAudioElement: HTMLAudioElement | HTMLVideoElement | null;
  masterClipStartTime: number;
  masterClipInPoint: number;
  masterClipSpeed: number;
  hasMasterAudio: boolean;
}

export const playheadState: PlayheadStateData = {
  position: 0,
  isUsingInternalPosition: false,
  playbackJustStarted: false,
  masterAudioElement: null,
  masterClipStartTime: 0,
  masterClipInPoint: 0,
  masterClipSpeed: 1,
  hasMasterAudio: false,
};

export function getPlayheadPosition(storePosition: number): number {
  return playheadState.isUsingInternalPosition
    ? playheadState.position
    : storePosition;
}

export function setMasterAudio(
  element: HTMLAudioElement | HTMLVideoElement,
  clipStartTime: number,
  clipInPoint: number,
  speed: number
): void {
  playheadState.hasMasterAudio = true;
  playheadState.masterAudioElement = element;
  playheadState.masterClipStartTime = clipStartTime;
  playheadState.masterClipInPoint = clipInPoint;
  playheadState.masterClipSpeed = speed;
}

export function clearMasterAudio(): void {
  playheadState.hasMasterAudio = false;
  playheadState.masterAudioElement = null;
}
```

---

## Phase 2: Extract LayerCache

### Move to `LayerCache.ts`

```typescript
// src/services/layerBuilder/LayerCache.ts

import type { Layer, TimelineClip, TimelineTrack } from '../../types';

export class LayerCache {
  private cachedLayers: Layer[] = [];
  private cacheValid = false;

  // Change detection state
  private lastPlayheadFrame = -1;
  private lastClipsRef: TimelineClip[] | null = null;
  private lastTracksRef: TimelineTrack[] | null = null;
  private lastActiveCompId: string | null = null;
  private lastIsPlaying = false;
  private lastProxyEnabled = false;

  // Stats
  private cacheHits = 0;
  private cacheMisses = 0;
  private lastStatsLog = 0;

  private readonly FRAME_RATE = 30;

  invalidate(): void {
    this.cacheValid = false;
  }

  checkCache(
    playheadPosition: number,
    clips: TimelineClip[],
    tracks: TimelineTrack[],
    activeCompId: string,
    isPlaying: boolean,
    isDraggingPlayhead: boolean,
    proxyEnabled: boolean,
    hasKeyframedClips: boolean
  ): { useCache: boolean; layers: Layer[] } {
    const currentFrame = Math.floor(playheadPosition * this.FRAME_RATE);

    const clipsChanged = clips !== this.lastClipsRef;
    const tracksChanged = tracks !== this.lastTracksRef;
    const frameChanged = currentFrame !== this.lastPlayheadFrame;
    const compChanged = activeCompId !== this.lastActiveCompId;
    const playingChanged = isPlaying !== this.lastIsPlaying;
    const proxyChanged = proxyEnabled !== this.lastProxyEnabled;

    const needsRebuild = !this.cacheValid ||
      clipsChanged || tracksChanged || compChanged ||
      playingChanged || proxyChanged ||
      (frameChanged && (isPlaying || isDraggingPlayhead || hasKeyframedClips));

    this.logStats();

    if (!needsRebuild && this.cachedLayers.length > 0) {
      this.cacheHits++;
      return { useCache: true, layers: this.cachedLayers };
    }

    this.cacheMisses++;
    this.updateRefs(currentFrame, clips, tracks, activeCompId, isPlaying, proxyEnabled);

    return { useCache: false, layers: [] };
  }

  setCachedLayers(layers: Layer[]): void {
    this.cachedLayers = layers;
    this.cacheValid = true;
  }

  private updateRefs(/* ... */): void { /* ... */ }
  private logStats(): void { /* ... */ }
}
```

---

## Phase 3: Extract AudioSyncService

### Move to `AudioSyncService.ts`

This is the largest extraction (~300 lines).

```typescript
// src/services/layerBuilder/AudioSyncService.ts

export class AudioSyncService {
  // Audio sync throttling
  private lastAudioSyncTime = 0;
  private playbackStartFrames = 0;
  private readonly AUDIO_SYNC_INTERVAL = 50;

  // Audio scrubbing
  private lastScrubPosition = -1;
  private lastScrubTime = 0;
  private scrubAudioTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly SCRUB_AUDIO_DURATION = 150;
  private readonly SCRUB_TRIGGER_INTERVAL = 30;

  // Audio proxies
  private activeAudioProxies: Map<string, HTMLAudioElement> = new Map();

  syncAudioElements(): void { /* ... */ }

  private syncAudioTrackClips(): void { /* ... */ }
  private syncVideoClipAudioProxies(): void { /* ... */ }
  private syncNestedCompMixdown(): void { /* ... */ }
  private playScrubAudio(audio: HTMLAudioElement, time: number): void { /* ... */ }
  private findMasterAudio(): void { /* ... */ }
}
```

---

## Phase 4: Extract VideoSyncService

### Move to `VideoSyncService.ts`

```typescript
// src/services/layerBuilder/VideoSyncService.ts

export class VideoSyncService {
  private lastSeekRef: Record<string, number> = {};
  private lastVideoSyncFrame = -1;
  private lastVideoSyncPlaying = false;

  // Native decoder throttling
  private nativeDecoderLastSeekTime: Map<string, number> = new Map();
  private nativeDecoderLastSeekFrame: Map<string, number> = new Map();
  private nativeDecoderPendingSeek: Map<string, boolean> = new Map();
  private readonly NATIVE_SEEK_THROTTLE_MS = 16;
  private readonly FRAME_RATE = 30;

  syncVideoElements(): void { /* ... */ }

  private syncNativeDecoder(clip: TimelineClip, ...): void { /* ... */ }
  private syncVideoElement(clip: TimelineClip, ...): void { /* ... */ }
  private pauseInactiveVideos(): void { /* ... */ }
}
```

---

## Phase 5: Extract NestedCompService

### Move to `NestedCompService.ts`

```typescript
// src/services/layerBuilder/NestedCompService.ts

export class NestedCompService {
  private primedNestedVideos: Set<string> = new Set();
  private proxyFramesRef: Map<string, { frameIndex: number; image: HTMLImageElement }> = new Map();
  private debugFrameCount = 0;

  // Lookahead settings
  private lastLookaheadTime = 0;
  private readonly LOOKAHEAD_INTERVAL = 100;
  private readonly LOOKAHEAD_SECONDS = 3.0;

  buildNestedLayers(clip: TimelineClip, clipTime: number, isPlaying: boolean): Layer[] { /* ... */ }

  preloadUpcomingFrames(clips: TimelineClip[], playheadPosition: number): void { /* ... */ }

  private primeUpcomingVideos(clips: TimelineClip[], playheadPosition: number, lookaheadEnd: number): void { /* ... */ }
}
```

---

## Phase 6: Extract ProxyLayerBuilder

### Move to `ProxyLayerBuilder.ts`

```typescript
// src/services/layerBuilder/ProxyLayerBuilder.ts

export class ProxyLayerBuilder {
  private proxyFramesRef: Map<string, { frameIndex: number; image: HTMLImageElement }> = new Map();

  buildProxyLayer(
    clip: TimelineClip,
    layerIndex: number,
    clipTime: number,
    transform: TransformData,
    effects: Effect[],
    activeCompId: string,
    mediaFile: MediaFile
  ): Layer | null { /* ... */ }

  shouldUseProxy(clip: TimelineClip, mediaFile: MediaFile | undefined): boolean { /* ... */ }

  getCachedProxyFrame(cacheKey: string): HTMLImageElement | null { /* ... */ }
}
```

---

## Phase 7: Refactor LayerBuilderService

### Final `LayerBuilderService.ts`

```typescript
// src/services/layerBuilder/LayerBuilderService.ts

import { LayerCache } from './LayerCache';
import { VideoSyncService } from './VideoSyncService';
import { AudioSyncService } from './AudioSyncService';
import { NestedCompService } from './NestedCompService';
import { ProxyLayerBuilder } from './ProxyLayerBuilder';
import { getPlayheadPosition } from './PlayheadState';

export class LayerBuilderService {
  private cache = new LayerCache();
  private videoSync = new VideoSyncService();
  private audioSync = new AudioSyncService();
  private nestedComp = new NestedCompService();
  private proxyBuilder = new ProxyLayerBuilder();

  invalidateCache(): void {
    this.cache.invalidate();
  }

  buildLayersFromStore(): Layer[] {
    // Get store state
    const timelineState = useTimelineStore.getState();
    const mediaState = useMediaStore.getState();

    // Check cache
    const cacheResult = this.cache.checkCache(/* ... */);
    if (cacheResult.useCache) return cacheResult.layers;

    // Build layers
    const layers = this.buildLayers(/* ... */);

    // Preload upcoming nested comps
    if (timelineState.isPlaying) {
      this.nestedComp.preloadUpcomingFrames(/* ... */);
    }

    // Cache and return
    this.cache.setCachedLayers(layers);
    return layers;
  }

  syncVideoElements(): void {
    this.videoSync.syncVideoElements();
  }

  syncAudioElements(): void {
    this.audioSync.syncAudioElements();
  }

  private buildLayers(/* ... */): Layer[] {
    // Iterate video tracks
    // For each clip type, delegate to appropriate builder
    // - Nested comp → this.nestedComp.buildNestedLayers()
    // - Video with proxy → this.proxyBuilder.buildProxyLayer()
    // - Regular video → buildVideoLayer()
    // - Image → buildImageLayer()
    // - Text → buildTextLayer()
  }

  private buildVideoLayer(/* ... */): Layer { /* ... */ }
  private buildImageLayer(/* ... */): Layer { /* ... */ }
  private buildTextLayer(/* ... */): Layer { /* ... */ }
  private buildNativeDecoderLayer(/* ... */): Layer { /* ... */ }
}
```

---

## Implementation Order

| Phase | Files | Estimated LOC | Risk |
|-------|-------|---------------|------|
| 1 | `PlayheadState.ts` | 50 | Low |
| 2 | `LayerCache.ts` | 100 | Low |
| 3 | `types.ts` | 50 | Low |
| 4 | `VideoSyncService.ts` | 150 | Medium |
| 5 | `ProxyLayerBuilder.ts` | 150 | Medium |
| 6 | `NestedCompService.ts` | 250 | Medium |
| 7 | `AudioSyncService.ts` | 300 | High |
| 8 | `LayerBuilderService.ts` | 200 | Medium |

**Total:** ~1250 lines across 8 files (vs 1505 in 1 file)

---

## Testing Strategy

1. **Before refactoring:** Capture current behavior
   - Export a test project with nested comps
   - Record FPS, cache hit rate, audio sync drift

2. **After each phase:** Verify no regression
   - Same cache hit rate
   - Same layer output for given playhead position
   - Audio still syncs correctly

3. **Key scenarios to test:**
   - Playback with multiple video clips
   - Proxy mode playback
   - Nested composition rendering
   - Audio scrubbing
   - Audio master clock sync
   - Native decoder clips

---

## Benefits

1. **Testability:** Each service can be unit tested independently
2. **Maintainability:** 200-line files vs 1500-line file
3. **Performance:** Easier to profile specific subsystems
4. **Collaboration:** Different developers can work on different services
5. **Extensibility:** New sync methods (e.g., MIDI) easy to add

---

## Not Changing

- Public API: `layerBuilder.buildLayersFromStore()`, `syncVideoElements()`, `syncAudioElements()`
- `playheadState` export (used by Timeline.tsx)
- Singleton pattern

---

*Created: January 2026*
