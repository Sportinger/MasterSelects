import type { SerializableClip, TimelineClip } from '../types';
import { Logger } from '../../../services/logger';
import { cloneClipNodeGraph } from '../../../services/nodeGraph';
import {
  createTimelineMathSceneCanvasRuntime,
  createTimelineSolidCanvasRuntime,
  createTimelineTextCanvasRuntime,
  createTimelineTransitionOverlayCanvasRuntime,
} from '../../../services/timeline/timelineGeneratedCanvasRuntime';
import type { useMediaStore } from '../../mediaStore';
import {
  createRestoredMotionClip,
  createRestoredPrimitiveMeshClip,
} from '../nestedRestore';
import { applyCommonRestoredClipFields, createLoadStateLiveInputClip } from './loadStateCommonClipRestore';

const log = Logger.create('Timeline');
type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

function activeCompositionDimensions(mediaStore: MediaStoreState): { width: number; height: number } {
  const activeComp = mediaStore.getActiveComposition?.();
  return {
    width: activeComp?.width || 1920,
    height: activeComp?.height || 1080,
  };
}

export async function createLoadStateGeneratedClip(params: {
  serializedClip: SerializableClip;
  mediaStore: MediaStoreState;
}): Promise<TimelineClip | undefined> {
  const { serializedClip, mediaStore } = params;
  const liveInputClip = createLoadStateLiveInputClip(serializedClip);
  if (liveInputClip) return liveInputClip;

  const motionClip = createRestoredMotionClip(serializedClip, serializedClip.id);
  if (motionClip) {
    log.debug('Restored motion clip', { clip: serializedClip.name, sourceType: serializedClip.sourceType });
    return motionClip;
  }

  if (serializedClip.sourceType === 'math-scene' && serializedClip.mathScene) {
    const dimensions = activeCompositionDimensions(mediaStore);
    const canvas = createTimelineMathSceneCanvasRuntime({
      mathScene: serializedClip.mathScene,
      duration: serializedClip.duration,
      dimensions,
    });

    log.debug('Restored math scene clip', { clip: serializedClip.name });
    return {
      id: serializedClip.id,
      trackId: serializedClip.trackId,
      name: serializedClip.name || 'Math Scene',
      file: new File([JSON.stringify(serializedClip.mathScene)], 'math-scene.json', { type: 'application/json' }),
      mediaFileId: serializedClip.mediaFileId || undefined,
      signalAssetId: serializedClip.signalAssetId,
      signalRefId: serializedClip.signalRefId,
      signalRenderAdapterId: serializedClip.signalRenderAdapterId,
      startTime: serializedClip.startTime,
      duration: serializedClip.duration,
      inPoint: serializedClip.inPoint,
      outPoint: serializedClip.outPoint,
      source: {
        type: 'math-scene',
        textCanvas: canvas,
        mediaFileId: serializedClip.mediaFileId || undefined,
        naturalDuration: serializedClip.duration,
      },
      mathScene: serializedClip.mathScene,
      ...applyCommonRestoredClipFields(serializedClip),
      isLoading: false,
    };
  }

  if (serializedClip.sourceType === 'text' && serializedClip.textProperties) {
    const dimensions = activeCompositionDimensions(mediaStore);
    const { canvas: textCanvas, textProperties } = await createTimelineTextCanvasRuntime({
      textProperties: serializedClip.textProperties,
      dimensions,
    });

    log.debug('Restored text clip', { clip: serializedClip.name });
    return {
      id: serializedClip.id,
      trackId: serializedClip.trackId,
      name: serializedClip.name,
      file: new File([], 'text-clip.txt', { type: 'text/plain' }),
      mediaFileId: serializedClip.mediaFileId || undefined,
      signalAssetId: serializedClip.signalAssetId,
      signalRefId: serializedClip.signalRefId,
      signalRenderAdapterId: serializedClip.signalRenderAdapterId,
      startTime: serializedClip.startTime,
      duration: serializedClip.duration,
      inPoint: serializedClip.inPoint,
      outPoint: serializedClip.outPoint,
      source: {
        type: 'text',
        textCanvas,
        mediaFileId: serializedClip.mediaFileId || undefined,
        naturalDuration: serializedClip.duration,
      },
      textProperties,
      ...applyCommonRestoredClipFields(serializedClip),
      isLoading: false,
    };
  }

  if (serializedClip.sourceType === 'solid' && serializedClip.solidColor) {
    const dimensions = activeCompositionDimensions(mediaStore);
    const canvas = createTimelineSolidCanvasRuntime({ color: serializedClip.solidColor, dimensions });

    log.debug('Restored solid clip', { clip: serializedClip.name, color: serializedClip.solidColor });
    return {
      id: serializedClip.id,
      trackId: serializedClip.trackId,
      name: serializedClip.name,
      file: new File([], 'solid-clip.dat', { type: 'application/octet-stream' }),
      mediaFileId: serializedClip.mediaFileId || undefined,
      signalAssetId: serializedClip.signalAssetId,
      signalRefId: serializedClip.signalRefId,
      signalRenderAdapterId: serializedClip.signalRenderAdapterId,
      startTime: serializedClip.startTime,
      duration: serializedClip.duration,
      inPoint: serializedClip.inPoint,
      outPoint: serializedClip.outPoint,
      source: {
        type: 'solid',
        textCanvas: canvas,
        mediaFileId: serializedClip.mediaFileId || undefined,
        naturalDuration: serializedClip.duration,
      },
      solidColor: serializedClip.solidColor,
      ...applyCommonRestoredClipFields(serializedClip),
      isLoading: false,
    };
  }

  if (serializedClip.sourceType === 'transition-overlay' && serializedClip.transitionOverlay) {
    const dimensions = activeCompositionDimensions(mediaStore);
    const canvas = createTimelineTransitionOverlayCanvasRuntime({
      overlay: serializedClip.transitionOverlay,
      dimensions,
    });

    log.debug('Restored transition overlay clip', { clip: serializedClip.name });
    return {
      id: serializedClip.id,
      trackId: serializedClip.trackId,
      name: serializedClip.name || 'Transition Overlay',
      file: new File([JSON.stringify(serializedClip.transitionOverlay)], 'transition-overlay.json', { type: 'application/json' }),
      mediaFileId: serializedClip.mediaFileId || undefined,
      signalAssetId: serializedClip.signalAssetId,
      signalRefId: serializedClip.signalRefId,
      signalRenderAdapterId: serializedClip.signalRenderAdapterId,
      startTime: serializedClip.startTime,
      duration: serializedClip.duration,
      inPoint: serializedClip.inPoint,
      outPoint: serializedClip.outPoint,
      source: {
        type: 'transition-overlay',
        textCanvas: canvas,
        mediaFileId: serializedClip.mediaFileId || undefined,
        naturalDuration: serializedClip.duration,
        transitionOverlay: structuredClone(serializedClip.transitionOverlay),
      },
      transitionOverlay: structuredClone(serializedClip.transitionOverlay),
      ...applyCommonRestoredClipFields(serializedClip),
      isLoading: false,
    };
  }

  if (serializedClip.sourceType === 'camera') {
    const { DEFAULT_SCENE_CAMERA_SETTINGS } = await import('../../mediaStore/types');
    log.debug('Restored camera clip', { clip: serializedClip.name });
    return {
      ...createTimelineControlClipBase(serializedClip, serializedClip.name || 'Camera', 'camera-clip.dat'),
      source: { type: 'camera', cameraSettings: serializedClip.cameraSettings || { ...DEFAULT_SCENE_CAMERA_SETTINGS }, mediaFileId: serializedClip.mediaFileId || undefined, naturalDuration: Number.MAX_SAFE_INTEGER },
    };
  }

  if (serializedClip.sourceType === 'light') {
    const { mergeLightClipSettings } = await import('../../../types/light');
    log.debug('Restored light clip', { clip: serializedClip.name });
    return {
      ...createTimelineControlClipBase(serializedClip, serializedClip.name || 'Light', 'light-clip.dat'),
      source: { type: 'light', lightSettings: mergeLightClipSettings(serializedClip.lightSettings), mediaFileId: serializedClip.mediaFileId || undefined, naturalDuration: Number.MAX_SAFE_INTEGER },
      is3D: serializedClip.is3D ?? true,
    };
  }

  if (serializedClip.sourceType === 'splat-effector') {
    const { DEFAULT_SPLAT_EFFECTOR_SETTINGS } = await import('../../../types/splatEffector');
    log.debug('Restored splat effector clip', { clip: serializedClip.name });
    return {
      ...createTimelineControlClipBase(serializedClip, serializedClip.name || '3D Effector', 'splat-effector.dat'),
      source: { type: 'splat-effector', splatEffectorSettings: serializedClip.splatEffectorSettings || { ...DEFAULT_SPLAT_EFFECTOR_SETTINGS }, mediaFileId: serializedClip.mediaFileId || undefined, naturalDuration: Number.MAX_SAFE_INTEGER },
      is3D: serializedClip.is3D ?? true,
    };
  }

  const meshClip = createRestoredPrimitiveMeshClip(serializedClip);
  if (meshClip) {
    log.debug('Restored mesh clip', { clip: serializedClip.name, meshType: serializedClip.meshType });
    return meshClip;
  }

  if (serializedClip.sourceType === 'midi') {
    log.debug('Restored MIDI clip', {
      clip: serializedClip.name,
      noteCount: serializedClip.midiData?.notes.length ?? 0,
    });
    return {
      id: serializedClip.id,
      trackId: serializedClip.trackId,
      name: serializedClip.name || 'MIDI Clip',
      file: new File([], 'midi-clip.dat', { type: 'application/octet-stream' }),
      startTime: serializedClip.startTime,
      duration: serializedClip.duration,
      inPoint: serializedClip.inPoint,
      outPoint: serializedClip.outPoint,
      source: {
        type: 'midi',
        naturalDuration: serializedClip.naturalDuration ?? serializedClip.duration,
      },
      transform: serializedClip.transform,
      effects: serializedClip.effects || [],
      colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
      nodeGraph: cloneClipNodeGraph(serializedClip.nodeGraph),
      audioState: serializedClip.audioState ? structuredClone(serializedClip.audioState) : undefined,
      midiData: serializedClip.midiData ? structuredClone(serializedClip.midiData) : { notes: [] },
      transitionSourceMap: serializedClip.transitionSourceMap ? structuredClone(serializedClip.transitionSourceMap) : undefined,
      transitionRecipeBlendWindows: serializedClip.transitionRecipeBlendWindows ? structuredClone(serializedClip.transitionRecipeBlendWindows) : undefined,
      masks: serializedClip.masks,
      isLoading: false,
    };
  }

  return undefined;
}

function createTimelineControlClipBase(
  serializedClip: SerializableClip,
  name: string,
  fileName: string,
): Omit<TimelineClip, 'source'> {
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name,
    file: new File([], fileName, { type: 'application/octet-stream' }),
    mediaFileId: serializedClip.mediaFileId || undefined,
    signalAssetId: serializedClip.signalAssetId,
    signalRefId: serializedClip.signalRefId,
    signalRenderAdapterId: serializedClip.signalRenderAdapterId,
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    ...applyCommonRestoredClipFields(serializedClip),
    isLoading: false,
  };
}
