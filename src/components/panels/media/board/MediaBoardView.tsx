import React from 'react';
import type { Composition, MediaFile, MediaFolder, ProjectItem, SolidItem, TextItem } from '../../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { FileTypeIcon } from '../FileTypeIcon';
import { getItemImportProgress, isImportedMediaFileItem } from '../itemTypeGuards';
import { getLabelHex } from '../labelColors';
import { MEDIA_BOARD_GRID_PARALLAX } from './constants';
import { getMediaBoardOrderKey, getMediaBoardTypeLabel, isMediaBoardFolder } from './layout';
import type {
  MediaBoardGroupLayout,
  MediaBoardInsertGapPlacement,
  MediaBoardMarquee,
  MediaBoardNodePlacement,
  MediaBoardRenderLod,
  MediaBoardViewport,
} from './types';

interface MediaBoardViewProps {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  canvasInnerRef: React.RefObject<HTMLDivElement | null>;
  overviewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewport: MediaBoardViewport;
  renderLod: MediaBoardRenderLod;
  overviewCanvasStyle: React.CSSProperties;
  isMediaSearchActive: boolean;
  mediaSearchResultCount: number;
  totalItems: number;
  itemCount: number;
  folderCount: number;
  folders: MediaFolder[];
  visibleGroups: MediaBoardGroupLayout[];
  visibleInsertGaps: MediaBoardInsertGapPlacement[];
  visiblePlacements: MediaBoardNodePlacement[];
  marquee: MediaBoardMarquee | null;
  selectedIdSet: Set<string>;
  mediaSearchVisibleItemIds: Set<string> | null;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onStartRename: (id: string, currentName: string) => void;
  onOpenAI: () => void;
  onResetLayout: () => void;
  onCanvasWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onCanvasDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onCanvasDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onNodeMouseDown: (e: React.MouseEvent, item: ProjectItem) => void;
  onItemDoubleClick: (item: ProjectItem) => void;
  onItemContextMenu: (e: React.MouseEvent, itemId?: string, parentId?: string | null) => void;
  consumeSuppressedContextMenu: () => boolean;
  onGroupDragOver: (e: React.DragEvent) => void;
  onGroupDrop: (e: React.DragEvent, groupId: string | null) => void;
  onTimelineDragStart: (e: React.DragEvent, item: ProjectItem) => void;
  onTimelineDragEnd: () => void;
  refreshFileUrls: (id: string) => void | Promise<unknown>;
  buildTooltip: (item: ProjectItem, isFolder: boolean, isComp: boolean) => string;
  formatDuration: (seconds: number) => string;
  getProjectItemIconType: (item: ProjectItem | undefined) => string | undefined;
  getGaussianSplatResolutionLabel: (item: ProjectItem) => string | null;
  getMediaFileContainerLabel: (mediaFile: MediaFile | null) => string | undefined;
  getMediaFileCodecLabel: (mediaFile: MediaFile | null) => string | undefined;
}

