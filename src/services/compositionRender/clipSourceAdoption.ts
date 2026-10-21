// Clip sources that need no media file load when a composition is prepared:
// runtime surfaces the active timeline already holds (live inputs, video and
// image elements, generated canvases) and canvases generated from the
// serialized clip data of an inactive composition (text, math scene,
// transition overlay, solid). File-backed sources go through sourceLoaders.

import type { MediaFile } from '../../stores/mediaStore/types';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import type { TimelineSourceType } from '../../types/timelineSource';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { liveInputRuntime } from '../mediaRuntime/liveInputRuntime';
import { renderFramedTextCanvas } from '../text/textCanvasFrame';
import { textRenderer } from '../textRenderer';
import {
  createTimelineSolidCanvasRuntime,
  createTimelineTransitionOverlayCanvasRuntime,
} from '../timeline/timelineGeneratedCanvasRuntime';
import { reportCompositionSource } from './sourceLifecycle';
import { loadImageSource } from './sourceLoaders';
import { buildSerializableMathSceneClip, getBackgroundSessionKey, getTimelineImageSource } from './sourceSetup';
import type { CompositionClipSourceEntry, CompositionSources } from './sourceTypes';

type ClipSourceType = TimelineSourceType | undefined;
type SourceCurrentCheck = (sources: CompositionSources) => boolean;
interface CompositionFrame { width: number; height: number; }

const isCanvasSourceType = (sourceType: ClipSourceType) => sourceType === 'text' || sourceType === 'solid'
  || sourceType === 'math-scene' || sourceType === 'transition-overlay' || isVectorAnimationSourceType(sourceType);

/** Live inputs have no File/Blob: resolve their running presentation surface. */
function adoptLiveInput(sources: CompositionSources, clip: TimelineClip, liveInputId: string): boolean {
  const fallbackVideo = liveInputRuntime.getVideoElement(liveInputId, true);
  const presentationVideo = liveInputRuntime.getPresentationVideoElement(liveInputId) ?? fallbackVideo;
  if (!presentationVideo) return false;
  const presentation = liveInputRuntime.getVideoPresentation(liveInputId);
  sources.clipSources.set(clip.id, {
    clipId: clip.id,
    type: 'video',
    videoElement: presentationVideo,
    canvasElement: liveInputRuntime.getPresentationCanvas(liveInputId) ?? undefined,
    isLiveInput: true,
    intrinsicWidth: presentation?.width,
    intrinsicHeight: presentation?.height,
    naturalDuration: clip.duration,
  });
  return true;
}

/**
 * Takes over a source the active timeline already holds, or starts loading its image. Returns false when the
 * clip still needs the file-backed path (or has nothing to show). A live input is resolved before the regular
 * file path so a later composition rebuild cannot discard a still-running stream.
 */
export function adoptActiveTimelineClipSource(
  sources: CompositionSources,
  clip: TimelineClip,
  sourceType: ClipSourceType,
  mediaFileId: string | undefined,
  mediaFile: MediaFile | undefined,
  loadPromises: Promise<void>[],
  isSourcesCurrent: SourceCurrentCheck,
): boolean {
  const source = clip.source;
  if (!source) return false;
  const { compositionId } = sources;
  if (sourceType === 'video' && source.liveInputId && adoptLiveInput(sources, clip, source.liveInputId)) return true;

  if (sourceType === 'video' && (source.videoElement || source.webCodecsPlayer || source.runtimeSourceId)) {
    sources.clipSources.set(clip.id, {
      clipId: clip.id,
      type: 'video',
      videoElement: source.videoElement,
      webCodecsPlayer: source.webCodecsPlayer,
      file: clip.file,
      naturalDuration: source.naturalDuration || source.videoElement?.duration || 0,
      runtimeSourceId: source.runtimeSourceId,
      runtimeSessionKey: getBackgroundSessionKey(compositionId, clip.id, source),
    });
    return true;
  }

  if (sourceType === 'image' && source.imageElement) {
    sources.clipSources.set(clip.id, {
      clipId: clip.id,
      type: 'image',
      imageElement: source.imageElement,
      file: clip.file,
      naturalDuration: source.naturalDuration || 5,
      runtimeSourceId: source.runtimeSourceId,
      runtimeSessionKey: getBackgroundSessionKey(compositionId, clip.id, source),
    });
    return true;
  }

  if (sourceType === 'image') {
    const imageSource = getTimelineImageSource(clip, mediaFile);
    if (imageSource) {
      loadPromises.push(loadImageSource(sources, {
        id: clip.id,
        name: clip.name,
        mediaFileId,
        naturalDuration: source.naturalDuration || clip.duration,
      }, imageSource, isSourcesCurrent));
      return true;
    }
  }

  if (isCanvasSourceType(sourceType) && source.textCanvas) {
    sources.clipSources.set(clip.id, {
      clipId: clip.id,
      type: sourceType,
      textCanvas: source.textCanvas,
      naturalDuration: clip.duration,
      ...(isVectorAnimationSourceType(sourceType) ? { lottieClip: clip } : {}),
      ...(sourceType === 'math-scene' ? { mathSceneClip: clip } : {}),
    });
    return true;
  }
  return false;
}

function addGeneratedEntry(sources: CompositionSources, entry: CompositionClipSourceEntry): void {
  sources.clipSources.set(entry.clipId, entry);
  reportCompositionSource(sources.compositionId, entry);
}

/** Generates the canvas of a media-less clip from its serialized data (an inactive composition). */
export function createSerializedCanvasSource(
  sources: CompositionSources,
  frame: CompositionFrame,
  clip: SerializableClip,
  sourceType: ClipSourceType,
): void {
  const { compositionId } = sources;
  const base = { clipId: clip.id, compositionId, naturalDuration: clip.duration };
  const dimensions = { width: frame.width, height: frame.height };

  if (sourceType === 'text' && clip.textProperties) {
    // Every prepared text clip needs its own backing canvas. Rendering
    // without a target uses TextRenderer's shared scratch canvas, so the
    // next text clip overwrites the previous one in independent previews.
    const frameWidth = Math.max(1, Math.round(frame.width));
    const frameHeight = Math.max(1, Math.round(frame.height));
    const textCanvas = textRenderer.createCanvas(frameWidth, frameHeight);
    if (clip.captionProperties) textRenderer.render(clip.textProperties, textCanvas);
    else renderFramedTextCanvas(clip.textProperties, textCanvas, frameWidth, frameHeight);
    if (textCanvas) addGeneratedEntry(sources, { ...base, type: 'text', textCanvas });
  }

  if (sourceType === 'math-scene' && clip.mathScene) {
    const mathSceneClip = buildSerializableMathSceneClip(clip);
    if (mathSceneClip?.source?.textCanvas) {
      addGeneratedEntry(sources, { ...base, type: 'math-scene', textCanvas: mathSceneClip.source.textCanvas, mathSceneClip });
    }
  }

  if (sourceType === 'transition-overlay' && clip.transitionOverlay) {
    const textCanvas = createTimelineTransitionOverlayCanvasRuntime({ overlay: clip.transitionOverlay, dimensions });
    addGeneratedEntry(sources, { ...base, type: 'transition-overlay', textCanvas });
  }

  if (sourceType === 'solid' && clip.solidColor) {
    const textCanvas = createTimelineSolidCanvasRuntime({ color: clip.solidColor, dimensions });
    addGeneratedEntry(sources, { ...base, type: 'solid', textCanvas });
  }
}
