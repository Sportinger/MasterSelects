import {
  createTimelineTextCanvasRuntime,
  markTimelineTextCanvasRuntimeShared,
} from '../../../services/timeline/timelineGeneratedCanvasRuntime';
import type { SerializableClip, TimelineClip } from '../types';
import { createRestoredNestedMediaClip } from '../nestedRestore';

type TextCanvasRuntime = Awaited<ReturnType<typeof createTimelineTextCanvasRuntime>>;
const MAX_SHARED_STATIC_TEXT_RUNTIMES = 128;
const sharedStaticTextRuntimes = new Map<string, Promise<TextCanvasRuntime>>();

function staticTextRuntimeKey(
  properties: NonNullable<SerializableClip['textProperties']>,
  dimensions: { width: number; height: number },
): string {
  return `${dimensions.width}x${dimensions.height}:${JSON.stringify(properties)}`;
}

function createInitialTextRuntime(
  serializedClip: SerializableClip,
  dimensions: { width: number; height: number },
): Promise<TextCanvasRuntime> {
  // A repeated nested-composition instance points at the same immutable
  // serialized text-properties object. Static text can therefore share its
  // initial raster. Dynamic/keyframed text keeps an independent canvas so a
  // later in-place render can never bleed into another timed instance.
  if (serializedClip.keyframes?.length || serializedClip.captionProperties) {
    return createTimelineTextCanvasRuntime({
      textProperties: serializedClip.textProperties!,
      dimensions,
    });
  }
  const properties = serializedClip.textProperties!;
  const key = staticTextRuntimeKey(properties, dimensions);
  const existing = sharedStaticTextRuntimes.get(key);
  if (existing) {
    // Refresh insertion order so frequently reused authoring templates stay hot.
    sharedStaticTextRuntimes.delete(key);
    sharedStaticTextRuntimes.set(key, existing);
    return existing;
  }
  const created = createTimelineTextCanvasRuntime({ textProperties: properties, dimensions })
    .then(runtime => {
      markTimelineTextCanvasRuntimeShared(runtime.canvas);
      return runtime;
    });
  sharedStaticTextRuntimes.set(key, created);
  while (sharedStaticTextRuntimes.size > MAX_SHARED_STATIC_TEXT_RUNTIMES) {
    const oldest = sharedStaticTextRuntimes.keys().next().value;
    if (oldest === undefined) break;
    sharedStaticTextRuntimes.delete(oldest);
  }
  void created.catch(() => sharedStaticTextRuntimes.delete(key));
  return created;
}

export async function appendNestedTextClip(
  output: TimelineClip[],
  serializedClip: SerializableClip,
  clipId: string,
  dimensions: { width: number; height: number },
): Promise<boolean> {
  if (serializedClip.sourceType !== 'text' || !serializedClip.textProperties) return false;
  const { canvas, textProperties: normalizedTextProperties } = await createInitialTextRuntime(
    serializedClip,
    dimensions,
  );
  // Properties remain independently editable even when the immutable initial
  // pixels are shared by repeated instances.
  const textProperties = structuredClone(normalizedTextProperties);
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
