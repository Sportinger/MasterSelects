# Runtime Audio Meter Bus Plan

## Goal

Move live audio meter, dynamics, and analyzer traffic out of the React/Zustand hot path and into a dedicated runtime signal bus.

The target architecture treats meters as high-frequency runtime telemetry, not persistent application state. UI surfaces should be able to animate meters, gain reduction, and EQ analyzer overlays without forcing React renders for every meter snapshot.

This is a full-scope architecture plan, not a small local optimization. The current `runtimeAudioMeters` Zustand state can remain as a compatibility and debug bridge during migration, but it should stop being the primary live transport for visible meters.

## Current Codebase State

Live meter snapshots are currently produced by:

- `src/services/layerBuilder/AudioSyncHandler.ts`
- `src/services/layerBuilder/AudioTrackSyncManager.ts`
- `src/services/audioRoutingManager.ts`
- `src/services/proxyFrameCache.ts` for scrub-meter snapshots used by `AudioTrackSyncManager`

Snapshots are currently represented by:

- `AudioMeterSnapshot`
- `AudioDynamicsReductionSnapshot`
- `RuntimeAudioMeterState`
- `src/types/audio.ts`

The store currently exposes:

- `runtimeAudioMeters`
- `updateRuntimeAudioMeter(trackId, snapshot, masterSnapshot?)`
- `clearStaleRuntimeAudioMeters(maxAgeMs?, now?)`
- `src/stores/timeline/trackSlice.ts`
- `src/stores/timeline/types.ts`

Known consumers include:

- `src/components/timeline/components/AudioLevelMeter.tsx`
- `src/components/panels/audio-mixer/AudioMixerPanel.tsx`
- `src/components/timeline/TimelineHeader.tsx`
- `src/components/timeline/TimelineControls.tsx`
- `src/components/panels/properties/VolumeTab.tsx`
- `src/components/panels/properties/AudioEffectStackControl.tsx`
- `src/components/panels/properties/FlexEqualizerControl.tsx`
- `src/components/panels/properties/useThrottledRuntimeAnalyzer.ts`
- `src/services/aiTools/bridge.ts`

Recent local optimizations already point in the right direction:

- `trackSlice.ts` batches `updateRuntimeAudioMeter` writes through `requestAnimationFrame`.
- `AudioMixerPanel.tsx` throttles panel meter subscriptions instead of subscribing directly to every store snapshot.
- `useThrottledRuntimeAnalyzer.ts` streams analyzer spectrum into refs for EQ drawing.

These are compatibility optimizations, not the final architecture. The full target should replace the scattered local patterns with one shared runtime transport.

## Non-Goals

- Do not serialize runtime meters into project files.
- Do not move track volume, pan, mute, solo, sends, effect stacks, or master bus settings out of Zustand.
- Do not route editor commands through the meter bus.
- Do not build a generic global event bus. This service is only for runtime audio meter telemetry.
- Do not remove existing debug bridge behavior until replacement debug snapshots are available.

## Coverage Boundary

This plan covers all live runtime audio meter streams found in the current codebase audit:

- audio track and master peak/RMS meters
- timeline audio layer/track header meters keyed by `track.id`
- stereo left/right meter channels
- phase correlation and stereo width carried on `AudioMeterSnapshot`
- live effect dynamics and gain-reduction snapshots
- live EQ/analyzer spectrum attached to runtime meter snapshots
- scrub audio meter snapshots
- stem-buffer mixer meter snapshots
- tail meters after stopping effect-heavy audio

This plan intentionally does not cover other meter-like displays that are not runtime audio-meter telemetry:

- video scopes: `src/components/panels/scopes/*` and `src/engine/analysis/*`
- timeline clip waveform/spectrogram drawing: `src/components/timeline/TimelineClipCanvas.tsx` plus shared canvas utilities and timeline artifact warmup services
- waveform-pyramid and loudness-envelope artifacts/caches under `src/services/audio/*`
- media import or analysis progress indicators
- playback health, render timing, and performance diagnostics
- MIDI mapping/activity indicators

Those surfaces may deserve their own runtime analysis or diagnostics transport later, but they should not be mixed into `runtimeAudioMeterBus`. The bus is deliberately scoped to live audio meter telemetry so demand tracking can stay precise and publishers can avoid unnecessary Web Audio analyser work.

