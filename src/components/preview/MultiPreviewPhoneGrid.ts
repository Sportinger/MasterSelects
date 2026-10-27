// Phone skin only: the Multi Preview grid fills the whole area and picks the arrangement of its tiles
// (4x1, 2x2, 1x4, ...) in which each picture is largest for the composition's shape. The desktop keeps
// its fixed 16:9 2x2 block.

import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

export interface MultiPreviewGridShape {
  columns: number;
  rows: number;
}

/** Columns/rows for `count` tiles in a `width` x `height` area whose pictures have `aspect` (w/h). */
export function bestMultiPreviewGrid(count: number, width: number, height: number, aspect: number): MultiPreviewGridShape {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  let best: MultiPreviewGridShape & { area: number } = { columns: 2, rows: Math.ceil(count / 2), area: -1 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = width / columns, cellHeight = height / rows;
    const pictureWidth = Math.min(cellWidth, cellHeight * safeAspect);
    const area = pictureWidth * (pictureWidth / safeAspect);
    // Prefer fewer empty cells when two arrangements are equally good.
    if (area > best.area * 1.001) best = { columns, rows, area };
  }
  return { columns: best.columns, rows: best.rows };
}

/** True when the element sits inside the phone skin (/m). */
export function usePhoneSkinAncestor(ref: RefObject<HTMLElement | null>): boolean {
  const [inside, setInside] = useState(false);
  useLayoutEffect(() => { setInside(Boolean(ref.current?.closest('.mobile-skin'))); }, [ref]);
  return inside;
}

/** Inline grid style for the phone, re-measured when the area changes size (rotation, side panels). */
export function useMultiPreviewPhoneGrid(
  wrapperRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  count: number,
  aspect: number,
): CSSProperties | undefined {
  const [shape, setShape] = useState<MultiPreviewGridShape | null>(null);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!enabled || !wrapper) { setShape(null); return undefined; }
    const measure = () => {
      if (wrapper.clientWidth < 1 || wrapper.clientHeight < 1) return;
      const next = bestMultiPreviewGrid(count, wrapper.clientWidth, wrapper.clientHeight, aspect);
      setShape((current) => current && current.columns === next.columns && current.rows === next.rows ? current : next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [wrapperRef, enabled, count, aspect]);
  if (!enabled || !shape) return undefined;
  return {
    gridTemplateColumns: `repeat(${shape.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))`,
  };
}
