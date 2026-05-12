// Text clip actions slice - extracted from clipSlice

import type { MaskVertex, TextBoundsPath, TimelineClip, TextClipProperties } from '../../types';
import type { TextClipActions, SliceCreator } from './types';
import { DEFAULT_TRANSFORM, DEFAULT_TEXT_PROPERTIES, DEFAULT_TEXT_DURATION } from './constants';
import { textRenderer } from '../../services/textRenderer';
import {
  cloneTextBoundsPath,
  createTextBoundsFromRect,
  resolveTextBoundsPath,
  resolveTextBoxRect,
} from '../../services/textLayout';
import { googleFontsService } from '../../services/googleFontsService';
import { engine } from '../../engine/WebGPUEngine';
import { layerBuilder } from '../../services/layerBuilder';
import { generateTextClipId } from './helpers/idGenerator';
import { useMediaStore } from '../mediaStore';
import { Logger } from '../../services/logger';

const log = Logger.create('TextClipSlice');

function getActiveCompositionResolution(): { width: number; height: number } {
  const mediaState = useMediaStore.getState();
  const activeComposition = mediaState.compositions.find(composition => composition.id === mediaState.activeCompositionId);
  if (activeComposition?.width && activeComposition.height) {
    return {
      width: Math.max(1, Math.round(activeComposition.width)),
      height: Math.max(1, Math.round(activeComposition.height)),
    };
  }

  const engineResolution = engine.getOutputDimensions();
  if (engineResolution.width > 0 && engineResolution.height > 0) {
    return {
      width: Math.max(1, Math.round(engineResolution.width)),
      height: Math.max(1, Math.round(engineResolution.height)),
    };
  }

  return {
    width: 1920,
    height: 1080,
  };
}

function getInitialTextProperties(width: number, height: number): TextClipProperties {
  const base = { ...DEFAULT_TEXT_PROPERTIES };
  const box = resolveTextBoxRect(base, width, height);
  return {
    ...base,
    boxX: Math.round(box.x),
    boxY: Math.round(box.y),
    boxWidth: Math.round(box.width),
    boxHeight: Math.round(box.height),
    textBounds: createTextBoundsFromRect(box, width, height),
  };
}

function cloneTextBoundsWithUpdates(
  bounds: TextBoundsPath,
  updates: Partial<TextBoundsPath>,
): TextBoundsPath {
  return {
    ...bounds,
    ...updates,
    position: updates.position ? { ...updates.position } : { ...bounds.position },
    vertices: updates.vertices
      ? updates.vertices.map(vertex => ({
          ...vertex,
          handleIn: { ...vertex.handleIn },
          handleOut: { ...vertex.handleOut },
        }))
      : bounds.vertices.map(vertex => ({
          ...vertex,
          handleIn: { ...vertex.handleIn },
          handleOut: { ...vertex.handleOut },
        })),
  };
}

function rescaleTextBoundsPath(
  bounds: TextBoundsPath,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): TextBoundsPath {
  if (fromWidth === toWidth && fromHeight === toHeight) {
    return cloneTextBoundsPath(bounds);
  }

  const scaleX = fromWidth / Math.max(1, toWidth);
  const scaleY = fromHeight / Math.max(1, toHeight);

  return {
    ...bounds,
    position: {
      x: bounds.position.x * scaleX,
      y: bounds.position.y * scaleY,
    },
    vertices: bounds.vertices.map(vertex => ({
      ...vertex,
      x: vertex.x * scaleX,
      y: vertex.y * scaleY,
      handleIn: {
        x: vertex.handleIn.x * scaleX,
        y: vertex.handleIn.y * scaleY,
      },
      handleOut: {
        x: vertex.handleOut.x * scaleX,
        y: vertex.handleOut.y * scaleY,
      },
    })),
  };
}

function rescaleTextBoxFields(
  props: TextClipProperties,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): Partial<TextClipProperties> {
  if (fromWidth === toWidth && fromHeight === toHeight) return {};
  const scaleX = toWidth / Math.max(1, fromWidth);
  const scaleY = toHeight / Math.max(1, fromHeight);
  return {
    boxX: typeof props.boxX === 'number' ? props.boxX * scaleX : props.boxX,
    boxY: typeof props.boxY === 'number' ? props.boxY * scaleY : props.boxY,
    boxWidth: typeof props.boxWidth === 'number' ? props.boxWidth * scaleX : props.boxWidth,
    boxHeight: typeof props.boxHeight === 'number' ? props.boxHeight * scaleY : props.boxHeight,
  };
}

function invalidateTextGpuBindings(): void {
  const pipeline = (engine as unknown as {
    compositorPipeline?: { invalidateBindGroupCache: (layerId?: string) => void };
  }).compositorPipeline;
  pipeline?.invalidateBindGroupCache();
}

