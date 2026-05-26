// Track-related actions slice

import type {
  AudioEffectInstance,
  AudioExportPreflightState,
  AudioMeterSnapshot,
  AudioSendState,
  MasterAudioState,
  TimelineTrack,
  TrackAudioState,
} from '../../types';
import type { TrackActions, SliceCreator } from './types';
import { MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT } from './constants';
import { Logger } from '../../services/logger';
import { generateClipId, generateEffectId } from './helpers/idGenerator';
import {
  aggregateAudioMeterSnapshots,
  createSilentAudioMeterSnapshot,
} from '../../services/audio/audioMetering';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  hasAudioEffect,
} from '../../engine/audio/AudioEffectRegistry';
import { runAudioExportPreflight as computeAudioExportPreflight } from '../../services/audio/audioExportPreflight';

const log = Logger.create('TrackSlice');

function clampVolumeDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-60, Math.min(18, value));
}

function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function clampSendGainDb(value: number): number {
  if (!Number.isFinite(value)) return -12;
  return Math.max(-60, Math.min(18, value));
}

function clampTruePeakCeilingDb(value: number): number {
  if (!Number.isFinite(value)) return -1;
  return Math.max(-24, Math.min(0, value));
}

function clampTargetLufs(value: number): number {
  if (!Number.isFinite(value)) return -14;
  return Math.max(-36, Math.min(-5, value));
}

function normalizeAudioSends(sends: TrackAudioState['sends'] | undefined): AudioSendState[] | undefined {
  if (!sends || sends.length === 0) return undefined;

  return sends.map((send, index) => ({
    id: typeof send.id === 'string' && send.id.length > 0 ? send.id : generateClipId('send'),
    targetBusId: typeof send.targetBusId === 'string' && send.targetBusId.length > 0
      ? send.targetBusId
      : `bus-${index + 1}`,
    gainDb: clampSendGainDb(send.gainDb),
    preFader: send.preFader === true,
    enabled: send.enabled !== false,
  }));
}

function normalizeMeterMode(meterMode: unknown): TrackAudioState['meterMode'] {
  return meterMode === 'rms' || meterMode === 'lufs' ? meterMode : 'peak';
}

function ensureTrackAudioState(track: TimelineTrack, patch: Partial<TrackAudioState> = {}): TrackAudioState {
  const next = {
    volumeDb: 0,
    pan: 0,
    muted: track.muted === true,
    solo: track.solo === true,
    recordArm: false,
    inputMonitor: false,
    meterMode: 'peak',
    ...(track.audioState ?? {}),
    ...patch,
  };

  return {
    ...next,
    volumeDb: clampVolumeDb(next.volumeDb),
    pan: clampPan(next.pan),
    sends: normalizeAudioSends(next.sends),
    meterMode: normalizeMeterMode(next.meterMode),
  };
}

function ensureMasterAudioState(
  current: MasterAudioState | undefined,
  patch: Partial<MasterAudioState> = {},
): MasterAudioState {
  const next = {
    volumeDb: 0,
    limiterEnabled: false,
    truePeakCeilingDb: -1,
    ...(current ?? {}),
    ...patch,
  };

  return {
    ...next,
    volumeDb: clampVolumeDb(next.volumeDb),
    truePeakCeilingDb: clampTruePeakCeilingDb(next.truePeakCeilingDb),
    ...(next.targetLufs !== undefined ? { targetLufs: clampTargetLufs(next.targetLufs) } : { targetLufs: undefined }),
  };
}

function createAudioEffectInstance(
  descriptorId: string,
  automationMode: AudioEffectInstance['automationMode'],
): AudioEffectInstance | null {
  const descriptor = getAudioEffect(descriptorId);
  if (!descriptor) return null;

  return {
    id: generateEffectId(),
    descriptorId: descriptor.id,
    enabled: true,
    params: getAudioEffectDefaultParams(descriptor.id),
    automationMode: descriptor.automation === 'none' ? 'none' : automationMode,
  };
}

function updateEffectStackParams(
  effectStack: readonly AudioEffectInstance[] | undefined,
  effectId: string,
  params: Partial<AudioEffectInstance['params']>,
): AudioEffectInstance[] {
  return (effectStack ?? []).map(effect => effect.id === effectId
    ? { ...effect, params: { ...effect.params, ...params } as AudioEffectInstance['params'] }
    : effect);
}

