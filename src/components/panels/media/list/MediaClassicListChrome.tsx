import type {
  CSSProperties,
  DragEvent,
  MouseEvent,
  MouseEventHandler,
  ReactNode,
  Ref,
  UIEventHandler,
} from 'react';

import { MediaClassicColumnHeaders } from './MediaClassicColumnHeaders';
import type {
  MediaClassicColumnId,
  MediaClassicDynamicColumnWidths,
  MediaClassicListRowData,
  MediaClassicMarquee,
} from './types';

type ClassicListStyle = CSSProperties & Record<`--media-${string}`, string>;

export interface MediaClassicListChromeProps {
  wrapperRef: Ref<HTMLDivElement>;
  isVerticalScrolling: boolean;
  isHorizontallyScrolled: boolean;
  onScroll: UIEventHandler<HTMLDivElement>;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  nameColumnWidth: number;
  columnWidths: MediaClassicDynamicColumnWidths;
  columnOrder: readonly MediaClassicColumnId[];
  draggingColumn: MediaClassicColumnId | null;
  dragOverColumn: MediaClassicColumnId | null;
  sortColumn: MediaClassicColumnId | null;
  sortDirection: 'asc' | 'desc';
  onColumnDragStart: (event: DragEvent<HTMLDivElement>, columnId: MediaClassicColumnId) => void;
  onColumnDragOver: (event: DragEvent<HTMLDivElement>, columnId: MediaClassicColumnId) => void;
  onColumnDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onColumnDrop: (event: DragEvent<HTMLDivElement>, columnId: MediaClassicColumnId) => void;
  onColumnDragEnd: (event: DragEvent<HTMLDivElement>) => void;
  onColumnSort: (columnId: MediaClassicColumnId) => void;
  onNameColumnResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  visibleRows: readonly MediaClassicListRowData[];
  renderRow: (row: MediaClassicListRowData) => ReactNode;
  marquee: MediaClassicMarquee | null;
}

export function MediaClassicListChrome({
  wrapperRef,
  isVerticalScrolling,
  isHorizontallyScrolled,
  onScroll,
  onMouseDown,
  onContextMenu,
  nameColumnWidth,
  columnWidths,
  columnOrder,
  draggingColumn,
  dragOverColumn,
  sortColumn,
  sortDirection,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDragLeave,
  onColumnDrop,
  onColumnDragEnd,
  onColumnSort,
  onNameColumnResizeStart,
  topSpacerHeight,
  bottomSpacerHeight,
  visibleRows,
  renderRow,
  marquee,
}: MediaClassicListChromeProps) {
  const wrapperClassName = [
    'media-panel-table-wrapper',
    isVerticalScrolling ? 'is-vertical-scrolling' : '',
    isHorizontallyScrolled ? 'is-horizontal-scrolled' : '',
  ].filter(Boolean).join(' ');

  const wrapperStyle: ClassicListStyle = {
    position: 'relative',
    '--media-name-column-width': `${nameColumnWidth}px`,
    '--media-label-column-width': `${columnWidths.label}px`,
    '--media-badge-column-width': `${columnWidths.badges}px`,
    '--media-duration-column-width': `${columnWidths.duration}px`,
    '--media-resolution-column-width': `${columnWidths.resolution}px`,
    '--media-fps-column-width': `${columnWidths.fps}px`,
    '--media-container-column-width': `${columnWidths.container}px`,
    '--media-codec-column-width': `${columnWidths.codec}px`,
    '--media-audio-column-width': `${columnWidths.audio}px`,
    '--media-bitrate-column-width': `${columnWidths.bitrate}px`,
    '--media-size-column-width': `${columnWidths.size}px`,
  };

  return (
    <div
      className={wrapperClassName}
      ref={wrapperRef}
      onScroll={onScroll}
      onMouseDown={onMouseDown}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.media-item')) onContextMenu(event);
      }}
      style={wrapperStyle}
    >
      <MediaClassicColumnHeaders
        columnOrder={columnOrder}
        draggingColumn={draggingColumn}
        dragOverColumn={dragOverColumn}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        nameColumnWidth={nameColumnWidth}
        onColumnDragStart={onColumnDragStart}
        onColumnDragOver={onColumnDragOver}
        onColumnDragLeave={onColumnDragLeave}
        onColumnDrop={onColumnDrop}
        onColumnDragEnd={onColumnDragEnd}
        onColumnSort={onColumnSort}
        onNameColumnResizeStart={onNameColumnResizeStart}
      />
      <div className="media-item-list">
        <MediaClassicVirtualSpacer height={topSpacerHeight} />
        {visibleRows.map((row) => renderRow(row))}
        <MediaClassicVirtualSpacer height={bottomSpacerHeight} />
        <MediaClassicMarqueeOverlay marquee={marquee} />
      </div>
    </div>
  );
}

function MediaClassicVirtualSpacer({ height }: { height: number }) {
  if (height <= 0) return null;
  return <div className="media-classic-virtual-spacer" style={{ height }} />;
}

function MediaClassicMarqueeOverlay({ marquee }: { marquee: MediaClassicMarquee | null }) {
  if (!marquee) return null;

  const left = Math.min(marquee.startX, marquee.currentX);
  const top = Math.min(marquee.startY, marquee.currentY);
  const width = Math.abs(marquee.currentX - marquee.startX);
  const height = Math.abs(marquee.currentY - marquee.startY);
  if (width < 3 && height < 3) return null;

  return (
    <div
      className="media-marquee"
      style={{ left, top, width, height }}
    />
  );
}
