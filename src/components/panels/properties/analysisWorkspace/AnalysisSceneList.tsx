import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { AnalysisSceneBlob } from './AnalysisSceneBlob';
import type {
  AnalysisScenePerson,
  AnalysisSceneTranscriptWord,
  AnalysisSceneView,
} from './analysisSceneViewModel';
import {
  ANALYSIS_SCENE_LIST_VIEWPORT_HEIGHT,
  type AnalysisSceneListItem,
  buildAnalysisSceneLayout,
  filterAnalysisSceneListItems,
  findActiveAnalysisSceneListItem,
  getAnalysisSceneWindow,
} from './analysisSceneListModel';

export interface AnalysisSceneListProps {
  items: readonly AnalysisSceneListItem[];
  selectedSceneId?: string;
  query?: string;
  sourceTime: number;
  /** Playback follows the active scene only when the host says follow is active. */
  followPlayback?: boolean;
  renderPersonThumbnail?: (
    person: AnalysisScenePerson,
    scene: AnalysisSceneView,
    sourceTime?: number,
  ) => ReactNode;
  onItemSelect: (item: AnalysisSceneListItem) => void;
  onWordClick?: (word: AnalysisSceneTranscriptWord) => void;
}

export function AnalysisSceneList({
  items,
  selectedSceneId,
  query = '',
  sourceTime,
  followPlayback = false,
  renderPersonThumbnail,
  onItemSelect,
  onWordClick,
}: AnalysisSceneListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(ANALYSIS_SCENE_LIST_VIEWPORT_HEIGHT);
  const filteredItems = useMemo(
    () => filterAnalysisSceneListItems(items, query),
    [items, query],
  );
  const layout = useMemo(
    () => buildAnalysisSceneLayout(filteredItems),
    [filteredItems],
  );
  const window = getAnalysisSceneWindow(layout, scrollTop, viewportHeight);
  const activeItem = useMemo(
    () => findActiveAnalysisSceneListItem(items, sourceTime, selectedSceneId),
    [items, selectedSceneId, sourceTime],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const updateHeight = () => {
      const next = Math.max(1, Math.round(viewport.clientHeight));
      setViewportHeight((current) => current === next ? current : next);
    };
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [filteredItems.length]);

  useEffect(() => {
    if (!followPlayback) return;
    const selectedIndex = filteredItems.findIndex(item => item.id === activeItem?.id);
    const viewport = viewportRef.current;
    const selectedRow = layout.rows[selectedIndex];
    if (!viewport || !selectedRow) return;
    const rowTop = selectedRow.offset;
    const rowBottom = rowTop + selectedRow.height;
    if (rowTop < viewport.scrollTop) {
      viewport.scrollTop = rowTop;
    } else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = Math.max(0, rowBottom - viewport.clientHeight);
    }
  }, [activeItem?.id, filteredItems, followPlayback, layout.rows]);

  if (filteredItems.length === 0) {
    return <p className="AnalysisSceneList__empty">No segments match this search.</p>;
  }

  return (
    <div
      ref={viewportRef}
      className="AnalysisSceneList"
      role="list"
      aria-label="Scene and transcript segments"
      onScroll={(event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="AnalysisSceneList__spacer" style={{ height: layout.totalHeight }}>
        {filteredItems.slice(window.start, window.end).map((item, offset) => {
          const index = window.start + offset;
          const row = layout.rows[index];
          if (!row) return null;
          return (
            <div
              role="listitem"
              aria-current={item.id === activeItem?.id ? 'true' : undefined}
              className="AnalysisSceneList__row"
              key={item.id}
              style={{ height: row.height, transform: `translateY(${row.offset}px)` }}
            >
              <AnalysisSceneBlob
                scene={item.scene}
                transcriptChunk={item.transcriptChunk}
                active={item.id === activeItem?.id}
                sourceTime={sourceTime}
                renderPersonThumbnail={renderPersonThumbnail}
                onChunkSelect={() => onItemSelect(item)}
                onWordClick={onWordClick}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