function setEffectStackEnabled(
  effectStack: readonly AudioEffectInstance[] | undefined,
  effectId: string,
  enabled: boolean,
): AudioEffectInstance[] {
  return (effectStack ?? []).map(effect => effect.id === effectId ? { ...effect, enabled } : effect);
}

function reorderEffectStack(
  effectStack: readonly AudioEffectInstance[] | undefined,
  effectId: string,
  newIndex: number,
): AudioEffectInstance[] {
  const nextStack = [...(effectStack ?? [])];
  const oldIndex = nextStack.findIndex(effect => effect.id === effectId);
  if (oldIndex < 0 || oldIndex === newIndex) return nextStack;

  const [moved] = nextStack.splice(oldIndex, 1);
  const clampedIndex = Math.max(0, Math.min(nextStack.length, newIndex));
  nextStack.splice(clampedIndex, 0, moved);
  return nextStack;
}

const RUNTIME_AUDIO_METER_MAX_AGE_MS = 450;
const AUDIO_EXPORT_PREFLIGHT_HISTORY_LIMIT = 8;

function updateRuntimeMeterState(
  currentTrackMeters: Record<string, AudioMeterSnapshot>,
  patch: Record<string, AudioMeterSnapshot | undefined>,
  now: number,
  maxAgeMs = RUNTIME_AUDIO_METER_MAX_AGE_MS,
) {
  const trackMeters: Record<string, AudioMeterSnapshot> = {};

  for (const [trackId, snapshot] of Object.entries(currentTrackMeters)) {
    if (now - snapshot.updatedAt > maxAgeMs) continue;
    trackMeters[trackId] = snapshot;
  }

  for (const [trackId, snapshot] of Object.entries(patch)) {
    if (!snapshot) {
      delete trackMeters[trackId];
      continue;
    }
    trackMeters[trackId] = snapshot;
  }

  return {
    trackMeters,
    master: aggregateAudioMeterSnapshots(Object.values(trackMeters), now),
  };
}

function withAudioExportPreflightMeasurementHistory(
  current: AudioExportPreflightState | undefined,
  next: AudioExportPreflightState,
  rangeStart: number,
  rangeEnd: number,
): AudioExportPreflightState {
  const existing = current?.measurementHistory ?? [];
  if (!next.measurement) {
    return existing.length > 0
      ? {
          ...next,
          measurementHistory: existing.slice(0, AUDIO_EXPORT_PREFLIGHT_HISTORY_LIMIT),
        }
      : next;
  }

  return {
    ...next,
    measurementHistory: [
      {
        checkedAt: next.lastCheckedAt ?? Date.now(),
        startTime: Math.max(0, Math.min(rangeStart, rangeEnd)),
        endTime: Math.max(0, Math.max(rangeStart, rangeEnd)),
        measurement: next.measurement,
      },
      ...existing,
    ].slice(0, AUDIO_EXPORT_PREFLIGHT_HISTORY_LIMIT),
  };
}

