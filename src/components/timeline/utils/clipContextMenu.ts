import { isManualLinkedGroupId } from '../../../stores/timeline/helpers/idGenerator';
import type { LabelColor } from '../../../stores/mediaStore/types';

export interface ClipContextMenuSourceLike {
  type?: string;
  mediaFileId?: string;
}

export interface ClipContextMenuClipLike {
  id: string;
  name?: string;
  mediaFileId?: string;
  compositionId?: string;
  linkedClipId?: string;
  linkedGroupId?: string;
  startTime?: number;
  duration?: number;
  meshType?: string;
  source?: ClipContextMenuSourceLike | null;
}

export interface ClipContextMenuMediaFileLike {
  id: string;
  name: string;
  type?: string;
  duration?: number;
  fileHash?: string;
  file?: File | Blob | null;
  url?: string | null;
}

export interface ClipContextMenuThumbnailCacheLike {
  clearSource: (mediaFileId: string) => Promise<void>;
  generateForSourceUrl: (
    mediaFileId: string,
    sourceUrl: string,
    duration: number,
    fileHash?: string,
    crossOrigin?: string,
  ) => Promise<void>;
}

export interface ClipContextMenuProxyStoreLike {
  generateProxy: (mediaFileId: string, options?: { force?: boolean }) => void;
  cancelProxyGeneration: (mediaFileId: string) => void;
  generateAudioProxy: (mediaFileId: string, options?: { force?: boolean }) => void | Promise<unknown>;
}

export interface ClipContextMenuLabelStoreLike {
  setLabelColor: (itemIds: string[], color: LabelColor) => void;
}

export interface ClipContextMenuShowInExplorerResult {
  success: boolean;
  message: string;
}

export type ClipContextMenuShowInExplorerHandler = (
  type: 'raw' | 'proxy',
  fileId: string,
) => Promise<ClipContextMenuShowInExplorerResult>;

export type ClipContextMenuTranscribeLoader = () => Promise<{
  transcribeClip: (clipId: string) => void;
}>;

export interface ClipContextMenuLabelItemLike {
  id: string;
  name?: string;
  labelColor?: LabelColor;
  meshType?: string;
}

export interface ClipContextMenuLabelStateLike {
  compositions?: readonly ClipContextMenuLabelItemLike[];
  files?: readonly ClipContextMenuLabelItemLike[];
  solidItems?: readonly ClipContextMenuLabelItemLike[];
  textItems?: readonly ClipContextMenuLabelItemLike[];
  meshItems?: readonly ClipContextMenuLabelItemLike[];
  cameraItems?: readonly ClipContextMenuLabelItemLike[];
  splatEffectorItems?: readonly ClipContextMenuLabelItemLike[];
}

export interface ClipContextMenuLabelTarget {
  mediaItemId: string | null;
  currentColor: LabelColor;
}

export type ClipContextMenuAudioAnalysisKind = 'waveform' | 'spectral';

export type ClipContextMenuAudioAnalysisGenerator = (
  clipId: string,
  options?: { force?: boolean },
) => void;

export type ClipContextMenuAudioClipIdResolver = (
  clips: readonly ClipContextMenuClipLike[],
  clipId: string,
) => string | null;

export interface ClipContextMenuClipboardActions {
  copyClipEffects: (clipId: string) => void;
  pasteClipEffects: (targetClipIds?: string[]) => void;
  copyClipColor: (clipId: string) => void;
  pasteClipColor: (targetClipIds?: string[]) => void;
}

export type ClipContextMenuClipboardCommand =
  | 'copy-effects'
  | 'paste-effects'
  | 'copy-color'
  | 'paste-color';

export type ClipContextMenuTimelineCommand =
  | 'split-at-playhead'
  | 'ripple-delete'
  | 'delete-gap-at-clip-start'
  | 'link-clips'
  | 'unlink-clips'
  | 'convert-solid-to-motion-shape'
  | 'open-multicam-dialog'
  | 'unlink-multicam-group'
  | 'toggle-reverse'
  | 'create-subcomposition'
  | 'delete-clip';

