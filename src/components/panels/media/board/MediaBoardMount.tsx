import type React from 'react';

import type { MediaFile, MediaFolder, ProjectItem } from '../../../../stores/mediaStore';
import { MediaBoardAnnotationLayer } from './MediaBoardAnnotationLayer';
import { MediaBoardView } from './MediaBoardView';
import type { MediaBoardAnnotation } from './annotations';
import type {
  MediaBoardGroupLayout,
  MediaBoardInsertGapPlacement,
  MediaBoardMarquee,
  MediaBoardNodePlacement,
  MediaBoardRenderLod,
  MediaBoardViewport,
  MediaBoardVisibleRect,
} from './types';

type MediaBoardAnnotationTextPatch = Partial<Pick<MediaBoardAnnotation, 'fontSize' | 'text'>>;

export interface MediaBoardMountProps {
  boardWrapperRef: React.RefObject<HTMLDivElement | null>;
  boardCanvasRef: React.RefObject<HTMLDivElement | null>;
  boardCanvasInnerRef: React.RefObject<HTMLDivElement | null>;
  boardOverviewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  buildGridTooltip: (item: ProjectItem, isFolder: boolean, isComp: boolean) => string;
  consumeSuppressedMediaBoardContextMenu: () => boolean;
  focusedMediaBoardOriginalId: string | null;
  formatDuration: (seconds: number) => string;
  folders: MediaFolder[];
  getGaussianSplatResolutionLabel: (item: ProjectItem) => string | null;
  getMediaFileCodecLabel: (mediaFile: MediaFile | null) => string | undefined;
  getMediaFileContainerLabel: (mediaFile: MediaFile | null) => string | undefined;
  getProjectItemIconType: (item: ProjectItem | undefined) => string | undefined;
  handleContextMenu: (event: React.MouseEvent, itemId?: string, parentId?: string | null) => void;
  handleMediaBoardAnnotationContextMenu: (event: React.MouseEvent, annotation: MediaBoardAnnotation) => void;
  handleMediaBoardAnnotationEditToggle: (annotation: MediaBoardAnnotation, editing: boolean) => void;
  handleMediaBoardAnnotationFocus: (annotation: MediaBoardAnnotation) => void;
  handleMediaBoardCanvasDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  handleMediaBoardCanvasDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  handleMediaBoardContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleMediaBoardDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleMediaBoardDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  handleMediaBoardGroupDragOver: (event: React.DragEvent) => void;
  handleMediaBoardGroupDrop: (event: React.DragEvent, groupId: string | null) => void;
  handleMediaBoardMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleMediaBoardNodeMouseDown: (event: React.MouseEvent, item: ProjectItem) => void;
  handleMediaBoardWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  handleItemDoubleClick: (item: ProjectItem, renameFromName?: boolean) => void | Promise<void>;
  isMediaSearchActive: boolean;
  mediaBoardItemsLength: number;
  mediaBoardMarquee: MediaBoardMarquee | null;
  mediaBoardOverviewCanvasStyle: React.CSSProperties;
  mediaBoardRenderLod: MediaBoardRenderLod;
  mediaBoardViewport: MediaBoardViewport;
  mediaBoardVisibleRect: MediaBoardVisibleRect;
  mediaSearchResultCount: number;
  mediaSearchVisibleItemIds: Set<string> | null;
  onOpenBoardAI: () => void;
  refreshFileUrls: (id: string) => void | Promise<unknown>;
  renamingId: string | null;
  renameValue: string;
  requestMediaBoardAnnotationTextFocus: (annotationId: string) => void;
  requestMediaBoardThumbnail: (id: string) => void;
  resetMediaBoardLayout: () => void;
  selectedIdSet: Set<string>;
  selectedMediaBoardAnnotationId: string | null;
  setRenameValue: (value: string) => void;
  setRenamingId: (id: string | null) => void;
  startMediaBoardAnnotationDrag: (event: React.MouseEvent, annotation: MediaBoardAnnotation) => void;
  startMediaBoardAnnotationResize: (event: React.MouseEvent, annotation: MediaBoardAnnotation, corner: 'nw' | 'ne' | 'sw' | 'se') => void;
  startRename: (id: string, currentName: string) => void;
  finishRename: () => void;
  totalItems: number;
  updateMediaBoardAnnotation: (id: string, patch: MediaBoardAnnotationTextPatch) => void;
  videoPosterFallbackIds: Set<string>;
  visibleMediaBoardAnnotations: readonly MediaBoardAnnotation[];
  visibleMediaBoardGroups: MediaBoardGroupLayout[];
  visibleMediaBoardInsertGaps: MediaBoardInsertGapPlacement[];
  visibleMediaBoardPlacements: MediaBoardNodePlacement[];
}

