import { LABEL_COLORS } from '../labelColors';
import { formatMediaDuration } from '../grid/format';
import { getItemImportProgress, getItemWaveformProgress, isImportedMediaFileItem } from '../itemTypeGuards';
import { MEDIA_CLASSIC_COLUMN_LABELS } from './classicColumnLabels';
import type { MediaClassicColumnId, MediaClassicDynamicColumnWidths, MediaClassicListRowData } from './types';
import { isProxyFrameCountComplete } from '../../../../stores/mediaStore/helpers/proxyCompleteness';
import type { Composition, MediaFile, ProjectItem, SignalAssetItem } from '../../../../stores/mediaStore';
import type { TrackingAsset } from '../../../../types/trackingAsset';
import { getTrackingAssetCoverageLabel, getTrackingAssetStateLabel } from '../trackingAssetPresentation';

export const MEDIA_CLASSIC_ROW_HEIGHT = 20;
export const MEDIA_CLASSIC_OVERSCAN_ROWS = 12;

const MEDIA_STATUS_BADGE_COLUMN_MIN_WIDTH = 58;
const MEDIA_STATUS_BADGE_COLUMN_MAX_WIDTH = 220;
const MEDIA_STATUS_BADGE_COLUMN_PADDING_X = 12;
const MEDIA_STATUS_BADGE_GAP = 4;
const MEDIA_COLUMN_TEXT_PADDING_X = 16;
const MEDIA_COLUMN_TEXT_CHAR_WIDTH = 6.2;
const DEFAULT_MEDIA_CLASSIC_COLUMN_ORDER: MediaClassicColumnId[] = ['name', 'badges', 'label', 'duration', 'resolution', 'fps', 'container', 'codec', 'audio', 'bitrate', 'size'];
const MEDIA_CLASSIC_COLUMN_ORDER_STORAGE_KEY = 'media-panel-column-order';

const DYNAMIC_MEDIA_COLUMN_IDS: Exclude<MediaClassicColumnId, 'name'>[] = ['badges', 'label', 'duration', 'resolution', 'fps', 'container', 'codec', 'audio', 'bitrate', 'size'];

const MEDIA_COLUMN_WIDTH_LIMITS: Record<Exclude<MediaClassicColumnId, 'name' | 'badges'>, { min: number; max: number }> = {
  label: { min: 24, max: 30 },
  duration: { min: 42, max: 100 },
  resolution: { min: 58, max: 140 },
  fps: { min: 36, max: 72 },
  container: { min: 48, max: 120 },
  codec: { min: 44, max: 128 },
  audio: { min: 42, max: 72 },
  bitrate: { min: 52, max: 110 },
  size: { min: 48, max: 96 },
};

interface BuildClassicMediaRowsInput {
  getItemsForParent: (parentId: string | null) => ProjectItem[];
  expandedFolderIds: ReadonlySet<string>;
  forceExpandFolders: boolean;
  sortItems: (items: ProjectItem[]) => ProjectItem[];
}

type ClassicVisibleRangeInput = { viewportHeight: number; scrollTop: number; rowCount: number };
export interface ClassicVisibleRange { start: number; end: number }

export function loadMediaClassicColumnOrder(): MediaClassicColumnId[] {
  try {
    const stored = localStorage.getItem(MEDIA_CLASSIC_COLUMN_ORDER_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as MediaClassicColumnId[];
      if (parsed.length === DEFAULT_MEDIA_CLASSIC_COLUMN_ORDER.length &&
          DEFAULT_MEDIA_CLASSIC_COLUMN_ORDER.every(col => parsed.includes(col))) {
        return parsed;
      }

      const missingColumns = DEFAULT_MEDIA_CLASSIC_COLUMN_ORDER.filter(col => !parsed.includes(col));
      if (missingColumns.length > 0) {
        const validColumns = parsed.filter(col => DEFAULT_MEDIA_CLASSIC_COLUMN_ORDER.includes(col));
        missingColumns.forEach((columnId) => {
          if (columnId === 'badges') {
            const nameIndex = validColumns.indexOf('name');
            validColumns.splice(nameIndex >= 0 ? nameIndex + 1 : 0, 0, columnId);
            return;
          }
          validColumns.push(columnId);
        });
        return validColumns;
      }
    }
  } catch {
    // Ignore invalid persisted column state.
  }
  return DEFAULT_MEDIA_CLASSIC_COLUMN_ORDER;
}

export function saveMediaClassicColumnOrder(columnOrder: readonly MediaClassicColumnId[]): void {
  localStorage.setItem(MEDIA_CLASSIC_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columnOrder));
}

