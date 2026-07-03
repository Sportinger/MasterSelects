// Track-related actions slice

import type {
  AudioSendState,
  TimelineTrack,
} from '../../types';
import type { TrackActions, SliceCreator } from './types';
import { MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT } from './constants';
import { Logger } from '../../services/logger';
import { generateClipId } from './helpers/idGenerator';
import { createDefaultMidiInstrument, type MidiInstrument } from '../../types/midiClip';
import { runtimeAudioMeterBus } from '../../services/audio/runtimeAudioMeterBus';
import { stopTimelineAudioPlayback } from '../../services/audio/timelineAudioPlaybackStopper';
import { hasAudioEffect } from '../../engine/audio/AudioEffectRegistry';
import { runAudioExportPreflight as computeAudioExportPreflight } from '../../services/audio/audioExportPreflight';
import { cleanupDeletedClipResources } from './deletedClipResources';
import {
  clearTransitionsLinkedToRemovedClips,
  setClipsAndCleanupTransitionComps,
} from './editOperations/transitionCompositionMaintenance';
import {
  cancelRuntimeAudioMeterMirrorFlush,
  clampPan,
  clampSendGainDb,
  clampVolumeDb,
  createAudioEffectInstance,
  ensureMasterAudioState,
  ensureTrackAudioState,
  flushRuntimeAudioMeterMirror,
  reorderEffectStack,
  scheduleRuntimeAudioMeterMirrorFlush,
  setEffectStackEnabled,
  updateEffectStackParams,
  withAudioExportPreflightMeasurementHistory,
} from './tracks/trackAudioState';

const log = Logger.create('TrackSlice');

function clampTrackHeight(value: number): number {
  return Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, value));
}

type TimelineTrackCreationType = 'video' | 'audio' | 'midi';

function createTrackId(type: TimelineTrackCreationType): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTimelineTrackForType(
  type: TimelineTrackCreationType,
  tracks: readonly TimelineTrack[],
): TimelineTrack {
  const typeCount = tracks.filter(t => t.type === type).length + 1;
  const typeLabel = type === 'video' ? 'Video' : type === 'midi' ? 'MIDI' : 'Audio';
  return {
    id: createTrackId(type),
    name: `${typeLabel} ${typeCount}`,
    type,
    height: type === 'video' ? 60 : 40,
    muted: false,
    visible: true,
    solo: false,
    ...(type === 'midi' ? { midiInstrument: createDefaultMidiInstrument() } : {}),
  };
}

export function insertTimelineTrack(
  tracks: readonly TimelineTrack[],
  expandedTracks: ReadonlySet<string>,
  newTrack: TimelineTrack,
): { tracks: TimelineTrack[]; expandedTracks: Set<string> } {
  const nextExpandedTracks = new Set(expandedTracks);
  nextExpandedTracks.add(newTrack.id);

  return {
    tracks: newTrack.type === 'video' ? [newTrack, ...tracks] : [...tracks, newTrack],
    expandedTracks: nextExpandedTracks,
  };
}