export const createTextClipSlice: SliceCreator<TextClipActions> = (set, get) => ({
  addTextClip: async (trackId, startTime, duration = DEFAULT_TEXT_DURATION, skipMediaItem = false) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find(t => t.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Text clips can only be added to video tracks');
      return null;
    }

    const clipId = generateTextClipId();
    await googleFontsService.loadFont(DEFAULT_TEXT_PROPERTIES.fontFamily, DEFAULT_TEXT_PROPERTIES.fontWeight);

    const resolution = getActiveCompositionResolution();
    const textProperties = getInitialTextProperties(resolution.width, resolution.height);
    const canvas = textRenderer.createCanvas(resolution.width, resolution.height);
    textRenderer.render(textProperties, canvas);

    const textClip: TimelineClip = {
      id: clipId,
      trackId,
      name: 'Text',
      file: new File([], 'text-clip.txt', { type: 'text/plain' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: { type: 'text', textCanvas: canvas, naturalDuration: duration },
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      textProperties,
      isLoading: false,
    };

    if (!skipMediaItem) {
      const mediaStore = useMediaStore.getState();
      const textFolderId = mediaStore.getOrCreateTextFolder();
      const mediaItemId = mediaStore.createTextItem('Text', textFolderId);
      textClip.mediaFileId = mediaItemId;
      textClip.source = { ...textClip.source!, mediaFileId: mediaItemId };
    }

    set({ clips: [...clips, textClip] });
    updateDuration();
    invalidateCache();

    log.debug('Created text clip', { clipId });
    return clipId;
  },

  updateTextProperties: (clipId, props) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip?.textProperties) return;

    let newProps: TextClipProperties = { ...clip.textProperties, ...props };

    const fallbackResolution = getActiveCompositionResolution();
    const currentCanvas = clip.source?.textCanvas;
    const sourceWidth = currentCanvas?.width || fallbackResolution.width;
    const sourceHeight = currentCanvas?.height || fallbackResolution.height;
    const renderWidth = fallbackResolution.width;
    const renderHeight = fallbackResolution.height;
    const shouldResizeCanvas = sourceWidth !== renderWidth || sourceHeight !== renderHeight;
    const propsBeforeCanvasResize = newProps;
    if (shouldResizeCanvas) {
      newProps = {
        ...newProps,
        ...rescaleTextBoxFields(newProps, sourceWidth, sourceHeight, renderWidth, renderHeight),
        textBounds: newProps.textBounds?.vertices?.length
          ? rescaleTextBoundsPath(newProps.textBounds, sourceWidth, sourceHeight, renderWidth, renderHeight)
          : newProps.textBounds,
      };
    }

    if (newProps.boxEnabled && !newProps.textBounds?.vertices?.length) {
      const legacyBox = resolveTextBoxRect(propsBeforeCanvasResize, sourceWidth, sourceHeight);
      const scaleX = renderWidth / Math.max(1, sourceWidth);
      const scaleY = renderHeight / Math.max(1, sourceHeight);
      const box = {
        x: legacyBox.x * scaleX,
        y: legacyBox.y * scaleY,
        width: legacyBox.width * scaleX,
        height: legacyBox.height * scaleY,
      };
      newProps = {
        ...newProps,
        textBounds: createTextBoundsFromRect(box, renderWidth, renderHeight),
      };
    }
    const canvas = currentCanvas &&
      currentCanvas.width === renderWidth &&
      currentCanvas.height === renderHeight
      ? currentCanvas
      : textRenderer.createCanvas(renderWidth, renderHeight);
    textRenderer.render(newProps, canvas);

    const texMgr = engine.getTextureManager();
    if (texMgr) {
      if (!texMgr.updateCanvasTexture(canvas)) {
        log.debug('Canvas texture not cached yet, will create on render');
      }
    }
    invalidateTextGpuBindings();

    set({
      clips: clips.map(c => c.id !== clipId ? c : {
        ...c,
        textProperties: newProps,
        source: { ...c.source!, textCanvas: canvas },
        name: newProps.text.substring(0, 20) || 'Text',
      }),
    });
    invalidateCache();

    try {
      layerBuilder.invalidateCache();
      const layers = layerBuilder.buildLayersFromStore();
      engine.render(layers);
    } catch (e) {
      log.debug('Direct render after text update failed', e);
    }

    if (props.fontFamily || props.fontWeight) {
      const fontFamily = props.fontFamily || newProps.fontFamily;
      const fontWeight = props.fontWeight || newProps.fontWeight;
      googleFontsService.loadFont(fontFamily, fontWeight).then(() => {
        const { clips: currentClips, invalidateCache: inv } = get();
        const currentClip = currentClips.find(cl => cl.id === clipId);
        if (!currentClip?.textProperties) return;

        const currentCanvas = currentClip.source?.textCanvas;
        if (currentCanvas) {
          textRenderer.render(currentClip.textProperties, currentCanvas);
          engine.getTextureManager()?.updateCanvasTexture(currentCanvas);
          invalidateTextGpuBindings();
        }
        inv();

        try {
          layerBuilder.invalidateCache();
          const layers = layerBuilder.buildLayersFromStore();
          engine.render(layers);
        } catch (e) {
          log.debug('Direct render after font load failed', e);
        }
      });
    }
  },

  updateTextBounds: (clipId, updates) => {
    const clip = get().clips.find(candidate => candidate.id === clipId);
    if (!clip?.textProperties) return;
    const sourceCanvas = clip.source?.textCanvas;
    const width = sourceCanvas?.width || getActiveCompositionResolution().width;
    const height = sourceCanvas?.height || getActiveCompositionResolution().height;
    const interpolatedBounds = get().getInterpolatedTextBounds(clip.id, get().playheadPosition - clip.startTime);
    const currentBounds = interpolatedBounds
      ? cloneTextBoundsPath(interpolatedBounds)
      : clip.textProperties.textBounds
      ? cloneTextBoundsPath(clip.textProperties.textBounds)
      : resolveTextBoundsPath(clip.textProperties, width, height);
    get().updateTextProperties(clipId, {
      boxEnabled: true,
      textBounds: cloneTextBoundsWithUpdates(currentBounds, updates),
    });
  },

  updateTextBoundsVertex: (clipId, vertexId, updates, recordKeyframe = true) => {
    const clip = get().clips.find(candidate => candidate.id === clipId);
    if (!clip?.textProperties) return;
    const sourceCanvas = clip.source?.textCanvas;
    const width = sourceCanvas?.width || getActiveCompositionResolution().width;
    const height = sourceCanvas?.height || getActiveCompositionResolution().height;
    const interpolatedBounds = get().getInterpolatedTextBounds(clip.id, get().playheadPosition - clip.startTime);
    const currentBounds = interpolatedBounds
      ? cloneTextBoundsPath(interpolatedBounds)
      : clip.textProperties.textBounds
      ? cloneTextBoundsPath(clip.textProperties.textBounds)
      : resolveTextBoundsPath(clip.textProperties, width, height);
    const nextBounds = cloneTextBoundsWithUpdates(currentBounds, {
      vertices: currentBounds.vertices.map(vertex => (
        vertex.id === vertexId
          ? {
              ...vertex,
              ...updates,
              handleIn: updates.handleIn ? { ...updates.handleIn } : { ...vertex.handleIn },
              handleOut: updates.handleOut ? { ...updates.handleOut } : { ...vertex.handleOut },
            }
          : vertex
      )),
    });
    get().updateTextProperties(clipId, {
      boxEnabled: true,
      textBounds: nextBounds,
    });
    if (recordKeyframe) {
      get().recordTextBoundsPathKeyframe(clipId);
    }
  },

  updateTextBoundsVertices: (clipId, vertexUpdates, recordKeyframe = true) => {
    const clip = get().clips.find(candidate => candidate.id === clipId);
    if (!clip?.textProperties) return;
    const sourceCanvas = clip.source?.textCanvas;
    const width = sourceCanvas?.width || getActiveCompositionResolution().width;
    const height = sourceCanvas?.height || getActiveCompositionResolution().height;
    const interpolatedBounds = get().getInterpolatedTextBounds(clip.id, get().playheadPosition - clip.startTime);
    const currentBounds = interpolatedBounds
      ? cloneTextBoundsPath(interpolatedBounds)
      : clip.textProperties.textBounds
      ? cloneTextBoundsPath(clip.textProperties.textBounds)
      : resolveTextBoundsPath(clip.textProperties, width, height);
    const updatesById = new Map(vertexUpdates.map(entry => [entry.vertexId, entry.updates]));
    const nextBounds = cloneTextBoundsWithUpdates(currentBounds, {
      vertices: currentBounds.vertices.map(vertex => {
        const updates = updatesById.get(vertex.id);
        if (!updates) return vertex;
        return {
          ...vertex,
          ...updates,
          handleIn: updates.handleIn ? { ...updates.handleIn } : { ...vertex.handleIn },
          handleOut: updates.handleOut ? { ...updates.handleOut } : { ...vertex.handleOut },
        } as MaskVertex;
      }),
    });
    get().updateTextProperties(clipId, {
      boxEnabled: true,
      textBounds: nextBounds,
    });
    if (recordKeyframe) {
      get().recordTextBoundsPathKeyframe(clipId);
    }
  },
});
