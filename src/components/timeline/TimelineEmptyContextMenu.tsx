import { useEffect } from 'react';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { useTimelineStore } from '../../stores/timeline';
import { handleSubmenuHover, handleSubmenuLeave } from '../panels/media/submenuPosition';
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
  onAddStoryboardScene?: (time: number, trackId: string) => void;
  onAddCaptionClip?: (time: number, trackId: string) => void;
  onAddTimelineLayer?: Parameters<typeof executeTimelineEmptyContextMenuCommand>[1]['onAddTimelineLayer'];
}

export function TimelineEmptyContextMenu({
  menu,
  onClose,
  onEraseGap,
  onEraseLayerGaps,
  onEraseAllGaps,
  onFitCompToWindow,
  onAddStoryboardScene,
  onAddCaptionClip,
  onAddTimelineLayer,
}: TimelineEmptyContextMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);
  const trackType = useTimelineStore(state =>
    menu ? state.tracks.find(track => track.id === menu.trackId)?.type : undefined
  );
  const canPasteClips = useTimelineStore(state => Boolean(state.clipboardData?.length));
  const targetTrackId = useTimelineStore(state => (
    trackType ? state.targetTrackIdByType[trackType] : undefined
  ));
  const setPlayheadPosition = useTimelineStore(state => state.setPlayheadPosition);
  const setTargetTrack = useTimelineStore(state => state.setTargetTrack);
  const pasteClips = useTimelineStore(state => state.pasteClips);

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
    trackType,
    canPasteClips,
  });
  const runCommand = (command: TimelineEmptyContextMenuCommand) => {
    const executed = executeTimelineEmptyContextMenuCommand(command, {
      onPasteClips: (time, trackId) => {
        setPlayheadPosition(time);
        if (trackType && targetTrackId !== trackId) setTargetTrack(trackId);
        pasteClips();
      },
      onEraseGap,
      onEraseLayerGaps,
      onEraseAllGaps,
      onFitCompToWindow,
      onAddStoryboardScene,
      onAddCaptionClip,
      onAddTimelineLayer,
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
      {contextMenuModel.clipboardCommands.map(command => (
        <div
          key={command.key}
          className={`context-menu-item ${command.enabled === false ? 'disabled' : ''}`}
          onClick={() => runCommand(command)}
        >
          {command.label}
        </div>
      ))}
      <div className="context-menu-separator" />
      {(contextMenuModel.sceneCommands.length > 0 || contextMenuModel.layerCommands.length > 0) && (
        <>
          <div
            className="context-menu-item has-submenu"
            onMouseEnter={handleSubmenuHover}
            onMouseLeave={handleSubmenuLeave}
          >
            <span>Add Layer</span>
            <span className="submenu-arrow">&#9654;</span>
            <div className="context-submenu">
              {contextMenuModel.layerCommands
                .filter(command => command.group === 'core' && command.payload?.layerTarget === 'text')
                .map(command => (
                  <div key={command.key} className="context-menu-item" onClick={() => runCommand(command)}>
                    {command.label}
                  </div>
                ))}
              {contextMenuModel.sceneCommands.map(command => (
                <div key={command.key} className="context-menu-item" onClick={() => runCommand(command)}>
                  {command.label}
                </div>
              ))}
              {contextMenuModel.layerCommands
                .filter(command => command.group === 'core' && command.payload?.layerTarget !== 'text')
                .map(command => (
                  <div key={command.key} className="context-menu-item" onClick={() => runCommand(command)}>
                    {command.label}
                  </div>
                ))}
              <div className="context-menu-separator" />
              <div
                className="context-menu-item has-submenu"
                onMouseEnter={handleSubmenuHover}
                onMouseLeave={handleSubmenuLeave}
              >
                <span>3D</span>
                <span className="submenu-arrow">&#9654;</span>
                <div className="context-submenu">
                  {contextMenuModel.layerCommands
                    .filter(command => command.group === '3d')
                    .map(command => (
                      <div key={command.key} className="context-menu-item" onClick={() => runCommand(command)}>
                        {command.label}
                      </div>
                    ))}
                </div>
              </div>
              <div
                className="context-menu-item has-submenu"
                onMouseEnter={handleSubmenuHover}
                onMouseLeave={handleSubmenuLeave}
              >
                <span>Motion</span>
                <span className="submenu-arrow">&#9654;</span>
                <div className="context-submenu">
                  {contextMenuModel.layerCommands
                    .filter(command => command.group === 'motion')
                    .map(command => (
                      <div key={command.key} className="context-menu-item" onClick={() => runCommand(command)}>
                        {command.label}
                      </div>
                    ))}
                </div>
              </div>
              {contextMenuModel.layerCommands.some(command => command.group === 'generators') && (
                <div
                  className="context-menu-item has-submenu"
                  onMouseEnter={handleSubmenuHover}
                  onMouseLeave={handleSubmenuLeave}
                >
                  <span>Generators</span>
                  <span className="submenu-arrow">&#9654;</span>
                  <div className="context-submenu">
                    {contextMenuModel.layerCommands
                      .filter(command => command.group === 'generators')
                      .map(command => (
                        <div key={command.key} className="context-menu-item" onClick={() => runCommand(command)}>
                          {command.label}
                        </div>
                      ))}
                  </div>
                </div>
              )}
              {contextMenuModel.layerCommands
                .filter(command => command.group === 'special')
                .map(command => (
                  <div key={command.key} className="context-menu-item" onClick={() => runCommand(command)}>
                    {command.label}
                  </div>
                ))}
            </div>
          </div>
          <div className="context-menu-separator" />
        </>
      )}
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
