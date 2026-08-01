import type { TimelineClip } from '../../types';
import type { MotionClipActions, SliceCreator } from './types';
import { createDefaultMotionLayerDefinition } from '../../types/motionDesign';
import { DEFAULT_TRANSFORM } from './constants';
import { generateMotionClipId } from './helpers/idGenerator';
import { renderHostPort } from '../../services/render/renderHostPort';
import { layerBuilder } from '../../services/layerBuilder';
import { Logger } from '../../services/logger';
import { cancelHistoryBatch, endBatch, startBatch } from '../historyStore';
import { useMediaStore } from '../mediaStore';
import {
  applyTimelineMotionCreateNullPlan,
  applyTimelineMotionCreateNullAndParentSelectedPlan,
  planTimelineMotionCreateNull,
  planTimelineMotionCreateNullAndParentSelected,
} from '../../services/motionDesign/contracts/timelineStructureAdapter';
import {
  MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
  type MotionAdjustmentStackContract,
} from '../../services/motionDesign/adjustment/contracts';
import {
  createDefaultMotionAdjustmentLayer,
  planCreateMotionAdjustment,
} from '../../services/motionDesign/adjustment/mutationPlanner';

const log = Logger.create('MotionClipSlice');

function colorFromHex(hex: string | undefined): { r: number; g: number; b: number; a: number } {
  const fallback = { r: 1, g: 1, b: 1, a: 1 };
  if (!hex) return fallback;

  const normalized = hex.trim().replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return fallback;
  }

  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
    a: 1,
  };
}

function getActiveMotionCompositionId(): string {
  return useMediaStore.getState().activeCompositionId ?? 'timeline:active';
}

function createMotionNullTimelineClip(
  clipId: string,
  trackId: string,
  startTime: number,
  duration: number,
  name = 'Null',
): TimelineClip {
  const motion = createDefaultMotionLayerDefinition('null');
  return {
    id: clipId,
    trackId,
    name,
    file: new File([JSON.stringify(motion)], 'motion-null.msmotion', { type: 'application/json' }),
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: {
      type: 'motion-null',
      naturalDuration: duration,
    },
    motion,
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    isLoading: false,
  };
}

