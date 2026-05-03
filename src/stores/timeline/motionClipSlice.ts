import type { TimelineClip } from '../../types';
import type { MotionClipActions, SliceCreator } from './types';
import { createDefaultMotionLayerDefinition } from '../../types/motionDesign';
import { DEFAULT_TRANSFORM } from './constants';
import { generateMotionClipId } from './helpers/idGenerator';
import { engine } from '../../engine/WebGPUEngine';
import { layerBuilder } from '../../services/layerBuilder';
import { Logger } from '../../services/logger';

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
    engine.requestRender();

    log.debug('Created motion shape clip', { clipId, primitive: motion.shape?.primitive });
    return clipId;
  },

  addMotionNullClip: (trackId, startTime, duration = 5) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find((candidate) => candidate.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Motion null clips can only be added to video tracks');
      return null;
    }

    const motion = createDefaultMotionLayerDefinition('null');
    const clipId = generateMotionClipId('null');
    const nullClip: TimelineClip = {
      id: clipId,
      trackId,
      name: 'Null',
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
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };

    set({ clips: [...clips, nullClip] });
    updateDuration();
    invalidateCache();
    layerBuilder.invalidateCache();
    engine.requestRender();

    log.debug('Created motion null clip', { clipId });
    return clipId;
  },

  addMotionAdjustmentClip: (trackId, startTime, duration = 5) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find((candidate) => candidate.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Motion adjustment clips can only be added to video tracks');
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

    set({ clips: [...clips, adjustmentClip] });
    updateDuration();
    invalidateCache();
    layerBuilder.invalidateCache();
    engine.requestRender();

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
    engine.requestRender();

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
    engine.requestRender();
  },
});