export interface ClipContextMenuTimelineActions {
  splitClipAtPlayhead: () => void;
  rippleDeleteSelection: (clipIds?: string[]) => void;
  deleteGapAtTime: (time: number) => void;
  linkClips: (clipIds: string[]) => void;
  unlinkClips: (clipIds: string[]) => void;
  convertSolidToMotionShape: (clipId: string) => string | null;
  setMulticamDialogOpen: (open: boolean) => void;
  unlinkGroup: (clipId: string) => void;
  toggleClipReverse: (clipId: string) => void;
  createSubcompositionFromSelection: (clipId: string) => void;
  removeClip: (clipId: string) => void;
}

export type ClipContextMenuStemSeparationStarter = (
  clipId: string,
  options?: { force?: boolean },
) => Promise<string | null>;

export interface CreateClipContextMenuModelInput {
  clipId?: string | null;
  clip?: ClipContextMenuClipLike | null;
  clipMap: ReadonlyMap<string, ClipContextMenuClipLike>;
  selectedClipIds: ReadonlySet<string>;
  isClipLocked: (clipId: string) => boolean;
  canPasteEffects: boolean;
  canPasteColor: boolean;
}

export interface ClipContextMenuModel {
  isVideo: boolean;
  isAudio: boolean;
  isSolid: boolean;
  targetClipIds: string[];
  clipLinkAffectedIds: string[];
  hasClipLinkTarget: boolean;
  hasLockedTarget: boolean;
  hasLockedClipLinkTarget: boolean;
  canModifyTargets: boolean;
  canLinkClips: boolean;
  canUnlinkClips: boolean;
  canPasteEffects: boolean;
  canPasteColor: boolean;
  effectCopyLabel: string;
  effectPasteLabel: string;
  showColorClipboardInEffects: boolean;
  showColorClipboardTopLevel: boolean;
}

export function getClipContextMenuTargetClipIds(
  clipId: string | null | undefined,
  selectedClipIds: ReadonlySet<string>,
): string[] {
  if (!clipId) return [];
  return selectedClipIds.has(clipId) ? [...selectedClipIds] : [clipId];
}

export function findMediaFileForClip(
  clip: ClipContextMenuClipLike | null | undefined,
  mediaFiles: readonly ClipContextMenuMediaFileLike[],
): ClipContextMenuMediaFileLike | null {
  if (!clip) return null;
  const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
  const audioBaseName = clip.name?.replace(' (Audio)', '');

  return mediaFiles.find((file) =>
    file.id === mediaFileId ||
    file.name === clip.name ||
    (Boolean(audioBaseName) && file.name === audioBaseName)
  ) ?? null;
}

function resolveLabelItemColor(item: ClipContextMenuLabelItemLike | null | undefined): ClipContextMenuLabelTarget {
  return {
    mediaItemId: item?.id ?? null,
    currentColor: item?.labelColor ?? 'none',
  };
}

export function resolveClipContextMenuLabelTarget(
  clip: ClipContextMenuClipLike | null | undefined,
  state: ClipContextMenuLabelStateLike,
): ClipContextMenuLabelTarget {
  if (!clip) return { mediaItemId: null, currentColor: 'none' };
  const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;

  if (clip.compositionId) {
    return resolveLabelItemColor(state.compositions?.find((item) => item.id === clip.compositionId));
  }

  if (mediaFileId) {
    const file = state.files?.find((item) => item.id === mediaFileId);
    if (file) return resolveLabelItemColor(file);
  }

  if (clip.source?.type === 'solid') {
    return resolveLabelItemColor(mediaFileId
      ? state.solidItems?.find((item) => item.id === mediaFileId)
      : state.solidItems?.find((item) => item.name === clip.name));
  }

  if (clip.source?.type === 'text') {
    return resolveLabelItemColor(mediaFileId
      ? state.textItems?.find((item) => item.id === mediaFileId)
      : state.textItems?.find((item) => item.name === clip.name));
  }

  if (clip.source?.type === 'model') {
    return resolveLabelItemColor(mediaFileId
      ? state.meshItems?.find((item) => item.id === mediaFileId)
      : state.meshItems?.find((item) => item.name === clip.name || item.meshType === clip.meshType));
  }

  if (clip.source?.type === 'camera') {
    return resolveLabelItemColor(mediaFileId
      ? state.cameraItems?.find((item) => item.id === mediaFileId)
      : state.cameraItems?.[0]);
  }

  if (clip.source?.type === 'splat-effector') {
    return resolveLabelItemColor(mediaFileId
      ? state.splatEffectorItems?.find((item) => item.id === mediaFileId)
      : state.splatEffectorItems?.find((item) => item.name === clip.name));
  }

  return { mediaItemId: null, currentColor: 'none' };
}

