import type { TimelineRect } from '../geometry';

export type TimelinePaintPacketVersion = 1;

export type TimelinePaintFacetKind =
  | 'body'
  | 'label'
  | 'thumbnail-strip'
  | 'waveform'
  | 'spectrogram'
  | 'midi-preview'
  | 'composition-visuals'
  | 'passive-decorations'
  | 'trim-visuals'
  | 'fade-visuals';

export type TimelinePaintResourceKind =
  | 'thumbnail-bitmap'
  | 'waveform-columns'
  | 'spectrogram-raster'
  | 'midi-bars'
  | 'scene-cut-markers'
  | 'transcript-markers'
  | 'face-ranges'
  | 'face-markers'
  | 'analysis-overlay'
  | 'composition-segments'
  | 'fade-curve-points'
  | 'trim-ghosts';

export interface TimelinePaintResourceRef {
  id: string;
  kind: TimelinePaintResourceKind;
  ownerClipId: string;
  sourceRefId?: string;
  byteEstimate?: number;
  transferMode: 'none' | 'copy' | 'transfer';
}

export interface TimelinePaintFacet {
  id: string;
  kind: TimelinePaintFacetKind;
  clipId: string;
  rect?: TimelineRect;
  resourceRefIds: readonly string[];
  zIndex?: number;
}

export interface TimelinePaintPacketState {
  selected: boolean;
  hovered: boolean;
  muted: boolean;
  disabled: boolean;
  pending: boolean;
}

export interface TimelinePaintPacket {
  schemaVersion: TimelinePaintPacketVersion;
  clipId: string;
  trackId: string;
  geometryEpoch: string;
  bodyRect: TimelineRect;
  label: string;
  state: TimelinePaintPacketState;
  facets: readonly TimelinePaintFacet[];
  resourceRefIds: readonly string[];
}

export interface TimelinePaintResourceTable {
  schemaVersion: TimelinePaintPacketVersion;
  resources: readonly TimelinePaintResourceRef[];
}

export interface BuildTimelinePaintPacketFacetInput {
  id?: string;
  kind: TimelinePaintFacetKind;
  rect?: TimelineRect;
  resourceRefIds?: readonly string[];
  zIndex?: number;
}

export interface BuildTimelinePaintPacketInput {
  clipId: string;
  trackId: string;
  geometryEpoch: string;
  bodyRect: TimelineRect;
  label: string;
  state: TimelinePaintPacketState;
  facets: readonly BuildTimelinePaintPacketFacetInput[];
  resources?: readonly TimelinePaintResourceRef[];
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export function buildTimelinePaintPacket(input: BuildTimelinePaintPacketInput): TimelinePaintPacket {
  const facets = input.facets.map((facet, index): TimelinePaintFacet => ({
    id: facet.id ?? `${input.clipId}:${facet.kind}:${index}`,
    kind: facet.kind,
    clipId: input.clipId,
    rect: facet.rect,
    resourceRefIds: facet.resourceRefIds ?? [],
    zIndex: facet.zIndex,
  }));
  return {
    schemaVersion: 1,
    clipId: input.clipId,
    trackId: input.trackId,
    geometryEpoch: input.geometryEpoch,
    bodyRect: input.bodyRect,
    label: input.label,
    state: input.state,
    facets,
    resourceRefIds: unique([
      ...(input.resources?.map((resource) => resource.id) ?? []),
      ...facets.flatMap((facet) => facet.resourceRefIds),
    ]),
  };
}

export function buildTimelinePaintResourceTable(
  resources: readonly TimelinePaintResourceRef[],
): TimelinePaintResourceTable {
  return {
    schemaVersion: 1,
    resources,
  };
}

export const timelinePaintFacetKinds = [
  'body',
  'label',
  'thumbnail-strip',
  'waveform',
  'spectrogram',
  'midi-preview',
  'composition-visuals',
  'passive-decorations',
  'trim-visuals',
  'fade-visuals',
] as const satisfies readonly TimelinePaintFacetKind[];

export const timelinePaintResourceKinds = [
  'thumbnail-bitmap',
  'waveform-columns',
  'spectrogram-raster',
  'midi-bars',
  'scene-cut-markers',
  'transcript-markers',
  'face-ranges',
  'face-markers',
  'analysis-overlay',
  'composition-segments',
  'fade-curve-points',
  'trim-ghosts',
] as const satisfies readonly TimelinePaintResourceKind[];