export function MediaBoardMount({
  boardWrapperRef,
  boardCanvasRef,
  boardCanvasInnerRef,
  boardOverviewCanvasRef,
  buildGridTooltip,
  consumeSuppressedMediaBoardContextMenu,
  focusedMediaBoardOriginalId,
  formatDuration,
  folders,
  getGaussianSplatResolutionLabel,
  getMediaFileCodecLabel,
  getMediaFileContainerLabel,
  getProjectItemIconType,
  handleContextMenu,
  handleMediaBoardAnnotationContextMenu,
  handleMediaBoardAnnotationEditToggle,
  handleMediaBoardAnnotationFocus,
  handleMediaBoardCanvasDragLeave,
  handleMediaBoardCanvasDragOver,
  handleMediaBoardContextMenu,
  handleMediaBoardDoubleClick,
  handleMediaBoardDrop,
  handleMediaBoardGroupDragOver,
  handleMediaBoardGroupDrop,
  handleMediaBoardMouseDown,
  handleMediaBoardNodeMouseDown,
  handleMediaBoardWheel,
  handleItemDoubleClick,
  isMediaSearchActive,
  mediaBoardItemsLength,
  mediaBoardMarquee,
  mediaBoardOverviewCanvasStyle,
  mediaBoardRenderLod,
  mediaBoardViewport,
  mediaBoardVisibleRect,
  mediaSearchResultCount,
  mediaSearchVisibleItemIds,
  onOpenBoardAI,
  refreshFileUrls,
  renamingId,
  renameValue,
  requestMediaBoardAnnotationTextFocus,
  requestMediaBoardThumbnail,
  resetMediaBoardLayout,
  selectedIdSet,
  selectedMediaBoardAnnotationId,
  setRenameValue,
  setRenamingId,
  startMediaBoardAnnotationDrag,
  startMediaBoardAnnotationResize,
  startRename,
  finishRename,
  totalItems,
  updateMediaBoardAnnotation,
  videoPosterFallbackIds,
  visibleMediaBoardAnnotations,
  visibleMediaBoardGroups,
  visibleMediaBoardInsertGaps,
  visibleMediaBoardPlacements,
}: MediaBoardMountProps) {
  return (
    <MediaBoardView
      wrapperRef={boardWrapperRef}
      canvasRef={boardCanvasRef}
      canvasInnerRef={boardCanvasInnerRef}
      overviewCanvasRef={boardOverviewCanvasRef}
      viewport={mediaBoardViewport}
      renderLod={mediaBoardRenderLod}
      overviewCanvasStyle={mediaBoardOverviewCanvasStyle}
      isMediaSearchActive={isMediaSearchActive}
      mediaSearchResultCount={mediaSearchResultCount}
      totalItems={totalItems}
      itemCount={mediaBoardItemsLength}
      folderCount={visibleMediaBoardGroups.filter((group) => group.id !== null).length}
      folders={folders}
      visibleGroups={visibleMediaBoardGroups}
      visibleInsertGaps={visibleMediaBoardInsertGaps}
      visiblePlacements={visibleMediaBoardPlacements}
      visibleRect={mediaBoardVisibleRect}
      focusedOriginalMediaId={focusedMediaBoardOriginalId}
      videoPosterFallbackIds={videoPosterFallbackIds}
      marquee={mediaBoardMarquee}
      selectedIdSet={selectedIdSet}
      mediaSearchVisibleItemIds={mediaSearchVisibleItemIds}
      renamingId={renamingId}
      renameValue={renameValue}
      onRenameValueChange={setRenameValue}
      onFinishRename={finishRename}
      onCancelRename={() => setRenamingId(null)}
      onStartRename={startRename}
      onOpenAI={onOpenBoardAI}
      onResetLayout={resetMediaBoardLayout}
      onCanvasWheel={handleMediaBoardWheel}
      onCanvasMouseDown={handleMediaBoardMouseDown}
      onCanvasDoubleClick={handleMediaBoardDoubleClick}
      onCanvasContextMenu={handleMediaBoardContextMenu}
      onCanvasDragOver={handleMediaBoardCanvasDragOver}
      onCanvasDragLeave={handleMediaBoardCanvasDragLeave}
      onCanvasDrop={handleMediaBoardDrop}
      onNodeMouseDown={handleMediaBoardNodeMouseDown}
      onItemDoubleClick={(item, renameFromName) => { void handleItemDoubleClick(item, renameFromName); }}
      onItemContextMenu={handleContextMenu}
      consumeSuppressedContextMenu={consumeSuppressedMediaBoardContextMenu}
      onGroupDragOver={handleMediaBoardGroupDragOver}
      onGroupDrop={handleMediaBoardGroupDrop}
      onRequestThumbnail={requestMediaBoardThumbnail}
      refreshFileUrls={refreshFileUrls}
      buildTooltip={buildGridTooltip}
      formatDuration={formatDuration}
      getProjectItemIconType={getProjectItemIconType}
      getGaussianSplatResolutionLabel={getGaussianSplatResolutionLabel}
      getMediaFileContainerLabel={getMediaFileContainerLabel}
      getMediaFileCodecLabel={getMediaFileCodecLabel}
    >
      <MediaBoardAnnotationLayer
        annotations={visibleMediaBoardAnnotations}
        selectedAnnotationId={selectedMediaBoardAnnotationId}
        onAnnotationContextMenu={handleMediaBoardAnnotationContextMenu}
        onAnnotationFocus={handleMediaBoardAnnotationFocus}
        onEditToggle={handleMediaBoardAnnotationEditToggle}
        onRequestTextFocus={requestMediaBoardAnnotationTextFocus}
        onStartDrag={startMediaBoardAnnotationDrag}
        onStartResize={startMediaBoardAnnotationResize}
        onUpdateAnnotation={updateMediaBoardAnnotation}
      />
    </MediaBoardView>
  );
}
