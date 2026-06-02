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
import { useTimelineStore } from '../../stores/timeline';
import { projectFileService } from '../../services/projectFileService';
import { thumbnailCacheService } from '../../services/thumbnailCacheService';
import { Logger } from '../../services/logger';
import { LABEL_COLORS, getLabelHex } from '../panels/media/labelColors';
import type { LabelColor } from '../../stores/mediaStore/types';
import { resolveAudibleAudioClip } from '../../services/audio/audioClipResolution';
import { isManualLinkedGroupId } from '../../stores/timeline/helpers/idGenerator';

const log = Logger.create('TimelineContextMenu');
const ACTIVE_STEM_JOB_PHASES = new Set<ClipStemSeparationJobState['phase']>([
  'queued',
  'preparing',
  'downloading-model',
  'loading-model',
  'separating',
  'storing',
]);

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
      if (!clip) return null;

      const mediaStore = useMediaStore.getState();
      return mediaStore.files.find(
        (f) =>
          f.id === clip.mediaFileId ||
          f.id === clip.source?.mediaFileId ||
          f.name === clip.name ||
          f.name === clip.name.replace(' (Audio)', '')
      ) || null;
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

    const result = await showInExplorer(type, mediaFile.id);

    if (result.success) {
      alert(result.message);
    } else {
      if (type === 'raw' && mediaFile.file) {
        const url = URL.createObjectURL(mediaFile.file);
        const a = document.createElement('a');
        a.href = url;
        a.download = mediaFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log.debug('Downloaded raw file:', mediaFile.name);
      } else {
        alert(result.message);
      }
    }

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

    const mediaStore = useMediaStore.getState();

    if (action === 'start') {
      mediaStore.generateProxy(mediaFile.id, options);
      log.debug('Starting proxy generation for:', mediaFile.name);
    } else {
      mediaStore.cancelProxyGeneration(mediaFile.id);
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

    const videoClip = [...clipMap.values()].find((candidate) =>
      (candidate.mediaFileId === mediaFile.id || candidate.source?.mediaFileId === mediaFile.id) &&
      candidate.source?.type === 'video' &&
      candidate.source.videoElement
    );
    const sourceVideo = videoClip?.source?.type === 'video'
      ? videoClip.source.videoElement
      : null;

    if (!sourceVideo) {
      log.warn('No video element available for thumbnail regeneration', {
        mediaFileId: mediaFile.id,
        name: mediaFile.name,
      });
      setContextMenu(null);
      return;
    }

    const duration = mediaFile.duration ||
      videoClip?.source?.naturalDuration ||
      sourceVideo.duration ||
      videoClip?.duration ||
      0;

    void (async () => {
      await thumbnailCacheService.clearSource(mediaFile.id);
      await thumbnailCacheService.generateForSource(mediaFile.id, sourceVideo, duration, mediaFile.fileHash);
    })().catch((error) => {
      log.warn('Thumbnail regeneration failed', { mediaFileId: mediaFile.id, error });
    });

    setContextMenu(null);
  };

  const handleAudioProxyRegeneration = (force: boolean) => {
    if (!contextMenu) return;

    const mediaFile = getMediaFileForClip(contextMenu.clipId);
    if (mediaFile) {
      void useMediaStore.getState().generateAudioProxy(mediaFile.id, { force });
    }

    setContextMenu(null);
  };

  const handleWaveformRegeneration = () => {
    if (!contextMenu) return;

    const resolved = resolveAudibleAudioClip([...clipMap.values()], contextMenu.clipId);
    if (resolved?.audioClip.id) {
      generateWaveformForClip(resolved.audioClip.id, { force: true });
    }

    setContextMenu(null);
  };

  const handleSpectralRegeneration = () => {
    if (!contextMenu) return;

    const resolved = resolveAudibleAudioClip([...clipMap.values()], contextMenu.clipId);
    if (resolved?.audioClip.id) {
      generateSpectrogramForClip(resolved.audioClip.id, { force: true });
    }

    setContextMenu(null);
  };

  if (!contextMenu) return null;

  const mediaFile = getMediaFileForClip(contextMenu.clipId);
  const clip = clipMap.get(contextMenu.clipId);
  const isVideo = clip?.source?.type === 'video';
  const isAudio = clip?.source?.type === 'audio';
  const isMidi = clip?.source?.type === 'midi';
  const isSolid = clip?.source?.type === 'solid';
  const isVideoMedia = mediaFile?.type === 'video' || isVideo;
  const audibleAudioResolution = resolveAudibleAudioClip([...clipMap.values()], contextMenu.clipId);
  const audibleAudioClip = audibleAudioResolution?.audioClip ?? null;
  const stemSeparationJob = audibleAudioClip ? clipStemSeparationJobs[audibleAudioClip.id] : undefined;
  const isStemSeparationActive = ACTIVE_STEM_JOB_PHASES.has(stemSeparationJob?.phase ?? 'failed');
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
  const canPasteEffects = hasClipboardEffects();
  const canPasteColor = hasClipboardColor();
  const getPasteTargetClipIds = (): string[] => {
    if (!contextMenu?.clipId) return [];
    return selectedClipIds.has(contextMenu.clipId)
      ? [...selectedClipIds]
      : [contextMenu.clipId];
  };
  const targetClipIds = getPasteTargetClipIds();
  const getClipLinkAffectedIds = (): Set<string> => {
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

    return affectedIds;
  };
  const clipLinkAffectedIds = getClipLinkAffectedIds();
  const hasClipLinkTarget = targetClipIds.some((clipId) => {
    const targetClip = clipMap.get(clipId);
    if (!targetClip) return false;
    return Boolean(targetClip.linkedClipId) ||
      isManualLinkedGroupId(targetClip.linkedGroupId) ||
      [...clipMap.values()].some((candidate) => candidate.linkedClipId === clipId);
  });
  const hasLockedTarget = targetClipIds.some(isClipLocked);
  const hasLockedClipLinkTarget = [...clipLinkAffectedIds].some(isClipLocked);
  const canModifyTargets = !hasLockedTarget;
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
  const showColorClipboardInEffects = Boolean(isVideo);
  const showColorClipboardTopLevel = !isAudio && !showColorClipboardInEffects;

  // Resolve the media item ID and current label color for the clip
  const resolveMediaItemColor = (): { mediaItemId: string | null; currentColor: LabelColor } => {
    if (!clip) return { mediaItemId: null, currentColor: 'none' };
    const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
    const ms = useMediaStore.getState();

    // Composition clips
    if (clip.compositionId) {
      const comp = ms.compositions.find(c => c.id === clip.compositionId);
      if (comp) return { mediaItemId: comp.id, currentColor: comp.labelColor || 'none' };
    }
    // Regular media files
    if (mediaFileId) {
      const file = ms.files.find(f => f.id === mediaFileId);
      if (file) return { mediaItemId: file.id, currentColor: file.labelColor || 'none' };
    }
    // Solid items
    if (clip.source?.type === 'solid') {
      const solid = mediaFileId
        ? ms.solidItems.find(si => si.id === mediaFileId)
        : ms.solidItems.find(si => si.name === clip.name);
      if (solid) return { mediaItemId: solid.id, currentColor: solid.labelColor || 'none' };
    }
    // Text items
    if (clip.source?.type === 'text') {
      const text = mediaFileId
        ? ms.textItems.find(ti => ti.id === mediaFileId)
        : ms.textItems.find(ti => ti.name === clip.name);
      if (text) return { mediaItemId: text.id, currentColor: text.labelColor || 'none' };
    }
    // Mesh items
    if (clip.source?.type === 'model') {
      const mesh = mediaFileId
        ? (ms.meshItems || []).find(m => m.id === mediaFileId)
        : (ms.meshItems || []).find(m => m.name === clip.name || m.meshType === clip.meshType);
      if (mesh) return { mediaItemId: mesh.id, currentColor: mesh.labelColor || 'none' };
    }
    // Camera items
    if (clip.source?.type === 'camera') {
      const cam = mediaFileId
        ? (ms.cameraItems || []).find(c => c.id === mediaFileId)
        : (ms.cameraItems || [])[0]; // Usually only one camera item
      if (cam) return { mediaItemId: cam.id, currentColor: cam.labelColor || 'none' };
    }
    if (clip.source?.type === 'splat-effector') {
      const effector = mediaFileId
        ? (ms.splatEffectorItems || []).find(e => e.id === mediaFileId)
        : (ms.splatEffectorItems || []).find(e => e.name === clip.name);
      if (effector) return { mediaItemId: effector.id, currentColor: effector.labelColor || 'none' };
    }
    return { mediaItemId: null, currentColor: 'none' };
  };
  const { mediaItemId, currentColor } = resolveMediaItemColor();

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
            onClick={() => {
              if (contextMenu.clipId) {
                copyClipEffects(contextMenu.clipId);
              }
              setContextMenu(null);
            }}
          >
            {effectCopyLabel}
          </div>
          <div
            className={`context-menu-item ${!canPasteEffects || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => {
              if (!canPasteEffects || !canModifyTargets) return;
              pasteClipEffects(targetClipIds);
              setContextMenu(null);
            }}
          >
            {effectPasteLabel}
          </div>
          {showColorClipboardInEffects && (
            <>
              <div className="context-menu-separator" />
              <div
                className="context-menu-item"
                onClick={() => {
                  if (contextMenu.clipId) {
                    copyClipColor(contextMenu.clipId);
                  }
                  setContextMenu(null);
                }}
              >
                Copy Color
              </div>
              <div
                className={`context-menu-item ${!canPasteColor || !canModifyTargets ? 'disabled' : ''}`}
                onClick={() => {
                  if (!canPasteColor || !canModifyTargets) return;
                  pasteClipColor(targetClipIds);
                  setContextMenu(null);
                }}
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
            onClick={() => {
              if (contextMenu.clipId) {
                copyClipColor(contextMenu.clipId);
              }
              setContextMenu(null);
            }}
          >
            Copy Color
          </div>
          <div
            className={`context-menu-item ${!canPasteColor || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => {
              if (!canPasteColor || !canModifyTargets) return;
              pasteClipColor(targetClipIds);
              setContextMenu(null);
            }}
          >
            Paste Color
          </div>
        </>
      )}

      <div className="context-menu-separator" />
      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => {
          if (!canModifyTargets) return;
          splitClipAtPlayhead();
          setContextMenu(null);
        }}
      >
        Split at Playhead (C)
      </div>
      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => {
          if (!canModifyTargets) return;
          rippleDeleteSelection(targetClipIds);
          setContextMenu(null);
        }}
      >
        Ripple Delete
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          if (!contextMenu) return;
          const targetTime = Math.max(0, (clip?.startTime ?? 0) - 0.0005);
          deleteGapAtTime(targetTime);
          setContextMenu(null);
        }}
      >
        Delete Gap at Clip Start
      </div>

      {(targetClipIds.length >= 2 || hasClipLinkTarget) && (
        <>
          <div className="context-menu-separator" />
          {targetClipIds.length >= 2 && (
            <div
              className={`context-menu-item ${!canLinkClips ? 'disabled' : ''}`}
              onClick={() => {
                if (!canLinkClips) return;
                linkClips(targetClipIds);
                setContextMenu(null);
              }}
            >
              Link Clips
            </div>
          )}
          {hasClipLinkTarget && (
            <div
              className={`context-menu-item ${!canUnlinkClips ? 'disabled' : ''}`}
              onClick={() => {
                if (!canUnlinkClips) return;
                unlinkClips(targetClipIds);
                setContextMenu(null);
              }}
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
            onClick={() => {
              if (!canModifyTargets) return;
              if (contextMenu.clipId) {
                convertSolidToMotionShape(contextMenu.clipId);
              }
              setContextMenu(null);
            }}
          >
            Convert Solid to Motion Shape
          </div>
        </>
      )}

      {/* Multicam options */}
      {selectedClipIds.size > 1 && (
        <div
          className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
          onClick={() => {
            if (!canModifyTargets) return;
            setMulticamDialogOpen(true);
            setContextMenu(null);
          }}
        >
          Combine Multicam ({selectedClipIds.size} clips)
        </div>
      )}
      {clip?.linkedGroupId && !isManualLinkedGroupId(clip.linkedGroupId) && (
        <div
          className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
          onClick={() => {
            if (!canModifyTargets) return;
            if (contextMenu.clipId) {
              unlinkGroup(contextMenu.clipId);
            }
            setContextMenu(null);
          }}
        >
          Unlink from Multicam
        </div>
      )}

      {isVideo && (
        <div
          className={`context-menu-item ${clip?.reversed ? 'checked' : ''} ${!canModifyTargets ? 'disabled' : ''}`}
          onClick={() => {
            if (!canModifyTargets) return;
            if (contextMenu.clipId) {
              toggleClipReverse(contextMenu.clipId);
            }
            setContextMenu(null);
          }}
        >
          {clip?.reversed ? '\u2713 ' : ''}Reverse Playback
        </div>
      )}

      <div
        className={`context-menu-item ${!canModifyTargets ? 'disabled' : ''}`}
        onClick={() => {
          if (!canModifyTargets || !contextMenu.clipId) return;
          createSubcompositionFromSelection(contextMenu.clipId);
          setContextMenu(null);
        }}
      >
        Create Subcomposition
      </div>

      {audibleAudioClip && (
        <>
          <div className="context-menu-separator" />
          <div
            className={`context-menu-item ${isStemSeparationActive || !canModifyTargets ? 'disabled' : ''}`}
            onClick={() => {
              if (!contextMenu.clipId || isStemSeparationActive || !canModifyTargets) return;
              void startClipStemSeparation(contextMenu.clipId, { force: hasStemSeparation });
              setContextMenu(null);
            }}
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
              if (contextMenu.clipId && clip?.transcriptStatus !== 'transcribing') {
                const { transcribeClip } = await import('../../services/clipTranscriber');
                transcribeClip(contextMenu.clipId);
              }
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
                  if (mediaItemId) {
                    useMediaStore.getState().setLabelColor([mediaItemId], c.key as LabelColor);
                  }
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
        onClick={() => {
          if (!canModifyTargets) return;
          if (contextMenu.clipId) {
            removeClip(contextMenu.clipId);
          }
          setContextMenu(null);
        }}
      >
        Delete Clip From Timeline
      </div>
    </div>
  );
}