function MediaBoardNode({
  placement,
  renderLod,
  selectedIdSet,
  mediaSearchVisibleItemIds,
  onNodeMouseDown,
  onItemDoubleClick,
  onItemContextMenu,
  consumeSuppressedContextMenu,
  onTimelineDragStart,
  onTimelineDragEnd,
  refreshFileUrls,
  buildTooltip,
  formatDuration,
  getProjectItemIconType,
  getGaussianSplatResolutionLabel,
  getMediaFileContainerLabel,
  getMediaFileCodecLabel,
}: Pick<
  MediaBoardViewProps,
  | 'renderLod'
  | 'selectedIdSet'
  | 'mediaSearchVisibleItemIds'
  | 'onNodeMouseDown'
  | 'onItemDoubleClick'
  | 'onItemContextMenu'
  | 'consumeSuppressedContextMenu'
  | 'onTimelineDragStart'
  | 'onTimelineDragEnd'
  | 'refreshFileUrls'
  | 'buildTooltip'
  | 'formatDuration'
  | 'getProjectItemIconType'
  | 'getGaussianSplatResolutionLabel'
  | 'getMediaFileContainerLabel'
  | 'getMediaFileCodecLabel'
> & {
  placement: MediaBoardNodePlacement;
}) {
  const { item, layout } = placement;
  if (isMediaBoardFolder(item)) return null;

  const isSelected = selectedIdSet.has(item.id);
  const isMediaFile = isImportedMediaFileItem(item);
  const mediaFile = isMediaFile ? item : null;
  const isComp = item.type === 'composition';
  const comp = isComp ? (item as Composition) : null;
  const isTextItem = item.type === 'text';
  const textItem = isTextItem ? (item as TextItem) : null;
  const isSolidItem = item.type === 'solid';
  const solidItem = isSolidItem ? (item as SolidItem) : null;
  const thumbUrl = mediaFile?.thumbnailUrl;
  const duration = mediaFile?.duration || comp?.duration;
  const importProgress = getItemImportProgress(item);
  const labelHex = 'labelColor' in item ? getLabelHex(item.labelColor) : 'transparent';
  const title = buildTooltip(item, false, isComp);
  const splatStatsLabel = mediaFile?.type === 'gaussian-splat'
    ? getGaussianSplatResolutionLabel(mediaFile)
    : null;
  const resolutionLabel = splatStatsLabel ??
    ('width' in item && 'height' in item && item.width && item.height
      ? `${item.width}x${item.height}`
      : comp
        ? `${comp.width}x${comp.height}`
        : null);
  const boardCodecLabel = mediaFile?.type === 'gaussian-splat'
    ? getMediaFileContainerLabel(mediaFile)
    : getMediaFileCodecLabel(mediaFile);
  const isCompactNode = renderLod.compact;
  const shouldRenderThumb = Boolean(thumbUrl && renderLod.showImages);
  if (renderLod.overviewCanvas && !isSelected && !placement.isDraggingPreview) return null;

  return (
    <div
      key={item.id}
      data-item-id={item.id}
      data-board-group-key={getMediaBoardOrderKey(placement.groupId)}
      data-media-panel-anim-id={item.id}
      className={[
        'media-board-node',
        isSelected ? 'selected' : '',
        mediaFile && mediaNeedsRelink(mediaFile) ? 'no-file' : '',
        importProgress !== null ? 'importing' : '',
        isTextItem ? 'text' : '',
        placement.isDraggingPreview ? 'drag-source-preview' : '',
        isCompactNode ? 'lod-compact' : '',
        thumbUrl && !shouldRenderThumb ? 'lod-thumbnail-paused' : '',
        mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(item.id) ? 'search-dimmed' : '',
      ].filter(Boolean).join(' ')}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
        borderTopColor: labelHex === 'transparent' ? 'var(--border-color)' : labelHex,
      }}
      title={title}
      onMouseDown={(e) => onNodeMouseDown(e, item)}
      onDoubleClick={() => { onItemDoubleClick(item); }}
      onContextMenu={(e) => {
        if (consumeSuppressedContextMenu()) {
          e.preventDefault();
          return;
        }
        onItemContextMenu(e, item.id);
      }}
    >
      <div className="media-board-node-thumb">
        {isSolidItem && solidItem ? (
          <div className="media-board-solid-preview" style={{ backgroundColor: solidItem.color }} />
        ) : textItem ? (
          <div className="media-board-text-preview" style={{ color: textItem.color, fontFamily: textItem.fontFamily }}>
            {textItem.text}
          </div>
        ) : shouldRenderThumb ? (
          <img
            src={thumbUrl}
            alt=""
            draggable={false}
            loading="eager"
            decoding="async"
            onError={mediaFile ? () => { void refreshFileUrls(mediaFile.id); } : undefined}
          />
        ) : (
          <div className="media-board-node-placeholder">
            <FileTypeIcon type={isComp ? 'composition' : getProjectItemIconType(item)} large />
          </div>
        )}
        {!isCompactNode && duration ? <span className="media-board-duration">{formatDuration(duration)}</span> : null}
        {!isCompactNode && importProgress !== null ? <span className="media-board-progress">{importProgress}%</span> : null}
        <span
          className="media-board-node-timeline-drag"
          draggable={importProgress === null}
          title="Drag to timeline"
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => onTimelineDragStart(e, item)}
          onDragEnd={onTimelineDragEnd}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
            <path d="M3 2h2v12H3V2Zm4 0h2v12H7V2Zm4 0h2v12h-2V2Z" />
          </svg>
        </span>
      </div>
      {!isCompactNode ? (
        <div className="media-board-node-body">
          <div className="media-board-node-name">{item.name}</div>
          <div className="media-board-node-meta">
            <span>{getMediaBoardTypeLabel(item)}</span>
            {resolutionLabel ? <span>{resolutionLabel}</span> : null}
            {boardCodecLabel ? <span>{boardCodecLabel}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MediaBoardView({
  wrapperRef,
  canvasRef,
  canvasInnerRef,
  overviewCanvasRef,
  viewport,
  renderLod,
  overviewCanvasStyle,
  isMediaSearchActive,
  mediaSearchResultCount,
  totalItems,
  itemCount,
  folderCount,
  folders,
  visibleGroups,
  visibleInsertGaps,
  visiblePlacements,
  marquee,
  selectedIdSet,
  mediaSearchVisibleItemIds,
  renamingId,
  renameValue,
  onRenameValueChange,
  onFinishRename,
  onCancelRename,
  onStartRename,
  onOpenAI,
  onResetLayout,
  onCanvasWheel,
  onCanvasMouseDown,
  onCanvasDoubleClick,
  onCanvasContextMenu,
  onCanvasDragOver,
  onCanvasDragLeave,
  onCanvasDrop,
  onNodeMouseDown,
  onItemDoubleClick,
  onItemContextMenu,
  consumeSuppressedContextMenu,
  onGroupDragOver,
  onGroupDrop,
  onTimelineDragStart,
  onTimelineDragEnd,
  refreshFileUrls,
  buildTooltip,
  formatDuration,
  getProjectItemIconType,
  getGaussianSplatResolutionLabel,
  getMediaFileContainerLabel,
  getMediaFileCodecLabel,
}: MediaBoardViewProps) {
  return (
    <div
      className="media-board-wrapper"
      ref={wrapperRef}
      style={{
        '--media-board-grid-x': `${viewport.panX * MEDIA_BOARD_GRID_PARALLAX}px`,
        '--media-board-grid-y': `${viewport.panY * MEDIA_BOARD_GRID_PARALLAX}px`,
      } as React.CSSProperties}
    >
      <div className="media-board-toolbar">
        <div className="media-board-toolbar-title">
          <span>Board</span>
          <span>
            {isMediaSearchActive
              ? `${mediaSearchResultCount} of ${totalItems} items`
              : `${itemCount} items in ${folderCount} folders`}
          </span>
        </div>
        <div className="media-board-toolbar-actions">
          <button
            className="btn btn-sm"
            onClick={onOpenAI}
            title="Open AI Video panel"
          >
            AI
          </button>
          <button className="btn btn-sm" onClick={onResetLayout} title="Reset board layout">
            Reset
          </button>
        </div>
      </div>
      <div
        ref={canvasRef}
        className="media-board-canvas"
        onWheel={onCanvasWheel}
        onMouseDown={onCanvasMouseDown}
        onDoubleClick={onCanvasDoubleClick}
        onContextMenu={onCanvasContextMenu}
        onDragOver={onCanvasDragOver}
        onDragLeave={onCanvasDragLeave}
        onDrop={onCanvasDrop}
      >
        <div
          ref={canvasInnerRef}
          className="media-board-canvas-inner"
          style={{
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          }}
        >
          {renderLod.overviewCanvas ? (
            <canvas
              ref={overviewCanvasRef}
              className="media-board-overview-canvas"
              style={overviewCanvasStyle}
              aria-hidden="true"
            />
          ) : null}
          {visibleGroups.filter((group) => group.id !== null).map((group) => {
            const folder = group.id ? folders.find((candidate) => candidate.id === group.id) : null;
            if (!folder) return null;
            const isRenamingGroup = group.id !== null && renamingId === group.id;
            return (
              <div
                key={group.id ?? 'root'}
                className={[
                  'media-board-group',
                  'folder-group',
                  `depth-${Math.min(group.depth, 3)}`,
                  selectedIdSet.has(folder.id) ? 'selected' : '',
                  group.isDraggingPreview ? 'drag-source-preview' : '',
                  mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(folder.id) ? 'search-dimmed' : '',
                ].filter(Boolean).join(' ')}
                data-item-id={folder.id}
                data-board-group-key={getMediaBoardOrderKey(group.id)}
                data-media-panel-anim-id={group.id ?? undefined}
                draggable={false}
                style={{
                  left: group.x,
                  top: group.y,
                  width: group.width,
                  height: group.height,
                }}
                onMouseDown={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('input, button')) return;
                  onNodeMouseDown(e, folder);
                }}
                onDoubleClick={() => { onItemDoubleClick(folder); }}
                onContextMenu={(e) => {
                  if (consumeSuppressedContextMenu()) {
                    e.preventDefault();
                    return;
                  }
                  onItemContextMenu(e, folder.id);
                }}
                onDragOver={onGroupDragOver}
                onDrop={(e) => onGroupDrop(e, group.id)}
              >
                <div className="media-board-group-header">
                  {isRenamingGroup ? (
                    <input
                      className="media-board-group-rename"
                      value={renameValue}
                      size={Math.max(1, renameValue.length)}
                      style={{ width: `${Math.max(4, renameValue.length + 1)}ch` }}
                      onChange={(e) => onRenameValueChange(e.target.value)}
                      onBlur={onFinishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onFinishRename();
                        if (e.key === 'Escape') onCancelRename();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span
                      title={group.name}
                      onDoubleClick={(e) => {
                        if (!group.id) return;
                        e.stopPropagation();
                        onStartRename(group.id, folder?.name ?? group.name);
                      }}
                    >
                      {group.name}
                    </span>
                  )}
                  <span>{group.itemCount}</span>
                </div>
              </div>
            );
          })}
          {visibleInsertGaps.map((gap) => (
            <div
              key={gap.id}
              className="media-board-insert-gap"
              style={{
                left: gap.layout.x,
                top: gap.layout.y,
                width: gap.layout.width,
                height: gap.layout.height,
              }}
            />
          ))}
          {visiblePlacements.map((placement) => (
            <MediaBoardNode
              key={placement.item.id}
              placement={placement}
              renderLod={renderLod}
              selectedIdSet={selectedIdSet}
              mediaSearchVisibleItemIds={mediaSearchVisibleItemIds}
              onNodeMouseDown={onNodeMouseDown}
              onItemDoubleClick={onItemDoubleClick}
              onItemContextMenu={onItemContextMenu}
              consumeSuppressedContextMenu={consumeSuppressedContextMenu}
              onTimelineDragStart={onTimelineDragStart}
              onTimelineDragEnd={onTimelineDragEnd}
              refreshFileUrls={refreshFileUrls}
              buildTooltip={buildTooltip}
              formatDuration={formatDuration}
              getProjectItemIconType={getProjectItemIconType}
              getGaussianSplatResolutionLabel={getGaussianSplatResolutionLabel}
              getMediaFileContainerLabel={getMediaFileContainerLabel}
              getMediaFileCodecLabel={getMediaFileCodecLabel}
            />
          ))}
          {marquee && (() => {
            const left = Math.min(marquee.startX, marquee.currentX);
            const top = Math.min(marquee.startY, marquee.currentY);
            const width = Math.abs(marquee.currentX - marquee.startX);
            const height = Math.abs(marquee.currentY - marquee.startY);
            if (width < 2 && height < 2) return null;
            return (
              <div
                className="media-board-marquee"
                style={{ left, top, width, height }}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );
}