## Target Architecture

Add a HMR-stable singleton service:

```text
src/services/audio/runtimeAudioMeterBus.ts
```

The bus owns live runtime meter snapshots, subscriber lists, stale cleanup, demand accounting, and debug snapshots.

High-level flow:

```text
AudioRoutingManager / AudioSyncHandler / AudioTrackSyncManager
  -> runtimeAudioMeterBus.publishTrack(...)
  -> runtimeAudioMeterBus.publishMaster(...)
  -> visible UI subscribers update refs/CSS/canvas
  -> throttled Zustand compatibility bridge for diagnostics
```

React should not be the frame clock for meter animation. The visible meter component should subscribe once, keep the latest snapshot in a ref, and update DOM/CSS or canvas on `requestAnimationFrame`.

## Runtime Bus API

Proposed public API:

```ts
export type RuntimeAudioMeterScope =
  | { kind: 'track'; trackId: string }
  | { kind: 'master' };

export type RuntimeAudioMeterFeature =
  | 'level'
  | 'stereo'
  | 'phase'
  | 'dynamics'
  | 'spectrum';

export interface RuntimeAudioMeterDemand {
  level: number;
  stereo: number;
  phase: number;
  dynamics: number;
  dynamicsEffects: Record<string, number>;
  spectrum: number;
}

export interface RuntimeAudioMeterSubscriptionOptions {
  features?: readonly RuntimeAudioMeterFeature[];
  dynamicsEffectIds?: readonly string[];
}

export interface RuntimeAudioMeterDebugSnapshot {
  master: AudioMeterSnapshot | null;
  tracks: Record<string, AudioMeterSnapshot>;
  demand: {
    master: RuntimeAudioMeterDemand;
    tracks: Record<string, RuntimeAudioMeterDemand>;
  };
}

export interface RuntimeAudioMeterBus {
  publishTrack(trackId: string, snapshot: AudioMeterSnapshot, masterSnapshot?: AudioMeterSnapshot): void;
  publishMaster(snapshot: AudioMeterSnapshot): void;
  clearTrack(trackId: string): void;
  clearAll(updatedAt?: number): void;
  clearStale(maxAgeMs?: number, now?: number): void;

  getTrackSnapshot(trackId: string): AudioMeterSnapshot | undefined;
  getMasterSnapshot(): AudioMeterSnapshot | undefined;
  getDebugSnapshot(now?: number): RuntimeAudioMeterDebugSnapshot;

  subscribeTrack(
    trackId: string,
    listener: (snapshot: AudioMeterSnapshot | undefined) => void,
    options?: RuntimeAudioMeterSubscriptionOptions,
  ): () => void;

  subscribeMaster(
    listener: (snapshot: AudioMeterSnapshot | undefined) => void,
    options?: RuntimeAudioMeterSubscriptionOptions,
  ): () => void;

  getDemand(scope: RuntimeAudioMeterScope): RuntimeAudioMeterDemand;
  hasDemand(scope: RuntimeAudioMeterScope, feature: RuntimeAudioMeterFeature): boolean;
}
```

The service should preserve identity through HMR, following the existing project singleton pattern.

Silent state is published through `publishTrack(trackId, createSilentAudioMeterSnapshot(now), masterSnapshot?)`; the bus owns silent duplicate suppression. There should not be a separate silent publish path unless it has exactly the same no-op semantics as `publishTrack`.

The bus also owns master aggregation when `publishTrack` receives no `masterSnapshot`. Current store behavior derives the master from non-stale track snapshots via `aggregateAudioMeterSnapshots`; the bus must preserve that behavior. If all track snapshots are stale or silent, the bus should publish a silent master snapshot rather than leaving the master stale or undefined.

## Demand Tracking

The bus should track subscriber demand per scope and feature.

Examples:

- A small master meter requests `level`.
- A stereo strip meter requests `level`, `stereo`, and `phase`.
- A compressor/dynamics UI requests `dynamics`.
- A focused dynamics UI can additionally request specific effect ids through `dynamicsEffectIds`.
- Flex EQ requests `spectrum`.

This allows future publisher-side savings:

- Skip `getFloatFrequencyData` when no subscriber needs `spectrum`.
- Avoid cloning `frequencyBuffer` when no visible analyzer exists.
- Avoid computing detailed dynamics overlays when no dynamics UI is visible.
- Continue publishing low-cost peak/RMS when only level meters are visible.

Demand tracking should be additive and reference-counted by subscription. Unsubscribing must decrement feature counts even across component unmounts and HMR.

Frame-rate throttling should live in UI hooks and components, not in the bus subscription layer. The bus should deduplicate unchanged snapshots and preserve snapshot identity on no-op publishes; visible components decide whether to draw every animation frame, 30 fps, or a slower accessibility/text cadence.

## Snapshot Detail Levels

Keep `AudioMeterSnapshot` as the canonical shape for now, but allow the bus to publish snapshots with optional fields omitted when no demand exists.

Required for all level subscribers:

- `peakLinear`
- `rmsLinear`
- `peakDb`
- `rmsDb`
- `clipping`
- `updatedAt`

Optional by demand:

- `channels`
- `phaseCorrelation`
- `stereoWidth`
- `dynamics`
- `spectrumDb`

`dynamics` keeps the current shape: `Record<effectId, AudioDynamicsReductionSnapshot>`. Demand-aware optimization may skip per-effect dynamics only after subscribers can declare the relevant effect ids.

`spectrumDb` must be snapshot-owned or paired with an explicit revision token. Analyzer subscribers rely on identity/revision changes; reusing a mutable `Float32Array` without a changing revision can freeze canvas consumers.

Publisher APIs should not require UI code to know how audio analysis is computed. UI only declares what it wants.

## Store Compatibility Bridge

`runtimeAudioMeters` in Zustand should become a throttled diagnostic mirror, not the primary live UI source.

Implementation direction:

- `updateRuntimeAudioMeter` stays temporarily for compatibility.
- Internally it publishes to `runtimeAudioMeterBus`.
- A store bridge subscribes to the bus and writes `runtimeAudioMeters`.
- While any visible UI still consumes the mirror, keep the mirror cadence high enough to preserve current meter behavior.
- After visible consumers migrate to the bus, lower the mirror to a diagnostic cadence, for example 5 to 10 fps.
- `clearStaleRuntimeAudioMeters` delegates to the bus and then updates the mirror.
- Project load/reset paths must call `runtimeAudioMeterBus.clearAll()` before or alongside resetting `runtimeAudioMeters` in serialized state.

This preserves:

- AI bridge summaries
- `measureStoreChurn` and audio-runtime debug signatures
- existing tests while migration is underway
- fallback components not yet converted

The final state may keep `runtimeAudioMeters` only for debug snapshots, or remove it after all consumers use the bus directly.

## Publisher Migration

Update these publisher paths:

### AudioSyncHandler

File:

```text
src/services/layerBuilder/AudioSyncHandler.ts
```

Replace direct store writes in `publishMeter` with bus publishes.

Current behavior to preserve:

- silent meter publication when muted or stopped
- tail-meter polling for effect tails
- master snapshot forwarding
- no work when no `meterTrackId`

Tail-meter polling currently owns `setInterval` lifecycle. The migration should either move tail polling under the HMR-stable bus or add explicit HMR disposal for old `AudioSyncHandler` intervals so stale intervals do not continue publishing after hot reload.

### AudioTrackSyncManager

File:

```text
src/services/layerBuilder/AudioTrackSyncManager.ts
```

Replace direct store writes for:

- scrub meters
- stem buffer mixer meters
- silent stem meters
- stale meter clearing

with bus operations.

The stem-buffer mixer path currently builds its own snapshots in `publishStemBufferMixerMeter`. It needs the same bus publish and demand-aware reduction path as normal routed media.

### ProxyFrameCache

File:

```text
src/services/proxyFrameCache.ts
```

`getScrubMeterSnapshot` currently reads time-domain, frequency, and stereo analyser data directly. Add demand-aware options here as well, because scrub metering can otherwise keep doing spectrum/stereo work even when no visible consumer needs it.

### Timeline Store Track Slice

File:

```text
src/stores/timeline/trackSlice.ts
```

Convert these runtime-meter responsibilities:

