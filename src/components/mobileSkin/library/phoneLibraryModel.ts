// Pure view model of the phone Library: which items a folder shows, the folder path, whether a move
// is allowed, the readable metadata of a media file and the usage lines of a delete warning.
// Reads plain media-store data only; never mutates anything.

import type {
  Composition, LabelColor, MediaFile, MediaFolder, MediaState,
} from '../../../stores/mediaStore/types';
import type { MediaFileUsageSummary } from '../../../stores/mediaStore/slices/fileManageSlice';
import { isUserVisibleComposition } from '../../../stores/mediaStore/compositionVisibility';
import { mediaNeedsRelink } from '../../../services/project/relinkMedia';

export type PhoneLibrarySource = Pick<MediaState,
  'files' | 'compositions' | 'folders' | 'textItems' | 'solidItems' | 'meshItems' | 'cameraItems' | 'lightItems'
  | 'splatEffectorItems' | 'mathSceneItems' | 'motionShapeItems' | 'signalAssets'>;

export type PhoneLibraryKind =
  | 'folder' | 'video' | 'image' | 'audio' | 'composition' | 'text' | 'solid' | 'signal' | 'model' | 'other';

export interface PhoneLibraryEntry {
  id: string;
  name: string;
  kind: PhoneLibraryKind;
  /** Short type word shown under the name. */
  typeLabel: string;
  parentId: string | null;
  labelColor: LabelColor;
  thumbnailUrl?: string;
  /** Seconds, when the item has a length. */
  duration?: number;
  /** A media file whose source is not available in this tab. */
  missing: boolean;
  /** Number of direct children (folders only). */
  childCount?: number;
}

interface NamedItem { id: string; name: string; parentId: string | null; labelColor?: LabelColor; type?: string; duration?: number }

const TYPE_LABELS: Record<string, string> = {
  video: 'Video', image: 'Image', audio: 'Audio', composition: 'Composition', text: 'Text', solid: 'Solid',
  signal: 'Data', model: '3D model', 'gaussian-splat': 'Splat', 'gaussian-avatar': 'Avatar', camera: 'Camera',
  light: 'Light', 'splat-effector': 'Splat effector', 'math-scene': 'Math scene', 'motion-shape': 'Shape',
};

function fileKind(file: Pick<MediaFile, 'type'>): PhoneLibraryKind {
  if (file.type === 'video' || file.type === 'image' || file.type === 'audio') return file.type;
  if (file.type === 'model' || file.type === 'gaussian-splat' || file.type === 'gaussian-avatar') return 'model';
  return 'other';
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Every library item of the project as an entry, regardless of folder. */
export function collectPhoneLibraryEntries(source: PhoneLibrarySource): PhoneLibraryEntry[] {
  const entries: PhoneLibraryEntry[] = [];
  const childCounts = new Map<string, number>();
  const count = (parentId: string | null) => {
    if (parentId) childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
  };
  for (const file of source.files) {
    count(file.parentId);
    entries.push({
      id: file.id, name: file.name, kind: fileKind(file), typeLabel: TYPE_LABELS[file.type] ?? file.type,
      parentId: file.parentId, labelColor: file.labelColor ?? 'none', thumbnailUrl: file.thumbnailUrl,
      duration: file.type === 'image' ? undefined : positive(file.duration), missing: mediaNeedsRelink(file),
    });
  }
  for (const composition of source.compositions.filter(isUserVisibleComposition)) {
    count(composition.parentId);
    entries.push({
      id: composition.id, name: composition.name, kind: 'composition',
      typeLabel: `Composition · ${composition.width}×${composition.height}`, parentId: composition.parentId,
      labelColor: composition.labelColor ?? 'none', duration: positive(composition.duration), missing: false,
    });
  }
  const others: NamedItem[] = [
    ...source.textItems, ...source.solidItems, ...(source.meshItems ?? []), ...(source.cameraItems ?? []),
    ...(source.lightItems ?? []), ...(source.splatEffectorItems ?? []), ...(source.mathSceneItems ?? []),
    ...(source.motionShapeItems ?? []), ...(source.signalAssets ?? []),
  ];
  for (const item of others) {
    count(item.parentId);
    const kind: PhoneLibraryKind = item.type === 'text' || item.type === 'solid' || item.type === 'signal' ? item.type : 'other';
    entries.push({
      id: item.id, name: item.name, kind, typeLabel: TYPE_LABELS[item.type ?? ''] ?? (item.type ?? 'Item'),
      parentId: item.parentId, labelColor: item.labelColor ?? 'none', duration: positive(item.duration), missing: false,
    });
  }
  for (const folder of source.folders) {
    count(folder.parentId);
  }
  for (const folder of source.folders) {
    entries.push({
      id: folder.id, name: folder.name, kind: 'folder', typeLabel: 'Folder', parentId: folder.parentId,
      labelColor: folder.labelColor ?? 'none', missing: false, childCount: childCounts.get(folder.id) ?? 0,
    });
  }
  return entries;
}

/** The items directly inside `folderId` (null = top level): folders first, then by name. */
export function listPhoneLibraryFolder(source: PhoneLibrarySource, folderId: string | null): PhoneLibraryEntry[] {
  const folderIds = new Set(source.folders.map((folder) => folder.id));
  // An item whose folder no longer exists shows at the top level instead of disappearing.
  const parentOf = (entry: PhoneLibraryEntry) => (entry.parentId && folderIds.has(entry.parentId) ? entry.parentId : null);
  return collectPhoneLibraryEntries(source)
    .filter((entry) => parentOf(entry) === folderId)
    .toSorted((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
}

/** Folder chain from the top level down to `folderId` (excluding the top level itself). */
export function phoneLibraryPath(folders: readonly MediaFolder[], folderId: string | null): MediaFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: MediaFolder[] = [];
  const seen = new Set<string>();
  let cursor = folderId ? byId.get(folderId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}

/** True when `folderId` is `ancestorId` itself or lies somewhere inside it. */
export function isFolderInside(folders: readonly MediaFolder[], folderId: string | null, ancestorId: string): boolean {
  return phoneLibraryPath(folders, folderId).some((folder) => folder.id === ancestorId);
}

export type PhoneMoveCheck = { ok: true } | { ok: false; reason: string };

/** A folder cannot move into itself or one of its own subfolders. */
export function checkPhoneLibraryMove(folders: readonly MediaFolder[], itemIds: readonly string[], targetId: string | null): PhoneMoveCheck {
  if (itemIds.length === 0) return { ok: false, reason: 'Select something to move first.' };
  for (const id of itemIds) {
    const folder = folders.find((candidate) => candidate.id === id);
    if (folder && isFolderInside(folders, targetId, folder.id)) {
      return { ok: false, reason: `"${folder.name}" cannot move into itself or one of its own folders.` };
    }
  }
  return { ok: true };
}

/** Every folder as a move target with its indented path label. */
export function phoneLibraryFolderTargets(folders: readonly MediaFolder[]): Array<{ id: string | null; label: string; depth: number }> {
  const targets: Array<{ id: string | null; label: string; depth: number }> = [{ id: null, label: 'Library (top level)', depth: 0 }];
  const walk = (parentId: string | null, depth: number) => {
    folders.filter((folder) => (folder.parentId ?? null) === parentId)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .forEach((folder) => {
        targets.push({ id: folder.id, label: folder.name, depth });
        walk(folder.id, depth + 1);
      });
  };
  walk(null, 1);
  return targets;
}

export function formatPhoneDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds * 10) / 10);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  const secondsText = rest < 10 ? `0${rest.toFixed(1)}` : rest.toFixed(1);
  return `${minutes}:${secondsText.replace(/\.0$/, '')}`;
}