function isSignalAssetItem(item: ProjectItem): item is SignalAssetItem {
  return 'type' in item && item.type === 'signal';
}

function isTrackingAsset(item: ProjectItem): item is TrackingAsset {
  return 'type' in item && item.type === 'tracking';
}

function clampMediaStatusBadgeColumnWidth(width: number): number {
  return Math.max(
    MEDIA_STATUS_BADGE_COLUMN_MIN_WIDTH,
    Math.min(MEDIA_STATUS_BADGE_COLUMN_MAX_WIDTH, Math.ceil(width)),
  );
}

function getMediaStatusBadgeWidths(item: ProjectItem): number[] {
  const mediaFile = isImportedMediaFileItem(item) ? item : null;
  const importProgress = getItemImportProgress(item);
  const waveformProgress = getItemWaveformProgress(item);
  const widths: number[] = [];

  if (importProgress !== null) {
    widths.push(Math.max(30, String(importProgress).length * 6 + 18));
  }
  if (importProgress === null && (waveformProgress !== null || Boolean(mediaFile?.waveform?.length || mediaFile?.audioAnalysisRefs?.waveformPyramidId))) {
    widths.push(waveformProgress !== null ? 44 : 20);
  }
  if (mediaFile?.audioProxyStatus === 'ready') widths.push(20);
  if (mediaFile?.audioProxyStatus === 'error') widths.push(28);
  if (mediaFile?.audioProxyStatus === 'generating') widths.push(46);
  if (
    mediaFile?.proxyStatus === 'ready' &&
    isProxyFrameCountComplete(
      mediaFile.proxyFrameCount,
      mediaFile.duration,
      mediaFile.proxyFps ?? mediaFile.fps,
    )
  ) widths.push(20);
  if (mediaFile?.proxyStatus === 'error') widths.push(28);
  if (mediaFile?.proxyStatus === 'generating') widths.push(46);
  if (mediaFile?.transcriptStatus === 'ready') widths.push(20);
  if (mediaFile?.analysisStatus === 'ready') widths.push(20);
  if (isTrackingAsset(item)) widths.push(36);

  return widths;
}

function getMediaStatusBadgeColumnWidth(items: readonly ProjectItem[]): number {
  const maxContentWidth = items.reduce((maxWidth, item) => {
    const widths = getMediaStatusBadgeWidths(item);
    if (widths.length === 0) return maxWidth;
    const contentWidth = widths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, widths.length - 1) * MEDIA_STATUS_BADGE_GAP +
      MEDIA_STATUS_BADGE_COLUMN_PADDING_X;
    return Math.max(maxWidth, contentWidth);
  }, 0);

  return clampMediaStatusBadgeColumnWidth(maxContentWidth);
}

