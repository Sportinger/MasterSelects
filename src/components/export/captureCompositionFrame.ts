import { ExportRenderSessionImpl } from '../../engine/export/ExportRenderSessionImpl';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { runStillImageExport } from './runners/stillImageExportRunner';

export function getCompositionFrameFilename(clipName: string | undefined, time: number): string {
  const baseName = (clipName ?? 'current-frame')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim() || 'current-frame';
  return `${baseName.slice(0, 80)}_frame_${Math.max(0, time).toFixed(2).replace('.', '_')}s.jpg`;
}

/** Render the requested timeline frame at composition resolution, independent of preview quality. */
export async function captureCompositionFrameJpegBlob(time: number): Promise<Blob | null> {
  const timeline = useTimelineStore.getState();
  if (timeline.isExporting) throw new Error('Another export is already running.');

  const media = useMediaStore.getState();
  const composition = media.getActiveComposition();
  if (!composition) throw new Error('Open a composition before exporting a frame.');
  const { width, height, frameRate: fps } = composition;
  const wasPlaying = timeline.isPlaying;
  if (wasPlaying) timeline.pause();
  timeline.startExport(time, time + 1 / Math.max(fps, 1));

  try {
    const result = await runStillImageExport({
      width, height, fps, exportTime: time,
      filename: 'current-frame', imageFormat: 'jpg', imageQuality: 0.92,
      selectedImageFormat: {
        id: 'jpg', label: 'JPG', mimeType: 'image/jpeg', supportsAlpha: false, lossless: false,
      },
      renderSessionRef: { current: null },
      createRenderSession: options => new ExportRenderSessionImpl({
        ...options, compositionId: composition.id,
      }),
    });
    return result?.blob ?? null;
  } finally {
    useTimelineStore.getState().endExport();
    if (wasPlaying && !useTimelineStore.getState().isPlaying
      && useMediaStore.getState().activeCompositionId === media.activeCompositionId) {
      await useTimelineStore.getState().play();
    }
  }
}
