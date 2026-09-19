import type { Layer, LayerRenderData } from '../../core/types';
import type { TextureManager } from '../../texture/TextureManager';
import type { ScrubbingCache } from '../../texture/ScrubbingCache';
import { getCopiedHtmlVideoPreviewFrame } from '../htmlVideoPreviewFallback';
import type { HtmlVideoCollectRequest } from './htmlVideoCollector';
import { getSurfaceVideoFrameTime } from '../surfaceVideoFrame';

export function collectExportHtmlVideo(
  request: HtmlVideoCollectRequest,
  currentTime: number,
  targetTime: number
): LayerRenderData | null {
  const { layer, video, deps, videoKey, controller } = request;
  const frame = collectExportHtmlVideoFrame(
    layer, video, deps.textureManager, deps.scrubbingCache, false, currentTime, targetTime,
  );
  if (frame) {
    if (frame.isVideo) deps.setLastVideoTime(videoKey, currentTime);
    controller.setDecoder('HTMLVideo');
    controller.markHasVideo();
  }
  return frame;
}

/** Shared export source collection, without interactive scrub/hold policy. */
export function collectExportHtmlVideoFrame(
  layer: Layer,
  video: HTMLVideoElement,
  textureManager: TextureManager,
  scrubbingCache: ScrubbingCache | null,
  requireFreshCapture = false,
  currentTime = video.currentTime,
  targetTime = layer.source?.mediaTime ?? currentTime,
): LayerRenderData | null {
  const surfaceFrameLocked = layer.effects.some(effect => effect.surfaceTrack);
  const frameTime = surfaceFrameLocked ? getSurfaceVideoFrameTime(video) : currentTime;
  const copiedFrame = getCopiedHtmlVideoPreviewFrame(
    video,
    scrubbingCache,
    targetTime,
    layer.sourceClipId,
    layer.sourceClipId,
    false,
    requireFreshCapture,
  );
  if (copiedFrame) {
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: copiedFrame.view,
      sourceWidth: copiedFrame.width,
      sourceHeight: copiedFrame.height,
      displayedMediaTime: surfaceFrameLocked ? frameTime : copiedFrame.mediaTime ?? currentTime,
      targetMediaTime: targetTime,
      previewPath: 'copied-preview',
    };
  }

  const extTex = textureManager.importVideoTexture(video);
  if (!extTex) {
    return null;
  }

  return {
    layer,
    isVideo: true,
    externalTexture: extTex,
    textureView: null,
    sourceWidth: video.videoWidth,
    sourceHeight: video.videoHeight,
    displayedMediaTime: frameTime,
    targetMediaTime: targetTime,
    previewPath: 'live-import',
  };
}
