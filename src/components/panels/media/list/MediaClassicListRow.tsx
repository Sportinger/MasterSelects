import type { DragEvent, MouseEvent } from 'react';

import type { MediaFile, ProjectItem } from '../../../../stores/mediaStore';
import { isImportedMediaFileItem } from '../itemTypeGuards';
import { MediaClassicListCell } from './MediaClassicListCell';
import type { MediaClassicBadgeTarget, MediaClassicColumnId } from './types';

export interface MediaClassicListRowProps {
  item: ProjectItem;
  depth: number;
  columnOrder: readonly MediaClassicColumnId[];
  selected: boolean;
  renaming: boolean;
  expanded: boolean;
  needsRelink: boolean;
  dragTarget: boolean;
  beingDragged: boolean;
  nameColumnWidth: number;
  renameValue: string;
  onOpenLabelPicker: (itemId: string, x: number, y: number) => void;
  onToggleFolder: (itemId: string) => void;
  onRenameValueChange: (value: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onNameClick: (event: MouseEvent, itemId: string, currentName: string) => void;
  onBadgeClick: (mediaFileId: string, target: MediaClassicBadgeTarget) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, item: ProjectItem) => void;
  onDragEnd: (event: DragEvent<HTMLDivElement>) => void;
  onFolderDragOver: (event: DragEvent<HTMLDivElement>, folderId: string) => void;
  onFolderDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onFolderDrop: (event: DragEvent<HTMLDivElement>, folderId: string) => void;
  onClick: (event: MouseEvent<HTMLDivElement>, itemId: string) => void;
  onDoubleClick: (item: ProjectItem) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, itemId: string) => void;
  getProjectItemIconType: (item: ProjectItem | undefined) => string | undefined;
  getGaussianSplatResolutionLabel: (item: ProjectItem) => string | null;
  getMediaFileContainerLabel: (mediaFile: MediaFile | null) => string | undefined;
  getMediaFileCodecLabel: (mediaFile: MediaFile | null) => string | undefined;
  isProxyFrameCountComplete: (frameCount?: number, duration?: number, fps?: number) => boolean;
  formatDuration: (seconds: number) => string;
  formatFileSize: (bytes?: number) => string;
  formatBitrate: (bps?: number) => string;
}

export function MediaClassicListRow({
  item,
  depth,
  columnOrder,
  selected,
  renaming,
  expanded,
  needsRelink,
  dragTarget,
  beingDragged,
  nameColumnWidth,
  renameValue,
  onOpenLabelPicker,
  onToggleFolder,
  onRenameValueChange,
  onFinishRename,
  onCancelRename,
  onNameClick,
  onBadgeClick,
  onDragStart,
  onDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop,
  onClick,
  onDoubleClick,
  onContextMenu,
  getProjectItemIconType,
  getGaussianSplatResolutionLabel,
  getMediaFileContainerLabel,
  getMediaFileCodecLabel,
  isProxyFrameCountComplete,
  formatDuration,
  formatFileSize,
  formatBitrate,
}: MediaClassicListRowProps) {
  const isFolder = 'isExpanded' in item;
  const isMediaFile = isImportedMediaFileItem(item);
  const mediaFile = isMediaFile ? item : null;
  const importing = isMediaFile && Boolean(item.isImporting);

  return (
    <div key={item.id} data-item-id={item.id}>
      <div
        data-media-panel-anim-id={item.id}
        className={`media-item ${selected ? 'selected' : ''} ${isFolder ? 'folder' : ''} ${needsRelink ? 'no-file' : ''} ${importing ? 'importing' : ''} ${dragTarget ? 'drag-target' : ''} ${beingDragged ? 'dragging' : ''}`}
        draggable={!importing}
        onDragStart={(event) => onDragStart(event, item)}
        onDragEnd={onDragEnd}
        onDragOver={isFolder ? (event) => onFolderDragOver(event, item.id) : undefined}
        onDragLeave={isFolder ? onFolderDragLeave : undefined}
        onDrop={isFolder ? (event) => onFolderDrop(event, item.id) : undefined}
        onClick={(event) => onClick(event, item.id)}
        onDoubleClick={() => onDoubleClick(item)}
        onContextMenu={(event) => onContextMenu(event, item.id)}
      >
        {columnOrder.map((colId) => (
          <MediaClassicListCell
            key={colId}
            colId={colId}
            item={item}
            depth={depth}
            isFolder={isFolder}
            isExpanded={expanded}
            isRenaming={renaming}
            isSelected={selected}
            mediaFile={mediaFile}
            nameColumnWidth={nameColumnWidth}
            renameValue={renameValue}
            onOpenLabelPicker={onOpenLabelPicker}
            onToggleFolder={onToggleFolder}
            onRenameValueChange={onRenameValueChange}
            onFinishRename={onFinishRename}
            onCancelRename={onCancelRename}
            onNameClick={onNameClick}
            onBadgeClick={onBadgeClick}
            getProjectItemIconType={getProjectItemIconType}
            getGaussianSplatResolutionLabel={getGaussianSplatResolutionLabel}
            getMediaFileContainerLabel={getMediaFileContainerLabel}
            getMediaFileCodecLabel={getMediaFileCodecLabel}
            isProxyFrameCountComplete={isProxyFrameCountComplete}
            formatDuration={formatDuration}
            formatFileSize={formatFileSize}
            formatBitrate={formatBitrate}
          />
        ))}
      </div>
    </div>
  );
}