- `updateRuntimeAudioMeter` becomes a temporary forwarder to `runtimeAudioMeterBus.publishTrack`.
- `clearStaleRuntimeAudioMeters` delegates to `runtimeAudioMeterBus.clearStale`.
- `removeTrack` calls `runtimeAudioMeterBus.clearTrack(id)` before updating the mirror.
- the current rAF batching code can be removed once the store is only a low-frequency mirror.

### Timeline Serialization

File:

```text
src/stores/timeline/serializationUtils.ts
```

The existing deserialization reset to `runtimeAudioMeters: { trackMeters: {} }` must also clear the bus source of truth. Otherwise the next mirror write can repopulate stale meters after project load.

### AudioRoutingManager

File:

```text
src/services/audioRoutingManager.ts
```

Add demand-aware snapshot options:

```ts
getMeterSnapshot(element, updatedAt, options)
getMasterMeterSnapshot(updatedAt, options)
```

Options should allow callers to skip:

- `route.analyserNode.getFloatFrequencyData(...)` when no `spectrum` demand exists
- spectrum buffer cloning when no `spectrum` demand exists
- `leftAnalyserNode` / `rightAnalyserNode` time-domain reads when no `stereo` or `phase` demand exists
- dynamics snapshot collection if no dynamics demand exists

This is a second-stage optimization inside the full migration. The first stage can publish full snapshots through the bus to preserve behavior.

## UI Migration

### Shared Hooks

Add:

```text
src/hooks/useRuntimeAudioMeterStream.ts
```

or colocate under:

```text
src/services/audio/runtimeAudioMeterHooks.ts
```

The hook should subscribe to the bus, keep the latest snapshot in a ref, and schedule frame callbacks without forcing React state updates for every snapshot.

Use primitive hook inputs (`scope`, `trackId`) or memoize any scope object internally. Callers should not pass fresh object literals that cause every render to unsubscribe and resubscribe.

Proposed APIs:

```ts
export function useRuntimeAudioMeterRef(
  scope: RuntimeAudioMeterScope | undefined,
  options?: RuntimeAudioMeterSubscriptionOptions,
): React.MutableRefObject<AudioMeterSnapshot | undefined>;

export function useRuntimeAudioMeterFrame(
  scope: RuntimeAudioMeterScope | undefined,
  onFrame: (snapshot: AudioMeterSnapshot | undefined) => void,
  options?: RuntimeAudioMeterSubscriptionOptions,
): boolean;

export function useRuntimeAudioMeterSnapshot(
  scope: RuntimeAudioMeterScope | undefined,
  options?: RuntimeAudioMeterSubscriptionOptions & { maxFps?: number },
): AudioMeterSnapshot | undefined;
```

Use `useRuntimeAudioMeterSnapshot` only where React text/state must update. Visual meters should use frame/ref APIs.

### AudioLevelMeter

File:

```text
src/components/timeline/components/AudioLevelMeter.tsx
```

Add a streaming mode while keeping the existing prop-based mode:

```ts
interface AudioLevelMeterProps {
  meter?: AudioMeterSnapshot;
  streamScope?: RuntimeAudioMeterScope;
  streamFeatures?: readonly RuntimeAudioMeterFeature[];
  label: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  display?: 'mono' | 'stereo' | 'auto';
}
```

In streaming mode:

- attach a root ref
- update CSS custom properties imperatively
- update clipping class imperatively
- update ARIA/title on a slower React cadence, not every frame
- avoid allocating fresh style objects per meter frame

CSS variables should carry values such as:

- `--meter-peak`
- `--meter-rms`
- `--meter-left-peak`
- `--meter-left-rms`
- `--meter-right-peak`
- `--meter-right-rms`
- `--meter-phase`

The existing DOM structure can remain stable so styling changes are minimal.

Streaming mode must still maintain accessibility and tests. Use a low-fps snapshot path, for example 4 fps, to update `aria-valuenow`, `title`, and any semantic clipping state while the visual meter bars animate through refs/CSS.

### EQ Analyzer

Files:

```text
src/components/panels/properties/useThrottledRuntimeAnalyzer.ts
src/components/panels/properties/FlexEqualizerControl.tsx
```

Replace Zustand reads with bus subscriptions requesting `spectrum`.

