import type { ExtensionProviderManifest } from '../../extensions';
import { SIGNAL_KINDS, type SignalKind, type SignalMetadata, type SignalRef } from '../../signals';
import type { SignalAssetItem } from '../../stores/mediaStore';
import type { TextClipProperties } from '../../types';

export const SIGNAL_TEXT_RENDERER_ADAPTER_ID = 'masterselects.renderer.signal-text-summary';
export const SIGNAL_TEXT_RENDERER_ADAPTER_VERSION = '1.0.0';
export const SIGNAL_TEXT_RENDERER_DEFAULT_DURATION = 5;

export const SIGNAL_TEXT_RENDERER_ADAPTER_MANIFEST: ExtensionProviderManifest = {
  schemaVersion: 1,
  id: SIGNAL_TEXT_RENDERER_ADAPTER_ID,
  version: SIGNAL_TEXT_RENDERER_ADAPTER_VERSION,
  displayName: 'Signal Text Summary Renderer',
  role: 'renderer-adapter',
  runtime: 'builtin',
  capabilities: [],
  signals: {
    inputKinds: [...SIGNAL_KINDS],
    outputKinds: ['texture', 'text'],
  },
  metadata: {
    outputSourceType: 'text',
    deterministic: true,
  },
};

export interface SignalTimelineRenderPlan {
  adapterId: typeof SIGNAL_TEXT_RENDERER_ADAPTER_ID;
  clipName: string;
  duration: number;
  signalAssetId: string;
  signalRefId?: string;
  textProperties: Partial<TextClipProperties>;
}

const PRIMARY_KIND_ORDER: SignalKind[] = [
  'table',
  'text',
  'document',
  'vector',
  'mesh',
  'geometry',
  'point-cloud',
  'scene',
  'binary',
  'metadata',
];

