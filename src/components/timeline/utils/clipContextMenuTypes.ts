import type { LabelColor } from '../../../stores/mediaStore/types';

export type { LabelColor };

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
  lightItems?: readonly ClipContextMenuLabelItemLike[];
  splatEffectorItems?: readonly ClipContextMenuLabelItemLike[];
}

export interface ClipContextMenuLabelTarget {
  mediaItemId: string | null;
  currentColor: LabelColor;
}

export type ClipContextMenuAudioAnalysisKind = 'waveform' | 'spectral';
export type ClipContextMenuAudioDisplayMode = 'compact' | 'detailed' | 'spectral';

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

export type ClipContextMenuCommandDescriptor =
  | {
      kind: 'show-in-explorer';
      explorerType: 'raw' | 'proxy';
      canExecute: boolean;
    }
  | {
      kind: 'proxy-generation';
      action: 'start' | 'stop';
      options?: { force?: boolean };
      canExecute: boolean;
    }
  | {
      kind: 'regenerate-thumbnails';
      canExecute: boolean;
    }
  | {
      kind: 'audio-proxy-regeneration';
      force: boolean;
      canExecute: boolean;
    }
  | {
      kind: 'audio-analysis-regeneration';
      analysisKind: ClipContextMenuAudioAnalysisKind;
      force?: boolean;
      canExecute: boolean;
    }
  | {
      kind: 'toggle-thumbnails';
      canExecute: boolean;
    }
  | {
      kind: 'toggle-waveforms';
      canExecute: boolean;
    }
  | {
      kind: 'set-audio-display-mode';
      mode: ClipContextMenuAudioDisplayMode;
      canExecute: boolean;
    }
  | {
      kind: 'clipboard';
      command: ClipContextMenuClipboardCommand;
      canExecute: boolean;
    }
  | {
      kind: 'timeline';
      command: ClipContextMenuTimelineCommand;
      canExecute: boolean;
    }
  | {
      kind: 'stem-separation';
      force: boolean;
      canExecute: boolean;
    }
  | {
      kind: 'music-to-midi';
      canExecute: boolean;
    }
  | {
      kind: 'transcription';
      transcriptStatus?: string | null;
      canExecute: boolean;
    }
  | {
      kind: 'label-color';
      color: LabelColor;
      canExecute: boolean;
    }
  | {
      kind: 'export-current-frame';
      canExecute: boolean;
    }
  | {
      kind: 'copy-generation-prompt';
      prompt: string;
      canExecute: boolean;
    };

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
  | 'sync-via-audio'
  | 'convert-solid-to-motion-shape'
  | 'open-multicam-dialog'
  | 'unlink-multicam-group'
  | 'toggle-reverse'
  | 'create-subcomposition'
  | 'delete-clip';

export interface ClipContextMenuTimelineActions {
  splitClipAtPlayhead: () => void;
  rippleDeleteSelection: (clipIds?: string[]) => void;
  deleteClipSelection: (clipIds?: string[]) => void;
  deleteGapAtTime: (time: number) => void;
  linkClips: (clipIds: string[]) => void;
  unlinkClips: (clipIds: string[]) => void;
  syncClipsViaAudio: (clipIds: string[], masterClipId?: string) => Promise<unknown>;
  convertSolidToMotionShape: (clipId: string) => string | null;
  setMulticamDialogOpen: (open: boolean) => void;
  unlinkGroup: (clipId: string) => void;
  toggleClipReverse: (clipId: string) => void;
  createSubcompositionFromSelection: (clipId: string) => void;
  removeClip: (clipId: string) => void;
}

export interface ClipContextMenuCommandExecutionContext {
  clipId: string | null | undefined;
  clip: ClipContextMenuClipLike | null | undefined;
  clips: readonly ClipContextMenuClipLike[];
  targetClipIds: readonly string[];
  mediaFile: ClipContextMenuMediaFileLike | null | undefined;
  mediaItemId: string | null | undefined;
  thumbnailCache: ClipContextMenuThumbnailCacheLike;
  getManagedPrimarySourceUrl?: (mediaFileId: string) => string | undefined;
  createPrimarySourceUrl?: (mediaFileId: string, file: File | Blob) => string;
  proxyStore: ClipContextMenuProxyStoreLike;
  labelStore: ClipContextMenuLabelStoreLike;
  clipboardActions: ClipContextMenuClipboardActions;
  timelineActions: ClipContextMenuTimelineActions;
  resolveAudioClipId: ClipContextMenuAudioClipIdResolver;
  generateWaveformForClip: ClipContextMenuAudioAnalysisGenerator;
  generateSpectrogramForClip: ClipContextMenuAudioAnalysisGenerator;
  startClipStemSeparation: ClipContextMenuStemSeparationStarter;
  openMusicToMidi: (clipId: string) => void;
  toggleThumbnailsEnabled: () => void;
  toggleWaveformsEnabled: () => void;
  setAudioDisplayMode: (mode: ClipContextMenuAudioDisplayMode) => void;
  loadTranscriber: ClipContextMenuTranscribeLoader;
  exportCurrentFrame: () => Promise<boolean>;
  writeClipboardText?: (text: string) => Promise<void>;
  onCopyPromptComplete?: () => void;
  showInExplorer: ClipContextMenuShowInExplorerHandler;
  notify: (message: string) => void;
  downloadRawFile: (file: File | Blob, name: string) => void;
  logDebug?: (message: string, value?: unknown) => void;
  logWarning?: (message: string, value?: unknown) => void;
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
  isMidi: boolean;
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
