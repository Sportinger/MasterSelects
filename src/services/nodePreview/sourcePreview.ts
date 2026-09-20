import type { TimelineClip } from '../../types';
import { mediaRuntimeRegistry } from '../mediaRuntime/registry';
import type { PreviewFrame, PreviewRequest } from './previewTypes';

/** Borrow the presented frame. This viewer never seeks a decoder or creates a media element. */
export async function sourcePreview(request: PreviewRequest, clip: TimelineClip, sourceTime: number): Promise<PreviewFrame> {
  const source = clip.source;
  const provider = source?.runtimeSessionKey && source.runtimeSourceId ? mediaRuntimeRegistry.getRuntime(source.runtimeSourceId)?.getSessionFrameProvider(source.runtimeSessionKey) : null;
  const videoFrame = provider?.getCurrentFrame() ?? source?.webCodecsPlayer?.getCurrentFrame();
  const video = source?.videoElement;
  const image = source?.imageElement;
  const input = videoFrame ?? (video && video.readyState >= 2 ? video : null) ?? (image?.complete && image.naturalWidth ? image : null) ?? source?.textCanvas;
  const base = { key: request.key, revision: request.revision, time: request.time };
  if (!input) return { ...base, status: 'missing', label: 'No decoded frame' };
  const width = videoFrame?.displayWidth ?? video?.videoWidth ?? image?.naturalWidth ?? source?.textCanvas?.width ?? 1;
  const height = videoFrame?.displayHeight ?? video?.videoHeight ?? image?.naturalHeight ?? source?.textCanvas?.height ?? 1;
  const scale = Math.min(request.width / Math.max(1, width), request.height / Math.max(1, height));
  const presentedTime = videoFrame ? videoFrame.timestamp / 1e6 : video?.currentTime;
  const owned = videoFrame?.clone();
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(owned ?? input, { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: 'low' }); }
  finally { owned?.close(); }
  const stale = presentedTime !== undefined && Math.abs(presentedTime - sourceTime) > 0.12;
  return { ...base, bitmap, aspectRatio: width / height, status: stale ? 'stale' : 'live', label: stale ? `Held frame · ${presentedTime.toFixed(2)}s` : 'Source' };
}
