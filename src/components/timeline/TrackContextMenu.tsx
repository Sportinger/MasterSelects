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
  createTrackColorSwatchCommands,
  createTrackContextMenuModel,
} from './utils/trackContextMenu';

export interface TrackContextMenuState {
  x: number;
  y: number;
  trackId: string;
  trackType: 'video' | 'audio' | 'midi';
  trackName: string;
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

  const store = useTimelineStore.getState();
  const track = store.tracks.find(t => t.id === menu.trackId);
  const trackClipCount = store.clips.filter(c => c.trackId === menu.trackId).length;
  const trackCount = store.tracks.filter(t => t.type === menu.trackType).length;
  const currentColor = getTrackLabelColor(track);
  const currentColorHex = currentColor === 'none'
    ? (track ? getTimelineTrackColor(track) : 'var(--bg-tertiary)')
    : getLabelHex(currentColor);

  const handleDeleteTrack = () => {
    useTimelineStore.getState().removeTrack(menu.trackId);
    onClose();
  };

  const handleDuplicateTrack = () => {
    // Add a track of the same type
    useTimelineStore.getState().addTrack(menu.trackType);
    onClose();
  };

  const handleSetTrackColor = (color: LabelColor) => {
    useTimelineStore.getState().setTrackLabelColor(menu.trackId, color);
    onClose();
  };
  const contextMenuModel = createTrackContextMenuModel({
    trackName: menu.trackName,
    trackTypeCount: trackCount,
    trackClipCount,
    onAddTrack: (trackType) => {
      useTimelineStore.getState().addTrack(trackType);
      onClose();
    },
    onDuplicateTrack: handleDuplicateTrack,
    onDeleteTrack: handleDeleteTrack,
  });
  const colorCommands = createTrackColorSwatchCommands(LABEL_COLORS, handleSetTrackColor);

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
        <div key={command.key} className="context-menu-item" onClick={command.action}>
          {command.label}
        </div>
      ))}
      <div className="context-menu-separator" />
      <div className="context-menu-item" onClick={contextMenuModel.duplicateCommand.action}>
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
                onClick={colorCommand?.action}
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
          contextMenuModel.deleteCommand.action();
        }}
        title={contextMenuModel.deleteCommand.title}
      >
        {contextMenuModel.deleteCommand.label}
      </div>
    </div>,
    document.body
  );
}
