import type { MathObject, MathParameter, MathSceneDefinition, TimelineClip } from '../../types';
import type { MathSceneClipActions, SliceCreator } from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { renderHostPort } from '../../services/render/renderHostPort';
import { layerBuilder } from '../../services/layerBuilder';
import { createDefaultMathScene } from '../../services/mathScene/defaultScene';
import { generateMathSceneClipId } from './helpers/idGenerator';
import { useMediaStore } from '../mediaStore';
import { Logger } from '../../services/logger';
import {
  createTimelineMathSceneCanvasRuntime,
  getTimelineGeneratedCanvasRuntime,
  renderTimelineMathSceneCanvasRuntime,
} from '../../services/timeline/timelineGeneratedCanvasRuntime';

const log = Logger.create('MathSceneClipSlice');

function renderMathClipNow(clip: TimelineClip, playheadPosition: number): void {
  if (clip.source?.type !== 'math-scene' || !clip.mathScene) return;
  const canvas = getTimelineGeneratedCanvasRuntime(clip);
  if (!canvas) return;
  const localTime = Math.max(0, Math.min(clip.duration, playheadPosition - clip.startTime));
  renderTimelineMathSceneCanvasRuntime({
    mathScene: clip.mathScene,
    currentCanvas: canvas,
    localTime,
    duration: clip.duration,
    dimensions: { width: canvas.width, height: canvas.height },
  });
  renderHostPort.updateCanvasTexture(canvas);
}

function rerenderAfterMathUpdate(clip: TimelineClip, playheadPosition: number): void {
  renderMathClipNow(clip, playheadPosition);
  try {
    layerBuilder.invalidateCache();
    const layers = layerBuilder.buildLayersFromStore();
    renderHostPort.render(layers);
  } catch (error) {
    log.debug('Direct render after math scene update failed', error);
    renderHostPort.requestRender();
  }
}

export const createMathSceneClipSlice: SliceCreator<MathSceneClipActions> = (set, get) => ({
  addMathSceneClip: (trackId, startTime, duration = 5, _skipMediaItem = false) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find(t => t.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Math scene clips can only be added to video tracks');
      return null;
    }

    const activeComp = useMediaStore.getState().getActiveComposition();
    const compWidth = activeComp?.width || 1920;
    const compHeight = activeComp?.height || 1080;
    const clipId = generateMathSceneClipId();
    const mathScene = createDefaultMathScene();
    const canvas = createTimelineMathSceneCanvasRuntime({
      mathScene,
      duration,
      dimensions: { width: compWidth, height: compHeight },
    });

    const mathClip: TimelineClip = {
      id: clipId,
      trackId,
      name: 'Math Scene',
      file: new File([JSON.stringify(mathScene)], 'math-scene.json', { type: 'application/json' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: {
        type: 'math-scene',
        textCanvas: canvas,
        naturalDuration: duration,
      },
      mathScene,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };

    set({ clips: [...clips, mathClip] });
    updateDuration();
    invalidateCache();
    renderHostPort.requestRender();

    log.debug('Created math scene clip', { clipId });
    return clipId;
  },

  updateMathScene: (clipId, updater) => {
    const { clips, invalidateCache, playheadPosition } = get();
    let updatedClip: TimelineClip | null = null;

    const nextClips = clips.map((clip) => {
      if (clip.id !== clipId || clip.source?.type !== 'math-scene' || !clip.mathScene) {
        return clip;
      }

      const nextScene = updater(structuredClone(clip.mathScene) as MathSceneDefinition);
      updatedClip = {
        ...clip,
        mathScene: nextScene,
        name: nextScene.objects.find((object) => object.type === 'function')?.name || 'Math Scene',
      };
      return updatedClip;
    });

    if (!updatedClip) return;

    set({ clips: nextClips });
    invalidateCache();
    rerenderAfterMathUpdate(updatedClip, playheadPosition);
  },

  addMathObject: (clipId, object) => {
    get().updateMathScene(clipId, (scene) => ({
      ...scene,
      objects: [...scene.objects, object],
    }));
  },

  updateMathObject: (clipId, objectId, patch) => {
    get().updateMathScene(clipId, (scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        object.id === objectId
          ? ({ ...object, ...patch } as MathObject)
          : object
      ),
    }));
  },

  removeMathObject: (clipId, objectId) => {
    get().updateMathScene(clipId, (scene) => ({
      ...scene,
      objects: scene.objects.filter((object) => object.id !== objectId),
    }));
  },

  updateMathParameter: (clipId, parameterId, patch) => {
    get().updateMathScene(clipId, (scene) => ({
      ...scene,
      parameters: scene.parameters.map((parameter) =>
        parameter.id === parameterId
          ? ({ ...parameter, ...patch } as MathParameter)
          : parameter
      ),
    }));
  },
});
