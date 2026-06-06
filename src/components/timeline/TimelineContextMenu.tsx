// TimelineContextMenu - Right-click context menu for timeline clips
// Extracted from Timeline.tsx for better maintainability

import { useEffect, useCallback } from 'react';
import { handleSubmenuHover, handleSubmenuLeave } from '../panels/media/submenuPosition';
import type { TimelineClip } from '../../types';
import type { MediaFile } from '../../stores/mediaStore';
import type { ClipStemSeparationJobState, GenerateClipAudioAnalysisOptions, TimelineAudioDisplayMode } from '../../stores/timeline/types';
import type { ContextMenuState } from './types';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { useMediaStore } from '../../stores/mediaStore';
import { projectFileService } from '../../services/projectFileService';
import { thumbnailCacheService } from '../../services/thumbnailCacheService';
import { Logger } from '../../services/logger';
import { LABEL_COLORS, getLabelHex } from '../panels/media/labelColors';
import { resolveAudibleAudioClip, resolveAudibleAudioClipId } from '../../services/audio/audioClipResolution';
import { isManualLinkedGroupId } from '../../stores/timeline/helpers/idGenerator';
import { isActiveStemJobPhase } from '../../stores/timeline/helpers/stemSeparationJobPhases';
import {
  createClipContextMenuModel,
  downloadClipContextMenuRawFile,
  executeClipContextMenuAudioAnalysisRegeneration,
  executeClipContextMenuAudioProxyRegeneration,
  executeClipContextMenuClipboardCommand,
  executeClipContextMenuLabelColor,
  executeClipContextMenuProxyGeneration,
  executeClipContextMenuShowInExplorer,
  executeClipContextMenuStemSeparation,
  executeClipContextMenuTimelineCommand,
  executeClipContextMenuTranscription,
  findMediaFileForClip,
  regenerateClipContextMenuThumbnails,
  resolveClipContextMenuLabelTarget,
} from './utils/clipContextMenu';
import {
  createPrimaryMediaObjectUrl,
  getPrimaryMediaObjectUrlKey,
  mediaObjectUrlManager,
} from '../../services/project/mediaObjectUrlManager';

