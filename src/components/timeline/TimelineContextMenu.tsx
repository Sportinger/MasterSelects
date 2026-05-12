// TimelineContextMenu - Right-click context menu for timeline clips
// Extracted from Timeline.tsx for better maintainability

import { useEffect, useCallback } from 'react';
import { handleSubmenuHover, handleSubmenuLeave } from '../panels/media/submenuPosition';
import type { TimelineClip } from '../../types';
import type { MediaFile } from '../../stores/mediaStore';
import type { ContextMenuState } from './types';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { useMediaStore } from '../../stores/mediaStore';
import { projectFileService } from '../../services/projectFileService';
import { Logger } from '../../services/logger';
import { LABEL_COLORS, getLabelHex } from '../panels/media/labelColors';
import type { LabelColor } from '../../stores/mediaStore/types';

const log = Logger.create('TimelineContextMenu');

interface TimelineContextMenuProps {
  contextMenu: ContextMenuState | null;
  setContextMenu: (menu: ContextMenuState | null) => void;

  // Clip data
  clipMap: Map<string, TimelineClip>;
  selectedClipIds: Set<string>;
  isClipLocked: (clipId: string) => boolean;

  // Actions
  selectClip: (clipId: string) => void;
  removeClip: (clipId: string) => void;
  splitClipAtPlayhead: () => void;
  toggleClipReverse: (clipId: string) => void;
  unlinkGroup: (clipId: string) => void;
  generateWaveformForClip: (clipId: string) => void;
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
  selectClip: _selectClip,
  removeClip,
  splitClipAtPlayhead,
  toggleClipReverse,
  unlinkGroup,
  generateWaveformForClip,
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
  const handleProxyGeneration = (action: 'start' | 'stop') => {
    if (!contextMenu) return;

    const mediaFile = getMediaFileForClip(contextMenu.clipId);
    if (!mediaFile) {
      setContextMenu(null);
      return;
    }

    const mediaStore = useMediaStore.getState();

    if (action === 'start') {
      mediaStore.generateProxy(mediaFile.id);
      log.debug('Starting proxy generation for:', mediaFile.name);
    } else {
      mediaStore.cancelProxyGeneration(mediaFile.id);
      log.debug('Cancelled proxy generation for:', mediaFile.name);
    }

    setContextMenu(null);
  };

  if (!contextMenu) return null;

  const mediaFile = getMediaFileForClip(contextMenu.clipId);
  const clip = clipMap.get(contextMenu.clipId);
  const isVideo = clip?.source?.type === 'video';
  const isSolid = clip?.source?.type === 'solid';
  const isGenerating = mediaFile?.proxyStatus === 'generating';
  const hasProxy = mediaFile?.proxyStatus === 'ready';
  const canPasteEffects = hasClipboardEffects();
  const canPasteColor = hasClipboardColor();
  const getPasteTargetClipIds = (): string[] => {
    if (!contextMenu?.clipId) return [];
    return selectedClipIds.has(contextMenu.clipId)
      ? [...selectedClipIds]
      : [contextMenu.clipId];
  };
  const targetClipIds = getPasteTargetClipIds();
  const hasLockedTarget = targetClipIds.some(isClipLocked);
  const canModifyTargets = !hasLockedTarget;

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

      {isVideo && (
        <>
          <div className="context-menu-separator" />
          {isGenerating ? (
            <div
              className="context-menu-item"
              onClick={() => handleProxyGeneration('stop')}
            >
              Stop Proxy Generation ({mediaFile?.proxyProgress || 0}%)
            </div>
          ) : hasProxy ? (
            <div className="context-menu-item disabled">Proxy Ready</div>
          ) : (
            <div
              className="context-menu-item"
              onClick={() => handleProxyGeneration('start')}
            >
              Generate Proxy
            </div>
          )}
        </>
      )}

      <div className="context-menu-separator" />
      <div
        className="context-menu-item"
        onClick={() => {
          if (contextMenu.clipId) {
            copyClipEffects(contextMenu.clipId);
          }
          setContextMenu(null);
        }}
      >
        Copy Effects
      </div>
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
        className={`context-menu-item ${!canPasteEffects || !canModifyTargets ? 'disabled' : ''}`}
        onClick={() => {
          if (!canPasteEffects || !canModifyTargets) return;
          pasteClipEffects(targetClipIds);
          setContextMenu(null);
        }}
      >
        Paste Effects
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
      {clip?.linkedGroupId && (
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

      {/* Generate Waveform option for audio clips */}
      {clip?.source?.type === 'audio' && (
        <>
          <div className="context-menu-separator" />
          <div
            className={`context-menu-item ${clip?.waveformGenerating ? 'disabled' : ''}`}
            onClick={() => {
              if (contextMenu.clipId && !clip?.waveformGenerating) {
                generateWaveformForClip(contextMenu.clipId);
              }
              setContextMenu(null);
            }}
          >
            {clip?.waveformGenerating
              ? `Generating Waveform... ${clip?.waveformProgress || 0}%`
              : clip?.waveform && clip.waveform.length > 0
              ? 'Regenerate Waveform'
              : 'Generate Waveform'}
          </div>
        </>
      )}

      {(isVideo || clip?.source?.type === 'audio') && (
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
        Delete Clip
      </div>
    </div>
  );
}
