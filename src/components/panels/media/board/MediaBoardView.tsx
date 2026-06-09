import React from 'react';
import type { MediaFile, MediaFolder, ProjectItem } from '../../../../stores/mediaStore';
import { MEDIA_BOARD_GRID_PARALLAX, getMediaBoardGridSize, getMediaBoardUiScale } from './constants';
import { getMediaBoardOrderKey } from './layout';
import { MediaBoardNode } from './MediaBoardNode';
import type {
  MediaBoardGroupLayout,
  MediaBoardInsertGapPlacement,
  MediaBoardMarquee,
  MediaBoardNodePlacement,
  MediaBoardRenderLod,
  MediaBoardViewport,
  MediaBoardVisibleRect,
} from './types';

export interface MediaBoardViewProps {
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
  visibleRect: MediaBoardVisibleRect;
  focusedOriginalMediaId: string | null;
  videoPosterFallbackIds: Set<string>;
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
  onRequestThumbnail: (id: string) => void;
  refreshFileUrls: (id: string) => void | Promise<unknown>;
  buildTooltip: (item: ProjectItem, isFolder: boolean, isComp: boolean) => string;
  formatDuration: (seconds: number) => string;
  getProjectItemIconType: (item: ProjectItem | undefined) => string | undefined;
  getGaussianSplatResolutionLabel: (item: ProjectItem) => string | null;
  getMediaFileContainerLabel: (mediaFile: MediaFile | null) => string | undefined;
  getMediaFileCodecLabel: (mediaFile: MediaFile | null) => string | undefined;
  children?: React.ReactNode;
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
  visibleRect,
  focusedOriginalMediaId,
  videoPosterFallbackIds,
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
  onRequestThumbnail,
  refreshFileUrls,
  buildTooltip,
  formatDuration,
  getProjectItemIconType,
  getGaussianSplatResolutionLabel,
  getMediaFileContainerLabel,
  getMediaFileCodecLabel,
  children,
}: MediaBoardViewProps) {
  return (
    <div
      className="media-board-wrapper"
      ref={wrapperRef}
      style={{
        '--media-board-grid-x': `${viewport.panX * MEDIA_BOARD_GRID_PARALLAX}px`,
        '--media-board-grid-y': `${viewport.panY * MEDIA_BOARD_GRID_PARALLAX}px`,
        '--media-board-grid-size': `${getMediaBoardGridSize(viewport.zoom)}px`,
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
            title="Expand AI generator"
          >
            Generate
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
            '--media-board-ui-scale': getMediaBoardUiScale(viewport.zoom),
          } as React.CSSProperties}
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
              viewport={viewport}
              visibleRect={visibleRect}
              focusedOriginalMediaId={focusedOriginalMediaId}
              videoPosterFallbackIds={videoPosterFallbackIds}
              selectedIdSet={selectedIdSet}
              mediaSearchVisibleItemIds={mediaSearchVisibleItemIds}
              onNodeMouseDown={onNodeMouseDown}
              onItemDoubleClick={onItemDoubleClick}
              onItemContextMenu={onItemContextMenu}
              consumeSuppressedContextMenu={consumeSuppressedContextMenu}
              onRequestThumbnail={onRequestThumbnail}
              refreshFileUrls={refreshFileUrls}
              buildTooltip={buildTooltip}
              formatDuration={formatDuration}
              getProjectItemIconType={getProjectItemIconType}
              getGaussianSplatResolutionLabel={getGaussianSplatResolutionLabel}
              getMediaFileContainerLabel={getMediaFileContainerLabel}
              getMediaFileCodecLabel={getMediaFileCodecLabel}
            />
          ))}
          {children}
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