export function formatMediaPanelFileSize(bytes?: number): string {
  if (!bytes) return '\u2013';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatMediaPanelBitrate(bps?: number): string {
  if (!bps) return '\u2013';
  if (bps < 1000) return `${bps} bps`;
  if (bps < 1000 * 1000) return `${(bps / 1000).toFixed(0)} kbps`;
  return `${(bps / (1000 * 1000)).toFixed(1)} Mbps`;
}

function formatCompactCount(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

function getGaussianSplatFrameCount(mediaFile: MediaFile): number | undefined {
  return mediaFile.splatFrameCount ?? mediaFile.gaussianSplatSequence?.frameCount;
}

function getGaussianSplatTotalCount(mediaFile: MediaFile): number | undefined {
  return mediaFile.totalSplatCount ?? mediaFile.gaussianSplatSequence?.totalSplatCount ?? mediaFile.splatCount;
}

function getGaussianSplatFirstFrameCount(mediaFile: MediaFile): number | undefined {
  return mediaFile.splatCount ?? mediaFile.gaussianSplatSequence?.frames[0]?.splatCount;
}

export function getGaussianSplatResolutionLabel(item: ProjectItem): string | null {
  if (!isImportedMediaFileItem(item) || item.type !== 'gaussian-splat') return null;

  const frameCount = getGaussianSplatFrameCount(item);
  const totalCount = getGaussianSplatTotalCount(item);
  const firstFrameCount = getGaussianSplatFirstFrameCount(item);
  const totalLabel = formatCompactCount(totalCount);
  const firstFrameLabel = formatCompactCount(firstFrameCount);

  if (frameCount && frameCount > 1) {
    return totalLabel ? `${frameCount}f / ${totalLabel} splats` : `${frameCount}f`;
  }

  return firstFrameLabel ? `${firstFrameLabel} splats` : null;
}

export function getGaussianSplatDetailLines(mediaFile: MediaFile): string[] {
  if (mediaFile.type !== 'gaussian-splat') return [];

  const frameCount = getGaussianSplatFrameCount(mediaFile);
  const totalCount = getGaussianSplatTotalCount(mediaFile);
  const firstFrameCount = getGaussianSplatFirstFrameCount(mediaFile);
  const minCount = mediaFile.gaussianSplatSequence?.minSplatCount;
  const maxCount = mediaFile.gaussianSplatSequence?.maxSplatCount;
  const lines: string[] = [];

  if (frameCount && frameCount > 1) {
    lines.push(`${frameCount} frames`);
    const totalLabel = formatCompactCount(totalCount);
    if (totalLabel) lines.push(`${totalLabel} splats total`);
    const minLabel = formatCompactCount(minCount);
    const maxLabel = formatCompactCount(maxCount);
    if (minLabel && maxLabel && minLabel !== maxLabel) {
      lines.push(`${minLabel}-${maxLabel} splats/frame`);
    }
  } else {
    const firstFrameLabel = formatCompactCount(firstFrameCount);
    if (firstFrameLabel) lines.push(`${firstFrameLabel} splats`);
  }

  return lines;
}

export function getMediaFileContainerLabel(mediaFile: MediaFile | null): string | undefined {
  if (!mediaFile) return undefined;
  if (mediaFile.container) return mediaFile.container;
  if (mediaFile.type === 'gaussian-splat' && mediaFile.gaussianSplatSequence?.container) {
    const frameCount = getGaussianSplatFrameCount(mediaFile);
    return frameCount && frameCount > 1
      ? `${mediaFile.gaussianSplatSequence.container} Seq`
      : mediaFile.gaussianSplatSequence.container;
  }
  return undefined;
}

export function getMediaFileCodecLabel(mediaFile: MediaFile | null): string | undefined {
  if (!mediaFile) return undefined;
  if (mediaFile.codec) return mediaFile.codec;
  if (mediaFile.type === 'gaussian-splat') {
    const frameCount = getGaussianSplatFrameCount(mediaFile);
    return frameCount && frameCount > 1
      ? 'Splat Seq'
      : 'Splat';
  }
  return undefined;
}

function getAudioWaveformColumnLabel(mediaFile: MediaFile): string {
  const channelCount = mediaFile.waveformChannels?.length;
  if (mediaFile.waveformStatus === 'generating') return `Wave ${mediaFile.waveformProgress ?? 0}%`;
  if (mediaFile.waveformStatus === 'error') return 'Wave error';
  if (mediaFile.waveformStatus === 'skipped') return 'Wave skipped';
  if (channelCount) return `${channelCount}ch wave`;
  if (mediaFile.waveform?.length || mediaFile.audioAnalysisRefs?.waveformPyramidId) return 'Waveform';
  return 'No waveform';
}

function getAudioProxyColumnLabel(mediaFile: MediaFile): string {
  if (mediaFile.audioProxyStatus === 'generating') return `Proxy ${mediaFile.audioProxyProgress ?? 0}%`;
  if (mediaFile.audioProxyStatus === 'ready') return 'Proxy WAV';
  if (mediaFile.audioProxyStatus === 'error') return 'Proxy error';
  return 'Source';
}

function getSignalKindLabel(item: SignalAssetItem): string {
  return item.signalKinds.length > 0 ? item.signalKinds.join(', ') : 'Signal';
}

export function getClassicMediaColumnText(item: ProjectItem, colId: Exclude<MediaClassicColumnId, 'name' | 'badges'>): string {
  const mediaFile = isImportedMediaFileItem(item) ? item : null;
  const signalAsset = isSignalAssetItem(item) ? item : null;
  const trackingAsset = isTrackingAsset(item) ? item : null;
  switch (colId) {
    case 'label':
      return '\u25cf';
    case 'duration': {
      const importProgress = getItemImportProgress(item);
      return importProgress !== null
        ? `Import ${importProgress}%`
        : trackingAsset
          ? getTrackingAssetCoverageLabel(trackingAsset) ?? '\u2013'
        : ('duration' in item && item.duration ? formatMediaDuration(item.duration) : '\u2013');
    }
    case 'resolution':
      if (mediaFile?.type === 'audio') return getAudioWaveformColumnLabel(mediaFile);
      if (signalAsset) return getSignalKindLabel(signalAsset);
      if (trackingAsset) return getTrackingAssetStateLabel(trackingAsset);
      return getGaussianSplatResolutionLabel(item) ??
        ('width' in item && 'height' in item && item.width && item.height ? `${item.width}\u00d7${item.height}` : '\u2013');
    case 'fps':
      if (mediaFile?.type === 'audio') return mediaFile.stemInfo?.label || mediaFile.stemInfo?.kind || 'Audio';
      if (mediaFile?.type === 'image') return 'Still';
      if (signalAsset) return `${signalAsset.artifacts.length} assets`;
      if (trackingAsset) return `${trackingAsset.track.fps}`;
      return mediaFile?.fps
        ? `${mediaFile.fps}`
        : ('type' in item && item.type === 'composition' ? `${(item as Composition).frameRate}` : '\u2013');
    case 'container':
      if ('type' in item && item.type === 'composition') return 'Comp';
      if (signalAsset) return signalAsset.providerId || 'Signal';
      if (trackingAsset) return 'Track';
      return getMediaFileContainerLabel(mediaFile) || '\u2013';
    case 'codec':
      if (mediaFile?.type === 'audio') return mediaFile.audioCodec || getMediaFileCodecLabel(mediaFile) || '\u2013';
      if (mediaFile?.type === 'image') return getMediaFileCodecLabel(mediaFile) || 'Raster';
      if ('type' in item && item.type === 'composition') return 'Timeline';
      if (signalAsset) return signalAsset.asset.source.extension || signalAsset.asset.source.mimeType || signalAsset.asset.source.kind;
      if (trackingAsset) return trackingAsset.track.projection === 'mesh' ? 'Mesh' : 'Planar';
      return getMediaFileCodecLabel(mediaFile) || '\u2013';
    case 'audio':
      return mediaFile?.type === 'audio' ? getAudioProxyColumnLabel(mediaFile) :
        mediaFile?.type === 'image' ? 'Image' :
        'type' in item && item.type === 'composition' ? 'Timeline' :
        signalAsset ? `${signalAsset.diagnostics?.length ?? 0} diag` :
        trackingAsset ? (trackingAsset.sourceVideoClipId ? 'Linked' : 'Project') :
        mediaFile?.hasAudio === true ? 'Yes' :
        mediaFile?.hasAudio === false ? 'No' : '\u2013';
    case 'bitrate':
      return formatMediaPanelBitrate(mediaFile?.bitrate);
    case 'size':
      return mediaFile
        ? formatMediaPanelFileSize(mediaFile.fileSize)
        : (isSignalAssetItem(item) ? formatMediaPanelFileSize(item.fileSize) : '\u2013');
    default:
      return '';
  }
}

function estimateClassicMediaColumnWidth(text: string): number {
  const weightedLength = Array.from(text).reduce((sum, char) => {
    if (char === '\u2013' || char === '\u25cf') return sum + 1.4;
    if (char === ' ' || char === '.' || char === ':' || char === '/') return sum + 0.55;
    if (/[MW@#%]/.test(char)) return sum + 1.2;
    if (/[ilI1|]/.test(char)) return sum + 0.55;
    return sum + 1;
  }, 0);
  return weightedLength * MEDIA_COLUMN_TEXT_CHAR_WIDTH + MEDIA_COLUMN_TEXT_PADDING_X;
}

export function getClassicMediaColumnWidths(items: readonly ProjectItem[]): MediaClassicDynamicColumnWidths {
  return DYNAMIC_MEDIA_COLUMN_IDS.reduce((widths, colId) => {
    if (colId === 'badges') {
      widths.badges = getMediaStatusBadgeColumnWidth(items);
      return widths;
    }

    const limits = MEDIA_COLUMN_WIDTH_LIMITS[colId];
    const headerWidth = estimateClassicMediaColumnWidth(MEDIA_CLASSIC_COLUMN_LABELS[colId]);
    const contentWidth = items.reduce((maxWidth, item) => (
      Math.max(maxWidth, estimateClassicMediaColumnWidth(getClassicMediaColumnText(item, colId)))
    ), headerWidth);
    widths[colId] = Math.max(limits.min, Math.min(limits.max, Math.ceil(contentWidth)));
    return widths;
  }, {} as Record<Exclude<MediaClassicColumnId, 'name'>, number>);
}

export function getClassicMediaSortValue(item: ProjectItem, colId: MediaClassicColumnId): string | number {
  const mediaFile = isImportedMediaFileItem(item) ? item : null;
  switch (colId) {
    case 'name': return item.name.toLowerCase();
    case 'badges': {
      if (!mediaFile) return 0;
      return [
        getItemImportProgress(item) !== null,
        getItemWaveformProgress(item) !== null || Boolean(mediaFile.waveform?.length || mediaFile.audioAnalysisRefs?.waveformPyramidId),
        mediaFile.proxyStatus === 'ready' || mediaFile.proxyStatus === 'generating' || mediaFile.proxyStatus === 'error',
        mediaFile.audioProxyStatus === 'ready' || mediaFile.audioProxyStatus === 'generating' || mediaFile.audioProxyStatus === 'error',
        mediaFile.transcriptStatus === 'ready',
        mediaFile.analysisStatus === 'ready',
      ].filter(Boolean).length;
    }
    case 'label': {
      const labelColor = 'labelColor' in item ? (item as MediaFile).labelColor : undefined;
      const idx = LABEL_COLORS.findIndex(c => c.key === (labelColor || 'none'));
      return idx >= 0 ? idx : 999;
    }
    case 'duration': return 'duration' in item && item.duration ? item.duration : 0;
    case 'resolution':
      if (mediaFile?.type === 'audio') {
        return mediaFile.waveformChannels?.length ?? mediaFile.waveform?.length ?? 0;
      }
      if (mediaFile?.type === 'gaussian-splat') {
        return getGaussianSplatTotalCount(mediaFile) ?? getGaussianSplatFirstFrameCount(mediaFile) ?? 0;
      }
      if (isSignalAssetItem(item)) return item.artifacts.length;
      return 'width' in item && 'height' in item && item.width && item.height ? item.width * item.height : 0;
    case 'fps': return mediaFile?.fps || ('type' in item && item.type === 'composition' ? (item as Composition).frameRate : 0);
    case 'container': return getMediaFileContainerLabel(mediaFile)?.toLowerCase() || '';
    case 'codec': return getMediaFileCodecLabel(mediaFile)?.toLowerCase() || '';
    case 'audio':
      if (mediaFile?.type === 'audio') return 2;
      if (isSignalAssetItem(item)) return item.diagnostics?.length ?? 0;
      return mediaFile?.hasAudio ? 1 : 0;
    case 'bitrate': return mediaFile?.bitrate || 0;
    case 'size': return mediaFile?.fileSize || (isSignalAssetItem(item) ? item.fileSize ?? 0 : 0);
    default: return 0;
  }
}

export function sortClassicMediaItems(
  items: ProjectItem[],
  sortColumn: MediaClassicColumnId | null,
  sortDirection: 'asc' | 'desc',
): ProjectItem[] {
  if (!sortColumn) return items;

  const folderItems = items.filter(i => 'isExpanded' in i);
  const nonFolderItems = items.filter(i => !('isExpanded' in i));
  const compare = (a: ProjectItem, b: ProjectItem): number => {
    const va = getClassicMediaSortValue(a, sortColumn);
    const vb = getClassicMediaSortValue(b, sortColumn);
    const result = typeof va === 'string' && typeof vb === 'string'
      ? va.localeCompare(vb)
      : (va as number) - (vb as number);
    return sortDirection === 'desc' ? -result : result;
  };

  return [
    ...folderItems.toSorted(compare),
    ...nonFolderItems.toSorted(compare),
  ];
}

export function buildClassicMediaRows({
  getItemsForParent,
  expandedFolderIds,
  forceExpandFolders,
  sortItems,
}: BuildClassicMediaRowsInput): MediaClassicListRowData[] {
  const rows: MediaClassicListRowData[] = [];
  const appendRows = (items: ProjectItem[], depth: number) => {
    for (const item of sortItems(items)) {
      rows.push({ item, depth });
      if ('isExpanded' in item && (expandedFolderIds.has(item.id) || forceExpandFolders)) {
        appendRows(getItemsForParent(item.id), depth + 1);
      }
    }
  };

  appendRows(getItemsForParent(null), 0);
  return rows;
}

export function getClassicVisibleRange({
  viewportHeight,
  scrollTop,
  rowCount,
}: ClassicVisibleRangeInput): ClassicVisibleRange {
  const height = Math.max(viewportHeight, MEDIA_CLASSIC_ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / MEDIA_CLASSIC_ROW_HEIGHT) - MEDIA_CLASSIC_OVERSCAN_ROWS);
  const visibleCount = Math.ceil(height / MEDIA_CLASSIC_ROW_HEIGHT) + MEDIA_CLASSIC_OVERSCAN_ROWS * 2;
  const end = Math.min(rowCount, start + visibleCount);
  return { start, end };
}
