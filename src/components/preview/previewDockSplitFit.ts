import { useDockStore } from '../../stores/dockStore';
import { findNodeById } from '../../utils/dockLayout';

const FIT_ANIMATION_CLASS = 'preview-fit-animating';
const FIT_ANIMATION_MS = 260;
const SPLIT_RATIO_EPSILON = 0.0005;
const MIN_SPLIT_RATIO = 0.1;
const MAX_SPLIT_RATIO = 0.9;
const SOLVER_ITERATIONS = 40;

interface SplitStep {
  children: [HTMLElement, HTMLElement];
  /** Which child holds the preview. */
  index: 0 | 1;
  /** Minimum sizes of both children along the solved axis. */
  minimums?: [number, number];
  ratio: number;
  split: HTMLElement;
  splitId: string;
}

interface SplitChange {
  ratio: number;
  split: HTMLElement;
  splitId: string;
}

function getSplitChildren(split: HTMLElement): HTMLElement[] {
  return Array.from(split.children).filter((child): child is HTMLElement => (
    child instanceof HTMLElement && child.classList.contains('dock-split-child')
  ));
}

function readMinimumSize(element: HTMLElement, property: 'minHeight' | 'minWidth'): number {
  const value = Number.parseFloat(window.getComputedStyle(element)[property]);
  return Number.isFinite(value) ? value : 0;
}

function clampRatio(ratio: number): number {
  return Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, ratio));
}

/** Dock splits around the preview, innermost first; null inside a maximized or fixed dock. */
function collectSplitSteps(previewElement: HTMLElement): SplitStep[] | null {
  const { root } = useDockStore.getState().layout;
  const steps: SplitStep[] = [];
  let child = previewElement.closest<HTMLElement>('.dock-split-child');
  while (child) {
    const split = child.parentElement;
    if (!split?.classList.contains('dock-split')) break;
    if (split.classList.contains('maximized-path')) return null;
    const [first, second] = getSplitChildren(split);
    const splitId = split.dataset.splitId;
    const node = splitId ? findNodeById(root, splitId) : null;
    if (!first || !second || !splitId || node?.kind !== 'split') return null;
    steps.push({
      children: [first, second],
      index: first === child ? 0 : 1,
      ratio: node.ratio,
      split,
      splitId,
    });
    child = split.parentElement?.closest<HTMLElement>('.dock-split-child') ?? null;
  }
  return steps;
}

function isFixedStep(step: SplitStep, property: 'maxHeight' | 'maxWidth'): boolean {
  return Boolean(step.children[0].style[property] || step.children[1].style[property]);
}

/**
 * Predicts the preview's span along one axis for the given ratios. Children are
 * sized `ratio * 100% - 2px`; constant offsets cancel through calibration.
 */
function predictSpan(
  steps: SplitStep[],
  ratios: Map<string, number>,
  start: number,
  size: number,
): { minimumOk: boolean; start: number; size: number } {
  let minimumOk = true;
  for (const step of steps) {
    const ratio = ratios.get(step.splitId) ?? step.ratio;
    const firstSize = ratio * size - 2;
    const secondSize = (1 - ratio) * size - 2;
    if (step.minimums && (firstSize < step.minimums[0] || secondSize < step.minimums[1])) {
      minimumOk = false;
    }
    if (step.index === 0) {
      size = firstSize;
    } else {
      start += ratio * size;
      size = secondSize;
    }
  }
  return { minimumOk, start, size };
}

