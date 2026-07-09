import { useEffect, useCallback, useRef, useState } from 'react';
import { handleSubmenuHover, handleSubmenuLeave } from '../panels/media/submenuPosition';
import type { TimelineClip } from '../../types';
import type { MediaFile } from '../../stores/mediaStore';
import type { ClipStemSeparationJobState, GenerateClipAudioAnalysisOptions, TimelineAudioDisplayMode } from '../../stores/timeline/types';
import type { ContextMenuState } from './types';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useSettingsStore, type TranscriptionProvider } from '../../stores/settingsStore';
import { useAccountStore } from '../../stores/accountStore';
import { projectFileService } from '../../services/projectFileService';
import { thumbnailCacheService } from '../../services/thumbnailCacheService';
import { captureCurrentPreviewFrameJpegBlob } from '../../services/previewFrameCapture';
import { Logger } from '../../services/logger';
import { downloadBlob } from '../../engine/export';
import { flashBoardMediaBridge } from '../../services/flashboard/FlashBoardMediaBridge';
import { LABEL_COLORS, getLabelHex } from '../panels/media/labelColors';
import { resolveAudibleAudioClip, resolveAudibleAudioClipId } from '../../services/audio/audioClipResolution';
import { isManualLinkedGroupId } from '../../stores/timeline/helpers/idGenerator';
import { isActiveStemJobPhase } from '../../stores/timeline/helpers/stemSeparationJobPhases';
import {
  type ClipContextMenuCommandDescriptor,
  type ClipContextMenuCommandExecutionContext,
  createClipContextMenuModel,
  downloadClipContextMenuRawFile,
  executeClipContextMenuCommand,
  findMediaFileForClip,
  resolveClipContextMenuLabelTarget,
} from './utils/clipContextMenu';
import {
  createPrimaryMediaObjectUrl,
  getPrimaryMediaObjectUrlKey,
  mediaObjectUrlManager,
} from '../../services/project/mediaObjectUrlManager';

const log = Logger.create('TimelineContextMenu');
const COPY_PROMPT_TOAST_MS = 900;
const TRANSCRIPTION_PROVIDER_LABELS: Record<TranscriptionProvider, string> = {
  local: 'Local Whisper Base',
  openai: 'OpenAI Whisper API',
  assemblyai: 'AssemblyAI',
  deepgram: 'Deepgram',
};

function getFrameExportFilename(clip: TimelineClip | null | undefined, playheadPosition: number): string {
  const baseName = (clip?.name ?? 'current-frame')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim() || 'current-frame';
  return `${baseName.slice(0, 80)}_frame_${Math.max(0, playheadPosition).toFixed(2).replace('.', '_')}s.jpg`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
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
}

interface TimelineContextMenuProps {
  contextMenu: ContextMenuState | null;
  setContextMenu: (menu: ContextMenuState | null) => void;

  // Clip data
  clipMap: Map<string, TimelineClip>;
  selectedClipIds: Set<string>;
  isClipLocked: (clipId: string) => boolean;
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
  audioDisplayMode: TimelineAudioDisplayMode;
  clipStemSeparationJobs: Record<string, ClipStemSeparationJobState>;

  // Actions
  selectClip: (clipId: string) => void;
  removeClip: (clipId: string) => void;
  splitClipAtPlayhead: () => void;
  rippleDeleteSelection: (clipIds?: string[]) => void;
  deleteClipSelection: (clipIds?: string[]) => void;
  deleteGapAtTime: (time: number) => void;
  toggleClipReverse: (clipId: string) => void;
  unlinkGroup: (clipId: string) => void;
  linkClips: (clipIds: string[]) => void;
  unlinkClips: (clipIds: string[]) => void;
  syncClipsViaAudio: (clipIds: string[], masterClipId?: string) => Promise<unknown>;
  generateWaveformForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => void;
  generateSpectrogramForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => void;
  startClipStemSeparation: (clipId: string, options?: { force?: boolean }) => Promise<string | null>;
  toggleThumbnailsEnabled: () => void;
  toggleWaveformsEnabled: () => void;
  setAudioDisplayMode: (mode: TimelineAudioDisplayMode) => void;
  convertSolidToMotionShape: (clipId: string) => string | null;
  createSubcompositionFromSelection: (clipId: string) => void;
  copyClipEffects: (clipId: string) => void;
  pasteClipEffects: (targetClipIds?: string[]) => void;
  hasClipboardEffects: () => boolean;
  copyClipColor: (clipId: string) => void;
  pasteClipColor: (targetClipIds?: string[]) => void;
  hasClipboardColor: () => boolean;
  setMulticamDialogOpen: (open: boolean) => void;

