// Adapter over the editor's existing thumbnail and waveform caches for the phone timeline.
// The desktop timeline (and its warmup hooks) is not mounted on the phone, so this module warms
// the resources of the visible clips itself. Filmstrips are DOM images; waveforms use one small
// main-thread 2D canvas per visible audio tile portion (Linux/Mesa: viewport-bounded, software
// raster preference through the shared surface helper).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Logger } from '../../../services/logger';
import { thumbnailCacheService } from '../../../services/thumbnailCacheService';
import {
  getTimelineThumbnailSourceId,
  scheduleVisibleTimelineThumbnailDbWarmup,
  type VisibleTimelineThumbnailRef,
} from '../../../services/timeline/timelineThumbnailDbWarmup';
import { scheduleVisibleTimelineThumbnailGeneration } from '../../../services/timeline/timelineThumbnailGenerationWarmup';
import {
  collectTimelineWaveformArtifactRefs,
  warmTimelineWaveformArtifacts,
} from '../../../services/timeline/timelineWaveformArtifactWarmup';
import { useMediaStore } from '../../../stores/mediaStore';
import type { TimelineClip } from '../../../types/timeline';
import { prepareTimelineClipCanvasMainThreadSurface } from '../../timeline/utils/timelineClipCanvasMainThreadSurface';
import { getTimelineClipCanvasVisibleSourceRange } from '../../timeline/utils/timelineClipCanvasVisibleSourceRange';
import { getTimelineClipCanvasWaveformPyramidForClip } from '../../timeline/utils/timelineClipCanvasWaveformResource';
import { buildWaveformLod, normalizeWaveformColumnsForDisplay } from '../../timeline/utils/waveformLod';

const log = Logger.create('PhoneClipVisuals');

/** Raster surfaces never exceed this CSS width (backing <= 2x, well below 8192). */
export const PHONE_RASTER_MAX_CSS_WIDTH = 2048;
/** Filmstrip images per tile portion are bounded too. */
export const PHONE_MAX_THUMBNAILS_PER_TILE = 32;

export function isPhoneClipReversed(clip: Pick<TimelineClip, 'reversed' | 'speed'>): boolean {
  return Boolean(clip.reversed) !== ((clip.speed ?? 1) < 0);
}

/**
 * Warms thumbnails and waveform pyramids of the visible clips and returns a version number that
 * changes whenever one of them becomes available, so tiles re-read the caches.
 */
export function usePhoneClipVisualWarmup(visibleClips: readonly TimelineClip[]): number {
  const [version, setVersion] = useState(0);
  const files = useMediaStore((state) => state.files);
  const rafRef = useRef<number | null>(null);

  const thumbnailRefs = useMemo<VisibleTimelineThumbnailRef[]>(() => {
    const hashes = new Map(files.map((file) => [file.id, file.fileHash] as const));
    const refs = new Map<string, VisibleTimelineThumbnailRef>();
    for (const clip of visibleClips) {
      const mediaFileId = getTimelineThumbnailSourceId(clip);
      if (mediaFileId && !refs.has(mediaFileId)) refs.set(mediaFileId, { mediaFileId, fileHash: hashes.get(mediaFileId) });
    }
    return [...refs.values()];
  }, [files, visibleClips]);
  const thumbnailKey = thumbnailRefs.map((ref) => ref.mediaFileId).join('|');

  const waveformRefs = useMemo(() => collectTimelineWaveformArtifactRefs(visibleClips), [visibleClips]);
  const waveformKey = waveformRefs.join('|');

  const bump = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setVersion((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (thumbnailRefs.length === 0) return;
    const ids = new Set(thumbnailRefs.map((ref) => ref.mediaFileId));
    const unsubscribe = thumbnailCacheService.subscribe((mediaFileId) => {
      if (ids.has(mediaFileId)) bump();
    });
    const cancelDb = scheduleVisibleTimelineThumbnailDbWarmup(thumbnailRefs);
    const cancelGeneration = scheduleVisibleTimelineThumbnailGeneration(thumbnailRefs);
    return () => {
      unsubscribe();
      cancelDb();
      cancelGeneration();
    };
    // Keyed by the visible source ids, not by array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbnailKey]);

  useEffect(() => {
    if (waveformRefs.length === 0) return;
    const controller = new AbortController();
    void warmTimelineWaveformArtifacts(waveformRefs, {
      signal: controller.signal,
      onResult: (result) => {
        if (result.status === 'error') log.warn('Waveform pyramid failed to load', { refId: result.refId, error: result.error });
        if (result.pyramid) bump();
      },
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformKey]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return version;
}

/** Thumbnail URLs (or null while missing) for the rendered portion of a video clip. */
export function getPhoneClipThumbnails(
  clip: TimelineClip,
  visibleStartRatio: number,
  visibleEndRatio: number,
  count: number,
): (string | null)[] {
  const mediaFileId = getTimelineThumbnailSourceId(clip);
  if (!mediaFileId || count <= 0) return [];
  const reversed = isPhoneClipReversed(clip);
  const range = getTimelineClipCanvasVisibleSourceRange(clip, visibleStartRatio, visibleEndRatio, reversed);
  return thumbnailCacheService.getThumbnailsForRange(
    mediaFileId,
    range.inPoint,
    range.outPoint,
    Math.min(PHONE_MAX_THUMBNAILS_PER_TILE, Math.ceil(count)),
    reversed,
  );
}

export function phoneClipHasWaveformData(clip: TimelineClip): boolean {
  return (clip.waveform?.length ?? 0) > 0
    || Boolean(clip.waveformChannels?.some((channel) => channel.length > 0))
    || getTimelineClipCanvasWaveformPyramidForClip(clip, undefined) !== null;
}

/**
 * Paints the waveform of the rendered portion of an audio clip. Returns false when no cached
 * waveform data exists or the canvas cannot be prepared (caller shows a plain tile).
 */
export function drawPhoneClipWaveform(
  canvas: HTMLCanvasElement,
  clip: TimelineClip,
  visibleStartRatio: number,
  visibleEndRatio: number,
  cssWidth: number,
  height: number,
  color: string,
): boolean {
  const width = Math.max(1, Math.min(PHONE_RASTER_MAX_CSS_WIDTH, Math.round(cssWidth)));
  const surface = prepareTimelineClipCanvasMainThreadSurface(canvas, width, height, 0);
  if (!surface) {
    log.warn('Waveform canvas unavailable', { clipId: clip.id });
    return false;
  }
  const { ctx, dpr } = surface;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const reversed = isPhoneClipReversed(clip);
  const range = getTimelineClipCanvasVisibleSourceRange(clip, visibleStartRatio, visibleEndRatio, reversed);
  const lod = buildWaveformLod({
    waveform: clip.waveform,
    waveformChannels: clip.waveformChannels,
    pyramid: getTimelineClipCanvasWaveformPyramidForClip(clip, undefined),
    width,
    inPoint: range.inPoint,
    outPoint: range.outPoint,
    naturalDuration: clip.source?.naturalDuration ?? Math.max(clip.outPoint, range.outPoint),
  });
  if (!lod || lod.columns.length === 0) return false;
  const columns = normalizeWaveformColumnsForDisplay(lod.columns);

  ctx.scale(dpr, dpr);
  ctx.fillStyle = color;
  const mid = height / 2;
  const step = width / columns.length;
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[reversed ? columns.length - 1 - index : index];
    const amplitude = Math.max(0.5, Math.min(1, column.peak) * (mid - 1));
    ctx.fillRect(index * step, mid - amplitude, Math.max(1, step), amplitude * 2);
  }
  return true;
}
