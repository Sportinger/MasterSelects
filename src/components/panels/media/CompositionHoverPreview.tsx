import { useEffect, useMemo, useState } from 'react';

import { thumbnailRenderer } from '../../../services/thumbnailRenderer';
import type { Composition, MediaFile } from '../../../stores/mediaStore';
import type { SerializableClip, TimelineClip } from '../../../types/timeline';
import { FileTypeIcon } from './FileTypeIcon';

export interface CompositionHoverPreviewSource {
  clipId: string;
  inPoint: number;
  kind: 'image' | 'video';
  url: string;
}

interface CompositionHoverPreviewProps {
  activeCompositionId?: string | null;
  activeTimelineClips?: readonly TimelineClip[];
  composition: Composition;
  mediaFiles?: readonly MediaFile[];
}

const frameCache = new Map<string, Promise<string[]>>();
const MAX_CACHE_ENTRIES = 8;

function getPreviewRenderSize(composition: Composition): { width: number; height: number } {
  const aspect = Math.max(0.1, composition.width / Math.max(1, composition.height));
  if (aspect >= 232 / 160) {
    return { width: 232, height: Math.max(48, Math.round(232 / aspect)) };
  }
  return { width: Math.max(48, Math.round(160 * aspect)), height: 160 };
}

function getClipMediaFileId(clip: TimelineClip | SerializableClip): string | undefined {
  return 'source' in clip
    ? clip.source?.mediaFileId ?? clip.mediaFileId
    : clip.mediaFileId;
}

export function getCompositionHoverPreviewSources(
  composition: Composition,
  activeCompositionId: string | null | undefined,
  activeTimelineClips: readonly TimelineClip[],
  mediaFiles: readonly MediaFile[],
): CompositionHoverPreviewSource[] {
  const clips: readonly (TimelineClip | SerializableClip)[] = composition.id === activeCompositionId
    ? activeTimelineClips
    : composition.timelineData?.clips ?? [];
  const mediaById = new Map(mediaFiles.map((mediaFile) => [mediaFile.id, mediaFile]));

  return clips
    .filter((clip) => {
      const sourceType = 'source' in clip ? clip.source?.type : clip.sourceType;
      return sourceType === 'video' || sourceType === 'image';
    })
    .toSorted((left, right) => left.startTime - right.startTime)
    .flatMap((clip) => {
      const mediaFileId = getClipMediaFileId(clip);
      const mediaFile = mediaFileId ? mediaById.get(mediaFileId) : undefined;
      if (!mediaFile || (mediaFile.type !== 'video' && mediaFile.type !== 'image')) return [];
      const url = mediaFile.type === 'video'
        ? mediaFile.proxyVideoUrl || mediaFile.url
        : mediaFile.thumbnailUrl || mediaFile.url;
      if (!url) return [];
      return [{
        clipId: clip.id,
        inPoint: clip.inPoint,
        kind: mediaFile.type,
        url,
      } satisfies CompositionHoverPreviewSource];
    });
}

function getCompositionFrameCacheKey(composition: Composition): string {
  const clips = composition.timelineData?.clips ?? [];
  const visualSignature = clips.map((clip) => ({
    id: clip.id,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    mediaFileId: clip.mediaFileId,
    sourceType: clip.sourceType,
    compositionId: clip.compositionId,
    transform: clip.transform,
    effects: clip.effects,
    keyframes: clip.keyframes,
    masks: clip.masks,
  }));
  return `${composition.id}:${composition.width}x${composition.height}:${composition.duration}:${JSON.stringify(visualSignature)}`;
}

function getRenderedCompositionFrames(composition: Composition): Promise<string[]> {
  const key = getCompositionFrameCacheKey(composition);
  const cached = frameCache.get(key);
  if (cached) return cached;

  if (frameCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = frameCache.keys().next().value;
    if (oldestKey) frameCache.delete(oldestKey);
  }
  const size = getPreviewRenderSize(composition);
  const pending = thumbnailRenderer.generateCompositionThumbnails(
    composition.id,
    composition.duration,
    { count: 6, ...size },
  ).catch(() => {
    frameCache.delete(key);
    return [];
  });
  frameCache.set(key, pending);
  return pending;
}

export function CompositionHoverPreview({
  activeCompositionId,
  activeTimelineClips = [],
  composition,
  mediaFiles = [],
}: CompositionHoverPreviewProps) {
  const isActiveComposition = composition.id === activeCompositionId;
  const fallbackSources = useMemo(() => getCompositionHoverPreviewSources(
    composition,
    activeCompositionId,
    activeTimelineClips,
    mediaFiles,
  ), [activeCompositionId, activeTimelineClips, composition, mediaFiles]);
  const [renderedFrames, setRenderedFrames] = useState<string[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [loading, setLoading] = useState(!isActiveComposition);

  useEffect(() => {
    let cancelled = false;
    setRenderedFrames([]);
    setFrameIndex(0);
    if (isActiveComposition) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    void getRenderedCompositionFrames(composition).then((frames) => {
      if (cancelled) return;
      setRenderedFrames(frames);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [composition, isActiveComposition]);

  const frameCount = renderedFrames.length || fallbackSources.length;
  useEffect(() => {
    if (frameCount <= 1) return undefined;
    const intervalId = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frameCount);
    }, renderedFrames.length > 0 ? 650 : 1600);
    return () => window.clearInterval(intervalId);
  }, [frameCount, renderedFrames.length]);

  const renderedFrame = renderedFrames[frameIndex % Math.max(1, renderedFrames.length)];
  const source = fallbackSources[frameIndex % Math.max(1, fallbackSources.length)];

  return (
    <div className="composition-hover-preview" data-composition-id={composition.id}>
      {renderedFrame ? (
        <img src={renderedFrame} alt="" draggable={false} />
      ) : source?.kind === 'video' ? (
        <video
          key={`${source.clipId}:${source.url}`}
          src={source.url}
          autoPlay
          loop
          muted
          playsInline
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            video.currentTime = Math.min(Math.max(0, source.inPoint), Math.max(0, video.duration - 0.05));
            void video.play().catch(() => undefined);
          }}
        />
      ) : source ? (
        <img src={source.url} alt="" draggable={false} />
      ) : (
        <div className="composition-hover-preview-empty">
          <FileTypeIcon type="composition" large />
          <span>{composition.name}</span>
        </div>
      )}
      <div className="composition-hover-preview-meta">
        <span>{composition.name}</span>
        <small>{composition.width}×{composition.height} · {composition.frameRate} fps</small>
      </div>
      {loading && <div className="composition-hover-preview-loading" aria-label="Rendering composition preview" />}
    </div>
  );
}
