// TrackContextMenu - Right-click context menu for track headers
// Allows adding/deleting video and audio tracks

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { useTimelineStore } from '../../stores/timeline';
import type { LabelColor } from '../../stores/mediaStore/types';
import { LABEL_COLORS, getLabelHex } from '../panels/media/labelColors';
import { handleSubmenuHover, handleSubmenuLeave } from '../panels/media/submenuPosition';
import { getTrackLabelColor, getTimelineTrackColor } from './trackColor';
import {
  createAddTrackCommands,
  createTrackColorSwatchCommands,
  createTrackContextMenuModel,
  executeTrackColorSwatchCommand,
  executeTrackContextMenuCommand,
  type TrackContextMenuCommand,
  type TrackColorSwatchCommand,
} from './utils/trackContextMenu';

export interface TrackContextMenuState {
  x: number;
  y: number;
  /** null = opened on empty header-column space: add-track commands only. */
  trackId: string | null;
  trackType: 'video' | 'audio' | 'midi' | 'score' | null;
  trackName: string | null;
}

interface TrackContextMenuProps {
  menu: TrackContextMenuState | null;
  onClose: () => void;
}

export function TrackContextMenu({ menu, onClose }: TrackContextMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);

  // Close on outside pointer/context interactions or Escape. Some timeline
  // surfaces stop bubbling click events, so listen in capture phase.
  useEffect(() => {
    if (!menu) return;

    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onClose();
    };

    const handleContextMenuOutside = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerOutside, true);
      document.addEventListener('contextmenu', handleContextMenuOutside, true);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handleContextMenuOutside, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, menuRef, onClose]);

  if (!menu) return null;

  // Empty header-column variant: no target track, so only "add track" entries.
  if (menu.trackId === null) {
    const addCommands = createAddTrackCommands();
    const runAddCommand = (command: TrackContextMenuCommand) => {
      const executed = executeTrackContextMenuCommand(command, {
        addTrack: (trackType) => useTimelineStore.getState().addTrack(trackType),
        duplicateTrack: () => {},
        deleteTrack: () => {},
      });
      if (executed) onClose();
    };
    return createPortal(
      <div
        ref={menuRef}
        className="timeline-context-menu"
        style={{
          position: 'fixed',
          left: adjustedPosition?.x ?? menu.x,
          top: adjustedPosition?.y ?? menu.y,
          zIndex: 10000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {addCommands.map(command => (
          <div key={command.key} className="context-menu-item" onClick={() => runAddCommand(command)}>
            {command.label}
          </div>
        ))}
      </div>,
      document.body
    );
  }

  const store = useTimelineStore.getState();
  const menuTrackId = menu.trackId;
  // The row handler always sets type+name alongside the id.
  const menuTrackType = menu.trackType ?? 'video';
  const menuTrackName = menu.trackName ?? '';
  const track = store.tracks.find(t => t.id === menuTrackId);
  const trackClipCount = store.clips.filter(c => c.trackId === menuTrackId).length;
  const trackCount = store.tracks.filter(t => t.type === menuTrackType).length;
  const currentColor = getTrackLabelColor(track);
  const currentColorHex = currentColor === 'none'
    ? (track ? getTimelineTrackColor(track) : 'var(--bg-tertiary)')
    : getLabelHex(currentColor);

  const contextMenuModel = createTrackContextMenuModel({
    trackName: menuTrackName,
    trackTypeCount: trackCount,
    trackClipCount,
  });
  const colorCommands = createTrackColorSwatchCommands(LABEL_COLORS);
  const runTrackCommand = (command: TrackContextMenuCommand) => {
    const executed = executeTrackContextMenuCommand(command, {
      addTrack: (trackType) => useTimelineStore.getState().addTrack(trackType),
      duplicateTrack: () => useTimelineStore.getState().addTrack(menuTrackType),
      deleteTrack: () => useTimelineStore.getState().removeTrack(menuTrackId),
    });
    if (executed) {
      onClose();
    }
  };
  const runColorCommand = (command: TrackColorSwatchCommand) => {
    const executed = executeTrackColorSwatchCommand(command, {
      setTrackColor: (color: LabelColor) => useTimelineStore.getState().setTrackLabelColor(menuTrackId, color),
    });
    if (executed) {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="timeline-context-menu"
      style={{
        position: 'fixed',
        left: adjustedPosition?.x ?? menu.x,
        top: adjustedPosition?.y ?? menu.y,
        zIndex: 10000,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {contextMenuModel.addTrackCommands.map(command => (
        <div key={command.key} className="context-menu-item" onClick={() => runTrackCommand(command)}>
          {command.label}
        </div>
      ))}
      <div className="context-menu-separator" />
      <div className="context-menu-item" onClick={() => runTrackCommand(contextMenuModel.duplicateCommand)}>
        {contextMenuModel.duplicateCommand.label}
      </div>
      <div className="context-menu-separator" />
      <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className="clip-color-indicator"
            style={{
              background: currentColorHex,
              width: 10,
              height: 10,
              borderRadius: 2,
              border: '1px solid rgba(255,255,255,0.2)',
              flexShrink: 0,
            }}
          />
          Track Color
        </span>
        <span className="submenu-arrow">{'\u25B6'}</span>
        <div className="context-submenu clip-color-submenu">
          <div className="clip-color-grid">
            {LABEL_COLORS.map(color => {
              const colorCommand = colorCommands.find(command => command.key === color.key);
              return (
              <span
                key={color.key}
                className={`label-picker-swatch ${color.key === 'none' ? 'none' : ''} ${currentColor === color.key ? 'active' : ''}`}
                title={color.name}
                style={{ background: color.key === 'none' ? 'var(--bg-tertiary)' : color.hex }}
                onClick={() => {
                  if (colorCommand) runColorCommand(colorCommand);
                }}
              >
                {color.key === 'none' && <span className="label-picker-x">&times;</span>}
              </span>
              );
            })}
          </div>
        </div>
      </div>
      <div className="context-menu-separator" />
      <div
        className={`context-menu-item danger ${contextMenuModel.deleteCommand.disabled ? 'disabled' : ''}`}
        onClick={() => {
          if (contextMenuModel.deleteCommand.disabled) return;
          runTrackCommand(contextMenuModel.deleteCommand);
        }}
        title={contextMenuModel.deleteCommand.title}
      >
        {contextMenuModel.deleteCommand.label}
      </div>
    </div>,
    document.body
  );
}