Replace `useThrottledRuntimeAnalyzer.ts` with a wrapper over the shared bus hook, then remove the old Zustand-specific implementation. Keep the current successful pattern:

- latest analyzer data in a ref
- canvas draw scheduled via `requestAnimationFrame`
- React state only for "has analyzer" boolean changes

### Dynamics Consumers

Files:

```text
src/components/panels/properties/VolumeTab.tsx
src/components/panels/properties/AudioEffectStackControl.tsx
src/components/panels/audio-mixer/AudioMixerPanel.tsx
```

Replace direct reads from `runtimeAudioMeters.*.dynamics` with bus subscriptions requesting `dynamics`.

Use React state only when the visible dynamics view model changes at human-visible cadence. Fast gain-reduction meter animation should be ref/CSS/canvas driven.

### Meter Surfaces To Convert

Convert all visible meter surfaces:

- Audio Mixer track strips
- Audio Mixer master strip
- Timeline audio layer/track header meters keyed by `track.id`
- Timeline collapsed audio summary meter
- Timeline master toolbar meter
- Volume tab dynamics and analyzer consumers
- Floating mixer FX window, including level/headroom, dynamics, and EQ spectrum demand
- Any future scopes should use the same hook and bus.

## Debug Bridge And Stats

File:

```text
src/services/aiTools/bridge.ts
```

Replace direct `useTimelineStore.getState().runtimeAudioMeters` reads with:

```ts
runtimeAudioMeterBus.getDebugSnapshot()
```

Current bridge consumers are concentrated in `src/services/aiTools/bridge.ts`, especially `createAudioRuntimeDebugSignature`, `summarizeRuntimeAudioMeters`, and `measureStoreChurn`. Preserve their existing output shape or document the break before changing it.

Preserve or provide equivalents for:

- master peak/rms
- track peak/rms
- updated age

Add optional demand diagnostics:

- active meter subscribers
- active spectrum subscribers
- active dynamics subscribers

Do not expose high-volume raw spectrum arrays through the bridge unless explicitly requested by a future debug tool.

If `measureStoreChurn` continues to watch the Zustand mirror, document that a low-frequency mirror intentionally reduces churn. Prefer subscribing that diagnostic directly to the bus when the goal is runtime audio activity rather than store-write activity.

## Cleanup And Stale State

The bus owns stale cleanup. It should:

- age out track snapshots after the current `RUNTIME_AUDIO_METER_MAX_AGE_MS` equivalent
- publish silent master state when all tracks are silent or stale
- clear removed tracks on `removeTrack`
- clear all meters on project load/reset/composition switch where current code clears store meters
- avoid repeated silent notifications when both previous and next state are silent

The bus should keep the existing silent-meter optimization: repeated silent updates must not trigger subscribers unnecessarily.

`clearStale` is called from hot audio-sync paths today. It must be allocation-light, preserve snapshot identity on no-op frames, and avoid notifying subscribers when no visible state changes.

## Tests

Add focused unit tests:

```text
tests/unit/audio/runtimeAudioMeterBus.test.ts
tests/unit/audio/runtimeAudioMeterHooks.test.tsx
```

Coverage:

- subscribe/unsubscribe for track and master
- publish track notifies only relevant subscribers
- publish master notifies master subscribers
- master forwarding from `publishTrack(..., masterSnapshot)` works
- master aggregation works when only track snapshots are published
- silent duplicate updates are suppressed
- stale cleanup removes old track snapshots
- stale cleanup publishes a silent master after all tracks expire
- demand counters increment and decrement correctly
- per-effect dynamics demand increments and decrements correctly
- feature demand is scoped per track/master
- debug snapshot rounds or omits heavy fields as expected
- HMR singleton reuses the same instance
- hooks unsubscribe on unmount
- hook frame callbacks do not trigger React render per published snapshot
- bus to Zustand mirror cadence is tested
- `removeTrack` clears bus and mirror state
- project load/reset clears bus and mirror state
- scrub-meter and stem-buffer mixer publishers publish through the bus
- AI bridge meter-summary shape stays compatible

Update existing tests only where contracts intentionally change. Existing relevant coverage to audit:

