// runtimeAudioMeterBus - dedicated runtime transport for live audio meter telemetry.
//
// Live audio meters are high-frequency runtime telemetry, not persistent application
// state. This singleton owns the latest track/master meter snapshots, subscriber lists,
// per-scope feature demand accounting, stale cleanup, master aggregation and debug
// snapshots so visible UI can animate meters without forcing React/Zustand renders for
// every snapshot.
//
// The bus is deliberately scoped to live audio meter telemetry only (see
// docs/completed/plans/runtime-audio-meter-bus-plan.md). It is NOT a generic global event bus.

import type { AudioMeterSnapshot } from '../../types';
import {
  aggregateAudioMeterSnapshots,
  createSilentAudioMeterSnapshot,
} from './audioMetering';

export const RUNTIME_AUDIO_METER_MAX_AGE_MS = 450;

export type RuntimeAudioMeterScope =
  | { kind: 'track'; trackId: string }
  | { kind: 'master' };

export type RuntimeAudioMeterFeature =
  | 'level'
  | 'stereo'
  | 'phase'
  | 'dynamics'
  | 'spectrum';

export const RUNTIME_AUDIO_METER_FEATURES: readonly RuntimeAudioMeterFeature[] = [
  'level',
  'stereo',
  'phase',
  'dynamics',
  'spectrum',
];

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

export interface RuntimeAudioMeterStateSnapshot {
  trackMeters: Record<string, AudioMeterSnapshot>;
  master?: AudioMeterSnapshot;
}

type MeterListener = (snapshot: AudioMeterSnapshot | undefined) => void;

interface InternalDemand {
  level: number;
  stereo: number;
  phase: number;
  dynamics: number;
  spectrum: number;
  dynamicsEffects: Map<string, number>;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isSilentSnapshot(snapshot: AudioMeterSnapshot | undefined): boolean {
  return !snapshot || (snapshot.peakLinear === 0 && snapshot.rmsLinear === 0);
}

function createEmptyDemand(): InternalDemand {
  return {
    level: 0,
    stereo: 0,
    phase: 0,
    dynamics: 0,
    spectrum: 0,
    dynamicsEffects: new Map<string, number>(),
  };
}

function snapshotDemand(demand: InternalDemand | undefined): RuntimeAudioMeterDemand {
  const dynamicsEffects: Record<string, number> = {};
  if (demand) {
    for (const [effectId, count] of demand.dynamicsEffects) {
      if (count > 0) dynamicsEffects[effectId] = count;
    }
  }
  return {
    level: demand?.level ?? 0,
    stereo: demand?.stereo ?? 0,
    phase: demand?.phase ?? 0,
    dynamics: demand?.dynamics ?? 0,
    spectrum: demand?.spectrum ?? 0,
    dynamicsEffects,
  };
}

function isDemandEmpty(demand: InternalDemand): boolean {
  if (demand.level || demand.stereo || demand.phase || demand.dynamics || demand.spectrum) {
    return false;
  }
  for (const count of demand.dynamicsEffects.values()) {
    if (count > 0) return false;
  }
  return true;
}

export class RuntimeAudioMeterBus {
  private trackMeters = new Map<string, AudioMeterSnapshot>();
  private master: AudioMeterSnapshot | undefined = undefined;
  private masterSource: 'aggregate' | 'explicit' = 'aggregate';

  private trackListeners = new Map<string, Set<MeterListener>>();
  private masterListeners = new Set<MeterListener>();
  private allListeners = new Set<() => void>();

  private trackDemand = new Map<string, InternalDemand>();
  private masterDemand: InternalDemand = createEmptyDemand();

  private stateDirty = true;
  private stateCache: RuntimeAudioMeterStateSnapshot = { trackMeters: {} };

  // ── Publishing ──────────────────────────────────────────────────────────

