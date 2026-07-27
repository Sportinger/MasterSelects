export type CanvasClipFieldDisposition =
  | 'paint-packet'
  | 'projection'
  | 'geometry'
  | 'resource-table'
  | 'interaction-shell'
  | 'runtime-provider'
  | 'delete';

export type CanvasClipFieldRuntimeBoundary =
  | 'plain-data'
  | 'resource-ref'
  | 'runtime-only';

export interface CanvasClipFieldCoverageEntry {
  field: string;
  disposition: CanvasClipFieldDisposition;
  replacement: string;
  runtimeBoundary: CanvasClipFieldRuntimeBoundary;
  deleteByGate?: string;
}

export const canvasClipFieldCoverage = [
  { field: 'id', disposition: 'paint-packet', replacement: 'TimelinePaintPacket.clipId', runtimeBoundary: 'plain-data' },
  { field: 'trackId', disposition: 'paint-packet', replacement: 'TimelinePaintPacket.trackId', runtimeBoundary: 'plain-data' },
  { field: 'trackType', disposition: 'projection', replacement: 'TimelineProjectionTrack.kind', runtimeBoundary: 'plain-data' },
  { field: 'startTime', disposition: 'geometry', replacement: 'TimelineClipBodyGeometry.bodyRect', runtimeBoundary: 'plain-data' },
  { field: 'duration', disposition: 'geometry', replacement: 'TimelineClipBodyGeometry.bodyRect', runtimeBoundary: 'plain-data' },
  { field: 'name', disposition: 'paint-packet', replacement: 'TimelinePaintPacket.label', runtimeBoundary: 'plain-data' },
  { field: 'inPoint', disposition: 'projection', replacement: 'TimelineProjectionClip.inPoint', runtimeBoundary: 'plain-data' },
  { field: 'outPoint', disposition: 'projection', replacement: 'TimelineProjectionClip.outPoint', runtimeBoundary: 'plain-data' },
  { field: 'reversed', disposition: 'projection', replacement: 'TimelineProjectionClip.reversed', runtimeBoundary: 'plain-data' },
  { field: 'linkedClipId', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.linked.linkedClipId', runtimeBoundary: 'plain-data' },
  { field: 'linkedGroupId', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.linked.linkedGroupId', runtimeBoundary: 'plain-data' },
  { field: 'isPendingDownload', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.download.status', runtimeBoundary: 'plain-data' },
  { field: 'downloadProgress', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.download.progress', runtimeBoundary: 'plain-data' },
  { field: 'downloadError', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.download.errorCode', runtimeBoundary: 'plain-data' },
  { field: 'transcript', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=transcript-markers)', runtimeBoundary: 'resource-ref' },
  { field: 'transcriptStatus', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.transcript.status', runtimeBoundary: 'plain-data' },
  { field: 'transcriptProgress', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.transcript.progress', runtimeBoundary: 'plain-data' },
  { field: 'analysis', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=analysis-overlay)', runtimeBoundary: 'resource-ref' },
  { field: 'analysisStatus', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.analysis.status', runtimeBoundary: 'plain-data' },
  { field: 'analysisProgress', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.analysis.progress', runtimeBoundary: 'plain-data' },
  { field: 'mediaFileId', disposition: 'projection', replacement: 'TimelineProjectionClip.mediaFileId', runtimeBoundary: 'plain-data' },
  { field: 'thumbnails', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=thumbnail-bitmap)', runtimeBoundary: 'resource-ref' },
  { field: 'isComposition', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.nestedComposition', runtimeBoundary: 'plain-data' },
  { field: 'compositionId', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.nestedComposition.compositionId', runtimeBoundary: 'plain-data' },
  { field: 'nestedClipBoundaries', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=composition-segments)', runtimeBoundary: 'resource-ref' },
  { field: 'clipSegments', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=composition-segments)', runtimeBoundary: 'resource-ref' },
  { field: 'mixdownWaveform', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=waveform-columns)', runtimeBoundary: 'resource-ref' },
  { field: 'mixdownGenerating', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.nestedComposition.hasMixdown', runtimeBoundary: 'plain-data' },
  { field: 'hasMixdownAudio', disposition: 'projection', replacement: 'TimelineProjectionClip.badges.nestedComposition.hasMixdown', runtimeBoundary: 'plain-data' },
  { field: 'waveform', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=waveform-columns)', runtimeBoundary: 'resource-ref' },
  { field: 'waveformChannels', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=waveform-columns)', runtimeBoundary: 'resource-ref' },
  { field: 'waveformGenerating', disposition: 'projection', replacement: 'TimelineProjectionClip.cacheRefs.waveform plus badges', runtimeBoundary: 'plain-data' },
  { field: 'waveformProgress', disposition: 'projection', replacement: 'TimelineProjectionClip.cacheRefs.waveform plus badges', runtimeBoundary: 'plain-data' },
  { field: 'audioState', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=waveform-columns|spectrogram-raster)', runtimeBoundary: 'resource-ref' },
  { field: 'midiData', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=midi-bars)', runtimeBoundary: 'resource-ref' },
  { field: 'fade', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=fade-curve-points)', runtimeBoundary: 'resource-ref' },
  { field: 'source', disposition: 'projection', replacement: 'TimelineProjectionClip source summary fields', runtimeBoundary: 'plain-data' },
  { field: 'source.type', disposition: 'projection', replacement: 'TimelineProjectionClip.sourceKind', runtimeBoundary: 'plain-data' },
  { field: 'source.mediaFileId', disposition: 'projection', replacement: 'TimelineProjectionClip.mediaFileId', runtimeBoundary: 'plain-data' },
  { field: 'source.naturalDuration', disposition: 'projection', replacement: 'TimelineProjectionClip.outPoint and cache refs', runtimeBoundary: 'plain-data' },
  { field: 'source.vectorAnimationSettings', disposition: 'resource-table', replacement: 'TimelinePaintResourceRef(kind=composition-segments)', runtimeBoundary: 'resource-ref' },
] as const satisfies readonly CanvasClipFieldCoverageEntry[];
