import { useEffect } from 'react';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import type { TimelineEmptyContextMenuState } from './types';
import { createTimelineEmptyContextMenuModel } from './utils/timelineEmptyContextMenu';

interface TimelineEmptyContextMenuProps {
  menu: TimelineEmptyContextMenuState | null;
  onClose: () => void;
  onEraseGap: (time: number, trackId: string) => void;
  onEraseLayerGaps: (time: number, trackId: string) => void;
  onEraseAllGaps: () => void;
  onFitCompToWindow: () => void;
}

export function TimelineEmptyContextMenu({
  menu,
  onClose,
  onEraseGap,
  onEraseLayerGaps,
  onEraseAllGaps,
  onFitCompToWindow,
}: TimelineEmptyContextMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);

  useEffect(() => {
    if (!menu) return;

    const handleClickOutside = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('contextmenu', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const contextMenuModel = createTimelineEmptyContextMenuModel({
    time: menu.time,
    trackId: menu.trackId,
    onEraseGap,
    onEraseLayerGaps,
    onEraseAllGaps,
    onFitCompToWindow,
  });
  const runCommand = (action: () => void) => {
    action();
    onClose();
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
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {contextMenuModel.gapCommands.map(command => (
        <div
          key={command.key}
          className="context-menu-item"
          onClick={() => runCommand(command.action)}
        >
          {command.label}
        </div>
      ))}
      <div className="context-menu-separator" />
      {contextMenuModel.viewCommands.map(command => (
        <div
          key={command.key}
          className="context-menu-item"
          onClick={() => runCommand(command.action)}
        >
          {command.label}
        </div>
      ))}
    </div>
  );
}