  publishTrack(
    trackId: string,
    snapshot: AudioMeterSnapshot,
    masterSnapshot?: AudioMeterSnapshot,
  ): void {
    const current = this.trackMeters.get(trackId);
    // Silent duplicate suppression: skip work entirely when nothing is audible.
    if (
      isSilentSnapshot(snapshot) &&
      isSilentSnapshot(current) &&
      isSilentSnapshot(masterSnapshot) &&
      isSilentSnapshot(this.master)
    ) {
      return;
    }

    const next = this.ageTrackMeters(snapshot.updatedAt, RUNTIME_AUDIO_METER_MAX_AGE_MS);
    next.set(trackId, snapshot);
    const nextMaster = this.resolveMasterSnapshot(next, snapshot.updatedAt, masterSnapshot);
    this.commit(next, nextMaster, this.resolveMasterSource(nextMaster, masterSnapshot));
  }

  publishTracks(
    entries: readonly { trackId: string; snapshot: AudioMeterSnapshot }[],
    masterSnapshot?: AudioMeterSnapshot,
  ): void {
    if (entries.length === 0) return;
    const updatedAt = entries.reduce((latest, entry) => Math.max(latest, entry.snapshot.updatedAt), 0);
    const next = this.ageTrackMeters(updatedAt, RUNTIME_AUDIO_METER_MAX_AGE_MS);
    let hasNonSilentUpdate = false;
    for (const { trackId, snapshot } of entries) {
      const current = this.trackMeters.get(trackId);
      if (!isSilentSnapshot(snapshot) || !isSilentSnapshot(current)) {
        hasNonSilentUpdate = true;
      }
      next.set(trackId, snapshot);
    }
    if (
      !hasNonSilentUpdate &&
      isSilentSnapshot(masterSnapshot) &&
      isSilentSnapshot(this.master)
    ) {
      return;
    }
    const nextMaster = this.resolveMasterSnapshot(next, updatedAt, masterSnapshot);
    this.commit(next, nextMaster, this.resolveMasterSource(nextMaster, masterSnapshot));
  }

  publishMaster(snapshot: AudioMeterSnapshot): void {
    this.commit(new Map(this.trackMeters), snapshot, 'explicit');
  }

  clearTrack(trackId: string): void {
    if (!this.trackMeters.has(trackId)) return;
    const now = nowMs();
    const next = this.ageTrackMeters(now, RUNTIME_AUDIO_METER_MAX_AGE_MS);
    next.delete(trackId);
    const nextMaster = aggregateAudioMeterSnapshots([...next.values()], now);
    this.commit(next, nextMaster);
  }

  clearAll(): void {
    this.commit(new Map<string, AudioMeterSnapshot>(), undefined);
  }

  clearStale(maxAgeMs = RUNTIME_AUDIO_METER_MAX_AGE_MS, now = nowMs()): void {
    const hadTracks = this.trackMeters.size > 0;
    const next = this.ageTrackMeters(now, maxAgeMs);
    const hasTracks = next.size > 0;

    if (!hadTracks && !hasTracks) {
      // No track meters at all: decay the master toward silence (tail meters).
      if (!this.master || this.master.peakLinear === 0) return;
      this.commit(next, createSilentAudioMeterSnapshot(now));
      return;
    }

    const nextMaster = this.master && now - this.master.updatedAt <= maxAgeMs
      ? this.master
      : aggregateAudioMeterSnapshots([...next.values()], now);
    this.commit(next, nextMaster, this.resolveMasterSource(nextMaster));
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  getTrackSnapshot(trackId: string): AudioMeterSnapshot | undefined {
    return this.trackMeters.get(trackId);
  }

  getMasterSnapshot(): AudioMeterSnapshot | undefined {
    return this.master;
  }

  /**
   * Returns the current bus state in the legacy `RuntimeAudioMeterState` shape.
   * The returned object identity is stable until the bus content changes, so the
   * Zustand mirror can cheaply skip no-op writes via reference equality.
   */
  getState(): RuntimeAudioMeterStateSnapshot {
    if (this.stateDirty) {
      const trackMeters: Record<string, AudioMeterSnapshot> = {};
      for (const [trackId, snapshot] of this.trackMeters) {
        trackMeters[trackId] = snapshot;
      }
      this.stateCache = this.master
        ? { trackMeters, master: this.master }
        : { trackMeters };
      this.stateDirty = false;
    }
    return this.stateCache;
  }

  getDebugSnapshot(): RuntimeAudioMeterDebugSnapshot {
    const tracks: Record<string, AudioMeterSnapshot> = {};
    for (const [trackId, snapshot] of this.trackMeters) {
      tracks[trackId] = snapshot;
    }
    const demandTracks: Record<string, RuntimeAudioMeterDemand> = {};
    for (const [trackId, demand] of this.trackDemand) {
      if (!isDemandEmpty(demand)) demandTracks[trackId] = snapshotDemand(demand);
    }
    return {
      master: this.master ?? null,
      tracks,
      demand: {
        master: snapshotDemand(this.masterDemand),
        tracks: demandTracks,
      },
    };
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  subscribeTrack(
    trackId: string,
    listener: MeterListener,
    options?: RuntimeAudioMeterSubscriptionOptions,
  ): () => void {
    let listeners = this.trackListeners.get(trackId);
    if (!listeners) {
      listeners = new Set<MeterListener>();
      this.trackListeners.set(trackId, listeners);
    }
    listeners.add(listener);

    let demand = this.trackDemand.get(trackId);
    if (!demand) {
      demand = createEmptyDemand();
      this.trackDemand.set(trackId, demand);
    }
    this.addDemand(demand, options);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const set = this.trackListeners.get(trackId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.trackListeners.delete(trackId);
      }
      const currentDemand = this.trackDemand.get(trackId);
      if (currentDemand) {
        this.removeDemand(currentDemand, options);
        if (isDemandEmpty(currentDemand) && !this.trackListeners.has(trackId)) {
          this.trackDemand.delete(trackId);
        }
      }
    };
  }

  subscribeMaster(
    listener: MeterListener,
    options?: RuntimeAudioMeterSubscriptionOptions,
  ): () => void {
    this.masterListeners.add(listener);
    this.addDemand(this.masterDemand, options);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.masterListeners.delete(listener);
      this.removeDemand(this.masterDemand, options);
    };
  }

