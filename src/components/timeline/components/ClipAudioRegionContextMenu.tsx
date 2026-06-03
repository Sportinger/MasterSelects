import { memo, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type {
  AudioRegionContextMenuCommand,
  AudioRegionContextMenuModel,
} from '../utils/audioRegionContextMenu';
import { findAudioRegionContextMenuCommand } from '../utils/audioRegionContextMenu';
import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';

interface ContextMenuPosition {
  x: number;
  y: number;
}

interface ClipAudioRegionContextMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  position: ContextMenuPosition;
  model: AudioRegionContextMenuModel;
  selection: TimelineAudioRegionSelection;
  onRunCommand: (
    command: AudioRegionContextMenuCommand,
    selection: TimelineAudioRegionSelection,
  ) => void;
}

export const ClipAudioRegionContextMenu = memo(function ClipAudioRegionContextMenu({
  menuRef,
  position,
  model,
  selection,
  onRunCommand,
}: ClipAudioRegionContextMenuProps) {
  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  return createPortal((
    <div
      ref={menuRef}
      className="timeline-context-menu clip-audio-region-context-menu"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 10000,
      }}
      onPointerDownCapture={(e) => {
        if (e.button !== 0) return;
        const target = e.target;
        if (!(target instanceof Element)) return;
        const commandElement = target.closest<HTMLElement>('[data-audio-region-command]');
        const commandKey = commandElement?.dataset.audioRegionCommand;
        if (!commandKey) return;
        const command = findAudioRegionContextMenuCommand(model, commandKey);
        if (!command) return;
        e.preventDefault();
        e.stopPropagation();
        onRunCommand(command, selection);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-menu-title">Audio Region</div>
      <div className="clip-audio-region-direct-actions">
        {model.directCommands.map(command => (
          <div
            key={command.key}
            data-audio-region-command={command.key}
            className={`context-menu-item ${command.disabled ? 'disabled' : ''} ${command.danger ? 'danger' : ''}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              onRunCommand(command, selection);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRunCommand(command, selection);
            }}
          >
            {command.label}
          </div>
        ))}
      </div>
      <div className="context-menu-separator" />
      {model.groups.map(group => (
        <div
          key={group.key}
          className="context-menu-item has-submenu clip-audio-region-submenu-trigger"
        >
          <span>{group.label}</span>
          <span className="submenu-arrow" aria-hidden="true">&#9654;</span>
          <div className="context-submenu clip-audio-region-submenu-panel">
            {group.commands.map(command => (
              <div
                key={command.key}
                data-audio-region-command={command.key}
                className={`context-menu-item ${command.disabled ? 'disabled' : ''} ${command.danger ? 'danger' : ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onRunCommand(command, selection);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRunCommand(command, selection);
                }}
              >
                {command.label}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ), portalTarget);
});