export const createMotionClipSlice: SliceCreator<MotionClipActions> = (set, get) => ({
  addMotionShapeClip: (trackId, startTime, options = {}) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find((candidate) => candidate.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Motion shape clips can only be added to video tracks');
      return null;
    }

    const duration = options.duration ?? 5;
    const motion = createDefaultMotionLayerDefinition('shape', {
      primitive: options.primitive,
      size: options.size,
      fillColor: options.fillColor,
    });
    const clipId = generateMotionClipId('shape');
    const shapeClip: TimelineClip = {
      id: clipId,
      trackId,
      name: options.name ?? 'Motion Shape',
      file: new File([JSON.stringify(motion)], 'motion-shape.msmotion', { type: 'application/json' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: {
        type: 'motion-shape',
        naturalDuration: duration,
      },
      motion,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };

    set({ clips: [...clips, shapeClip] });
    updateDuration();
    invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestRender();

    log.debug('Created motion shape clip', { clipId, primitive: motion.shape?.primitive });
    return clipId;
  },

  addMotionNullClip: (trackId, startTime, duration = 5, name = 'Null') => {
    const state = get();
    const track = state.tracks.find((candidate) => candidate.id === trackId);

    if (!track || track.type !== 'video' || track.locked === true) {
      log.warn('Motion null clips can only be added to unlocked video tracks', { trackId });
      return null;
    }
    const normalizedName = name.trim();
    if (
      !Number.isFinite(startTime)
      || startTime < 0
      || !Number.isFinite(duration)
      || duration < 0.001
      || !normalizedName
      || normalizedName.length > 120
    ) {
      log.warn('Motion null timing or name is invalid', { startTime, duration });
      return null;
    }

    const clipId = generateMotionClipId('null');
    const nullClip = createMotionNullTimelineClip(
      clipId,
      trackId,
      startTime,
      duration,
      normalizedName,
    );
    const compositionId = getActiveMotionCompositionId();
    const planned = planTimelineMotionCreateNull({
      compositionId,
      clips: state.clips,
      clipKeyframes: state.clipKeyframes,
      timelineTime: startTime,
      nullClip,
    });
    if (!planned.ok) {
      log.warn('Cannot create Motion null', {
        failures: planned.failures.map((failure) => failure.code),
      });
      return null;
    }
    const applied = applyTimelineMotionCreateNullPlan({
      compositionId,
      clips: state.clips,
      clipKeyframes: state.clipKeyframes,
      timelineTime: startTime,
      nullClip,
      plan: planned.plan,
    });
    if (!applied.ok) {
      log.warn('Motion null creation failed during atomic application', {
        message: applied.message,
      });
      return null;
    }

    const historyBatch = startBatch(planned.plan.history.label);
    try {
      set({ clips: applied.clips, clipKeyframes: applied.clipKeyframes });
      state.updateDuration();
      state.invalidateCache();
      layerBuilder.invalidateCache();
      renderHostPort.requestRender();
      if (historyBatch.opened) endBatch();
    } catch (error) {
      if (historyBatch.opened) cancelHistoryBatch();
      throw error;
    }

    log.debug('Created motion null clip', {
      clipId,
      graphRevision: planned.plan.apply.nextRevision,
    });
    return clipId;
  },

  addMotionNullAndParentSelected: (trackId, timelineTime, selectedClipIds, duration = 5) => {
    const state = get();
    const track = state.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.type !== 'video' || track.locked === true) {
      log.warn('Atomic Motion null parenting requires an unlocked video track', { trackId });
      return null;
    }
    const selection = [...(selectedClipIds ?? state.selectedClipIds)];
    if (selection.length === 0) {
      log.warn('Atomic Motion null parenting requires at least one selected clip');
      return null;
    }
    const selectedSet = new Set(selection);
    if (state.clips.some((clip) => (
      selectedSet.has(clip.id)
      && state.tracks.find((candidate) => candidate.id === clip.trackId)?.locked === true
    ))) {
      log.warn('Atomic Motion null parenting cannot mutate clips on locked tracks');
      return null;
    }

    const clipId = generateMotionClipId('null');
    const selectedClips = state.clips.filter((clip) => selectedSet.has(clip.id));
    const nullStartTime = selectedClips.reduce(
      (earliest, clip) => Math.min(earliest, clip.startTime),
      timelineTime,
    );
    const nullEndTime = selectedClips.reduce(
      (latest, clip) => Math.max(latest, clip.startTime + clip.duration),
      timelineTime + duration,
    );
    const nullClip = createMotionNullTimelineClip(
      clipId,
      trackId,
      nullStartTime,
      Math.max(0.001, nullEndTime - nullStartTime),
    );
    const compositionId = getActiveMotionCompositionId();
    const planned = planTimelineMotionCreateNullAndParentSelected({
      compositionId,
      clips: state.clips,
      clipKeyframes: state.clipKeyframes,
      timelineTime,
      nullClip,
      selectedClipIds: selection,
    });
    if (!planned.ok) {
      log.warn('Cannot create Motion null and parent selection', {
        failures: planned.failures.map((failure) => failure.code),
      });
      return null;
    }
    const applied = applyTimelineMotionCreateNullAndParentSelectedPlan({
      compositionId,
      clips: state.clips,
      clipKeyframes: state.clipKeyframes,
      timelineTime,
      nullClip,
      selectedClipIds: selection,
      plan: planned.plan,
    });
    if (!applied.ok) {
      log.warn('Motion null transaction failed during atomic application', {
        message: applied.message,
      });
      return null;
    }

    const historyBatch = startBatch(planned.plan.history.label);
    try {
      set({
        clips: applied.clips,
        clipKeyframes: applied.clipKeyframes,
        selectedClipIds: new Set([clipId]),
        primarySelectedClipId: clipId,
      });
      state.updateDuration();
      state.invalidateCache();
      layerBuilder.invalidateCache();
      renderHostPort.requestRender();
      if (historyBatch.opened) endBatch();
    } catch (error) {
      if (historyBatch.opened) cancelHistoryBatch();
      throw error;
    }
    log.debug('Created Motion null and parented selection', { clipId, selection });
    return clipId;
  },

  addMotionAdjustmentClip: (trackId, startTime, duration = 5) => {
    const state = get();
    const { clips, tracks, invalidateCache } = state;
    const track = tracks.find((candidate) => candidate.id === trackId);

    if (!track || track.type !== 'video' || track.locked === true) {
      log.warn('Motion adjustment clips can only be added to unlocked video tracks');
      return null;
    }
    if (
      !Number.isFinite(startTime)
      || startTime < 0
      || !Number.isFinite(duration)
      || duration < 0.001
    ) {
      log.warn('Motion adjustment timing is invalid', { startTime, duration });
      return null;
    }

    const motion = createDefaultMotionLayerDefinition('adjustment');
    const clipId = generateMotionClipId('adjustment');
    const adjustmentClip: TimelineClip = {
      id: clipId,
      trackId,
      name: 'Adjustment',
      file: new File([JSON.stringify(motion)], 'motion-adjustment.msmotion', { type: 'application/json' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: {
        type: 'motion-adjustment',
        naturalDuration: duration,
      },
      motion,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };

    const compositionId = getActiveMotionCompositionId();
    const emptyStack: MotionAdjustmentStackContract = {
      contractVersion: MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
      revision: state.timelineRevision,
      compositionId,
      evaluationTime: startTime,
      inputOrder: 'top-to-bottom',
      layers: [],
    };
    let historyLabel = 'Create Adjustment Layer';
    try {
      const planned = planCreateMotionAdjustment(emptyStack, {
        expectedRevision: emptyStack.revision,
        insertIndex: 0,
        layer: createDefaultMotionAdjustmentLayer(clipId, {
          start: startTime,
          end: startTime + duration,
        }),
      });
      historyLabel = planned.history.label;
    } catch (error) {
      log.warn('Motion adjustment failed frozen contract admission', {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    const historyBatch = startBatch(historyLabel);
    try {
      const nextClips = [...clips, adjustmentClip];
      set({
        clips: nextClips,
        ...(state.durationLocked
          ? {}
          : {
              duration: Math.max(
                60,
                Math.max(...nextClips.map((clip) => clip.startTime + clip.duration)) + 10,
              ),
            }),
      });
      invalidateCache();
      layerBuilder.invalidateCache();
      renderHostPort.requestRender();
      if (historyBatch.opened) endBatch();
    } catch (error) {
      if (historyBatch.opened) cancelHistoryBatch();
      throw error;
    }

    log.debug('Created motion adjustment clip', { clipId });
    return clipId;
  },

  convertSolidToMotionShape: (clipId) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);

    if (!clip || clip.source?.type !== 'solid') {
      log.warn('Only solid clips can be converted to motion shapes', { clipId });
      return null;
    }

    const motion = createDefaultMotionLayerDefinition('shape', {
      primitive: 'rectangle',
      fillColor: colorFromHex(clip.solidColor),
    });
    const convertedClip: TimelineClip = {
      ...clip,
      name: clip.name || 'Motion Shape',
      file: new File([JSON.stringify(motion)], 'motion-shape.msmotion', { type: 'application/json' }),
      source: {
        ...(clip.source ?? {}),
        type: 'motion-shape',
        textCanvas: undefined,
        naturalDuration: clip.duration,
      },
      motion,
      solidColor: undefined,
      isLoading: false,
    };

    set({
      clips: clips.map((candidate) => candidate.id === clipId ? convertedClip : candidate),
    });
    invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestRender();

    log.debug('Converted solid clip to motion shape', { clipId });
    return clipId;
  },

  updateMotionLayer: (clipId, updater) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip?.motion) return;

    set({
      clips: clips.map((candidate) => {
        if (candidate.id !== clipId || !candidate.motion) {
          return candidate;
        }
        return { ...candidate, motion: updater(structuredClone(candidate.motion)) };
      }),
    });
    invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestRender();
  },
});