function formatBytes(bytes: number | undefined): string | null {
  if (!bytes || !Number.isFinite(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Readable metadata of a media file; rows without a value are left out, decode errors stay visible. */
export function describePhoneMediaInfo(file: MediaFile): Array<[string, string]> {
  const rows: Array<[string, string | null | undefined]> = [
    ['Type', TYPE_LABELS[file.type] ?? file.type],
    ['Duration', file.type === 'image' ? null : formatPhoneDuration(positive(file.duration)) || null],
    ['Size', file.width && file.height ? `${file.width}×${file.height}` : null],
    ['Frame rate', file.fps ? `${Math.round(file.fps * 100) / 100} fps` : null],
    ['Video codec', file.codec],
    ['Audio', file.audioCodec ?? (file.hasAudio === false ? 'None' : file.hasAudio ? 'Yes' : null)],
    ['Container', file.container],
    ['File size', formatBytes(file.fileSize)],
    ['Bit rate', file.bitrate ? `${Math.round(file.bitrate / 1000)} kbit/s` : null],
    ['Stored at', file.projectPath ?? file.filePath ?? file.absolutePath ?? (file.file ? 'This tab only' : null)],
    ['Proxy', file.type === 'video' ? describeProxy(file) : null],
    ['Waveform', file.waveformStatus && file.waveformStatus !== 'idle' ? file.waveformStatus : null],
    ['Source', mediaNeedsRelink(file) ? 'Missing – relink it' : 'Available'],
    ['Problem', file.decodeError ? `Cannot decode: ${file.decodeError}` : null],
  ];
  return rows.filter((row): row is [string, string] => typeof row[1] === 'string' && row[1].length > 0);
}

function describeProxy(file: MediaFile): string {
  switch (file.proxyStatus) {
    case 'generating': return `Making ${Math.round(file.proxyProgress ?? 0)}%`;
    case 'ready': return 'Ready';
    case 'error': return 'Failed';
    default: return (file.linkedSources ?? []).some((source) => source.role === 'proxy') ? 'Linked proxy' : 'None';
  }
}

/** "Used in Main (2 clips), Intro (1 clip)" lines for the delete warning. */
export function describePhoneMediaUsage(usages: readonly MediaFileUsageSummary[]): string[] {
  return usages.flatMap((usage) => usage.compositions.map((composition) => (
    `${usage.mediaFileName} – ${composition.compositionName}: ${composition.clipCount} clip${composition.clipCount === 1 ? '' : 's'}`
  )));
}

export function isPhoneComposition(item: unknown): item is Composition {
  return typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'composition';
}
