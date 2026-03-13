import type { Composition } from '../stores/mediaStore/types';
import type { TimelineTrack } from '../types';
import type { PreviewPanelData, PreviewPanelSource } from '../types/dock';

export function createPreviewPanelSource(compositionId: string | null = null): PreviewPanelSource {
  return compositionId
    ? { type: 'composition', compositionId }
    : { type: 'activeComp' };
}

export function normalizePreviewPanelSource(data?: PreviewPanelData | null): PreviewPanelSource {
  if (data?.source?.type === 'activeComp') {
    return data.source;
  }

  if (data?.source?.type === 'composition') {
    return { type: 'composition', compositionId: data.source.compositionId };
  }

  if (data?.source?.type === 'layer-index') {
    return {
      type: 'layer-index',
      compositionId: data.source.compositionId ?? null,
      layerIndex: data.source.layerIndex,
    };
  }

  return createPreviewPanelSource(data?.compositionId ?? null);
}

export function createPreviewPanelDataPatch(
  source: PreviewPanelSource,
  extra: Omit<Partial<PreviewPanelData>, 'source' | 'compositionId'> = {},
): PreviewPanelData {
  return {
    ...extra,
    source,
    compositionId: source.type === 'composition' ? source.compositionId : null,
  };
}

export function isSamePreviewPanelSource(a: PreviewPanelSource, b: PreviewPanelSource): boolean {
  if (a.type !== b.type) return false;

  switch (a.type) {
    case 'activeComp':
      return true;
    case 'composition':
      return a.compositionId === (b as Extract<PreviewPanelSource, { type: 'composition' }>).compositionId;
    case 'layer-index':
      return (
        a.compositionId === (b as Extract<PreviewPanelSource, { type: 'layer-index' }>).compositionId &&
        a.layerIndex === (b as Extract<PreviewPanelSource, { type: 'layer-index' }>).layerIndex
      );
    default:
      return false;
  }
}

export function resolvePreviewSourceCompositionId(
  source: PreviewPanelSource,
  activeCompositionId: string | null,
): string | null {
  switch (source.type) {
    case 'activeComp':
      return activeCompositionId;
    case 'composition':
      return source.compositionId;
    case 'layer-index':
      return source.compositionId ?? activeCompositionId;
    default:
      return activeCompositionId;
  }
}

export function getCompositionVideoTracks(
  compositionId: string | null,
  compositions: Composition[],
  activeCompositionId: string | null,
  activeCompositionVideoTracks: TimelineTrack[],
): TimelineTrack[] {
  if (compositionId === null || compositionId === activeCompositionId) {
    return activeCompositionVideoTracks;
  }

  const composition = compositions.find((comp) => comp.id === compositionId);
  return composition?.timelineData?.tracks.filter((track) => track.type === 'video') ?? [];
}

export function getPreviewLayerLabel(layerIndex: number, trackName?: string | null): string {
  const trimmedName = trackName?.trim();
  return trimmedName
    ? `Layer ${layerIndex + 1} (${trimmedName})`
    : `Layer ${layerIndex + 1}`;
}

export function getPreviewSourceLabel(
  source: PreviewPanelSource,
  compositions: Composition[],
  activeCompositionId: string | null,
  activeCompositionVideoTracks: TimelineTrack[],
): string {
  switch (source.type) {
    case 'activeComp':
      return 'Active';
    case 'composition': {
      const composition = compositions.find((comp) => comp.id === source.compositionId);
      return composition?.name ?? 'Unknown';
    }
    case 'layer-index': {
      const compositionId = source.compositionId;
      const compositionName = compositionId === null
        ? 'Active'
        : compositions.find((comp) => comp.id === compositionId)?.name ?? 'Unknown';
      const videoTracks = getCompositionVideoTracks(
        compositionId,
        compositions,
        activeCompositionId,
        activeCompositionVideoTracks,
      );
      return `${compositionName} / ${getPreviewLayerLabel(source.layerIndex, videoTracks[source.layerIndex]?.name)}`;
    }
    default:
      return 'Preview';
  }
}
