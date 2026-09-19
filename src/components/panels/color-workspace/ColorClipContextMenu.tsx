import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useContextMenuPosition } from '../../../hooks/useContextMenuPosition';
import type { LabelColor, ProxyStatus } from '../../../stores/mediaStore/types';
import type { ColorGradeMode } from '../../../types/colorGradeOwnership';
import type { ColorGradeVersion } from '../../../types/colorCorrection';
import { LABEL_COLORS, getLabelHex } from '../media/labelColors';
import './ColorClipContextMenu.css';

export interface ColorClipContextMenuPosition {
  x: number;
  y: number;
  clipId: string;
}

export interface ColorClipMarkerOption {
  color?: string;
  label: string;
}

export interface ColorClipContextMenuProps {
  position: ColorClipContextMenuPosition;
  clipName: string;
  versions: readonly ColorGradeVersion[];
  versionScopeLabel: 'Local Versions' | 'Remote Versions';
  activeVersionId?: string;
  gradeMode: ColorGradeMode;
  canUseRemoteGrade: boolean;
  hasRemoteGrade: boolean;
  currentLabelColor: LabelColor;
  canSetLabelColor: boolean;
  canFindMedia: boolean;
  proxyStatus?: ProxyStatus;
  proxyProgress?: number;
  canManageProxy: boolean;
  thumbnailsUpdating: boolean;
  canUpdateThumbnails: boolean;
  markerOptions: readonly ColorClipMarkerOption[];
  onClose: () => void;
  onSelectVersion: (versionId: string) => void;
  onCreateVersion: () => void;
  onKeepOnlyActiveVersion: () => void;
  onSetGradeMode: (mode: ColorGradeMode) => void;
  onCopyRemoteToLocal: () => void;
  onCopyLocalToRemote: () => void;
  onAddMarker: (color?: string) => void;
  onSetLabelColor: (color: LabelColor) => void;
  onOpenNodeGraph: () => void;
  onViewClipDetails: () => void;
  onFindInMedia: () => void;
  onManageProxy: () => void;
  onUpdateAllThumbnails: () => void;
}

function MenuItem({
  children,
  disabled = false,
  onSelect,
}: {
  children: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="color-clip-context-menu-item"
      disabled={disabled}
      onClick={onSelect}
      role="menuitem"
      type="button"
    >
      {children}
    </button>
  );
}

function Submenu({
  label,
  openLeft,
  children,
}: {
  label: string;
  openLeft: boolean;
  children: ReactNode;
}) {
  return (
    <div className="color-clip-context-submenu-host">
      <button
        aria-haspopup="menu"
        className="color-clip-context-menu-item"
        role="menuitem"
        type="button"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="color-clip-context-menu-arrow">&gt;</span>
      </button>
      <div
        aria-label={label}
        className={`color-clip-context-submenu${openLeft ? ' open-left' : ''}`}
        role="menu"
      >
        {children}
      </div>
    </div>
  );
}