- `tests/unit/audioScrubSync.test.ts`
- `tests/unit/AudioLevelMeter.test.tsx`
- `tests/unit/VolumeTab.test.tsx`
- `tests/stores/timeline/trackSlice.test.ts`
- `tests/helpers/storeFactory.ts`

## Verification

Use targeted checks during implementation:

```bash
npx eslint src/services/audio/runtimeAudioMeterBus.ts src/components/timeline/components/AudioLevelMeter.tsx
npx vitest run tests/unit/audio/runtimeAudioMeterBus.test.ts tests/unit/audio/runtimeAudioMeterHooks.test.tsx
npx tsc -b --pretty false
```

Runtime smoke checks:

- Mixer hidden vs visible during playback
- Timeline advanced audio headers visible
- Timeline master toolbar visible
- EQ window open with live analyzer
- Dynamics-enabled effect visible
- Scrub audio with meters
- Tail-meter decay after stopping effect-heavy audio
- Multiple audio tracks active at once

Use the dev bridge where practical:

```text
getStats
getStatsHistory
getLogs
getPlaybackTrace
```

Key success signals:

- no browser console errors
- no loss of existing meter behavior
- visible meters animate smoothly
- opening the Audio Mixer no longer noticeably increases timeline/playback latency
- bridge diagnostics still report runtime audio meter summaries where they do today
- spectrum work only runs when EQ/analyzer UI demands it

## Migration Order

This is the safest full-scope order:

1. Add `runtimeAudioMeterBus` and tests.
2. Add a Zustand mirror from the bus, initially preserving current visible-meter cadence.
3. Change `updateRuntimeAudioMeter` to forward into the bus, while publishers can still call it.
4. Convert `AudioLevelMeter` to support `streamScope`.
5. Convert `AudioMixerPanel` meters and dynamics.
6. Convert `TimelineHeader` meters.
7. Convert `TimelineControls` master meter.
8. Convert `useThrottledRuntimeAnalyzer` to subscribe to the bus.
9. Convert `VolumeTab` and `AudioEffectStackControl` dynamics reads.
10. Convert direct publisher call sites from `updateRuntimeAudioMeter` to bus APIs.
11. Add demand-aware snapshot options to `audioRoutingManager`, `proxyFrameCache`, and stem-buffer mixer snapshots.
12. Replace AI bridge meter reads with bus debug snapshots.
13. Lower the Zustand mirror to diagnostic cadence.
14. Remove temporary direct Zustand meter subscriptions and panel-local throttling.

Even though this plan is full scope, implementation should still keep coherent commits and preserve compatibility at each step.

## Risks

### Risk: UI Imperative Updates Become Hard To Maintain

Mitigation:

- keep the imperative code inside `AudioLevelMeter`
- expose declarative props for callers
- keep static rendering path for tests and non-live snapshots

### Risk: Store Mirror Diverges From Bus

Mitigation:

- bus is source of truth
- store mirror is subscribed from bus only
- debug bridge reads bus directly once available

### Risk: Demand Tracking Accidentally Disables Needed Analyzer Data

Mitigation:

- first migrate with full snapshots
- add demand-aware snapshot reduction after all consumers declare features
- test feature counters before enabling expensive read skipping

### Risk: HMR Leaves Old Subscribers Alive

Mitigation:

- singleton owns subscriptions
- React hooks always return cleanup
- HMR dispose clears frame timers, tail-meter intervals, and stale mirror subscriptions, but preserves latest snapshots where useful

### Risk: Existing AI Tools Depend On Zustand Shape

Mitigation:

- keep `runtimeAudioMeters` mirror until AI bridge is migrated
- preserve `summarizeRuntimeAudioMeters` output shape
- keep `measureStoreChurn` semantics explicit: store churn and runtime signal churn are different metrics after the bus split

## Completion Criteria

- All meter UI surfaces consume the runtime bus instead of direct `runtimeAudioMeters` subscriptions.
- EQ analyzer streaming uses the same bus and feature demand model.
- Zustand meter state is either removed or documented as a low-frequency debug mirror.
- Existing AI bridge diagnostics that expose meter summaries keep a compatible shape or have documented replacement fields.
- Unit tests cover bus behavior, demand tracking, cleanup, and hooks.
- Runtime smoke tests show no visible regressions in mixer, timeline headers, master toolbar, EQ analyzer, or dynamics UI.