  // File explorer
  showInExplorer: (type: 'raw' | 'proxy', fileId: string) => Promise<{ success: boolean; message: string }>;
}

export function TimelineContextMenu({
  contextMenu,
  setContextMenu,
  clipMap,
  selectedClipIds,
  isClipLocked,
  thumbnailsEnabled,
  waveformsEnabled,
  audioDisplayMode,
  clipStemSeparationJobs,
  selectClip: _selectClip,
  removeClip,
  splitClipAtPlayhead,
  rippleDeleteSelection,
  deleteClipSelection,
  deleteGapAtTime,
  toggleClipReverse,
  unlinkGroup,
  linkClips,
  unlinkClips,
  syncClipsViaAudio,
  generateWaveformForClip,
  generateSpectrogramForClip,
  startClipStemSeparation,
  toggleThumbnailsEnabled,
  toggleWaveformsEnabled,
  setAudioDisplayMode,
  convertSolidToMotionShape,
  createSubcompositionFromSelection,
  copyClipEffects,
  pasteClipEffects,
  hasClipboardEffects,
  copyClipColor,
  pasteClipColor,
  hasClipboardColor,
  setMulticamDialogOpen,
  showInExplorer,
}: TimelineContextMenuProps) {
  const { menuRef: contextMenuRef, adjustedPosition: contextMenuPosition } = useContextMenuPosition(contextMenu);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const [showCopiedPromptToast, setShowCopiedPromptToast] = useState(false);
  const copiedPromptTimeoutRef = useRef<number | null>(null);
  const confirmPromptCopied = useCallback(() => {
    setShowCopiedPromptToast(true);
    if (copiedPromptTimeoutRef.current !== null) {
      window.clearTimeout(copiedPromptTimeoutRef.current);
    }
    copiedPromptTimeoutRef.current = window.setTimeout(() => {
      setShowCopiedPromptToast(false);
      copiedPromptTimeoutRef.current = null;
    }, COPY_PROMPT_TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (copiedPromptTimeoutRef.current !== null) {
      window.clearTimeout(copiedPromptTimeoutRef.current);
    }
  }, []);

  // Get the media file for a clip
  const getMediaFileForClip = useCallback(
    (clipId: string): MediaFile | null => {
      const clip = clipMap.get(clipId);
      return findMediaFileForClip(clip, useMediaStore.getState().files) as MediaFile | null;
    },
    [clipMap]
  );

  // Close context menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = () => {
      setContextMenu(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };

    const timeoutId = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, setContextMenu]);

  const copiedPromptToast = showCopiedPromptToast ? (
    <div className="timeline-copy-prompt-toast" role="status" aria-live="polite">Copied</div>
  ) : null;
  const transcriptionProvider = useSettingsStore((state) => state.transcriptionProvider);
  const isSignedIn = useAccountStore((state) => Boolean(state.session?.authenticated));
  const activeTranscriptionProviderLabel = isSignedIn
    ? 'OpenAI Whisper Cloud'
    : TRANSCRIPTION_PROVIDER_LABELS[transcriptionProvider];

  if (!contextMenu) return copiedPromptToast;

  const mediaFile = getMediaFileForClip(contextMenu.clipId);
  const clip = clipMap.get(contextMenu.clipId);
  const generationPrompt = mediaFile ? (flashBoardMediaBridge.getMetadata(mediaFile.id)?.prompt.trim() ?? '') : '';
  const canCopyGenerationPrompt = generationPrompt.length > 0;
  const canPasteEffects = hasClipboardEffects();
  const canPasteColor = hasClipboardColor();
  const menuModel = createClipContextMenuModel({
    clipId: contextMenu.clipId,
    clip,
    clipMap,
    selectedClipIds,
    isClipLocked,
    canPasteEffects,
    canPasteColor,
  });
  const {
    isVideo,
    isAudio,
    isMidi,
    isSolid,
    targetClipIds,
    hasClipLinkTarget,
    canModifyTargets,
    canLinkClips,
    canUnlinkClips,
    effectCopyLabel,
    effectPasteLabel,
    showColorClipboardInEffects,
    showColorClipboardTopLevel,
  } = menuModel;
  const isVideoMedia = mediaFile?.type === 'video' || isVideo;
  const canExportCurrentFrame = Boolean(clip && !isAudio && !isMidi);
  const allClips = [...clipMap.values()];
  const syncAudioClipIds = new Set(targetClipIds
    .map((targetClipId) => resolveAudibleAudioClip(allClips, targetClipId)?.audioClip.id)
    .filter((id): id is string => Boolean(id)));
  const canSyncViaAudio = canModifyTargets && syncAudioClipIds.size >= 2;
  const audibleAudioResolution = resolveAudibleAudioClip(allClips, contextMenu.clipId);
  const audibleAudioClip = audibleAudioResolution?.audioClip ?? null;
  const stemSeparationJob = audibleAudioClip ? clipStemSeparationJobs[audibleAudioClip.id] : undefined;
  const isStemSeparationActive = isActiveStemJobPhase(stemSeparationJob?.phase);
  const stemProgressPercent = Math.round(Math.max(0, Math.min(1, stemSeparationJob?.progress ?? 0)) * 100);
  const hasStemSeparation = Boolean(audibleAudioClip?.audioState?.stemSeparation);
  const isGenerating = mediaFile?.proxyStatus === 'generating';
  const hasProxy = mediaFile?.proxyStatus === 'ready';
  const thumbnailStatus = mediaFile ? thumbnailCacheService.getStatus(mediaFile.id) : 'none';
  const hasSourceAudio = Boolean(
    audibleAudioClip ||
    mediaFile?.type === 'audio' ||
    (mediaFile?.type === 'video' && (mediaFile.hasAudio !== false || Boolean(mediaFile.audioCodec)))
  );
  const isAudioProxyGenerating = mediaFile?.audioProxyStatus === 'generating';
  const hasAudioProxy = mediaFile?.audioProxyStatus === 'ready' || mediaFile?.hasProxyAudio === true;
  const audioAnalysisJob = audibleAudioClip?.audioAnalysisJob;
  const isAudioAnalysisGenerating = Boolean(audibleAudioClip?.waveformGenerating || audioAnalysisJob);
  const audioAnalysisProgress = Math.round(Math.max(0, Math.min(100,
    audioAnalysisJob?.progress ?? audibleAudioClip?.waveformProgress ?? 0
  )));
  const hasSpectrogram = Boolean(
    audibleAudioClip?.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0] ||
    audibleAudioClip?.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0]
  );
  const hasThumbnailRegenerationSource = Boolean(mediaFile && (
    mediaFile.url ||
    mediaFile.file ||
    mediaObjectUrlManager.get(mediaFile.id, getPrimaryMediaObjectUrlKey())
  ));

  const { mediaItemId, currentColor } = resolveClipContextMenuLabelTarget(clip, useMediaStore.getState());
  const canSetLabelColor = Boolean(mediaItemId);
  const clipboardActions = {
    copyClipEffects,
    pasteClipEffects,
    copyClipColor,
    pasteClipColor,
  };
  const timelineActions = {
    splitClipAtPlayhead,
    rippleDeleteSelection,
    deleteClipSelection,
    deleteGapAtTime,
    linkClips,
    unlinkClips,
    syncClipsViaAudio,
    convertSolidToMotionShape,
    setMulticamDialogOpen,
    unlinkGroup,
    toggleClipReverse,
    createSubcompositionFromSelection,
    removeClip,
  };
  const commandContext: ClipContextMenuCommandExecutionContext = {
    clipId: contextMenu.clipId,
    clip,
    clips: allClips,
    targetClipIds,
    mediaFile,
    mediaItemId,
    thumbnailCache: thumbnailCacheService,
    getManagedPrimarySourceUrl: (mediaFileId: string) => mediaObjectUrlManager.get(mediaFileId, getPrimaryMediaObjectUrlKey()),
    createPrimarySourceUrl: (mediaFileId: string, file: File | Blob) => createPrimaryMediaObjectUrl(mediaFileId, file, {
      revokeExisting: false,
    }),
    proxyStore: useMediaStore.getState(),
    labelStore: useMediaStore.getState(),
    clipboardActions,
    timelineActions,
    resolveAudioClipId: (clips, clipId) => resolveAudibleAudioClipId(clips as TimelineClip[], clipId),
    generateWaveformForClip,
    generateSpectrogramForClip,
    startClipStemSeparation,
    toggleThumbnailsEnabled,
    toggleWaveformsEnabled,
    setAudioDisplayMode,
    loadTranscriber: () => import('../../services/clipTranscriber'),
    exportCurrentFrame: async () => {
      const blob = await captureCurrentPreviewFrameJpegBlob();
      if (!blob) {
        alert('Could not export current frame.');
        return false;
      }
      downloadBlob(blob, getFrameExportFilename(clip, playheadPosition));
      return true;
    },
    writeClipboardText: copyTextToClipboard,
    onCopyPromptComplete: confirmPromptCopied,
    showInExplorer,
    notify: (message: string) => alert(message),
    downloadRawFile: downloadClipContextMenuRawFile,
    logDebug: (message: string, value?: unknown) => log.debug(message, value),
    logWarning: (message: string, value?: unknown) => log.warn(message, value),
  };
  const runCommand = (command: ClipContextMenuCommandDescriptor) => {
    void executeClipContextMenuCommand(command, commandContext)
      .then((handled) => {
        if (handled) setContextMenu(null);
      })
      .catch((error) => {
        log.warn('Clip context menu command failed', { command: command.kind, error });
      });
  };

  return (
    <>
      {copiedPromptToast}
      <div
        ref={contextMenuRef}
        className="timeline-context-menu"
        style={{
          position: 'fixed',
          left: contextMenuPosition?.x ?? contextMenu.x,
          top: contextMenuPosition?.y ?? contextMenu.y,
          zIndex: 10000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
      {isMidi && clip && (
        <>
          <div
            className="context-menu-item"
            onClick={() => {
              useTimelineStore.getState().setClipRenameId(clip.id);
              setContextMenu(null);
            }}
          >
            Rename
          </div>
          <div className="context-menu-separator" />
        </>
      )}
      {isVideo && (
        <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
          <span>Show in Explorer</span>
          <span className="submenu-arrow">{'\u25B6'}</span>
          <div className="context-submenu">
            <div
              className="context-menu-item"
              onClick={() => runCommand({ kind: 'show-in-explorer', explorerType: 'raw', canExecute: Boolean(mediaFile) })}
            >
              Raw {mediaFile?.hasFileHandle && '(has path)'}
            </div>
            <div
              className={`context-menu-item ${!hasProxy ? 'disabled' : ''}`}
              onClick={() => runCommand({ kind: 'show-in-explorer', explorerType: 'proxy', canExecute: Boolean(mediaFile && hasProxy) })}
            >
              Proxy{' '}
              {!hasProxy
                ? '(not available)'
                : projectFileService.isProjectOpen()
                ? `(${projectFileService.getProjectData()?.name}/Proxy)`
                : '(IndexedDB)'}
            </div>
          </div>
        </div>
      )}

      {(isVideoMedia || hasSourceAudio || audibleAudioClip) && (
        <>
          <div className="context-menu-separator" />
          <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
            <span>Regenerate</span>
            <span className="submenu-arrow">{'\u25B6'}</span>
            <div className="context-submenu">
              {isVideoMedia && (
                <div
                  className={`context-menu-item ${!mediaFile || (!isGenerating && !mediaFile.file) ? 'disabled' : ''}`}
                  onClick={() => runCommand({
                    kind: 'proxy-generation',
                    action: isGenerating ? 'stop' : 'start',
                    options: { force: hasProxy },
                    canExecute: Boolean(mediaFile && (isGenerating || mediaFile.file)),
                  })}
                >
                  {isGenerating
                    ? `Stop Proxy Generation (${mediaFile?.proxyProgress || 0}%)`
                    : `Proxy${hasProxy ? ' (ready)' : ''}`}
                </div>
              )}
              {isVideoMedia && (
                <div
                  className={`context-menu-item ${thumbnailStatus === 'generating' || !hasThumbnailRegenerationSource ? 'disabled' : ''}`}
                  onClick={() => runCommand({
                    kind: 'regenerate-thumbnails',
                    canExecute: thumbnailStatus !== 'generating' && hasThumbnailRegenerationSource,
                  })}
                >
                  Thumbnails
                  {thumbnailStatus === 'ready'
                    ? ' (ready)'
                    : thumbnailStatus === 'generating'
                    ? ' (generating)'
                    : ''}
                </div>
              )}
              {hasSourceAudio && (
                <div
                  className={`context-menu-item ${!mediaFile || isAudioProxyGenerating ? 'disabled' : ''}`}
                  onClick={() => runCommand({
                    kind: 'audio-proxy-regeneration',
                    force: hasAudioProxy,
                    canExecute: Boolean(mediaFile && !isAudioProxyGenerating),
                  })}
                >
                  WAV Audio Proxy
                  {isAudioProxyGenerating
                    ? ` (${mediaFile?.audioProxyProgress || 0}%)`
                    : hasAudioProxy
                    ? ' (ready)'
                    : ''}
                </div>
              )}
              {audibleAudioClip && (
                <div
                  className={`context-menu-item ${isAudioAnalysisGenerating ? 'disabled' : ''}`}
                  onClick={() => runCommand({
                    kind: 'audio-analysis-regeneration',
                    analysisKind: 'waveform',
                    canExecute: !isAudioAnalysisGenerating,
                  })}
                >
                  Waveform
                  {isAudioAnalysisGenerating
                    ? ` (${audioAnalysisProgress}%)`
                    : audibleAudioClip.waveform?.length
                    ? ' (ready)'
                    : ''}
                </div>
              )}
              {audibleAudioClip && (
                <div
                  className={`context-menu-item ${isAudioAnalysisGenerating ? 'disabled' : ''}`}
                  onClick={() => runCommand({
                    kind: 'audio-analysis-regeneration',
                    analysisKind: 'spectral',
                    canExecute: !isAudioAnalysisGenerating,
                  })}
                >
                  Spectral
                  {isAudioAnalysisGenerating
                    ? ` (${audioAnalysisProgress}%)`
                    : hasSpectrogram
                    ? ' (ready)'
                    : ''}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {(isVideo || isAudio) && (
        <>
          <div className="context-menu-separator" />
          {isVideo && (
              <div
                className={`context-menu-item ${thumbnailsEnabled ? 'checked' : ''}`}
                onClick={() => runCommand({ kind: 'toggle-thumbnails', canExecute: true })}
              >
              {thumbnailsEnabled ? '\u2713 ' : ''}Show Thumbnail
            </div>
          )}
          {isAudio && (
            <>
              <div
                className={`context-menu-item ${waveformsEnabled ? 'checked' : ''}`}
                onClick={() => runCommand({ kind: 'toggle-waveforms', canExecute: true })}
              >
                {waveformsEnabled ? '\u2713 ' : ''}Waveforms
              </div>
              <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
                <span>Audio Display</span>
                <span className="submenu-arrow">{'\u25B6'}</span>
                <div className="context-submenu">
                  {([
                    ['compact', 'Compact Audio'],
                    ['detailed', 'Detailed Audio'],
                    ['spectral', 'Spectral Audio'],
                  ] as const).map(([mode, label]) => (
                    <div
                      key={mode}
                      className={`context-menu-item ${audioDisplayMode === mode ? 'checked' : ''}`}
                      onClick={() => runCommand({ kind: 'set-audio-display-mode', mode, canExecute: true })}
                    >
                      {audioDisplayMode === mode ? '\u2713 ' : ''}{label}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {canExportCurrentFrame && (
        <>
          <div className="context-menu-separator" />
          <div
            className="context-menu-item"
            onClick={() => runCommand({ kind: 'export-current-frame', canExecute: true })}
          >
            Export Current Frame
          </div>
        </>
      )}

      <div className="context-menu-separator" />
      <div
        className={`context-menu-item ${!canCopyGenerationPrompt ? 'disabled' : ''}`}
        onClick={() => runCommand({
          kind: 'copy-generation-prompt',
          prompt: generationPrompt,
          canExecute: canCopyGenerationPrompt,
        })}
      >
        Copy Prompt
      </div>

      <div className="context-menu-separator" />
      <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span>Effects</span>
        <span className="submenu-arrow">{'\u25B6'}</span>
        <div className="context-submenu">
          <div
            className="context-menu-item"
            onClick={() => runCommand({ kind: 'clipboard', command: 'copy-effects', canExecute: Boolean(clip) })}
          >
            {effectCopyLabel}
          </div>
          <div
            className={`context-menu-item ${!canPasteEffects || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => runCommand({ kind: 'clipboard', command: 'paste-effects', canExecute: canPasteEffects && canModifyTargets })}
          >
            {effectPasteLabel}
          </div>
          {showColorClipboardInEffects && (
            <>
              <div className="context-menu-separator" />
              <div
                className="context-menu-item"
                onClick={() => runCommand({ kind: 'clipboard', command: 'copy-color', canExecute: Boolean(clip) })}
              >
                Copy Color
              </div>
              <div
                className={`context-menu-item ${!canPasteColor || !canModifyTargets ? 'disabled' : ''}`}
                onClick={() => runCommand({ kind: 'clipboard', command: 'paste-color', canExecute: canPasteColor && canModifyTargets })}
              >
                Paste Color
              </div>
            </>
          )}
        </div>
      </div>
      {showColorClipboardTopLevel && (
        <>
          <div
            className="context-menu-item"
            onClick={() => runCommand({ kind: 'clipboard', command: 'copy-color', canExecute: Boolean(clip) })}
          >
            Copy Color
          </div>
          <div
            className={`context-menu-item ${!canPasteColor || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => runCommand({ kind: 'clipboard', command: 'paste-color', canExecute: canPasteColor && canModifyTargets })}
          >
            Paste Color
          </div>
        </>
      )}

      <div className="context-menu-separator" />
      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => runCommand({ kind: 'timeline', command: 'split-at-playhead', canExecute: canModifyTargets })}
      >
        Split at Playhead (C)
      </div>
      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => runCommand({ kind: 'timeline', command: 'ripple-delete', canExecute: canModifyTargets })}
      >
        Ripple Delete
      </div>
      <div
        className={`context-menu-item ${!canModifyTargets || !clip ? 'disabled' : ''}`}
        onClick={() => runCommand({ kind: 'timeline', command: 'delete-gap-at-clip-start', canExecute: canModifyTargets && Boolean(clip) })}
      >
        Delete Gap at Clip Start
      </div>

      {(targetClipIds.length >= 2 || hasClipLinkTarget || syncAudioClipIds.size >= 2) && (
        <>
          <div className="context-menu-separator" />
          {syncAudioClipIds.size >= 2 && (
            <div
              className={`context-menu-item ${!canSyncViaAudio ? 'disabled' : ''}`}
              onClick={() => runCommand({ kind: 'timeline', command: 'sync-via-audio', canExecute: canSyncViaAudio })}
            >
              Sync via Audio
            </div>
          )}
          {targetClipIds.length >= 2 && (
            <div
              className={`context-menu-item ${!canLinkClips ? 'disabled' : ''}`}
              onClick={() => runCommand({ kind: 'timeline', command: 'link-clips', canExecute: canLinkClips })}
            >
              Link Clips
            </div>
          )}
          {hasClipLinkTarget && (
            <div
              className={`context-menu-item ${!canUnlinkClips ? 'disabled' : ''}`}
              onClick={() => runCommand({ kind: 'timeline', command: 'unlink-clips', canExecute: canUnlinkClips })}
            >
              Unlink Clips
            </div>
          )}
        </>
      )}

      {isSolid && (
        <>
          <div className="context-menu-separator" />
          <div
            className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
            onClick={() => runCommand({ kind: 'timeline', command: 'convert-solid-to-motion-shape', canExecute: canModifyTargets })}
          >
            Convert Solid to Motion Shape
          </div>
        </>
      )}

      {clip?.linkedGroupId && !isManualLinkedGroupId(clip.linkedGroupId) && (
        <div
          className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
          onClick={() => runCommand({ kind: 'timeline', command: 'unlink-multicam-group', canExecute: canModifyTargets })}
        >
          Unlink from Multicam
        </div>
      )}

      {isVideo && (
        <div
          className={`context-menu-item ${clip?.reversed ? 'checked' : ''} ${!canModifyTargets ? 'disabled' : ''}`}
          onClick={() => runCommand({ kind: 'timeline', command: 'toggle-reverse', canExecute: canModifyTargets })}
        >
          {clip?.reversed ? '\u2713 ' : ''}Reverse Playback
        </div>
      )}

      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => runCommand({ kind: 'timeline', command: 'create-subcomposition', canExecute: canModifyTargets })}
      >
        Create Subcomposition
      </div>

      {audibleAudioClip && (
        <>
          <div className="context-menu-separator" />
          <div
            className={`context-menu-item ${isStemSeparationActive || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => runCommand({
              kind: 'stem-separation',
              force: hasStemSeparation,
              canExecute: canModifyTargets && !isStemSeparationActive,
            })}
          >
            {isStemSeparationActive
              ? `Separating Stems... ${stemProgressPercent}%`
              : hasStemSeparation
              ? 'Regenerate Stems...'
              : 'Stem Separation...'}
          </div>
        </>
      )}

      {(isVideo || isAudio) && (
        <>
          <div className="context-menu-separator" />
          <div
            className={`context-menu-item ${clip?.transcriptStatus === 'transcribing' ? 'disabled' : ''}`}
            onClick={() => runCommand({
              kind: 'transcription',
              transcriptStatus: clip?.transcriptStatus,
              canExecute: clip?.transcriptStatus !== 'transcribing',
            })}
          >
            {clip?.transcriptStatus === 'transcribing'
              ? `Transcribing... ${clip?.transcriptProgress || 0}%`
              : clip?.transcriptStatus === 'ready'
              ? `Re-transcribe (${activeTranscriptionProviderLabel})`
              : `Transcribe (${activeTranscriptionProviderLabel})`}
          </div>
        </>
      )}

      {/* Clip color picker — sets the media item's label color (synced between timeline and media panel) */}
      <div className="context-menu-separator" />
      <div className={`context-menu-item has-submenu ${!canSetLabelColor ? 'disabled' : ''}`} onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className="clip-color-indicator"
            style={{
              background: currentColor !== 'none' ? getLabelHex(currentColor) : 'var(--bg-tertiary)',
              width: 10,
              height: 10,
              borderRadius: 2,
              border: '1px solid rgba(255,255,255,0.2)',
              flexShrink: 0,
            }}
          />
          Label Color
        </span>
        <span className="submenu-arrow">{'\u25B6'}</span>
        <div className="context-submenu clip-color-submenu">
          <div className="clip-color-grid">
            {LABEL_COLORS.map(c => (
              <span
                key={c.key}
                className={`label-picker-swatch ${c.key === 'none' ? 'none' : ''} ${currentColor === c.key ? 'active' : ''}`}
                title={c.name}
                style={{ background: c.key === 'none' ? 'var(--bg-tertiary)' : c.hex }}
                onClick={() => runCommand({ kind: 'label-color', color: c.key, canExecute: canSetLabelColor })}
              >
                {c.key === 'none' && <span className="label-picker-x">&times;</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="context-menu-separator" />
      <div
        className={`context-menu-item danger ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => runCommand({ kind: 'timeline', command: 'delete-clip', canExecute: canModifyTargets })}
      >
        Delete Clip From Timeline
      </div>
      </div>
    </>
  );
}