  retainDemand(
    scope: RuntimeAudioMeterScope,
    options?: RuntimeAudioMeterSubscriptionOptions,
  ): () => void {
    const demand = scope.kind === 'master'
      ? this.masterDemand
      : this.getOrCreateTrackDemand(scope.trackId);
    this.addDemand(demand, options);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.removeDemand(demand, options);
      if (
        scope.kind === 'track' &&
        isDemandEmpty(demand) &&
        !this.trackListeners.has(scope.trackId)
      ) {
        this.trackDemand.delete(scope.trackId);
      }
    };
  }

  /**
   * Fired (without payload) after any bus mutation. Used by the Zustand mirror.
   * Does not participate in demand accounting.
   */
  subscribeAll(listener: () => void): () => void {
    this.allListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.allListeners.delete(listener);
    };
  }

  // ── Demand queries ──────────────────────────────────────────────────────

  getDemand(scope: RuntimeAudioMeterScope): RuntimeAudioMeterDemand {
    if (scope.kind === 'master') return snapshotDemand(this.masterDemand);
    return snapshotDemand(this.trackDemand.get(scope.trackId));
  }

  hasDemand(scope: RuntimeAudioMeterScope, feature: RuntimeAudioMeterFeature): boolean {
    const demand = scope.kind === 'master'
      ? this.masterDemand
      : this.trackDemand.get(scope.trackId);
    if (!demand) return false;
    return demand[feature] > 0;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private ageTrackMeters(now: number, maxAgeMs: number): Map<string, AudioMeterSnapshot> {
    const next = new Map<string, AudioMeterSnapshot>();
    for (const [trackId, snapshot] of this.trackMeters) {
      if (now - snapshot.updatedAt > maxAgeMs) continue;
      next.set(trackId, snapshot);
    }
    return next;
  }

  private getOrCreateTrackDemand(trackId: string): InternalDemand {
    let demand = this.trackDemand.get(trackId);
    if (!demand) {
      demand = createEmptyDemand();
      this.trackDemand.set(trackId, demand);
    }
    return demand;
  }

  private resolveMasterSnapshot(
    tracks: Map<string, AudioMeterSnapshot>,
    updatedAt: number,
    masterSnapshot?: AudioMeterSnapshot,
  ): AudioMeterSnapshot {
    if (masterSnapshot) return masterSnapshot;
    if (
      this.masterSource === 'explicit' &&
      this.master &&
      updatedAt - this.master.updatedAt <= RUNTIME_AUDIO_METER_MAX_AGE_MS
    ) {
      return this.master;
    }
    return aggregateAudioMeterSnapshots([...tracks.values()], updatedAt);
  }

  private resolveMasterSource(
    nextMaster: AudioMeterSnapshot | undefined,
    explicitMasterSnapshot?: AudioMeterSnapshot,
  ): 'aggregate' | 'explicit' {
    if (explicitMasterSnapshot) return 'explicit';
    return nextMaster && nextMaster === this.master ? this.masterSource : 'aggregate';
  }

  private commit(
    nextTracks: Map<string, AudioMeterSnapshot>,
    nextMaster: AudioMeterSnapshot | undefined,
    nextMasterSource: 'aggregate' | 'explicit' = 'aggregate',
  ): void {
    const changedTrackIds: string[] = [];
    const seen = new Set<string>();
    for (const trackId of this.trackMeters.keys()) {
      seen.add(trackId);
      if (!Object.is(this.trackMeters.get(trackId), nextTracks.get(trackId))) {
        changedTrackIds.push(trackId);
      }
    }
    for (const trackId of nextTracks.keys()) {
      if (seen.has(trackId)) continue;
      if (!Object.is(this.trackMeters.get(trackId), nextTracks.get(trackId))) {
        changedTrackIds.push(trackId);
      }
    }
    const masterChanged = !Object.is(this.master, nextMaster);

    if (changedTrackIds.length === 0 && !masterChanged) return;

    this.trackMeters = nextTracks;
    this.master = nextMaster;
    this.masterSource = nextMaster ? nextMasterSource : 'aggregate';
    this.stateDirty = true;

    for (const trackId of changedTrackIds) {
      const listeners = this.trackListeners.get(trackId);
      if (!listeners || listeners.size === 0) continue;
      const snapshot = nextTracks.get(trackId);
      for (const listener of [...listeners]) {
        listener(snapshot);
      }
    }

    if (masterChanged && this.masterListeners.size > 0) {
      for (const listener of [...this.masterListeners]) {
        listener(nextMaster);
      }
    }

    if (this.allListeners.size > 0) {
      for (const listener of [...this.allListeners]) {
        listener();
      }
    }
  }

  private addDemand(demand: InternalDemand, options?: RuntimeAudioMeterSubscriptionOptions): void {
    const features = options?.features ?? ['level'];
    for (const feature of features) {
      demand[feature] += 1;
    }
    if (options?.dynamicsEffectIds) {
      for (const effectId of options.dynamicsEffectIds) {
        demand.dynamicsEffects.set(effectId, (demand.dynamicsEffects.get(effectId) ?? 0) + 1);
      }
    }
  }

  private removeDemand(demand: InternalDemand, options?: RuntimeAudioMeterSubscriptionOptions): void {
    const features = options?.features ?? ['level'];
    for (const feature of features) {
      demand[feature] = Math.max(0, demand[feature] - 1);
    }
    if (options?.dynamicsEffectIds) {
      for (const effectId of options.dynamicsEffectIds) {
        const nextCount = (demand.dynamicsEffects.get(effectId) ?? 0) - 1;
        if (nextCount <= 0) demand.dynamicsEffects.delete(effectId);
        else demand.dynamicsEffects.set(effectId, nextCount);
      }
    }
  }

  /** Test-only: drop all subscribers/demand as well as snapshots. */
  resetForTest(): void {
    this.trackMeters = new Map();
    this.master = undefined;
    this.masterSource = 'aggregate';
    this.trackListeners.clear();
    this.masterListeners.clear();
    this.allListeners.clear();
    this.trackDemand.clear();
    this.masterDemand = createEmptyDemand();
    this.stateDirty = true;
    this.stateCache = { trackMeters: {} };
  }
}

// HMR-safe singleton: preserve identity (and live subscribers/snapshots) across hot reloads.
let instance: RuntimeAudioMeterBus | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.runtimeAudioMeterBus) {
    instance = import.meta.hot.data.runtimeAudioMeterBus as RuntimeAudioMeterBus;
  }
  import.meta.hot.dispose((data) => {
    data.runtimeAudioMeterBus = instance;
  });
}

if (!instance) {
  instance = new RuntimeAudioMeterBus();
}

export const runtimeAudioMeterBus = instance;