const MAX_LINE_LENGTH = 96;
const MAX_BODY_LINES = 11;
const MAX_METADATA_ENTRIES = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateLine(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_LINE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_LINE_LENGTH - 1)}...`;
}

function formatBytes(size: number | undefined): string | undefined {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return undefined;
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function titleForKind(kind: SignalKind | undefined): string {
  if (!kind) return 'Signal';
  return kind
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getPrimaryRef(item: SignalAssetItem): SignalRef | undefined {
  const refs = item.asset.refs;
  for (const kind of PRIMARY_KIND_ORDER) {
    const match = refs.find((ref) => ref.kind === kind);
    if (match) return match;
  }
  return refs[0];
}

function getPrimaryMetadata(item: SignalAssetItem, ref: SignalRef | undefined): SignalMetadata {
  const artifact = ref?.artifactId
    ? item.artifacts.find((candidate) => candidate.artifactId === ref.artifactId)
    : undefined;
  return {
    ...(item.asset.metadata ?? {}),
    ...(artifact?.metadata ?? {}),
    ...(ref?.metadata ?? {}),
  };
}

function getArrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(displayValue).map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function formatColumnTypes(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const labels = value
    .map((entry) => {
      if (!isRecord(entry)) return undefined;
      const name = displayValue(entry.name).trim();
      const type = displayValue(entry.type).trim();
      if (!name && !type) return undefined;
      return type ? `${name || 'column'}:${type}` : name;
    })
    .filter((entry): entry is string => Boolean(entry));
  return labels.length > 0 ? labels.join(' | ') : undefined;
}

function formatPreviewRows(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((row) => {
    if (Array.isArray(row)) {
      return truncateLine(row.map(displayValue).join(' | '));
    }
    return truncateLine(displayValue(row));
  }).filter(Boolean);
}

function buildTableLines(metadata: SignalMetadata): string[] {
  const rowCount = typeof metadata.rowCount === 'number' ? metadata.rowCount : undefined;
  const columnCount = typeof metadata.columnCount === 'number' ? metadata.columnCount : undefined;
  const columns = getArrayOfStrings(metadata.columns);
  const columnTypes = formatColumnTypes(metadata.columnTypes);
  const previewRows = formatPreviewRows(metadata.previewRows);

  const lines: string[] = [];
  if (rowCount !== undefined || columnCount !== undefined) {
    const resolvedColumnCount = columnCount ?? (columns.length || '?');
    lines.push(`${rowCount ?? '?'} rows x ${resolvedColumnCount} columns`);
  }
  if (columns.length > 0) {
    lines.push(truncateLine(columns.join(' | ')));
  }
  if (columnTypes) {
    lines.push(truncateLine(columnTypes));
  }
  if (previewRows.length > 0) {
    lines.push('', ...previewRows);
  }
  return lines;
}

function buildBinaryLines(item: SignalAssetItem, metadata: SignalMetadata): string[] {
  const lines: string[] = [];
  const mimeType = displayValue(metadata.mimeType || item.asset.source.mimeType).trim();
  const byteLength = typeof metadata.byteLength === 'number' ? metadata.byteLength : item.fileSize;
  const formattedSize = formatBytes(byteLength);
  const headerHex = displayValue(metadata.headerHex).trim();

  if (mimeType) lines.push(mimeType);
  if (formattedSize) lines.push(formattedSize);
  if (headerHex) lines.push(`Header ${truncateLine(headerHex)}`);
  return lines;
}

function buildMetadataLines(metadata: SignalMetadata): string[] {
  return Object.entries(metadata)
    .filter(([key]) => !['columns', 'columnTypes', 'previewRows'].includes(key))
    .slice(0, MAX_METADATA_ENTRIES)
    .map(([key, value]) => `${key}: ${truncateLine(displayValue(value))}`);
}

function buildBodyLines(item: SignalAssetItem, ref: SignalRef | undefined, metadata: SignalMetadata): string[] {
  if (ref?.kind === 'table') {
    return buildTableLines(metadata);
  }
  if (ref?.kind === 'binary') {
    return buildBinaryLines(item, metadata);
  }

  const lines: string[] = [];
  const format = displayValue(metadata.format).trim();
  const mimeType = displayValue(metadata.mimeType || ref?.mimeType || item.asset.source.mimeType).trim();
  const formattedSize = formatBytes(
    typeof metadata.byteLength === 'number' ? metadata.byteLength : item.fileSize,
  );

  if (format) lines.push(`Format ${format}`);
  if (mimeType) lines.push(mimeType);
  if (formattedSize) lines.push(formattedSize);
  lines.push(...buildMetadataLines(metadata));
  return lines;
}

function buildText(item: SignalAssetItem, ref: SignalRef | undefined, metadata: SignalMetadata): string {
  const title = item.name || item.asset.name || 'Signal Asset';
  const subtitle = `${titleForKind(ref?.kind)} Signal`;
  const kinds = item.signalKinds.length > 0 ? item.signalKinds.join(', ') : undefined;
  const body = buildBodyLines(item, ref, metadata)
    .filter((line, index, lines) => line || (index > 0 && index < lines.length - 1))
    .slice(0, MAX_BODY_LINES);

  return [
    truncateLine(title),
    subtitle,
    kinds ? `Kinds: ${truncateLine(kinds)}` : undefined,
    '',
    ...body,
  ].filter((line): line is string => line !== undefined).join('\n');
}

export function canRenderSignalAssetToTimeline(item: SignalAssetItem): boolean {
  return item.type === 'signal' && item.asset.refs.length > 0;
}

export function createSignalTimelineRenderPlan(item: SignalAssetItem): SignalTimelineRenderPlan {
  const primaryRef = getPrimaryRef(item);
  const metadata = getPrimaryMetadata(item, primaryRef);
  const text = buildText(item, primaryRef, metadata);

  return {
    adapterId: SIGNAL_TEXT_RENDERER_ADAPTER_ID,
    clipName: item.name || item.asset.name || 'Signal',
    duration: SIGNAL_TEXT_RENDERER_DEFAULT_DURATION,
    signalAssetId: item.id,
    signalRefId: primaryRef?.id,
    textProperties: {
      text,
      fontFamily: 'Roboto',
      fontSize: 44,
      fontWeight: 500,
      fontStyle: 'normal',
      color: '#f7fafc',
      textAlign: 'left',
      verticalAlign: 'middle',
      lineHeight: 1.18,
      letterSpacing: 0,
      boxEnabled: true,
      boxX: 150,
      boxY: 140,
      boxWidth: 1620,
      boxHeight: 800,
      textBounds: undefined,
      strokeEnabled: false,
      strokeColor: '#000000',
      strokeWidth: 2,
      shadowEnabled: true,
      shadowColor: 'rgba(0, 0, 0, 0.55)',
      shadowOffsetX: 3,
      shadowOffsetY: 4,
      shadowBlur: 10,
      pathEnabled: false,
      pathPoints: [],
    },
  };
}
