// SlotGrid - Resolume-style grid with row labels (layers) on left, column numbers on top
// Compositions fill slots left-to-right, top-to-bottom; remaining slots are empty

import { Fragment, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import { animateSlotGrid } from './slotGridAnimation';
import { MiniTimeline } from './MiniTimeline';
import type { Composition } from '../../stores/mediaStore';

interface SlotGridProps {
  opacity: number;
}

const GRID_COLS = 8;
const GRID_ROWS = 4;

export function SlotGrid({ opacity }: SlotGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [slotSize, setSlotSize] = useState(120);

  const compositions = useMediaStore(state => state.compositions);
  const activeCompositionId = useMediaStore(state => state.activeCompositionId);
  const openCompositionTab = useMediaStore(state => state.openCompositionTab);

  // Auto-calculate slot size based on available space
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const availableWidth = entry.contentRect.width - 32 - 16; // minus row label width + padding
        const availableHeight = entry.contentRect.height - 28 - 16; // minus col header height + padding
        const sizeByWidth = Math.floor((availableWidth - (GRID_COLS - 1) * 6) / GRID_COLS);
        const sizeByHeight = Math.floor((availableHeight - (GRID_ROWS - 1) * 6) / GRID_ROWS);
        setSlotSize(Math.max(60, Math.min(sizeByWidth, sizeByHeight)));
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Handle Ctrl+Shift+Scroll on the SlotGrid itself
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        animateSlotGrid(e.deltaY > 0 ? 1 : 0);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const handleSlotClick = useCallback((comp: Composition) => {
    openCompositionTab(comp.id);
    animateSlotGrid(0);
  }, [openCompositionTab]);

  const sortedCompositions = useMemo(() => {
    return [...compositions].sort((a, b) => a.name.localeCompare(b.name));
  }, [compositions]);

  // Build a flat slot map: index → composition or null
  const totalSlots = GRID_COLS * GRID_ROWS;
  const slotMap = useMemo(() => {
    const map: (Composition | null)[] = new Array(totalSlots).fill(null);
    sortedCompositions.forEach((comp, i) => {
      if (i < totalSlots) map[i] = comp;
    });
    return map;
  }, [sortedCompositions, totalSlots]);

  return (
    <div
      ref={containerRef}
      className="slot-grid-container"
      style={{ opacity }}
    >
      <div
        className="slot-grid-resolume"
        style={{
          gridTemplateColumns: `32px repeat(${GRID_COLS}, ${slotSize}px)`,
          gridAutoRows: `${slotSize}px`,
        }}
      >
        {/* Empty corner */}
        <div className="slot-grid-corner" />

        {/* Column headers */}
        {Array.from({ length: GRID_COLS }, (_, i) => (
          <div key={`col-${i}`} className="slot-grid-col-header">
            {i + 1}
          </div>
        ))}

        {/* Rows: label + slots */}
        {Array.from({ length: GRID_ROWS }, (_, rowIndex) => (
          <Fragment key={`row-${rowIndex}`}>
            <div className="slot-grid-row-label">
              {String.fromCharCode(65 + rowIndex)}
            </div>
            {Array.from({ length: GRID_COLS }, (_, colIndex) => {
              const slotIndex = rowIndex * GRID_COLS + colIndex;
              const comp = slotMap[slotIndex];
              if (comp) {
                const isActive = comp.id === activeCompositionId;
                return (
                  <div
                    key={slotIndex}
                    className={`slot-grid-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleSlotClick(comp)}
                    title={comp.name}
                  >
                    <MiniTimeline
                      timelineData={comp.timelineData}
                      compositionName={comp.name}
                      compositionDuration={comp.duration}
                      isActive={isActive}
                      width={slotSize - 4}
                      height={slotSize - 4}
                    />
                  </div>
                );
              }
              return (
                <div key={slotIndex} className="slot-grid-item empty" />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
