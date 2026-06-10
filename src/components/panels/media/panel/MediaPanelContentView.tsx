import type { MouseEvent, ReactNode, Ref } from 'react';
import type { ProjectItem } from '../../../../stores/mediaStore';
import { MediaGridChrome, type MediaGridChromeProps } from '../grid/MediaGridChrome';
import { MediaClassicListChrome, type MediaClassicListChromeProps } from '../list/MediaClassicListChrome';
import type { MediaPanelViewMode } from './types';
import { MediaNoMediaEmptyState } from './MediaNoMediaEmptyState';
import { MediaNoSearchResultsEmptyState } from './MediaNoSearchResultsEmptyState';

interface MediaPanelContentViewProps {
  viewMode: MediaPanelViewMode;
  contentRef: Ref<HTMLDivElement>;
  totalItems: number;
  isMediaSearchActive: boolean;
  mediaSearchResultCount: number;
  mediaSearchQuery: string;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, itemId?: string, parentId?: string | null) => void;
  classic: Omit<MediaClassicListChromeProps, 'wrapperRef' | 'onContextMenu' | 'renderRow'> & {
    wrapperRef: Ref<HTMLDivElement>;
    renderRow: (item: ProjectItem, depth?: number) => ReactNode;
  };
  icons: Omit<MediaGridChromeProps, 'wrapperRef' | 'onContextMenu' | 'renderItem'> & {
    wrapperRef: Ref<HTMLDivElement>;
    renderItem: (item: ProjectItem) => ReactNode;
  };
  renderBoard: () => ReactNode;
}

export function MediaPanelContentView({
  viewMode,
  contentRef,
  totalItems,
  isMediaSearchActive,
  mediaSearchResultCount,
  mediaSearchQuery,
  onContextMenu,
  classic,
  icons,
  renderBoard,
}: MediaPanelContentViewProps) {
  return (
    <div className={`media-panel-content media-panel-content-${viewMode}`} ref={contentRef}>
      {totalItems === 0 ? (
        <MediaNoMediaEmptyState onContextMenu={onContextMenu} />
      ) : isMediaSearchActive && mediaSearchResultCount === 0 ? (
        <MediaNoSearchResultsEmptyState
          query={mediaSearchQuery}
          onContextMenu={onContextMenu}
        />
      ) : viewMode === 'classic' ? (
        <MediaClassicListChrome
          wrapperRef={classic.wrapperRef}
          isVerticalScrolling={classic.isVerticalScrolling}
          isHorizontallyScrolled={classic.isHorizontallyScrolled}
          onScroll={classic.onScroll}
          onMouseDown={classic.onMouseDown}
          onContextMenu={onContextMenu}
          nameColumnWidth={classic.nameColumnWidth}
          columnWidths={classic.columnWidths}
          columnOrder={classic.columnOrder}
          draggingColumn={classic.draggingColumn}
          dragOverColumn={classic.dragOverColumn}
          sortColumn={classic.sortColumn}
          sortDirection={classic.sortDirection}
          onColumnDragStart={classic.onColumnDragStart}
          onColumnDragOver={classic.onColumnDragOver}
          onColumnDragLeave={classic.onColumnDragLeave}
          onColumnDrop={classic.onColumnDrop}
          onColumnDragEnd={classic.onColumnDragEnd}
          onColumnSort={classic.onColumnSort}
          onNameColumnResizeStart={classic.onNameColumnResizeStart}
          topSpacerHeight={classic.topSpacerHeight}
          bottomSpacerHeight={classic.bottomSpacerHeight}
          visibleRows={classic.visibleRows}
          renderRow={({ item, depth }) => classic.renderRow(item, depth)}
          marquee={classic.marquee}
        />
      ) : viewMode === 'icons' ? (
        <MediaGridChrome
          wrapperRef={icons.wrapperRef}
          items={icons.items}
          showBreadcrumb={icons.showBreadcrumb}
          breadcrumbItems={icons.breadcrumbItems}
          onSelectFolder={icons.onSelectFolder}
          onMouseDown={icons.onMouseDown}
          onContextMenu={onContextMenu}
          renderItem={icons.renderItem}
          marquee={icons.marquee}
        />
      ) : (
        renderBoard()
      )}
    </div>
  );
}