/** Bisects one ratio so `read(ratio)` reaches `target` (read is increasing). */
function solveRatio(read: (ratio: number) => number, target: number): number {
  let low = MIN_SPLIT_RATIO;
  let high = MAX_SPLIT_RATIO;
  for (let i = 0; i < SOLVER_ITERATIONS; i += 1) {
    const middle = (low + high) / 2;
    if (read(middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

interface HorizontalFit {
  changes: SplitChange[];
  width: number;
}

/**
 * Moves the dividers left and right of the preview by the same amount so the
 * preview width changes by `widthDelta`; backs off where panels hit minimums.
 */
function resolveHorizontalFit(
  container: HTMLElement,
  horizontal: SplitStep[],
  widthDelta: number,
): HorizontalFit | null {
  const leftStep = horizontal.find(step => step.index === 1);
  const rightStep = horizontal.find(step => step.index === 0);
  const outerIndex = Math.max(
    leftStep ? horizontal.indexOf(leftStep) : -1,
    rightStep ? horizontal.indexOf(rightStep) : -1,
  );
  if (outerIndex < 0) return null;

  // Outer→inner path from the outermost adjusted split down to the preview.
  const path = horizontal.slice(0, outerIndex + 1).reverse();
  for (const step of path) {
    step.minimums = [
      readMinimumSize(step.children[0], 'minWidth'),
      readMinimumSize(step.children[1], 'minWidth'),
    ];
  }
  const outerRect = path[0].split.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const current = predictSpan(path, new Map(), outerRect.left, outerRect.width);
  const insetStart = containerRect.left - current.start;
  const insetEnd = current.start + current.size - containerRect.right;

  const shareCount = (leftStep ? 1 : 0) + (rightStep ? 1 : 0);
  const solveFor = (scale: number): Map<string, number> => {
    const perSide = widthDelta * scale / shareCount;
    const targetStart = current.start - (leftStep ? perSide : 0);
    const targetEnd = current.start + current.size + (rightStep ? perSide : 0);
    const ratios = new Map<string, number>();
    for (let pass = 0; pass < 6; pass += 1) {
      if (leftStep) {
        ratios.set(leftStep.splitId, solveRatio((ratio) => {
          const trial = new Map(ratios).set(leftStep.splitId, ratio);
          return predictSpan(path, trial, outerRect.left, outerRect.width).start;
        }, targetStart));
      }
      if (rightStep) {
        ratios.set(rightStep.splitId, solveRatio((ratio) => {
          const trial = new Map(ratios).set(rightStep.splitId, ratio);
          const span = predictSpan(path, trial, outerRect.left, outerRect.width);
          return span.start + span.size;
        }, targetEnd));
      }
    }
    return ratios;
  };

  // Largest share of the requested change that keeps every panel above its minimum.
  let ratios = solveFor(1);
  if (!predictSpan(path, ratios, outerRect.left, outerRect.width).minimumOk) {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 16; i += 1) {
      const middle = (low + high) / 2;
      if (predictSpan(path, solveFor(middle), outerRect.left, outerRect.width).minimumOk) {
        low = middle;
      } else {
        high = middle;
      }
    }
    ratios = solveFor(low);
  }

  const span = predictSpan(path, ratios, outerRect.left, outerRect.width);
  const changes = path
    .filter(step => ratios.has(step.splitId))
    .map(step => ({ ratio: ratios.get(step.splitId) ?? step.ratio, split: step.split, splitId: step.splitId }));
  return { changes, width: span.size - insetStart - insetEnd };
}

/**
 * Moves the divider below the preview so its canvas area gets the given height.
 * Stacked splits passed on the way only pass a proportional share through.
 */
function resolveVerticalFit(
  vertical: SplitStep[],
  heightDelta: number,
): SplitChange | null {
  let previewShare = 1;
  for (const step of vertical) {
    const splitHeight = step.split.clientHeight;
    if (!(splitHeight > 0)) return null;
    if (step.index === 1) {
      previewShare *= step.children[1].clientHeight / splitHeight;
      continue;
    }
    if (previewShare <= 0) return null;
    const minimumRatio = (readMinimumSize(step.children[0], 'minHeight') + 2) / splitHeight;
    const maximumRatio = 1 - (readMinimumSize(step.children[1], 'minHeight') + 2) / splitHeight;
    if (minimumRatio > maximumRatio) return null;
    const ratio = clampRatio(Math.max(
      minimumRatio,
      Math.min(maximumRatio, step.ratio + heightDelta / previewShare / splitHeight),
    ));
    return { ratio, split: step.split, splitId: step.splitId };
  }
  return null;
}

interface FitPreviewDockSplitParams {
  aspectHeight: number;
  aspectWidth: number;
  /** The whole preview panel content (canvas area plus transport row). */
  container: HTMLElement;
  /** Transport row height the preview will have once the toggle settles. */
  nextTransportHeight: number;
}

/**
 * Refits the dock around the preview so the canvas area matches the aspect
 * ratio exactly. The correction is split between the divider below and the
 * dividers on both sides (equally) with the least total divider movement.
 * Best effort: missing, fixed or minimum-bound dividers take no share.
 */
export function fitPreviewDockSplitToAspect({
  aspectHeight,
  aspectWidth,
  container,
  nextTransportHeight,
}: FitPreviewDockSplitParams): void {
  if (!(aspectWidth > 0) || !(aspectHeight > 0)) return;
  const steps = collectSplitSteps(container);
  if (!steps) return;
  const vertical = steps.filter(step => step.split.classList.contains('vertical'));
  const horizontal = steps.filter(step => step.split.classList.contains('horizontal'));
  const hasBottomDivider = vertical.some(step => step.index === 0)
    && !vertical.some(step => isFixedStep(step, 'maxHeight'));
  const sideDividerCount = horizontal.some(step => isFixedStep(step, 'maxWidth'))
    ? 0
    : (horizontal.some(step => step.index === 1) ? 1 : 0)
      + (horizontal.some(step => step.index === 0) ? 1 : 0);

  const aspect = aspectWidth / aspectHeight;
  const width = container.clientWidth;
  const canvasHeight = container.clientHeight - nextTransportHeight;
  // Width the canvas area lacks (positive) or has in excess (negative).
  const widthError = aspect * canvasHeight - width;
  // Least squares over divider moves: bottom moves dH, each side moves dW / k.
  let widthDelta = 0;
  if (sideDividerCount > 0) {
    widthDelta = hasBottomDivider
      ? widthError * sideDividerCount / (sideDividerCount + aspect * aspect)
      : widthError;
  }

  const changes: SplitChange[] = [];
  let fittedWidth = width;
  if (Math.abs(widthDelta) >= 0.5) {
    const horizontalFit = resolveHorizontalFit(container, horizontal, widthDelta);
    if (horizontalFit) {
      changes.push(...horizontalFit.changes);
      fittedWidth = horizontalFit.width;
    }
  }
  if (hasBottomDivider) {
    // Round up so the canvas stays width-limited and spans the full panel width.
    const desiredCanvasHeight = Math.ceil(fittedWidth / aspect);
    const verticalFit = resolveVerticalFit(vertical, desiredCanvasHeight - canvasHeight);
    if (verticalFit) changes.push(verticalFit);
  }

  const { layout, setSplitRatio } = useDockStore.getState();
  for (const change of changes) {
    const node = findNodeById(layout.root, change.splitId);
    if (node?.kind !== 'split' || Math.abs(node.ratio - change.ratio) < SPLIT_RATIO_EPSILON) continue;
    const split = change.split;
    split.classList.add(FIT_ANIMATION_CLASS);
    window.setTimeout(() => split.classList.remove(FIT_ANIMATION_CLASS), FIT_ANIMATION_MS);
    setSplitRatio(change.splitId, change.ratio);
  }
}