export const createTrackSlice: SliceCreator<TrackActions> = (set, get) => ({
  addTrack: (type) => {
    const { tracks, expandedTracks } = get();
    const typeCount = tracks.filter(t => t.type === type).length + 1;
    const newTrack: TimelineTrack = {
      id: `${type}-${Date.now()}`,
      name: `${type === 'video' ? 'Video' : 'Audio'} ${typeCount}`,
      type,
      height: type === 'video' ? 60 : 40,
      muted: false,
      visible: true,
      solo: false,
    };

    // Video tracks: insert at TOP (before all existing video tracks)
    // Audio tracks: insert at BOTTOM (after all existing audio tracks)
    // Both types auto-expand for keyframe visibility
    const newExpanded = new Set(expandedTracks);
    newExpanded.add(newTrack.id);

    if (type === 'video') {
      // Insert at index 0 (top of timeline)
      set({ tracks: [newTrack, ...tracks], expandedTracks: newExpanded });
    } else {
      // Audio: append at end (bottom of timeline)
      set({ tracks: [...tracks, newTrack], expandedTracks: newExpanded });
    }

    return newTrack.id;
  },

  removeTrack: (id) => {
    const { tracks, clips } = get();
    const track = tracks.find(t => t.id === id);
    if (track?.locked) {
      log.warn('Cannot remove locked track', { id });
      return;
    }
    const runtimeAudioMeters = updateRuntimeMeterState(
      get().runtimeAudioMeters.trackMeters,
      { [id]: undefined },
      performance.now(),
    );
    set({
      tracks: tracks.filter(t => t.id !== id),
      clips: clips.filter(c => c.trackId !== id),
      runtimeAudioMeters,
    });
  },

  renameTrack: (id, name) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(t => t.id === id ? { ...t, name } : t),
    });
  },

  setTrackMuted: (id, muted) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(t => t.id === id
        ? {
          ...t,
          muted,
          ...((t.type === 'audio' || t.audioState)
            ? { audioState: ensureTrackAudioState(t, { muted }) }
            : {}),
        }
        : t),
    });
    // Audio changes don't affect video cache
  },

  setTrackVisible: (id, visible) => {
    const { tracks, invalidateCache } = get();
    const track = tracks.find(t => t.id === id);
    set({
      tracks: tracks.map(t => t.id === id ? { ...t, visible } : t),
    });
    // Invalidate cache if video track visibility changed
    if (track?.type === 'video') {
      invalidateCache();
    }
  },

  setTrackSolo: (id, solo) => {
    const { tracks, invalidateCache } = get();
    const track = tracks.find(t => t.id === id);
    set({
      tracks: tracks.map(t => t.id === id
        ? {
          ...t,
          solo,
          ...((t.type === 'audio' || t.audioState)
            ? { audioState: ensureTrackAudioState(t, { solo }) }
            : {}),
        }
        : t),
    });
    // Invalidate cache if video track solo changed
    if (track?.type === 'video') {
      invalidateCache();
    }
  },

  setTrackLocked: (id, locked) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(t => t.id === id ? { ...t, locked } : t),
    });
  },

  updateTrackAudioState: (id, patch) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(track => {
        if (track.id !== id) return track;
        const audioState = ensureTrackAudioState(track, {
          ...patch,
          ...(patch.volumeDb !== undefined ? { volumeDb: clampVolumeDb(patch.volumeDb) } : {}),
          ...(patch.pan !== undefined ? { pan: clampPan(patch.pan) } : {}),
        });
        return {
          ...track,
          muted: audioState.muted,
          solo: audioState.solo,
          audioState,
        };
      }),
    });
  },

  setTrackAudioVolumeDb: (id, volumeDb) => {
    get().updateTrackAudioState(id, { volumeDb });
  },

  setTrackAudioPan: (id, pan) => {
    get().updateTrackAudioState(id, { pan });
  },

  addTrackAudioSend: (trackId, targetBusId) => {
    const { tracks } = get();
    const track = tracks.find(candidate => candidate.id === trackId);
    if (!track) return null;

    const audioState = ensureTrackAudioState(track);
    const sendId = generateClipId('send');
    const nextSend: AudioSendState = {
      id: sendId,
      targetBusId: targetBusId && targetBusId.trim() ? targetBusId.trim() : `bus-${(audioState.sends?.length ?? 0) + 1}`,
      gainDb: -12,
      preFader: false,
      enabled: true,
    };

    set({
      tracks: tracks.map(candidate => candidate.id === trackId
        ? {
          ...candidate,
          audioState: ensureTrackAudioState(candidate, {
            sends: [...(audioState.sends ?? []), nextSend],
          }),
        }
        : candidate),
    });

    return sendId;
  },

  updateTrackAudioSend: (trackId, sendId, patch) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(track => {
        if (track.id !== trackId) return track;
        const audioState = ensureTrackAudioState(track);
        return {
          ...track,
          audioState: ensureTrackAudioState(track, {
            sends: (audioState.sends ?? []).map(send => send.id === sendId
              ? {
                ...send,
                ...patch,
                ...(patch.targetBusId !== undefined ? { targetBusId: patch.targetBusId.trim() || send.targetBusId } : {}),
                ...(patch.gainDb !== undefined ? { gainDb: clampSendGainDb(patch.gainDb) } : {}),
              }
              : send),
          }),
        };
      }),
    });
  },

  removeTrackAudioSend: (trackId, sendId) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(track => track.id === trackId
        ? {
          ...track,
          audioState: ensureTrackAudioState(track, {
            sends: (track.audioState?.sends ?? []).filter(send => send.id !== sendId),
          }),
        }
        : track),
    });
  },

  addTrackAudioEffectInstance: (trackId, descriptorId) => {
    if (!hasAudioEffect(descriptorId)) return null;

    const { tracks } = get();
    const track = tracks.find(candidate => candidate.id === trackId);
    if (!track) return null;

    const effect = createAudioEffectInstance(descriptorId, 'track');
    if (!effect) return null;

    set({
      tracks: tracks.map(candidate => candidate.id === trackId
        ? {
          ...candidate,
          audioState: ensureTrackAudioState(candidate, {
            effectStack: [...(candidate.audioState?.effectStack ?? []), effect],
          }),
        }
        : candidate),
    });
    return effect.id;
  },

  removeTrackAudioEffectInstance: (trackId, effectId) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(track => track.id === trackId
        ? {
          ...track,
          audioState: ensureTrackAudioState(track, {
            effectStack: (track.audioState?.effectStack ?? []).filter(effect => effect.id !== effectId),
          }),
        }
        : track),
    });
  },

  updateTrackAudioEffectInstance: (trackId, effectId, params) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(track => track.id === trackId
        ? {
          ...track,
          audioState: ensureTrackAudioState(track, {
            effectStack: updateEffectStackParams(track.audioState?.effectStack, effectId, params),
          }),
        }
        : track),
    });
  },

  setTrackAudioEffectInstanceEnabled: (trackId, effectId, enabled) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(track => track.id === trackId
        ? {
          ...track,
          audioState: ensureTrackAudioState(track, {
            effectStack: setEffectStackEnabled(track.audioState?.effectStack, effectId, enabled),
          }),
        }
        : track),
    });
  },

  reorderTrackAudioEffectInstance: (trackId, effectId, newIndex) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(track => track.id === trackId
        ? {
          ...track,
          audioState: ensureTrackAudioState(track, {
            effectStack: reorderEffectStack(track.audioState?.effectStack, effectId, newIndex),
          }),
        }
        : track),
    });
  },

  updateMasterAudioState: (patch) => {
    const { masterAudioState } = get();
    set({ masterAudioState: ensureMasterAudioState(masterAudioState, patch) });
  },

  setMasterAudioVolumeDb: (volumeDb) => {
    get().updateMasterAudioState({ volumeDb });
  },

  setMasterLimiterEnabled: (enabled) => {
    get().updateMasterAudioState({ limiterEnabled: enabled });
  },

  setMasterTruePeakCeilingDb: (truePeakCeilingDb) => {
    get().updateMasterAudioState({ truePeakCeilingDb });
  },

  setMasterTargetLufs: (targetLufs) => {
    get().updateMasterAudioState({ targetLufs });
  },

  runAudioExportPreflight: (startTime, endTime, renderedBuffer) => {
    const { clips, tracks, masterAudioState, duration, inPoint, outPoint } = get();
    const rangeStart = startTime ?? inPoint ?? 0;
    const rangeEnd = endTime ?? outPoint ?? duration;
    const computedPreflight = computeAudioExportPreflight({
      clips,
      tracks,
      masterAudioState,
      startTime: rangeStart,
      endTime: rangeEnd,
      renderedBuffer,
    });
    const exportPreflight = withAudioExportPreflightMeasurementHistory(
      masterAudioState?.exportPreflight,
      computedPreflight,
      rangeStart,
      rangeEnd,
    );
    set({
      masterAudioState: ensureMasterAudioState(masterAudioState, {
        exportPreflight,
      }),
    });
    return exportPreflight;
  },

  addMasterAudioEffectInstance: (descriptorId) => {
    if (!hasAudioEffect(descriptorId)) return null;

    const effect = createAudioEffectInstance(descriptorId, 'track');
    if (!effect) return null;

    const current = get().masterAudioState;
    set({
      masterAudioState: ensureMasterAudioState(current, {
        effectStack: [...(current?.effectStack ?? []), effect],
      }),
    });
    return effect.id;
  },

  removeMasterAudioEffectInstance: (effectId) => {
    const current = get().masterAudioState;
    set({
      masterAudioState: ensureMasterAudioState(current, {
        effectStack: (current?.effectStack ?? []).filter(effect => effect.id !== effectId),
      }),
    });
  },

  updateMasterAudioEffectInstance: (effectId, params) => {
    const current = get().masterAudioState;
    set({
      masterAudioState: ensureMasterAudioState(current, {
        effectStack: updateEffectStackParams(current?.effectStack, effectId, params),
      }),
    });
  },

  setMasterAudioEffectInstanceEnabled: (effectId, enabled) => {
    const current = get().masterAudioState;
    set({
      masterAudioState: ensureMasterAudioState(current, {
        effectStack: setEffectStackEnabled(current?.effectStack, effectId, enabled),
      }),
    });
  },

  reorderMasterAudioEffectInstance: (effectId, newIndex) => {
    const current = get().masterAudioState;
    set({
      masterAudioState: ensureMasterAudioState(current, {
        effectStack: reorderEffectStack(current?.effectStack, effectId, newIndex),
      }),
    });
  },

  updateRuntimeAudioMeter: (trackId, snapshot) => {
    const { runtimeAudioMeters } = get();
    set({
      runtimeAudioMeters: updateRuntimeMeterState(
        runtimeAudioMeters.trackMeters,
        { [trackId]: snapshot },
        snapshot.updatedAt,
      ),
    });
  },

  clearStaleRuntimeAudioMeters: (maxAgeMs = RUNTIME_AUDIO_METER_MAX_AGE_MS, now = performance.now()) => {
    const { runtimeAudioMeters } = get();
    const next = updateRuntimeMeterState(runtimeAudioMeters.trackMeters, {}, now, maxAgeMs);
    const hadTrackMeters = Object.keys(runtimeAudioMeters.trackMeters).length > 0;
    const hasTrackMeters = Object.keys(next.trackMeters).length > 0;

    if (!hadTrackMeters && !hasTrackMeters) {
      if (!runtimeAudioMeters.master || runtimeAudioMeters.master.peakLinear === 0) return;
      set({ runtimeAudioMeters: { trackMeters: {}, master: createSilentAudioMeterSnapshot(now) } });
      return;
    }

    set({ runtimeAudioMeters: next });
  },

  setTrackHeight: (id, height) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(t => t.id === id ? { ...t, height: Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, height)) } : t),
    });
  },

  scaleTracksOfType: (type, delta) => {
    const { tracks } = get();
    const tracksOfType = tracks.filter(t => t.type === type);

    if (tracksOfType.length === 0) return;

    // Find the max height among tracks of this type
    const maxHeight = Math.max(...tracksOfType.map(t => t.height));

    // First call: sync all to max height (if they differ)
    // Subsequent calls: scale uniformly
    const allSameHeight = tracksOfType.every(t => t.height === maxHeight);

    if (!allSameHeight && delta !== 0) {
      // Sync all to max height first
      set({
        tracks: tracks.map(t =>
          t.type === type ? { ...t, height: maxHeight } : t
        ),
      });
    } else {
      // All already synced, scale uniformly
      const newHeight = Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, maxHeight + delta));
      set({
        tracks: tracks.map(t =>
          t.type === type ? { ...t, height: newHeight } : t
        ),
      });
    }
  },

  // Track parenting (layer linking) - like After Effects layer parenting
  setTrackParent: (trackId, parentTrackId) => {
    const { tracks } = get();

    // Can't parent to self
    if (parentTrackId === trackId) return;

    // Cycle detection: parent can't be a child/grandchild of this track
    if (parentTrackId) {
      const wouldCreateCycle = (checkId: string): boolean => {
        const check = tracks.find(t => t.id === checkId);
        if (!check?.parentTrackId) return false;
        if (check.parentTrackId === trackId) return true;
        return wouldCreateCycle(check.parentTrackId);
      };

      if (wouldCreateCycle(parentTrackId)) {
        log.warn('Cannot create circular track parent reference');
        return;
      }
    }

    set({
      tracks: tracks.map(t =>
        t.id === trackId ? { ...t, parentTrackId: parentTrackId || undefined } : t
      ),
    });
  },

  getTrackChildren: (trackId) => {
    const { tracks } = get();
    return tracks.filter(t => t.parentTrackId === trackId);
  },
});
