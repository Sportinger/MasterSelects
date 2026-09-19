import { useLayoutEffect, useRef, type RefObject } from 'react';

import {
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  useDockStore,
} from '../../stores/dockStore';
import { useMediaStore } from '../../stores/mediaStore';
import { findNodeById } from '../../utils/dockLayout';
import {
  MOBILE_PORTRAIT_PREVIEW_WIDTH_RATIO,
  resolveMobilePreviewSplitRatio,
} from './mobilePreviewLayoutFit';

const MOBILE_LANDSCAPE_ROOT_SPLIT_ID = 'mobile-root-split';
const MOBILE_LANDSCAPE_LOWER_SPLIT_ID = 'mobile-lower-split';
const MOBILE_PORTRAIT_ROOT_SPLIT_ID = 'mobile-v-root-split';
const MOBILE_PORTRAIT_TOP_SPLIT_ID = 'mobile-v-top-split';
const MOBILE_LANDSCAPE_PREVIEW_GROUP_ID = 'preview-group';
const MOBILE_PORTRAIT_PREVIEW_GROUP_ID = 'mobile-v-preview-group';
const SPLIT_RATIO_EPSILON = 0.0005;
const MEDIUM_MOBILE_LANDSCAPE_ROOT_RATIO = 0.42;
const MEDIUM_MOBILE_LANDSCAPE_LOWER_RATIO = 0.45;
const MEDIUM_MOBILE_PORTRAIT_ROOT_RATIO = 0.62;
const MEDIUM_MOBILE_PORTRAIT_TOP_RATIO = 0.42;

function getDirectChild(
  element: HTMLElement,
  className: string,
  index = 0,
): HTMLElement | null {
  const matches = Array.from(element.children).filter((child): child is HTMLElement => (
    child instanceof HTMLElement && child.classList.contains(className)
  ));
  return matches[index] ?? null;
}

function readMinimumHeight(element: HTMLElement | null): number {
  if (!element) return 0;
  const value = Number.parseFloat(window.getComputedStyle(element).minHeight);
  return Number.isFinite(value) ? value : 0;
}

function readSplitRatio(splitId: string): number | null {
  const node = findNodeById(useDockStore.getState().layout.root, splitId);
  return node?.kind === 'split' ? node.ratio : null;
}

interface UseMobilePreviewLayoutFitParams {
  containerRef: RefObject<HTMLDivElement | null>;
}

