import './TimelineMarkers.css';
import { useEffect } from 'react';
import type { TimelineMarker } from '../../stores/timeline/types';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { useMIDI } from '../../hooks/useMIDI';
import { formatMIDINoteBinding } from '../../types/midi';
import {
  jumpToMarkerAndStopTime,
  jumpToMarkerTime,
  playFromMarkerTime,
} from '../../services/midi/midiCommands';

export interface MarkerContextMenuState {
  x: number;
  y: number;
  markerId: string;
}

interface MarkerContextMenuProps {
  menu: MarkerContextMenuState | null;
  markers: TimelineMarker[];
  updateMarker: (markerId: string, updates: Partial<Omit<TimelineMarker, 'id'>>) => void;
  removeMarker: (markerId: string) => void;
  onClose: () => void;
}

export function MarkerContextMenu({
  menu,
  markers,
  updateMarker,
  removeMarker,
  onClose,
}: MarkerContextMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);
  const {
    learnTarget,
    startLearningMarkerBinding,
    cancelLearning,
  } = useMIDI();

  const marker = menu ? markers.find((candidate) => candidate.id === menu.markerId) ?? null : null;
  const playBinding = marker?.midiBindings?.find((binding) => binding.action === 'playFromMarker') ?? null;
  const jumpBinding = marker?.midiBindings?.find((binding) => binding.action === 'jumpToMarker') ?? null;
  const jumpStopBinding = marker?.midiBindings?.find((binding) => binding.action === 'jumpToMarkerAndStop') ?? null;
  const isLearningThisMarker = learnTarget?.kind === 'marker' && learnTarget.markerId === marker?.id;

  useEffect(() => {
    if (!menu) {
      return;
    }

    const handleClickOutside = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
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
  }, [menu, onClose]);

  if (!menu || !marker) {
    return null;
  }

  const setMarkerBinding = (
    action: 'playFromMarker' | 'jumpToMarker' | 'jumpToMarkerAndStop',
    binding: typeof playBinding | null
  ) => {
    const existingBindings = marker.midiBindings ?? [];
    const nextBindings = binding
      ? [...existingBindings.filter((candidate) => candidate.action !== action), binding]
      : existingBindings.filter((candidate) => candidate.action !== action);

    updateMarker(marker.id, {
      midiBindings: nextBindings.length > 0 ? nextBindings : undefined,
    });
  };

  return (
    <div
      ref={menuRef}
      className="timeline-context-menu"
      style={{
        position: 'fixed',
        left: adjustedPosition?.x ?? menu.x,
        top: adjustedPosition?.y ?? menu.y,
        zIndex: 10000,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          void jumpToMarkerTime(marker.time);
          onClose();
        }}
      >
        Jump To Marker
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          void playFromMarkerTime(marker.time);
          onClose();
        }}
      >
        Play From Marker
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          void jumpToMarkerAndStopTime(marker.time);
          onClose();
        }}
      >
        Jump To Marker And Stop
      </div>

      <div className="context-menu-separator" />

      <div
        className="context-menu-item"
        onClick={() => {
          updateMarker(marker.id, {
            stopPlayback: !marker.stopPlayback,
          });
          onClose();
        }}
      >
        {marker.stopPlayback ? 'Disable Stop Marker' : 'Enable Stop Marker'}
      </div>

      {marker.stopPlayback && (
        <div className="context-menu-item disabled">
          Playback stops automatically when the playhead crosses this marker.
        </div>
      )}

      <div className="context-menu-separator" />

      <div
        className="context-menu-item"
        onClick={() => {
          startLearningMarkerBinding(marker.id, marker.label || 'Marker', 'jumpToMarker');
          onClose();
        }}
      >
        Learn MIDI Note: Jump To Marker
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          startLearningMarkerBinding(marker.id, marker.label || 'Marker', 'playFromMarker');
          onClose();
        }}
      >
        Learn MIDI Note: Play From Marker
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          startLearningMarkerBinding(marker.id, marker.label || 'Marker', 'jumpToMarkerAndStop');
          onClose();
        }}
      >
        Learn MIDI Note: Jump To Marker And Stop
      </div>

      {isLearningThisMarker && (
        <div
          className="context-menu-item"
          onClick={() => {
            cancelLearning();
            onClose();
          }}
        >
          Cancel MIDI Learn
        </div>
      )}

      {(jumpBinding || playBinding || jumpStopBinding) && <div className="context-menu-separator" />}

      {jumpBinding && (
        <>
          <div className="context-menu-item disabled">
            Jump To Marker: {formatMIDINoteBinding(jumpBinding)}
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              setMarkerBinding('jumpToMarker', null);
              onClose();
            }}
          >
            Clear Jump Binding
          </div>
        </>
      )}

      {jumpStopBinding && (
        <>
          <div className="context-menu-item disabled">
            Jump To Marker And Stop: {formatMIDINoteBinding(jumpStopBinding)}
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              setMarkerBinding('jumpToMarkerAndStop', null);
              onClose();
            }}
          >
            Clear Jump And Stop Binding
          </div>
        </>
      )}

      {playBinding && (
        <>
          <div className="context-menu-item disabled">
            Play From Marker: {formatMIDINoteBinding(playBinding)}
          </div>
          <div
            className="context-menu-item"
            onClick={() => {
              setMarkerBinding('playFromMarker', null);
              onClose();
            }}
          >
            Clear Play Binding
          </div>
        </>
      )}

      <div className="context-menu-separator" />

      <div
        className="context-menu-item danger"
        onClick={() => {
          if (isLearningThisMarker) {
            cancelLearning();
          }
          removeMarker(marker.id);
          onClose();
        }}
      >
        Delete Marker
      </div>
    </div>
  );
}