export const createTrackSlice: SliceCreator<TrackActions> = (set, get) => ({
  addTrack: (type) => {
    const { tracks, expandedTracks } = get();
    const newTrack = createTimelineTrackForType(type, tracks);

    // Video tracks: insert at TOP (before all existing video tracks)
    // Audio tracks: insert at BOTTOM (after all existing audio tracks)
    // Both types auto-expand for keyframe visibility
    set(insertTimelineTrack(tracks, expandedTracks, newTrack));

    return newTrack.id;
  },

  removeTrack: (id) => {
    const { tracks, clips, targetTrackIdByType, propertiesSelection } = get();
    const track = tracks.find(t => t.id === id);
    if (track?.locked) {
      log.warn('Cannot remove locked track', { id });
      return;
    }
    const deletedClips = clips.filter(c => c.trackId === id);
    const nextTracks = tracks.filter(t => t.id !== id);
    const nextTargetTrackIdByType = { ...targetTrackIdByType };
    if (track && nextTargetTrackIdByType[track.type] === id) {
      delete nextTargetTrackIdByType[track.type];
    }
    // Runtime meters live on the dedicated bus; drop this track's snapshot there
    // and mirror the resulting bus state back into the store.
    runtimeAudioMeterBus.clearTrack(id);
    cleanupDeletedClipResources(deletedClips);
    const deletedClipIds = new Set(deletedClips.map((clip) => clip.id));
    setClipsAndCleanupTransitionComps(set, clips, {
      tracks: nextTracks,
      clips: clearTransitionsLinkedToRemovedClips(clips.filter(c => c.trackId !== id), deletedClipIds),
      runtimeAudioMeters: runtimeAudioMeterBus.getState(),
      targetTrackIdByType: nextTargetTrackIdByType,
      ...(propertiesSelection?.kind === 'track' && propertiesSelection.trackId === id
        ? { propertiesSelection: null }
        : {}),
    });
  },

  reorderTrack: (trackId, targetTrackId, placeBelow) => {
    const { tracks } = get();
    if (trackId === targetTrackId) return;
    const source = tracks.find(t => t.id === trackId);
    const target = tracks.find(t => t.id === targetTrackId);
    if (!source || !target || source.locked) return;

    // Only reorder within the same section: video among video, audio/midi among
    // the audio section. Track array order is the compositing z-order for video.
    const sectionOf = (t: TimelineTrack) => (t.type === 'video' ? 'video' : 'audio');
    if (sectionOf(source) !== sectionOf(target)) return;

    const without = tracks.filter(t => t.id !== trackId);
    const targetIndex = without.findIndex(t => t.id === targetTrackId);
    if (targetIndex < 0) return;
    const insertIndex = placeBelow ? targetIndex + 1 : targetIndex;
    without.splice(insertIndex, 0, source);
    set({ tracks: without });
  },

  renameTrack: (id, name) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(t => t.id === id ? { ...t, name } : t),
    });
  },

  setTrackLabelColor: (id, labelColor) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(t => t.id === id
        ? {
            ...t,
            labelColor: labelColor === 'none' ? undefined : labelColor,
          }
        : t),
    });
  },

  setTrackMuted: (id, muted) => {
    const { tracks } = get();
    const track = tracks.find(t => t.id === id);
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
    if (muted && track?.type === 'audio') {
      stopTimelineAudioPlayback();
    }
    // Audio changes don't affect video cache
  },

  setTrackVisible: (id, visible) => {
    const { tracks, invalidateCache, targetTrackIdByType } = get();
    const track = tracks.find(t => t.id === id);
    const nextState: Partial<ReturnType<typeof get>> = {
      tracks: tracks.map(t => t.id === id ? { ...t, visible } : t),
    };
    if (track?.type === 'video' && visible === false && targetTrackIdByType.video === id) {
      const nextTargetTrackIdByType = { ...targetTrackIdByType };
      delete nextTargetTrackIdByType.video;
      nextState.targetTrackIdByType = nextTargetTrackIdByType;
    }
    set(nextState);
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
    const { tracks, targetTrackIdByType } = get();
    const track = tracks.find(t => t.id === id);
    const nextState: Partial<ReturnType<typeof get>> = {
      tracks: tracks.map(t => t.id === id ? { ...t, locked } : t),
    };
    if (track && locked === true && targetTrackIdByType[track.type] === id) {
      const nextTargetTrackIdByType = { ...targetTrackIdByType };
      delete nextTargetTrackIdByType[track.type];
      nextState.targetTrackIdByType = nextTargetTrackIdByType;
    }
    set(nextState);
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

  updateRuntimeAudioMeter: (trackId, snapshot, masterSnapshot) => {
    // The runtime meter bus is the source of truth (silent suppression, master
    // aggregation and stale handling all live there). The store keeps only a
    // throttled diagnostic mirror so high-frequency meters do not re-render the
    // timeline while playback or panel resizing is active.
    runtimeAudioMeterBus.publishTrack(trackId, snapshot, masterSnapshot);
    scheduleRuntimeAudioMeterMirrorFlush(
      () => get().runtimeAudioMeters,
      (runtimeAudioMeters) => set({ runtimeAudioMeters }),
    );
  },

  updateRuntimeAudioMeters: (entries, masterSnapshot) => {
    if (entries.length === 0) return;
    runtimeAudioMeterBus.publishTracks(entries, masterSnapshot);
    scheduleRuntimeAudioMeterMirrorFlush(
      () => get().runtimeAudioMeters,
      (runtimeAudioMeters) => set({ runtimeAudioMeters }),
    );
  },

  clearStaleRuntimeAudioMeters: (maxAgeMs, now) => {
    runtimeAudioMeterBus.clearStale(maxAgeMs, now);
    if (maxAgeMs !== undefined && maxAgeMs <= 0) {
      cancelRuntimeAudioMeterMirrorFlush();
      flushRuntimeAudioMeterMirror(
        () => get().runtimeAudioMeters,
        (runtimeAudioMeters) => set({ runtimeAudioMeters }),
      );
      return;
    }
    scheduleRuntimeAudioMeterMirrorFlush(
      () => get().runtimeAudioMeters,
      (runtimeAudioMeters) => set({ runtimeAudioMeters }),
    );
  },

  setTrackHeight: (id, height) => {
    const { tracks } = get();
    const nextHeight = clampTrackHeight(height);
    const currentTrack = tracks.find(track => track.id === id);
    if (!currentTrack || currentTrack.height === nextHeight) return;

    set({
      tracks: tracks.map(t => t.id === id ? { ...t, height: nextHeight } : t),
    });
  },

  scaleTracksOfType: (type, delta, baselineHeight = MIN_TRACK_HEIGHT) => {
    const { tracks } = get();
    const tracksOfType = tracks.filter(t => t.type === type);

    if (tracksOfType.length === 0) return;

    const effectiveBaselineHeight = clampTrackHeight(
      Number.isFinite(baselineHeight) ? baselineHeight : MIN_TRACK_HEIGHT,
    );
    const getEffectiveHeight = (track: TimelineTrack) => Math.max(track.height, effectiveBaselineHeight);

    // Find the max height among tracks of this type
    const maxHeight = Math.max(...tracksOfType.map(getEffectiveHeight));

    // First call: sync all to max height (if they differ)
    // Subsequent calls: scale uniformly
    const allSameHeight = tracksOfType.every(t => getEffectiveHeight(t) === maxHeight);

    if (!allSameHeight && delta !== 0) {
      // Sync all to max height first
      if (tracksOfType.every(t => t.height === maxHeight)) return;
      set({
        tracks: tracks.map(t =>
          t.type === type && t.height !== maxHeight ? { ...t, height: maxHeight } : t
        ),
      });
    } else {
      // All already synced, scale uniformly
      const newHeight = clampTrackHeight(maxHeight + delta);
      if (tracksOfType.every(t => t.height === newHeight)) return;
      set({
        tracks: tracks.map(t =>
          t.type === type && t.height !== newHeight ? { ...t, height: newHeight } : t
        ),
      });
    }
  },

  setTargetTrack: (trackId) => {
    if (trackId === null) {
      set({ targetTrackIdByType: {} });
      return;
    }

    const { tracks, targetTrackIdByType } = get();
    const track = tracks.find(candidate => candidate.id === trackId);
    if (!track || track.locked === true) return;
    if (track.type === 'video' && track.visible === false) return;

    if (targetTrackIdByType[track.type] === track.id) {
      const nextTargetTrackIdByType = { ...targetTrackIdByType };
      delete nextTargetTrackIdByType[track.type];
      set({ targetTrackIdByType: nextTargetTrackIdByType });
      return;
    }

    set({
      targetTrackIdByType: {
        ...targetTrackIdByType,
        [track.type]: track.id,
      },
    });
  },

  clearTargetTracks: () => {
    set({ targetTrackIdByType: {} });
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

  setTrackMidiInstrument: (trackId, patch) => {
    const { tracks } = get();
    set({
      tracks: tracks.map(track => {
        if (track.id !== trackId || track.type !== 'midi') return track;
        const current: MidiInstrument = track.midiInstrument ?? createDefaultMidiInstrument();

        // Changing the instrument *kind* swaps to a clean default for that kind
        // (no stale adsr/waveform left on a GM instrument, etc.), then applies any
        // other provided fields.
        if (patch.kind && patch.kind !== current.kind) {
          const base = createDefaultMidiInstrument(patch.kind);
          return { ...track, midiInstrument: { ...base, ...patch } as MidiInstrument };
        }

        // Same kind: shallow-merge, and deep-merge the ADSR only for the simple
        // synth (GM has no envelope of its own).
        const merged = { ...current, ...patch } as MidiInstrument;
        if (merged.kind === 'simple-synth' && current.kind === 'simple-synth') {
          const patchAdsr = 'adsr' in patch ? patch.adsr : undefined;
          merged.adsr = { ...current.adsr, ...(patchAdsr ?? {}) };
        }
        return { ...track, midiInstrument: merged };
      }),
    });
  },
});