export function getClipContextMenuLinkAffectedIds(
  targetClipIds: readonly string[],
  clipMap: ReadonlyMap<string, ClipContextMenuClipLike>,
): string[] {
  const affectedIds = new Set(targetClipIds);
  const targetIdSet = new Set(targetClipIds);
  const manualGroupIds = new Set<string>();

  for (const clipId of targetClipIds) {
    const targetClip = clipMap.get(clipId);
    if (!targetClip) continue;
    if (targetClip.linkedClipId) affectedIds.add(targetClip.linkedClipId);
    const groupId = targetClip.linkedGroupId;
    if (groupId && isManualLinkedGroupId(groupId)) {
      manualGroupIds.add(groupId);
    }
  }

  for (const candidate of clipMap.values()) {
    if (candidate.linkedClipId && targetIdSet.has(candidate.linkedClipId)) {
      affectedIds.add(candidate.id);
    }
    if (candidate.linkedGroupId && manualGroupIds.has(candidate.linkedGroupId)) {
      affectedIds.add(candidate.id);
    }
  }

  return [...affectedIds];
}

export function createClipContextMenuModel(input: CreateClipContextMenuModelInput): ClipContextMenuModel {
  const sourceType = input.clip?.source?.type;
  const isVideo = sourceType === 'video';
  const isAudio = sourceType === 'audio';
  const isSolid = sourceType === 'solid';
  const targetClipIds = getClipContextMenuTargetClipIds(input.clipId, input.selectedClipIds)
    .filter((clipId) => input.clipMap.has(clipId));
  const clipLinkAffectedIds = getClipContextMenuLinkAffectedIds(targetClipIds, input.clipMap);
  const hasClipLinkTarget = targetClipIds.some((clipId) => {
    const targetClip = input.clipMap.get(clipId);
    if (!targetClip) return false;
    return Boolean(targetClip.linkedClipId) ||
      isManualLinkedGroupId(targetClip.linkedGroupId) ||
      [...input.clipMap.values()].some((candidate) => candidate.linkedClipId === clipId);
  });
  const hasLockedTarget = targetClipIds.some(input.isClipLocked);
  const hasLockedClipLinkTarget = clipLinkAffectedIds.some(input.isClipLocked);
  const canModifyTargets = targetClipIds.length > 0 && !hasLockedTarget;
  const canLinkClips = targetClipIds.length >= 2 && !hasLockedClipLinkTarget;
  const canUnlinkClips = hasClipLinkTarget && !hasLockedClipLinkTarget;
  const effectCopyLabel = isAudio
    ? 'Copy Audio Effects'
    : isVideo
      ? 'Copy Video Effects'
      : 'Copy Effects';
  const effectPasteLabel = isAudio
    ? 'Paste Audio Effects'
    : isVideo
      ? 'Paste Video Effects'
      : 'Paste Effects';
  const showColorClipboardInEffects = isVideo;
  const showColorClipboardTopLevel = !isAudio && !showColorClipboardInEffects;

  return {
    isVideo,
    isAudio,
    isSolid,
    targetClipIds,
    clipLinkAffectedIds,
    hasClipLinkTarget,
    hasLockedTarget,
    hasLockedClipLinkTarget,
    canModifyTargets,
    canLinkClips,
    canUnlinkClips,
    canPasteEffects: input.canPasteEffects,
    canPasteColor: input.canPasteColor,
    effectCopyLabel,
    effectPasteLabel,
    showColorClipboardInEffects,
    showColorClipboardTopLevel,
  };
}