const log = Logger.create('TimelineContextMenu');

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
  deleteGapAtTime: (time: number) => void;
  toggleClipReverse: (clipId: string) => void;
  unlinkGroup: (clipId: string) => void;
  linkClips: (clipIds: string[]) => void;
  unlinkClips: (clipIds: string[]) => void;
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
  deleteGapAtTime,
  toggleClipReverse,
  unlinkGroup,
  linkClips,
  unlinkClips,
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

  // Handle "Show in Explorer" action
  const handleShowInExplorer = async (type: 'raw' | 'proxy') => {
    if (!contextMenu) return;

    const mediaFile = getMediaFileForClip(contextMenu.clipId);
    if (!mediaFile) {
      log.warn('Media file not found for clip');
      setContextMenu(null);
      return;
    }

    await executeClipContextMenuShowInExplorer({
      type,
      mediaFile,
      showInExplorer,
      notify: (message) => alert(message),
      downloadRawFile: downloadClipContextMenuRawFile,
      logDebug: (message, value) => log.debug(message, value),
    });

    setContextMenu(null);
  };

  // Handle Start/Stop Proxy Generation
  const handleProxyGeneration = (action: 'start' | 'stop', options: { force?: boolean } = {}) => {
    if (!contextMenu) return;

    const mediaFile = getMediaFileForClip(contextMenu.clipId);
    if (!mediaFile) {
      setContextMenu(null);
      return;
    }

    const handled = executeClipContextMenuProxyGeneration({
      mediaFile,
      proxyStore: useMediaStore.getState(),
      action,
      options,
    });

    if (handled && action === 'start') {
      log.debug('Starting proxy generation for:', mediaFile.name);
    } else if (handled) {
      log.debug('Cancelled proxy generation for:', mediaFile.name);
    }

    setContextMenu(null);
  };

  const handleThumbnailRegeneration = () => {
    if (!contextMenu) return;

    const mediaFile = getMediaFileForClip(contextMenu.clipId);
    if (!mediaFile) {
      setContextMenu(null);
      return;
    }

    void (async () => {
      const result = await regenerateClipContextMenuThumbnails({
        mediaFile,
        clips: [...clipMap.values()],
        thumbnailCache: thumbnailCacheService,
        getManagedPrimarySourceUrl: (mediaFileId) => mediaObjectUrlManager.get(mediaFileId, getPrimaryMediaObjectUrlKey()),
        createPrimarySourceUrl: (mediaFileId, file) => createPrimaryMediaObjectUrl(mediaFileId, file, {
          revokeExisting: false,
        }),
      });
      if (!result.success) {
        log.warn('No source URL available for thumbnail regeneration', {
          mediaFileId: mediaFile.id,
          name: mediaFile.name,
          reason: result.reason,
        });
      }
    })().catch((error) => {
      log.warn('Thumbnail regeneration failed', { mediaFileId: mediaFile.id, error });
    });

    setContextMenu(null);
  };

  const handleAudioProxyRegeneration = (force: boolean) => {
    if (!contextMenu) return;

    const mediaFile = getMediaFileForClip(contextMenu.clipId);
    executeClipContextMenuAudioProxyRegeneration({
      mediaFile,
      proxyStore: useMediaStore.getState(),
      force,
    });

    setContextMenu(null);
  };

  const handleWaveformRegeneration = () => {
    if (!contextMenu) return;

    executeClipContextMenuAudioAnalysisRegeneration({
      clipId: contextMenu.clipId,
      clips: [...clipMap.values()],
      kind: 'waveform',
      resolveAudioClipId: (clips, clipId) => resolveAudibleAudioClipId(clips as TimelineClip[], clipId),
      generateWaveformForClip,
      generateSpectrogramForClip,
    });

    setContextMenu(null);
  };

  const handleSpectralRegeneration = () => {
    if (!contextMenu) return;

    executeClipContextMenuAudioAnalysisRegeneration({
      clipId: contextMenu.clipId,
      clips: [...clipMap.values()],
      kind: 'spectral',
      resolveAudioClipId: (clips, clipId) => resolveAudibleAudioClipId(clips as TimelineClip[], clipId),
      generateWaveformForClip,
      generateSpectrogramForClip,
    });

    setContextMenu(null);
  };

  if (!contextMenu) return null;

  const mediaFile = getMediaFileForClip(contextMenu.clipId);
  const clip = clipMap.get(contextMenu.clipId);
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
  const audibleAudioResolution = resolveAudibleAudioClip([...clipMap.values()], contextMenu.clipId);
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

  const { mediaItemId, currentColor } = resolveClipContextMenuLabelTarget(clip, useMediaStore.getState());
  const clipboardActions = {
    copyClipEffects,
    pasteClipEffects,
    copyClipColor,
    pasteClipColor,
  };
  const timelineActions = {
    splitClipAtPlayhead,
    rippleDeleteSelection,
    deleteGapAtTime,
    linkClips,
    unlinkClips,
    convertSolidToMotionShape,
    setMulticamDialogOpen,
    unlinkGroup,
    toggleClipReverse,
    createSubcompositionFromSelection,
    removeClip,
  };
  const runClipboardCommand = (
    command: Parameters<typeof executeClipContextMenuClipboardCommand>[0]['command'],
    canExecute: boolean,
  ) => {
    const handled = executeClipContextMenuClipboardCommand({
      command,
      clipId: contextMenu.clipId,
      targetClipIds,
      canExecute,
      actions: clipboardActions,
    });
    if (handled) setContextMenu(null);
  };
  const runTimelineCommand = (
    command: Parameters<typeof executeClipContextMenuTimelineCommand>[0]['command'],
    canExecute: boolean,
  ) => {
    const handled = executeClipContextMenuTimelineCommand({
      command,
      clip,
      clipId: contextMenu.clipId,
      targetClipIds,
      canExecute,
      actions: timelineActions,
    });
    if (handled) setContextMenu(null);
  };
  const runStemSeparationCommand = () => {
    const handled = executeClipContextMenuStemSeparation({
      clipId: contextMenu.clipId,
      canExecute: canModifyTargets && !isStemSeparationActive,
      force: hasStemSeparation,
      startClipStemSeparation,
    });
    if (handled) setContextMenu(null);
  };

  return (
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
      {isVideo && (
        <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
          <span>Show in Explorer</span>
          <span className="submenu-arrow">{'\u25B6'}</span>
          <div className="context-submenu">
            <div
              className="context-menu-item"
              onClick={() => handleShowInExplorer('raw')}
            >
              Raw {mediaFile?.hasFileHandle && '(has path)'}
            </div>
            <div
              className={`context-menu-item ${!hasProxy ? 'disabled' : ''}`}
              onClick={() => hasProxy && handleShowInExplorer('proxy')}
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
                  onClick={() => {
                    if (!mediaFile || (!isGenerating && !mediaFile.file)) return;
                    handleProxyGeneration(isGenerating ? 'stop' : 'start', { force: hasProxy });
                  }}
                >
                  {isGenerating
                    ? `Stop Proxy Generation (${mediaFile?.proxyProgress || 0}%)`
                    : `Proxy${hasProxy ? ' (ready)' : ''}`}
                </div>
              )}
              {isVideoMedia && (
                <div
                  className={`context-menu-item ${thumbnailStatus === 'generating' ? 'disabled' : ''}`}
                  onClick={() => {
                    if (thumbnailStatus === 'generating') return;
                    handleThumbnailRegeneration();
                  }}
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
                  onClick={() => {
                    if (!mediaFile || isAudioProxyGenerating) return;
                    handleAudioProxyRegeneration(hasAudioProxy);
                  }}
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
                  onClick={() => {
                    if (isAudioAnalysisGenerating) return;
                    handleWaveformRegeneration();
                  }}
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
                  onClick={() => {
                    if (isAudioAnalysisGenerating) return;
                    handleSpectralRegeneration();
                  }}
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
              onClick={() => {
                toggleThumbnailsEnabled();
                setContextMenu(null);
              }}
            >
              {thumbnailsEnabled ? '\u2713 ' : ''}Show Thumbnail
            </div>
          )}
          {isAudio && (
            <>
              <div
                className={`context-menu-item ${waveformsEnabled ? 'checked' : ''}`}
                onClick={() => {
                  toggleWaveformsEnabled();
                  setContextMenu(null);
                }}
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
                      onClick={() => {
                        setAudioDisplayMode(mode);
                        setContextMenu(null);
                      }}
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

      <div className="context-menu-separator" />
      <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span>Effects</span>
        <span className="submenu-arrow">{'\u25B6'}</span>
        <div className="context-submenu">
          <div
            className="context-menu-item"
            onClick={() => runClipboardCommand('copy-effects', Boolean(contextMenu.clipId))}
          >
            {effectCopyLabel}
          </div>
          <div
            className={`context-menu-item ${!canPasteEffects || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => runClipboardCommand('paste-effects', canPasteEffects && canModifyTargets)}
          >
            {effectPasteLabel}
          </div>
          {showColorClipboardInEffects && (
            <>
              <div className="context-menu-separator" />
              <div
                className="context-menu-item"
                onClick={() => runClipboardCommand('copy-color', Boolean(contextMenu.clipId))}
              >
                Copy Color
              </div>
              <div
                className={`context-menu-item ${!canPasteColor || !canModifyTargets ? 'disabled' : ''}`}
                onClick={() => runClipboardCommand('paste-color', canPasteColor && canModifyTargets)}
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
            onClick={() => runClipboardCommand('copy-color', Boolean(contextMenu.clipId))}
          >
            Copy Color
          </div>
          <div
            className={`context-menu-item ${!canPasteColor || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => runClipboardCommand('paste-color', canPasteColor && canModifyTargets)}
          >
            Paste Color
          </div>
        </>
      )}

      <div className="context-menu-separator" />
      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => runTimelineCommand('split-at-playhead', canModifyTargets)}
      >
        Split at Playhead (C)
      </div>
      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => runTimelineCommand('ripple-delete', canModifyTargets)}
      >
        Ripple Delete
      </div>
      <div
        className="context-menu-item"
        onClick={() => runTimelineCommand('delete-gap-at-clip-start', true)}
      >
        Delete Gap at Clip Start
      </div>

      {(targetClipIds.length >= 2 || hasClipLinkTarget) && (
        <>
          <div className="context-menu-separator" />
          {targetClipIds.length >= 2 && (
            <div
              className={`context-menu-item ${!canLinkClips ? 'disabled' : ''}`}
              onClick={() => runTimelineCommand('link-clips', canLinkClips)}
            >
              Link Clips
            </div>
          )}
          {hasClipLinkTarget && (
            <div
              className={`context-menu-item ${!canUnlinkClips ? 'disabled' : ''}`}
              onClick={() => runTimelineCommand('unlink-clips', canUnlinkClips)}
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
            onClick={() => runTimelineCommand('convert-solid-to-motion-shape', canModifyTargets)}
          >
            Convert Solid to Motion Shape
          </div>
        </>
      )}

      {/* Multicam options */}
      {selectedClipIds.size > 1 && (
        <div
          className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
          onClick={() => runTimelineCommand('open-multicam-dialog', canModifyTargets)}
        >
          Combine Multicam ({selectedClipIds.size} clips)
        </div>
      )}
      {clip?.linkedGroupId && !isManualLinkedGroupId(clip.linkedGroupId) && (
        <div
          className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
          onClick={() => runTimelineCommand('unlink-multicam-group', canModifyTargets)}
        >
          Unlink from Multicam
        </div>
      )}

      {isVideo && (
        <div
          className={`context-menu-item ${clip?.reversed ? 'checked' : ''} ${!canModifyTargets ? 'disabled' : ''}`}
          onClick={() => runTimelineCommand('toggle-reverse', canModifyTargets)}
        >
          {clip?.reversed ? '\u2713 ' : ''}Reverse Playback
        </div>
      )}

      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => runTimelineCommand('create-subcomposition', canModifyTargets)}
      >
        Create Subcomposition
      </div>

      {audibleAudioClip && (
        <>
          <div className="context-menu-separator" />
          <div
            className={`context-menu-item ${isStemSeparationActive || !canModifyTargets ? 'disabled' : ''}`}
            onClick={runStemSeparationCommand}
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
            onClick={async () => {
              await executeClipContextMenuTranscription({
                clipId: contextMenu.clipId,
                transcriptStatus: clip?.transcriptStatus,
                loadTranscriber: () => import('../../services/clipTranscriber'),
              });
              setContextMenu(null);
            }}
          >
            {clip?.transcriptStatus === 'transcribing'
              ? `Transcribing... ${clip?.transcriptProgress || 0}%`
              : clip?.transcriptStatus === 'ready'
              ? 'Re-transcribe'
              : 'Transcribe'}
          </div>
        </>
      )}

      {/* Clip color picker — sets the media item's label color (synced between timeline and media panel) */}
      <div className="context-menu-separator" />
      <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
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
                onClick={() => {
                  executeClipContextMenuLabelColor({
                    mediaItemId,
                    color: c.key,
                    labelStore: useMediaStore.getState(),
                  });
                  setContextMenu(null);
                }}
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
        onClick={() => runTimelineCommand('delete-clip', canModifyTargets)}
      >
        Delete Clip From Timeline
      </div>
    </div>
  );
}
