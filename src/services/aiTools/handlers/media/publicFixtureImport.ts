import { useMediaStore } from '../../../../stores/mediaStore';
import type { MediaFile } from '../../../../stores/mediaStore/types';
import { useTimelineStore } from '../../../../stores/timeline';
import {
  createVideoElement,
  initWebCodecsPlayer,
  waitForVideoMetadata,
  waitForVideoReady,
} from '../../../../stores/timeline/helpers/webCodecsHelpers';
import { flags } from '../../../../engine/featureFlags';

export interface ImportedPublicVideoFixture {
  readonly id: string;
  readonly name: string;
  readonly duration?: number;
  readonly source: File;
}

export async function importPublicVideoFixtureAsset(url: string, name: string): Promise<ImportedPublicVideoFixture> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch video fixture asset ${url}: ${response.status}`);
  }
  const blob = await response.blob();
  const file = new File([blob], name, { type: blob.type || 'video/webm' });
  const imported = await useMediaStore.getState().importFile(file);
  if (!imported || !('type' in imported) || imported.type !== 'video' || !('file' in imported)) {
    throw new Error(`Fixture asset ${name} did not import as a video media file.`);
  }
  const media = imported as MediaFile;
  if (!media.file) {
    throw new Error(`Fixture asset ${name} imported without a runtime media source.`);
  }
  return {
    id: media.id,
    name: media.name,
    duration: media.duration,
    source: media.file,
  };
}

export async function attachHtmlVideoRuntimeSourceToClip(params: {
  readonly clipId: string;
  readonly file: File;
  readonly mediaId: string;
  readonly fallbackDurationSeconds: number;
}): Promise<{
  readonly naturalDuration: number;
  readonly readyState: number;
  readonly width: number;
  readonly height: number;
}> {
  const video = createVideoElement(params.file);
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try {
    video.load();
  } catch {
    // Browser media elements may reject load() while metadata is already queued.
  }
  await waitForVideoMetadata(video, 8000);
  await waitForVideoReady(video, 3000);

  const naturalDuration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : params.fallbackDurationSeconds;

  useTimelineStore.getState().updateClip(params.clipId, {
    duration: naturalDuration,
    outPoint: naturalDuration,
    source: {
      type: 'video',
      naturalDuration,
      mediaFileId: params.mediaId,
      videoElement: video,
    },
    isLoading: false,
  });

  return {
    naturalDuration,
    readyState: video.readyState,
    width: video.videoWidth || 0,
    height: video.videoHeight || 0,
  };
}

export function enableWebCodecsFixtureFlags(): () => void {
  const previousUseFullWebCodecsPlayback = flags.useFullWebCodecsPlayback;
  const previousDisableHtmlPreviewFallback = flags.disableHtmlPreviewFallback;
  flags.useFullWebCodecsPlayback = true;
  flags.disableHtmlPreviewFallback = true;
  return () => {
    flags.useFullWebCodecsPlayback = previousUseFullWebCodecsPlayback;
    flags.disableHtmlPreviewFallback = previousDisableHtmlPreviewFallback;
  };
}

async function waitForWebCodecsFrame(
  player: Awaited<ReturnType<typeof initWebCodecsPlayer>>,
  timeoutMs: number,
): Promise<void> {
  if (!player || player.hasFrame?.()) {
    return;
  }

  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    const poll = () => {
      if (player.hasFrame?.() || performance.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(poll, 16);
    };
    poll();
  });
}

export async function attachWebCodecsRuntimeSourceToClip(params: {
  readonly clipId: string;
  readonly file: File;
  readonly mediaId: string;
  readonly fallbackDurationSeconds: number;
  readonly fileName?: string;
  readonly includeHtmlVideoElement?: boolean;
  readonly prepareSequentialExport?: boolean;
}): Promise<{
  readonly naturalDuration: number;
  readonly readyState: number;
  readonly width: number;
  readonly height: number;
  readonly webCodecsReady: boolean;
  readonly webCodecsFullMode: boolean;
  readonly webCodecsHasFrame: boolean;
  readonly webCodecsWidth: number;
  readonly webCodecsHeight: number;
}> {
  const video = createVideoElement(params.file);
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try {
    video.load();
  } catch {
    // Browser media elements may reject load() while metadata is already queued.
  }
  await waitForVideoMetadata(video, 8000);
  await waitForVideoReady(video, 3000);

  const naturalDuration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : params.fallbackDurationSeconds;
  const webCodecsPlayer = await initWebCodecsPlayer(video, params.fileName ?? params.file.name, params.file);
  if (!webCodecsPlayer || !webCodecsPlayer.isFullMode?.()) {
    webCodecsPlayer?.destroy?.();
    throw new Error('WebCodecs full-mode provider did not initialize for the golden fixture.');
  }
  if (params.prepareSequentialExport !== false) {
    await webCodecsPlayer.prepareForSequentialExport(0);
  } else {
    await webCodecsPlayer.seekAsync(0);
  }
  await waitForWebCodecsFrame(webCodecsPlayer, 2000);

  useTimelineStore.getState().updateClip(params.clipId, {
    duration: naturalDuration,
    outPoint: naturalDuration,
    source: {
      type: 'video',
      naturalDuration,
      mediaFileId: params.mediaId,
      ...(params.includeHtmlVideoElement === true ? { videoElement: video } : {}),
      webCodecsPlayer,
    },
    isLoading: false,
  });

  return {
    naturalDuration,
    readyState: video.readyState,
    width: video.videoWidth || 0,
    height: video.videoHeight || 0,
    webCodecsReady: webCodecsPlayer.ready === true,
    webCodecsFullMode: webCodecsPlayer.isFullMode?.() === true,
    webCodecsHasFrame: webCodecsPlayer.hasFrame?.() === true,
    webCodecsWidth: webCodecsPlayer.width || 0,
    webCodecsHeight: webCodecsPlayer.height || 0,
  };
}
