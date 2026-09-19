import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useTrackingStore } from '../../stores/trackingStore';
import type { PlanarTrack } from '../../types/planarTracking';
import type { TrackingAsset } from '../../types/trackingAsset';
import { arePlanarTracksEqual } from './trackingAssetEquality';

interface LegacyTrackingClip {
  id: string;
  name?: string;
  mediaId?: string;
  mediaFileId?: string;
  source?: { mediaFileId?: string } | null;
  planarTracks?: readonly PlanarTrack[];
}

export interface LegacyTrackingComposition {
  id: string;
  clips?: readonly LegacyTrackingClip[];
  timelineData?: { clips: readonly LegacyTrackingClip[] };
}

export function createTrackingAssetId(sourceMediaId: string, trackId: string): string {
  return `tracking:${encodeURIComponent(sourceMediaId)}:${encodeURIComponent(trackId)}`;
}

export { cloneTrackingAssets, normalizeTrackingAssets } from '../../stores/trackingStore';

function sourceMediaIdForClip(clip: LegacyTrackingClip, track: PlanarTrack): string | undefined {
  return clip.mediaId || clip.mediaFileId || clip.source?.mediaFileId || track.sourceId || undefined;
}

function currentCompositions(): LegacyTrackingComposition[] {
  const media = useMediaStore.getState();
  const activeClips = useTimelineStore.getState().clips;
  return media.compositions.map((composition) => ({
    id: composition.id,
    clips: composition.id === media.activeCompositionId
      ? activeClips
      : composition.timelineData?.clips ?? [],
  }));
}

function clipsForComposition(composition: LegacyTrackingComposition): readonly LegacyTrackingClip[] {
  return composition.clips ?? composition.timelineData?.clips ?? [];
}

/** Populate canonical project assets for clip-owned tracks written by older project versions. */
export function ensureLegacyTrackingAssets(
  compositions: readonly LegacyTrackingComposition[] = currentCompositions(),
): TrackingAsset[] {
  const store = useTrackingStore.getState();
  const knownIds = new Set(store.assets.map((asset) => asset.id));
  const created: TrackingAsset[] = [];
  const createdAt = Date.now();

  for (const composition of compositions) {
    for (const clip of clipsForComposition(composition)) {
      for (const track of clip.planarTracks ?? []) {
        const sourceMediaId = sourceMediaIdForClip(clip, track);
        if (!sourceMediaId) continue;
        const id = createTrackingAssetId(sourceMediaId, track.id);
        if (knownIds.has(id)) continue;
        knownIds.add(id);
        const asset: TrackingAsset = {
          id,
          type: 'tracking',
          name: track.name || clip.name || 'Tracking',
          parentId: null,
          createdAt,
          sourceMediaId,
          sourceVideoClipId: clip.id,
          sourceCompositionId: composition.id,
          track,
          revision: 1,
        };
        store.upsertAsset(asset);
        const storedAsset = getTrackingAsset(id);
        if (storedAsset) created.push(storedAsset);
      }
    }
  }

  return created;
}

function findClip(clipId: string): { clip: LegacyTrackingClip; compositionId?: string } | undefined {
  const media = useMediaStore.getState();
  const activeClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
  if (activeClip) return { clip: activeClip, compositionId: media.activeCompositionId ?? undefined };
  for (const composition of media.compositions) {
    const clip = composition.timelineData?.clips.find((candidate) => candidate.id === clipId);
    if (clip) return { clip, compositionId: composition.id };
  }
  return undefined;
}

/** Publish the latest authored track while preserving the asset's stable identity and organization. */
const publishedTracks = new WeakMap<PlanarTrack, { assetId: string; revision: number }>();

export function publishTrackingAsset(clipId: string, track: PlanarTrack): TrackingAsset | undefined {
  const match = findClip(clipId);
  if (!match) return undefined;
  const sourceMediaId = sourceMediaIdForClip(match.clip, track);
  if (!sourceMediaId) return undefined;
  const id = createTrackingAssetId(sourceMediaId, track.id);
  const existing = getTrackingAsset(id);
  const memo = publishedTracks.get(track);
  if (
    existing
    && (
      (memo?.assetId === id && memo.revision === existing.revision)
      || arePlanarTracksEqual(existing.track, track)
    )
  ) {
    publishedTracks.set(track, { assetId: id, revision: existing.revision });
    return existing;
  }
  const asset: TrackingAsset = existing
    ? {
        ...existing,
        sourceVideoClipId: existing.sourceVideoClipId ?? clipId,
        sourceCompositionId: existing.sourceCompositionId ?? match.compositionId,
        track,
        revision: existing.revision + 1,
      }
    : {
        id,
        type: 'tracking',
        name: track.name || match.clip.name || 'Tracking',
        parentId: null,
        createdAt: Date.now(),
        sourceMediaId,
        sourceVideoClipId: clipId,
        sourceCompositionId: match.compositionId,
        track,
        revision: 1,
      };
  useTrackingStore.getState().upsertAsset(asset);
  const storedAsset = getTrackingAsset(id);
  if (storedAsset) publishedTracks.set(track, { assetId: id, revision: storedAsset.revision });
  return storedAsset;
}

export function getTrackingAsset(id: string): TrackingAsset | undefined {
  return useTrackingStore.getState().assets.find((asset) => asset.id === id);
}
