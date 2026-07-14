import { isManualLinkedGroupId } from '../../../stores/timeline/helpers/idGenerator';
import type {
  ClipContextMenuAudioAnalysisGenerator,
  ClipContextMenuAudioAnalysisKind,
  ClipContextMenuAudioClipIdResolver,
  ClipContextMenuClipboardActions,
  ClipContextMenuClipboardCommand,
  ClipContextMenuClipLike,
  ClipContextMenuCommandDescriptor,
  ClipContextMenuCommandExecutionContext,
  ClipContextMenuLabelItemLike,
  ClipContextMenuLabelStateLike,
  ClipContextMenuLabelStoreLike,
  ClipContextMenuLabelTarget,
  ClipContextMenuMediaFileLike,
  ClipContextMenuModel,
  ClipContextMenuProxyStoreLike,
  ClipContextMenuShowInExplorerHandler,
  ClipContextMenuStemSeparationStarter,
  ClipContextMenuThumbnailCacheLike,
  ClipContextMenuTimelineActions,
  ClipContextMenuTimelineCommand,
  ClipContextMenuTranscribeLoader,
  CreateClipContextMenuModelInput,
  LabelColor,
} from './clipContextMenuTypes';

export type {
  ClipContextMenuAudioAnalysisGenerator,
  ClipContextMenuAudioAnalysisKind,
  ClipContextMenuAudioClipIdResolver,
  ClipContextMenuAudioDisplayMode,
  ClipContextMenuClipboardActions,
  ClipContextMenuClipboardCommand,
  ClipContextMenuClipLike,
  ClipContextMenuCommandDescriptor,
  ClipContextMenuCommandExecutionContext,
  ClipContextMenuLabelItemLike,
  ClipContextMenuLabelStateLike,
  ClipContextMenuLabelStoreLike,
  ClipContextMenuLabelTarget,
  ClipContextMenuMediaFileLike,
  ClipContextMenuModel,
  ClipContextMenuProxyStoreLike,
  ClipContextMenuShowInExplorerHandler,
  ClipContextMenuShowInExplorerResult,
  ClipContextMenuSourceLike,
  ClipContextMenuStemSeparationStarter,
  ClipContextMenuThumbnailCacheLike,
  ClipContextMenuTimelineActions,
  ClipContextMenuTimelineCommand,
  ClipContextMenuTranscribeLoader,
  CreateClipContextMenuModelInput,
  LabelColor,
} from './clipContextMenuTypes';

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

  if (clip.source?.type === 'light') {
    return resolveLabelItemColor(mediaFileId
      ? state.lightItems?.find((item) => item.id === mediaFileId)
      : state.lightItems?.find((item) => item.name === clip.name));
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
  const isMidi = sourceType === 'midi';
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
    isMidi,
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

async function writeTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall back below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function executeClipContextMenuCopyPrompt(input: {
  prompt: string;
  canExecute: boolean;
  writeClipboardText?: (text: string) => Promise<void>;
  onCopied?: () => void;
}): Promise<boolean> {
  const prompt = input.prompt.trim();
  if (!input.canExecute || !prompt) return false;

  await (input.writeClipboardText ?? writeTextToClipboard)(prompt);
  input.onCopied?.();
  return true;
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
    case 'sync-via-audio':
      if (!input.clipId) return false;
      void input.actions.syncClipsViaAudio([...input.targetClipIds], input.clipId);
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
      input.actions.deleteClipSelection([...input.targetClipIds]);
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

export async function executeClipContextMenuCommand(
  command: ClipContextMenuCommandDescriptor,
  context: ClipContextMenuCommandExecutionContext,
): Promise<boolean> {
  if (!command.canExecute) {
    return false;
  }

  switch (command.kind) {
    case 'show-in-explorer':
      return executeClipContextMenuShowInExplorer({
        type: command.explorerType,
        mediaFile: context.mediaFile,
        showInExplorer: context.showInExplorer,
        notify: context.notify,
        downloadRawFile: context.downloadRawFile,
        logDebug: context.logDebug,
      });
    case 'proxy-generation':
      return executeClipContextMenuProxyGeneration({
        mediaFile: context.mediaFile,
        proxyStore: context.proxyStore,
        action: command.action,
        options: command.options,
      });
    case 'regenerate-thumbnails': {
      if (!context.mediaFile) {
        return false;
      }
      const result = await regenerateClipContextMenuThumbnails({
        mediaFile: context.mediaFile,
        clips: context.clips,
        thumbnailCache: context.thumbnailCache,
        getManagedPrimarySourceUrl: context.getManagedPrimarySourceUrl,
        createPrimarySourceUrl: context.createPrimarySourceUrl,
      });
      if (!result.success) {
        context.logWarning?.('No source URL available for thumbnail regeneration', {
          mediaFileId: context.mediaFile.id,
          name: context.mediaFile.name,
          reason: result.reason,
        });
      }
      return result.success;
    }
    case 'audio-proxy-regeneration':
      return executeClipContextMenuAudioProxyRegeneration({
        mediaFile: context.mediaFile,
        proxyStore: context.proxyStore,
        force: command.force,
      });
    case 'audio-analysis-regeneration':
      return executeClipContextMenuAudioAnalysisRegeneration({
        clipId: context.clipId,
        clips: context.clips,
        kind: command.analysisKind,
        resolveAudioClipId: context.resolveAudioClipId,
        generateWaveformForClip: context.generateWaveformForClip,
        generateSpectrogramForClip: context.generateSpectrogramForClip,
        force: command.force,
      });
    case 'toggle-thumbnails':
      context.toggleThumbnailsEnabled();
      return true;
    case 'toggle-waveforms':
      context.toggleWaveformsEnabled();
      return true;
    case 'set-audio-display-mode':
      context.setAudioDisplayMode(command.mode);
      return true;
    case 'clipboard':
      if ((command.command === 'copy-effects' || command.command === 'copy-color') && !context.clip) {
        return false;
      }
      if ((command.command === 'paste-effects' || command.command === 'paste-color') && context.targetClipIds.length === 0) {
        return false;
      }
      return executeClipContextMenuClipboardCommand({
        command: command.command,
        clipId: context.clipId,
        targetClipIds: context.targetClipIds,
        canExecute: command.canExecute,
        actions: context.clipboardActions,
      });
    case 'timeline':
      if (context.targetClipIds.length === 0) {
        return false;
      }
      if ([
        'delete-gap-at-clip-start',
        'sync-via-audio',
        'convert-solid-to-motion-shape',
        'unlink-multicam-group',
        'toggle-reverse',
        'create-subcomposition',
        'delete-clip',
      ].includes(command.command) && !context.clip) {
        return false;
      }
      if (command.command === 'open-multicam-dialog' && context.targetClipIds.length < 2) {
        return false;
      }
      if (command.command === 'link-clips' && context.targetClipIds.length < 2) {
        return false;
      }
      if (command.command === 'sync-via-audio' && context.targetClipIds.length < 2) {
        return false;
      }
      return executeClipContextMenuTimelineCommand({
        command: command.command,
        clip: context.clip,
        clipId: context.clipId,
        targetClipIds: context.targetClipIds,
        canExecute: command.canExecute,
        actions: context.timelineActions,
      });
    case 'stem-separation':
      return executeClipContextMenuStemSeparation({
        clipId: context.clipId,
        canExecute: command.canExecute,
        force: command.force,
        startClipStemSeparation: context.startClipStemSeparation,
      });
    case 'transcription':
      return executeClipContextMenuTranscription({
        clipId: context.clipId,
        transcriptStatus: command.transcriptStatus,
        loadTranscriber: context.loadTranscriber,
      });
    case 'label-color':
      return executeClipContextMenuLabelColor({
        mediaItemId: context.mediaItemId,
        color: command.color,
        labelStore: context.labelStore,
      });
    case 'export-current-frame':
      return context.exportCurrentFrame();
    case 'copy-generation-prompt':
      return executeClipContextMenuCopyPrompt({
        prompt: command.prompt,
        canExecute: command.canExecute,
        writeClipboardText: context.writeClipboardText,
        onCopied: context.onCopyPromptComplete,
      });
  }
}