export async function regenerateClipContextMenuThumbnails(input: {
  mediaFile: ClipContextMenuMediaFileLike;
  clips: readonly ClipContextMenuClipLike[];
  thumbnailCache: ClipContextMenuThumbnailCacheLike;
  getManagedPrimarySourceUrl?: (mediaFileId: string) => string | undefined;
  createPrimarySourceUrl?: (mediaFileId: string, file: File | Blob) => string;
}): Promise<{ success: boolean; reason?: string; sourceUrl?: string; duration: number }> {
  const { mediaFile } = input;
  const sourceUrl =
    input.getManagedPrimarySourceUrl?.(mediaFile.id) ||
    mediaFile.url ||
    (mediaFile.file ? input.createPrimarySourceUrl?.(mediaFile.id, mediaFile.file) : undefined);

  if (!sourceUrl) {
    return { success: false, reason: 'missing-source-url', duration: 0 };
  }

  const sourceClip = input.clips.find((clip) =>
    (clip.mediaFileId === mediaFile.id || clip.source?.mediaFileId === mediaFile.id) &&
    clip.source?.type === 'video'
  );
  const duration = mediaFile.duration || sourceClip?.duration || 0;

  await input.thumbnailCache.clearSource(mediaFile.id);
  await input.thumbnailCache.generateForSourceUrl(
    mediaFile.id,
    sourceUrl,
    duration,
    mediaFile.fileHash,
  );

  return { success: true, sourceUrl, duration };
}

export function executeClipContextMenuProxyGeneration(input: {
  mediaFile: ClipContextMenuMediaFileLike | null | undefined;
  proxyStore: Pick<ClipContextMenuProxyStoreLike, 'generateProxy' | 'cancelProxyGeneration'>;
  action: 'start' | 'stop';
  options?: { force?: boolean };
}): boolean {
  if (!input.mediaFile) return false;

  if (input.action === 'start') {
    input.proxyStore.generateProxy(input.mediaFile.id, input.options);
  } else {
    input.proxyStore.cancelProxyGeneration(input.mediaFile.id);
  }

  return true;
}

export function executeClipContextMenuAudioProxyRegeneration(input: {
  mediaFile: ClipContextMenuMediaFileLike | null | undefined;
  proxyStore: Pick<ClipContextMenuProxyStoreLike, 'generateAudioProxy'>;
  force: boolean;
}): boolean {
  if (!input.mediaFile) return false;

  void input.proxyStore.generateAudioProxy(input.mediaFile.id, { force: input.force });
  return true;
}

export async function executeClipContextMenuTranscription(input: {
  clipId: string | null | undefined;
  transcriptStatus?: string | null;
  loadTranscriber: ClipContextMenuTranscribeLoader;
}): Promise<boolean> {
  if (!input.clipId || input.transcriptStatus === 'transcribing') {
    return false;
  }

  const { transcribeClip } = await input.loadTranscriber();
  transcribeClip(input.clipId);
  return true;
}

export async function executeClipContextMenuShowInExplorer(input: {
  type: 'raw' | 'proxy';
  mediaFile: ClipContextMenuMediaFileLike | null | undefined;
  showInExplorer: ClipContextMenuShowInExplorerHandler;
  notify: (message: string) => void;
  downloadRawFile: (file: File | Blob, name: string) => void;
  logDebug?: (message: string, value?: unknown) => void;
}): Promise<boolean> {
  const { mediaFile } = input;
  if (!mediaFile) return false;

  const result = await input.showInExplorer(input.type, mediaFile.id);
  if (result.success) {
    input.notify(result.message);
    return true;
  }

  if (input.type === 'raw' && mediaFile.file) {
    input.downloadRawFile(mediaFile.file, mediaFile.name);
    input.logDebug?.('Downloaded raw file:', mediaFile.name);
    return true;
  }

  input.notify(result.message);
  return true;
}

