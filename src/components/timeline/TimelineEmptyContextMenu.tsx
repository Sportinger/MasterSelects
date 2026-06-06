import { useEffect } from 'react';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import type { TimelineEmptyContextMenuState } from './types';
import {
  createTimelineEmptyContextMenuModel,
  executeTimelineEmptyContextMenuCommand,
  type TimelineEmptyContextMenuCommand,
} from './utils/timelineEmptyContextMenu';

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

    const handlePointerOutside = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerOutside, true);
    document.addEventListener('contextmenu', handlePointerOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, menuRef, onClose]);

  if (!menu) return null;

  const contextMenuModel = createTimelineEmptyContextMenuModel({
    time: menu.time,
    trackId: menu.trackId,
  });
  const runCommand = (command: TimelineEmptyContextMenuCommand) => {
    const executed = executeTimelineEmptyContextMenuCommand(command, {
      onEraseGap,
      onEraseLayerGaps,
      onEraseAllGaps,
      onFitCompToWindow,
    });
    if (executed) {
      onClose();
    }
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
          onClick={() => runCommand(command)}
        >
          {command.label}
        </div>
      ))}
      <div className="context-menu-separator" />
      {contextMenuModel.viewCommands.map(command => (
        <div
          key={command.key}
          className="context-menu-item"
          onClick={() => runCommand(command)}
        >
          {command.label}
        </div>
      ))}
    </div>
  );
}
