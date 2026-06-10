import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTimelineStore } from '../../../stores/timeline';
import type { LabelColor } from '../../../stores/mediaStore/types';
import type { TimelineTrack } from '../../../types/timeline';
import { useContextMenuPosition } from '../../../hooks/useContextMenuPosition';
import { getTimelineTrackColor, getTrackLabelColor } from '../../timeline/trackColor';
import { LABEL_COLORS, getLabelHex } from '../media/labelColors';
import type { TrackColorMenuTarget } from './audioMixerTypes';

export function MixerTrackColorMenu({
  target,
  tracks,
  onClose,
}: {
  target: TrackColorMenuTarget | null;
  tracks: readonly TimelineTrack[];
  onClose: () => void;
}) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(target);

  useEffect(() => {
    if (!target) return undefined;

    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const eventTarget = event.target;
      if (eventTarget instanceof Node && menuRef.current?.contains(eventTarget)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerOutside, true);
      document.addEventListener('contextmenu', handlePointerOutside, true);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuRef, onClose, target]);

  if (!target) return null;

  const track = tracks.find(candidate => candidate.id === target.trackId);
  if (!track) return null;

  const trackIndex = tracks.findIndex(candidate => candidate.id === target.trackId);
  const currentColor = getTrackLabelColor(track);
  const currentColorHex = currentColor === 'none'
    ? getTimelineTrackColor(track, trackIndex)
    : getLabelHex(currentColor);
  const handleSetTrackColor = (color: LabelColor) => {
    useTimelineStore.getState().setTrackLabelColor(track.id, color);
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="timeline-context-menu audio-mixer-track-color-menu"
      style={{
        position: 'fixed',
        left: adjustedPosition?.x ?? target.x,
        top: adjustedPosition?.y ?? target.y,
        zIndex: 10000,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu-item disabled">
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
          {track.name}
        </span>
      </div>
      <div className="context-menu-separator" />
      <div className="clip-color-grid audio-mixer-track-color-grid">
        {LABEL_COLORS.map(color => (
          <span
            key={color.key}
            className={`label-picker-swatch ${color.key === 'none' ? 'none' : ''} ${currentColor === color.key ? 'active' : ''}`}
            title={color.name}
            style={{ background: color.key === 'none' ? 'var(--bg-tertiary)' : color.hex }}
            onClick={() => handleSetTrackColor(color.key)}
          >
            {color.key === 'none' && <span className="label-picker-x">&times;</span>}
          </span>
        ))}
      </div>
    </div>,
    document.body,
  );
}