export function downloadClipContextMenuRawFile(file: File | Blob, name: string): void {
  const url = URL.createObjectURL(file);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function executeClipContextMenuLabelColor(input: {
  mediaItemId: string | null | undefined;
  color: LabelColor;
  labelStore: ClipContextMenuLabelStoreLike;
}): boolean {
  if (!input.mediaItemId) return false;
  input.labelStore.setLabelColor([input.mediaItemId], input.color);
  return true;
}

export function executeClipContextMenuAudioAnalysisRegeneration(input: {
  clipId: string | null | undefined;
  clips: readonly ClipContextMenuClipLike[];
  kind: ClipContextMenuAudioAnalysisKind;
  resolveAudioClipId: ClipContextMenuAudioClipIdResolver;
  generateWaveformForClip: ClipContextMenuAudioAnalysisGenerator;
  generateSpectrogramForClip: ClipContextMenuAudioAnalysisGenerator;
  force?: boolean;
}): boolean {
  if (!input.clipId) return false;
  const audioClipId = input.resolveAudioClipId(input.clips, input.clipId);
  if (!audioClipId) return false;

  const options = { force: input.force !== false };
  if (input.kind === 'waveform') {
    input.generateWaveformForClip(audioClipId, options);
  } else {
    input.generateSpectrogramForClip(audioClipId, options);
  }
  return true;
}

export function executeClipContextMenuClipboardCommand(input: {
  command: ClipContextMenuClipboardCommand;
  clipId: string | null | undefined;
  targetClipIds: readonly string[];
  canExecute: boolean;
  actions: ClipContextMenuClipboardActions;
}): boolean {
  if (!input.canExecute) return false;

  switch (input.command) {
    case 'copy-effects':
      if (!input.clipId) return false;
      input.actions.copyClipEffects(input.clipId);
      return true;
    case 'paste-effects':
      input.actions.pasteClipEffects([...input.targetClipIds]);
      return true;
    case 'copy-color':
      if (!input.clipId) return false;
      input.actions.copyClipColor(input.clipId);
      return true;
    case 'paste-color':
      input.actions.pasteClipColor([...input.targetClipIds]);
      return true;
  }
}

export function getClipContextMenuDeleteGapTime(clip: ClipContextMenuClipLike | null | undefined): number {
  return Math.max(0, (clip?.startTime ?? 0) - 0.0005);
}

export function executeClipContextMenuTimelineCommand(input: {
  command: ClipContextMenuTimelineCommand;
  clip: ClipContextMenuClipLike | null | undefined;
  clipId: string | null | undefined;
  targetClipIds: readonly string[];
  canExecute: boolean;
  actions: ClipContextMenuTimelineActions;
}): boolean {
  if (!input.canExecute) return false;

  switch (input.command) {
    case 'split-at-playhead':
      input.actions.splitClipAtPlayhead();
      return true;
    case 'ripple-delete':
      input.actions.rippleDeleteSelection([...input.targetClipIds]);
      return true;
    case 'delete-gap-at-clip-start':
      input.actions.deleteGapAtTime(getClipContextMenuDeleteGapTime(input.clip));
      return true;
    case 'link-clips':
      input.actions.linkClips([...input.targetClipIds]);
      return true;
    case 'unlink-clips':
      input.actions.unlinkClips([...input.targetClipIds]);
      return true;
    case 'convert-solid-to-motion-shape':
      if (!input.clipId) return false;
      input.actions.convertSolidToMotionShape(input.clipId);
      return true;
    case 'open-multicam-dialog':
      input.actions.setMulticamDialogOpen(true);
      return true;
    case 'unlink-multicam-group':
      if (!input.clipId) return false;
      input.actions.unlinkGroup(input.clipId);
      return true;
    case 'toggle-reverse':
      if (!input.clipId) return false;
      input.actions.toggleClipReverse(input.clipId);
      return true;
    case 'create-subcomposition':
      if (!input.clipId) return false;
      input.actions.createSubcompositionFromSelection(input.clipId);
      return true;
    case 'delete-clip':
      if (!input.clipId) return false;
      input.actions.removeClip(input.clipId);
      return true;
  }
}

export function executeClipContextMenuStemSeparation(input: {
  clipId: string | null | undefined;
  canExecute: boolean;
  force: boolean;
  startClipStemSeparation: ClipContextMenuStemSeparationStarter;
}): boolean {
  if (!input.clipId || !input.canExecute) return false;
  void input.startClipStemSeparation(input.clipId, { force: input.force });
  return true;
}
