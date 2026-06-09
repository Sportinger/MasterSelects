import type { MouseEvent, MouseEventHandler, ReactNode, Ref } from 'react';

import type { ProjectItem } from '../../../../stores/mediaStore';
import { MediaGridBreadcrumb, type MediaGridBreadcrumbItem } from './MediaGridBreadcrumb';

export interface MediaGridMarquee {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface MediaGridChromeProps {
  wrapperRef: Ref<HTMLDivElement>;
  items: readonly ProjectItem[];
  showBreadcrumb: boolean;
  breadcrumbItems: readonly MediaGridBreadcrumbItem[];
  onSelectFolder: (folderId: string | null) => void;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  renderItem: (item: ProjectItem) => ReactNode;
  marquee: MediaGridMarquee | null;
}

export function MediaGridChrome({
  wrapperRef,
  items,
  showBreadcrumb,
  breadcrumbItems,
  onSelectFolder,
  onMouseDown,
  onContextMenu,
  renderItem,
  marquee,
}: MediaGridChromeProps) {
  return (
    <div
      className="media-grid-wrapper"
      ref={wrapperRef}
      onMouseDown={onMouseDown}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.media-grid-item')) onContextMenu(event);
      }}
      style={{ position: 'relative' }}
    >
      {showBreadcrumb && (
        <MediaGridBreadcrumb
          items={breadcrumbItems}
          onSelectFolder={onSelectFolder}
        />
      )}
      <div className="media-grid">
        {items.map((item) => renderItem(item))}
      </div>
      <MediaGridMarqueeOverlay marquee={marquee} />
    </div>
  );
}

function MediaGridMarqueeOverlay({ marquee }: { marquee: MediaGridMarquee | null }) {
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
