import type { LayerRenderData } from '../../core/types';
import { getCopiedHtmlVideoPreviewFrame } from '../htmlVideoPreviewFallback';
import type { HtmlVideoCollectRequest } from './htmlVideoCollector';
import { getSurfaceVideoFrameTime } from '../surfaceVideoFrame';

export function collectExportHtmlVideo(
  request: HtmlVideoCollectRequest,
  currentTime: number,
  targetTime: number
): LayerRenderData | null {
  const { layer, video, deps, videoKey, controller } = request;
  const surfaceFrameLocked = layer.effects.some(effect => effect.surfaceTrack);
  const frameTime = surfaceFrameLocked ? getSurfaceVideoFrameTime(video) : currentTime;
  const copiedFrame = getCopiedHtmlVideoPreviewFrame(
    video,
    deps.scrubbingCache,
    targetTime,
    layer.sourceClipId,
    layer.sourceClipId,
  );
  if (copiedFrame) {
    controller.setDecoder('HTMLVideo');
    controller.markHasVideo();
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

  const extTex = deps.textureManager.importVideoTexture(video);
  if (!extTex) {
    return null;
  }

  deps.setLastVideoTime(videoKey, currentTime);
  controller.setDecoder('HTMLVideo');
  controller.markHasVideo();
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