/** Fits Mobile Preview geometry once whenever a Mobile layout is entered. */
export function useMobilePreviewLayoutFit({
  containerRef,
}: UseMobilePreviewLayoutFitParams): void {
  const fittedLayoutIdRef = useRef<string | null>(null);
  const activeLayoutId = useDockStore((state) => state.activeSavedLayoutId);
  const mediumLayoutOverride = useDockStore((state) => state.mediumLayoutOverride);
  const setSplitRatio = useDockStore((state) => state.setSplitRatio);
  const compositionSize = useMediaStore((state) => {
    const composition = state.compositions.find(
      (candidate) => candidate.id === state.activeCompositionId,
    );
    return composition ? `${composition.width}:${composition.height}` : '';
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const portraitLayout = activeLayoutId === FACTORY_VERTICAL_MOBILE_LAYOUT_ID;
    const landscapeLayout = activeLayoutId === FACTORY_MOBILE_LAYOUT_ID;
    if (!portraitLayout && !landscapeLayout) {
      fittedLayoutIdRef.current = null;
      return;
    }
    const fitKey = `${activeLayoutId}:${mediumLayoutOverride === true ? 'medium' : 'standard'}`;
    if (!container || fittedLayoutIdRef.current === fitKey) return;

    const [compositionWidth, compositionHeight] = compositionSize.split(':').map(Number);
    if (!(compositionWidth > 0) || !(compositionHeight > 0)) return;

    const rootSplitId = portraitLayout
      ? MOBILE_PORTRAIT_ROOT_SPLIT_ID
      : MOBILE_LANDSCAPE_ROOT_SPLIT_ID;
    const previewGroupId = portraitLayout
      ? MOBILE_PORTRAIT_PREVIEW_GROUP_ID
      : MOBILE_LANDSCAPE_PREVIEW_GROUP_ID;
    let scheduledFrame: number | null = null;

    const applyFit = () => {
      scheduledFrame = null;

      if (mediumLayoutOverride === true) {
        const rootRatio = portraitLayout
          ? MEDIUM_MOBILE_PORTRAIT_ROOT_RATIO
          : MEDIUM_MOBILE_LANDSCAPE_ROOT_RATIO;
        const rootSplitId = portraitLayout
          ? MOBILE_PORTRAIT_ROOT_SPLIT_ID
          : MOBILE_LANDSCAPE_ROOT_SPLIT_ID;
        const rootCurrentRatio = readSplitRatio(rootSplitId);
        if (rootCurrentRatio !== null && Math.abs(rootCurrentRatio - rootRatio) > SPLIT_RATIO_EPSILON) {
          setSplitRatio(rootSplitId, rootRatio);
        }

        const nestedSplitId = portraitLayout
          ? MOBILE_PORTRAIT_TOP_SPLIT_ID
          : MOBILE_LANDSCAPE_LOWER_SPLIT_ID;
        const nestedRatio = portraitLayout
          ? MEDIUM_MOBILE_PORTRAIT_TOP_RATIO
          : MEDIUM_MOBILE_LANDSCAPE_LOWER_RATIO;
        const nestedCurrentRatio = readSplitRatio(nestedSplitId);
        if (nestedCurrentRatio !== null && Math.abs(nestedCurrentRatio - nestedRatio) > SPLIT_RATIO_EPSILON) {
          setSplitRatio(nestedSplitId, nestedRatio);
        }
        fittedLayoutIdRef.current = fitKey;
        return;
      }

      const rootSplit = container.querySelector<HTMLElement>(
        `[data-split-id="${rootSplitId}"]`,
      );
      const previewPane = container.querySelector<HTMLElement>(
        `[data-group-id="${previewGroupId}"]`,
      );
      const previewContainer = previewPane?.querySelector<HTMLElement>('.preview-container');
      if (!rootSplit || !previewPane || !previewContainer) return;

      const firstRootChild = getDirectChild(rootSplit, 'dock-split-child', 0);
      const secondRootChild = getDirectChild(rootSplit, 'dock-split-child', 1);
      const rootDivider = getDirectChild(rootSplit, 'dock-resize-handle');
      if (!firstRootChild || !secondRootChild) return;

      let previewWidthContainer = rootSplit.clientWidth;
      let previewWidthRatio = 1;
      if (portraitLayout) {
        const topSplit = container.querySelector<HTMLElement>(
          `[data-split-id="${MOBILE_PORTRAIT_TOP_SPLIT_ID}"]`,
        );
        if (!topSplit) return;
        previewWidthContainer = topSplit.clientWidth;
        previewWidthRatio = MOBILE_PORTRAIT_PREVIEW_WIDTH_RATIO;

        const currentTopRatio = readSplitRatio(MOBILE_PORTRAIT_TOP_SPLIT_ID);
        if (
          currentTopRatio !== null
          && Math.abs(currentTopRatio - MOBILE_PORTRAIT_PREVIEW_WIDTH_RATIO)
            > SPLIT_RATIO_EPSILON
        ) {
          setSplitRatio(
            MOBILE_PORTRAIT_TOP_SPLIT_ID,
            MOBILE_PORTRAIT_PREVIEW_WIDTH_RATIO,
          );
        }
      }

      const nextRootRatio = resolveMobilePreviewSplitRatio({
        compositionHeight,
        compositionWidth,
        containerHeight: rootSplit.clientHeight,
        containerWidth: previewWidthContainer,
        dividerSize: rootDivider
          ? (rootDivider.clientHeight || rootDivider.clientWidth)
          : 0,
        minimumPreviewHeight: readMinimumHeight(firstRootChild),
        minimumRemainingHeight: readMinimumHeight(secondRootChild),
        previewChromeHeight: Math.max(
          0,
          previewPane.clientHeight - previewContainer.clientHeight,
        ),
        previewWidthRatio,
      });
      const currentRootRatio = readSplitRatio(rootSplitId);
      if (nextRootRatio === null || currentRootRatio === null) return;
      if (Math.abs(currentRootRatio - nextRootRatio) > SPLIT_RATIO_EPSILON) {
        setSplitRatio(rootSplitId, nextRootRatio);
      }
      fittedLayoutIdRef.current = fitKey;
    };

    scheduledFrame = window.requestAnimationFrame(applyFit);

    return () => {
      if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame);
    };
  }, [activeLayoutId, compositionSize, containerRef, mediumLayoutOverride, setSplitRatio]);
}
