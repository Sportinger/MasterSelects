import type { TransitionMultiPanelOrder } from '../../transitions';

export interface TransitionPanelSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransitionMultiPanelPlanInput {
  rows: number;
  columns: number;
  progress: number;
  seed?: number;
  order?: TransitionMultiPanelOrder;
  stagger?: number;
  magneticPoint?: { x: number; y: number };
}

export interface TransitionMultiPanelCellPlan {
  id: string;
  index: number;
  row: number;
  column: number;
  orderIndex: number;
  zIndex: number;
  progress: number;
  sourceRect: TransitionPanelSourceRect;
}

const MAX_PANEL_AXIS = 32;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function sanitizeAxis(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return clamp(Math.round(value), 1, MAX_PANEL_AXIS);
}

function hash01(seed: number, index: number): number {
  let state = Math.imul(index + 0x9e3779b9, 0x85ebca6b) ^ Math.trunc(seed);
  state ^= state >>> 16;
  state = Math.imul(state, 0xc2b2ae35);
  state ^= state >>> 13;
  state = Math.imul(state, 0x27d4eb2f);
  state ^= state >>> 15;
  return (state >>> 0) / 0xffffffff;
}

function getPanelRank(
  order: TransitionMultiPanelOrder,
  row: number,
  column: number,
  rows: number,
  columns: number,
  seed: number,
  index: number,
  magneticPoint: { x: number; y: number },
): number {
  if (order === 'column-major') return column * rows + row;
  if (order === 'random') return hash01(seed, index);

  const centerRow = (rows - 1) * 0.5;
  const centerColumn = (columns - 1) * 0.5;
  const centerDistance = Math.hypot(row - centerRow, column - centerColumn);
  const jitter = hash01(seed, index) * 0.01;

  if (order === 'center-out') return centerDistance + jitter;
  if (order === 'edge-in') return -centerDistance + jitter;
  if (order === 'magnetic') {
    const pointRow = clamp01(magneticPoint.y) * Math.max(1, rows - 1);
    const pointColumn = clamp01(magneticPoint.x) * Math.max(1, columns - 1);
    return Math.hypot(row - pointRow, column - pointColumn) + jitter;
  }

  return row * columns + column;
}

function getPanelProgress(globalProgress: number, orderIndex: number, panelCount: number, stagger: number): number {
  if (panelCount <= 1 || stagger <= 0) return clamp01(globalProgress);
  const delay = (orderIndex / (panelCount - 1)) * stagger;
  return clamp01((globalProgress - delay) / Math.max(0.0001, 1 - delay));
}

export function createTransitionMultiPanelPlan(
  input: TransitionMultiPanelPlanInput,
): TransitionMultiPanelCellPlan[] {
  const rows = sanitizeAxis(input.rows);
  const columns = sanitizeAxis(input.columns);
  const panelCount = rows * columns;
  const progress = clamp01(input.progress);
  const order = input.order ?? 'row-major';
  const seed = Number.isFinite(input.seed) ? input.seed ?? 0 : 0;
  const stagger = clamp01(input.stagger ?? 0);
  const magneticPoint = input.magneticPoint ?? { x: 0.5, y: 0.5 };

  const ranked = Array.from({ length: panelCount }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return {
      index,
      row,
      column,
      rank: getPanelRank(order, row, column, rows, columns, seed, index, magneticPoint),
    };
  }).toSorted((a, b) => a.rank - b.rank || a.index - b.index);

  const orderIndexByPanel = new Map<number, number>();
  ranked.forEach((panel, orderIndex) => {
    orderIndexByPanel.set(panel.index, orderIndex);
  });

  return Array.from({ length: panelCount }, (_, index): TransitionMultiPanelCellPlan => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const orderIndex = orderIndexByPanel.get(index) ?? index;
    return {
      id: `panel:${row}:${column}`,
      index,
      row,
      column,
      orderIndex,
      zIndex: panelCount - orderIndex,
      progress: getPanelProgress(progress, orderIndex, panelCount, stagger),
      sourceRect: {
        x: column / columns,
        y: row / rows,
        width: 1 / columns,
        height: 1 / rows,
      },
    };
  });
}
