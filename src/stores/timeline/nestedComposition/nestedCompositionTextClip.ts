import { createTimelineTextCanvasRuntime } from '../../../services/timeline/timelineGeneratedCanvasRuntime';
import type { SerializableClip, TimelineClip } from '../types';
import { createRestoredNestedMediaClip } from '../nestedRestore';

export async function appendNestedTextClip(
  output: TimelineClip[],
  serializedClip: SerializableClip,
  clipId: string,
  dimensions: { width: number; height: number },
): Promise<boolean> {
  if (serializedClip.sourceType !== 'text' || !serializedClip.textProperties) return false;
  const { canvas, textProperties } = await createTimelineTextCanvasRuntime({
    textProperties: serializedClip.textProperties,
    dimensions,
  });
  output.push({
    ...createRestoredNestedMediaClip(serializedClip, {
      clipId,
      file: new File([], serializedClip.name || 'text'),
      source: {
        type: 'text',
        textCanvas: canvas,
        mediaFileId: serializedClip.mediaFileId || undefined,
        naturalDuration: serializedClip.duration,
      },
      isLoading: false,
    }),
    textProperties,
  });
  return true;
}
