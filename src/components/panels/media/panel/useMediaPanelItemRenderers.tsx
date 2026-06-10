import type { Dispatch, SetStateAction } from 'react';
import { isProxyFrameCountComplete } from '../../../../stores/mediaStore/helpers/proxyCompleteness';
import type { Composition, MediaFile, ProjectItem } from '../../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { getProjectItemIconType, isImportedMediaFileItem } from '../itemTypeGuards';
import { formatMediaDuration as formatDuration } from '../grid/format';
import {
  formatMediaPanelBitrate as formatBitrate,
  formatMediaPanelFileSize as formatFileSize,
  getGaussianSplatDetailLines,
  getGaussianSplatResolutionLabel,
  getMediaFileCodecLabel,
  getMediaFileContainerLabel,
} from '../list/classicListPlanning';
import { MediaGridItem } from '../grid/MediaGridItem';
import { MediaClassicListRow, type MediaClassicListRowProps } from '../list/MediaClassicListRow';

interface UseMediaPanelItemRenderersInput {
  columnOrder: MediaClassicListRowProps['columnOrder'];
  selectedIds: readonly string[];
  renamingId: string | null;
  expandedFolderIds: readonly string[];
  dragOverFolderId: string | null;
  internalDragId: string | null;
  nameColumnWidth: number;
  renameValue: string;
  setLabelPickerItemId: Dispatch<SetStateAction<string | null>>;
  setLabelPickerPos: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setRenameValue: (value: string) => void;
  setRenamingId: (id: string | null) => void;
  toggleFolderExpanded: MediaClassicListRowProps['onToggleFolder'];
  finishRename: MediaClassicListRowProps['onFinishRename'];
  handleNameClick: MediaClassicListRowProps['onNameClick'];
  handleBadgeClick: MediaClassicListRowProps['onBadgeClick'];
  handleDragStart: MediaClassicListRowProps['onDragStart'];
  handleDragEnd: MediaClassicListRowProps['onDragEnd'];
  handleFolderDragOver: MediaClassicListRowProps['onFolderDragOver'];
  handleFolderDragLeave: MediaClassicListRowProps['onFolderDragLeave'];
  handleFolderDrop: MediaClassicListRowProps['onFolderDrop'];
  handleItemClick: (id: string, event: Parameters<MediaClassicListRowProps['onClick']>[0]) => void;
  handleItemDoubleClick: (item: ProjectItem) => void;
  handleContextMenu: MediaClassicListRowProps['onContextMenu'];
  getItemsForParent: (parentId: string | null) => readonly ProjectItem[];
  refreshFileUrls: (mediaFileId: string) => Promise<unknown>;
}