export function ColorClipContextMenu({
  position,
  clipName,
  versions,
  versionScopeLabel,
  activeVersionId,
  gradeMode,
  canUseRemoteGrade,
  hasRemoteGrade,
  currentLabelColor,
  canSetLabelColor,
  canFindMedia,
  proxyStatus,
  proxyProgress,
  canManageProxy,
  thumbnailsUpdating,
  canUpdateThumbnails,
  markerOptions,
  onClose,
  onSelectVersion,
  onCreateVersion,
  onKeepOnlyActiveVersion,
  onSetGradeMode,
  onCopyRemoteToLocal,
  onCopyLocalToRemote,
  onAddMarker,
  onSetLabelColor,
  onOpenNodeGraph,
  onViewClipDetails,
  onFindInMedia,
  onManageProxy,
  onUpdateAllThumbnails,
}: ColorClipContextMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(position);
  const opensLeft = position.x > window.innerWidth - 500;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuRef, onClose]);

  const runAndClose = (action: () => void) => {
    action();
    onClose();
  };
  const proxyLabel = proxyStatus === 'generating'
    ? `Stop Proxy Generation${typeof proxyProgress === 'number' ? ` (${Math.round(proxyProgress)}%)` : ''}`
    : proxyStatus === 'ready'
      ? 'Regenerate Proxy'
      : proxyStatus === 'error'
        ? 'Retry Proxy Generation'
        : 'Generate Proxy';

  if (!adjustedPosition) return null;

  return createPortal(
    <div
      aria-label={`Color clip actions for ${clipName}`}
      className="color-clip-context-menu"
      onContextMenu={event => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      <Submenu label={versionScopeLabel} openLeft={opensLeft}>
        {versions.map(version => (
          <MenuItem
            key={version.id}
            onSelect={() => runAndClose(() => onSelectVersion(version.id))}
          >
            <span aria-hidden="true" className="color-clip-context-menu-check">
              {version.id === activeVersionId ? '\u2713' : ''}
            </span>
            <span>{version.name}</span>
          </MenuItem>
        ))}
        <div className="color-clip-context-menu-separator" role="separator" />
        <MenuItem onSelect={() => runAndClose(onCreateVersion)}>Create New Version</MenuItem>
      </Submenu>

      <MenuItem
        disabled={versions.length <= 1 || !activeVersionId}
        onSelect={() => runAndClose(onKeepOnlyActiveVersion)}
      >
        Delete Unused Versions
      </MenuItem>

      <div className="color-clip-context-menu-separator" role="separator" />

      <Submenu label="Markers" openLeft={opensLeft}>
        {markerOptions.map(option => (
          <MenuItem
            key={option.label}
            onSelect={() => runAndClose(() => onAddMarker(option.color))}
          >
            <span
              aria-hidden="true"
              className="color-clip-context-color-dot"
              style={{ backgroundColor: option.color ?? '#8b8e96' }}
            />
            <span>{option.label}</span>
          </MenuItem>
        ))}
      </Submenu>

      <Submenu label="Label Color" openLeft={opensLeft}>
        <div className="color-clip-context-color-grid">
          {LABEL_COLORS.map(color => (
            <button
              aria-label={`${color.name}${color.key === currentLabelColor ? ', selected' : ''}`}
              aria-pressed={color.key === currentLabelColor}
              className="color-clip-context-color-swatch"
              disabled={!canSetLabelColor}
              key={color.key}
              onClick={() => runAndClose(() => onSetLabelColor(color.key))}
              role="menuitem"
              title={color.name}
              type="button"
            >
              <span
                className={color.key === 'none' ? 'none' : undefined}
                style={color.key === 'none' ? undefined : { backgroundColor: getLabelHex(color.key) }}
              />
            </button>
          ))}
        </div>
      </Submenu>

      <div className="color-clip-context-menu-separator" role="separator" />

      <MenuItem
        disabled={!hasRemoteGrade}
        onSelect={() => runAndClose(onCopyRemoteToLocal)}
      >
        Copy Remote Grades to Local
      </MenuItem>
      <MenuItem
        disabled={!canUseRemoteGrade}
        onSelect={() => runAndClose(onCopyLocalToRemote)}
      >
        Copy Local Grades to Remote
      </MenuItem>
      <MenuItem onSelect={() => runAndClose(() => onSetGradeMode('local'))}>
        <span aria-hidden="true" className="color-clip-context-menu-check">
          {gradeMode === 'local' ? '\u2713' : ''}
        </span>
        <span>Use Local Grades</span>
      </MenuItem>
      <MenuItem
        disabled={!canUseRemoteGrade}
        onSelect={() => runAndClose(() => onSetGradeMode('remote'))}
      >
        <span aria-hidden="true" className="color-clip-context-menu-check">
          {gradeMode === 'remote' ? '\u2713' : ''}
        </span>
        <span>Use Remote Grades</span>
      </MenuItem>

      <div className="color-clip-context-menu-separator" role="separator" />

      <MenuItem onSelect={() => runAndClose(onOpenNodeGraph)}>Display Node Graph</MenuItem>
      <MenuItem onSelect={() => runAndClose(onViewClipDetails)}>View Clip Details</MenuItem>
      <MenuItem disabled={!canFindMedia} onSelect={() => runAndClose(onFindInMedia)}>Find in Media</MenuItem>

      <div className="color-clip-context-menu-separator" role="separator" />

      <MenuItem disabled={!canManageProxy} onSelect={() => runAndClose(onManageProxy)}>
        {proxyLabel}
      </MenuItem>
      <MenuItem
        disabled={!canUpdateThumbnails || thumbnailsUpdating}
        onSelect={() => runAndClose(onUpdateAllThumbnails)}
      >
        {thumbnailsUpdating ? 'Updating Thumbnails\u2026' : 'Update All Thumbnails'}
      </MenuItem>
    </div>,
    document.body,
  );
}