export function useMediaPanelItemRenderers({
  columnOrder,
  selectedIds,
  renamingId,
  expandedFolderIds,
  dragOverFolderId,
  internalDragId,
  nameColumnWidth,
  renameValue,
  setLabelPickerItemId,
  setLabelPickerPos,
  setRenameValue,
  setRenamingId,
  toggleFolderExpanded,
  finishRename,
  handleNameClick,
  handleBadgeClick,
  handleDragStart,
  handleDragEnd,
  handleFolderDragOver,
  handleFolderDragLeave,
  handleFolderDrop,
  handleItemClick,
  handleItemDoubleClick,
  handleContextMenu,
  getItemsForParent,
  refreshFileUrls,
}: UseMediaPanelItemRenderersInput) {
  const renderClassicRow = (item: ProjectItem, depth: number = 0) => {
    const isFolder = 'isExpanded' in item;
    const isMediaFile = isImportedMediaFileItem(item);

    return (
      <MediaClassicListRow
        key={item.id}
        item={item}
        depth={depth}
        columnOrder={columnOrder}
        selected={selectedIds.includes(item.id)}
        renaming={renamingId === item.id}
        expanded={isFolder && expandedFolderIds.includes(item.id)}
        needsRelink={isMediaFile && mediaNeedsRelink(item)}
        dragTarget={isFolder && dragOverFolderId === item.id}
        beingDragged={internalDragId === item.id}
        nameColumnWidth={nameColumnWidth}
        renameValue={renameValue}
        onOpenLabelPicker={(itemId, x, y) => {
          setLabelPickerItemId(itemId);
          setLabelPickerPos({ x, y });
        }}
        onToggleFolder={toggleFolderExpanded}
        onRenameValueChange={setRenameValue}
        onFinishRename={finishRename}
        onCancelRename={() => setRenamingId(null)}
        onNameClick={handleNameClick}
        onBadgeClick={handleBadgeClick}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onFolderDragOver={handleFolderDragOver}
        onFolderDragLeave={handleFolderDragLeave}
        onFolderDrop={handleFolderDrop}
        onClick={(event, itemId) => handleItemClick(itemId, event)}
        onDoubleClick={handleItemDoubleClick}
        onContextMenu={handleContextMenu}
        getProjectItemIconType={getProjectItemIconType}
        getGaussianSplatResolutionLabel={getGaussianSplatResolutionLabel}
        getMediaFileContainerLabel={getMediaFileContainerLabel}
        getMediaFileCodecLabel={getMediaFileCodecLabel}
        isProxyFrameCountComplete={isProxyFrameCountComplete}
        formatDuration={formatDuration}
        formatFileSize={formatFileSize}
        formatBitrate={formatBitrate}
      />
    );
  };

  const buildGridTooltip = (item: ProjectItem, isFolder: boolean, isComp: boolean): string => {
    const parts: string[] = [item.name];

    if (isFolder) {
      const children = getItemsForParent(item.id);
      parts.push(`${children.length} item${children.length !== 1 ? 's' : ''}`);
    } else if (isComp) {
      const comp = item as Composition;
      parts.push(`${comp.width}\u00d7${comp.height}`);
      parts.push(`${comp.frameRate} fps`);
      if (comp.duration) parts.push(formatDuration(comp.duration));
    } else if ('type' in item && item.type === 'signal') {
      if (item.signalKinds.length > 0) parts.push(item.signalKinds.join(', '));
      if (item.providerId) parts.push(item.providerId);
      if (item.fileSize) parts.push(formatFileSize(item.fileSize));
      const warningCount = item.diagnostics?.filter((diagnostic) => diagnostic.severity !== 'info').length ?? 0;
      if (warningCount > 0) parts.push(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`);
    } else if ('type' in item) {
      const mediaFile = item as MediaFile;
      if (mediaFile.type === 'gaussian-splat') {
        parts.push(...getGaussianSplatDetailLines(mediaFile));
        const container = getMediaFileContainerLabel(mediaFile);
        if (container) parts.push(container);
      } else if (mediaFile.width && mediaFile.height) {
        parts.push(`${mediaFile.width}\u00d7${mediaFile.height}`);
      }
      if (mediaFile.duration) parts.push(formatDuration(mediaFile.duration));
      const codec = getMediaFileCodecLabel(mediaFile);
      if (codec) parts.push(codec);
      if (mediaFile.audioCodec) parts.push(mediaFile.audioCodec);
      if (mediaFile.fps) parts.push(`${mediaFile.fps} fps`);
      if (mediaFile.fileSize) parts.push(formatFileSize(mediaFile.fileSize));
      if (mediaFile.bitrate) parts.push(formatBitrate(mediaFile.bitrate));
      if (!mediaFile.duration && 'duration' in item && item.duration) parts.push(formatDuration(item.duration));
    }

    return parts.join('\n');
  };

  const renderGridItem = (item: ProjectItem) => {
    const isFolder = 'isExpanded' in item;

    return (
      <MediaGridItem
        key={item.id}
        item={item}
        selected={selectedIds.includes(item.id)}
        dragTarget={isFolder && dragOverFolderId === item.id}
        folderItemCount={isFolder ? getItemsForParent(item.id).length : 0}
        getProjectItemIconType={getProjectItemIconType}
        buildTooltip={buildGridTooltip}
        onRefreshFileUrls={(mediaFileId) => { void refreshFileUrls(mediaFileId); }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onFolderDragOver={handleFolderDragOver}
        onFolderDragLeave={handleFolderDragLeave}
        onFolderDrop={handleFolderDrop}
        onClick={(event, itemId) => handleItemClick(itemId, event)}
        onDoubleClick={handleItemDoubleClick}
        onContextMenu={handleContextMenu}
      />
    );
  };

  return {
    renderClassicRow,
    buildGridTooltip,
    renderGridItem,
  };
}
