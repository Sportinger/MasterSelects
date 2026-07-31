import { useCallback, useEffect, useRef } from 'react';
import { useDockStore } from '../../../stores/dockStore';
import type { DockNode, DockSplit } from '../../../types/dock';
import type { TimelineCurveMode } from '../../../stores/timeline/viewPreferences';

export const MIN_GRAPH_TIMELINE_CONTENT_HEIGHT_PX = 420;
const MIN_GRAPH_SIBLING_HEIGHT_PX = 200;

interface TimelineVerticalSplitTarget {
  split: DockSplit;
  timelineChildIndex: 0 | 1;
}

interface TimelineGraphPanelRestoreSnapshot {
  expandedRatio: number;
  splitId: string;
  ratio: number;
  timelineChildIndex: 0 | 1;
}

export interface TimelineGraphPanelExpansionInput {
  childHeight: number;
  minContentHeight?: number;
  siblingMinHeight?: number;
  splitHeight: number;
  splitRatio: number;
  timelineChildIndex: 0 | 1;
  timelineContentHeight: number;
}

function nodeContainsTimeline(node: DockNode): boolean {
  if (node.kind === 'tab-group') {
    return node.panels.some((panel) => panel.type === 'timeline');
  }
  return nodeContainsTimeline(node.children[0]) || nodeContainsTimeline(node.children[1]);
}

export function findTimelineVerticalSplit(node: DockNode): TimelineVerticalSplitTarget | null {
  if (node.kind === 'tab-group') return null;
  const firstContainsTimeline = nodeContainsTimeline(node.children[0]);
  const secondContainsTimeline = nodeContainsTimeline(node.children[1]);
  if (node.direction === 'vertical' && firstContainsTimeline !== secondContainsTimeline) {
    return {
      split: node,
      timelineChildIndex: firstContainsTimeline ? 0 : 1,
    };
  }
  if (firstContainsTimeline) return findTimelineVerticalSplit(node.children[0]);
  if (secondContainsTimeline) return findTimelineVerticalSplit(node.children[1]);
  return null;
}

export function planTimelineGraphPanelExpansion({
  childHeight,
  minContentHeight = MIN_GRAPH_TIMELINE_CONTENT_HEIGHT_PX,
  siblingMinHeight = MIN_GRAPH_SIBLING_HEIGHT_PX,
  splitHeight,
  splitRatio,
  timelineChildIndex,
  timelineContentHeight,
}: TimelineGraphPanelExpansionInput): number | null {
  if (![childHeight, minContentHeight, siblingMinHeight, splitHeight, splitRatio, timelineContentHeight]
    .every(Number.isFinite)) {
    return null;
  }
  if (splitHeight <= 0 || timelineContentHeight >= minContentHeight) return null;

  const missingContentHeight = minContentHeight - timelineContentHeight;
  const maximumTimelineHeight = Math.max(0, splitHeight - siblingMinHeight);
  const desiredTimelineHeight = Math.min(
    maximumTimelineHeight,
    childHeight + missingContentHeight,
  );
  if (desiredTimelineHeight <= childHeight + 0.5) return null;

  const rawRatio = timelineChildIndex === 0
    ? desiredTimelineHeight / splitHeight
    : 1 - desiredTimelineHeight / splitHeight;
  const ratio = Math.max(0.1, Math.min(0.9, rawRatio));
  if (timelineChildIndex === 0 && ratio <= splitRatio + 0.0005) return null;
  if (timelineChildIndex === 1 && ratio >= splitRatio - 0.0005) return null;
  return ratio;
}

function findSplitById(node: DockNode, splitId: string): DockSplit | null {
  if (node.kind === 'tab-group') return null;
  if (node.id === splitId) return node;
  return findSplitById(node.children[0], splitId)
    ?? findSplitById(node.children[1], splitId);
}

function findDockSplitElement(splitId: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('.dock-split[data-split-id]')]
    .find((element) => element.dataset.splitId === splitId)
    ?? null;
}

/** Temporarily gives the shared Graph enough vertical authoring space. */
export function useTimelineGraphPanelResize(timelineCurveMode: TimelineCurveMode): void {
  const restoreSnapshotRef = useRef<TimelineGraphPanelRestoreSnapshot | null>(null);

  const restorePreviousPanelHeight = useCallback(() => {
    const snapshot = restoreSnapshotRef.current;
    if (!snapshot) return;
    restoreSnapshotRef.current = null;

    const dockState = useDockStore.getState();
    const split = findSplitById(dockState.layout.root, snapshot.splitId);
    if (!split || split.direction !== 'vertical') return;
    if (!nodeContainsTimeline(split.children[snapshot.timelineChildIndex])) return;
    if (Math.abs(split.ratio - snapshot.expandedRatio) > 0.001) return;
    dockState.setSplitRatio(snapshot.splitId, snapshot.ratio);
  }, []);

  useEffect(() => {
    if (timelineCurveMode !== 'graph') {
      restorePreviousPanelHeight();
      return;
    }
    if (restoreSnapshotRef.current) return;

    const dockState = useDockStore.getState();
    const target = findTimelineVerticalSplit(dockState.layout.root);
    if (!target) return;
    const timelineElement = document.querySelector<HTMLElement>(
      '.dock-panel-content[data-panel-type="timeline"] .timeline-container',
    );
    const splitElement = findDockSplitElement(target.split.id);
    if (!timelineElement || !splitElement) return;

    const splitChildren = [...splitElement.children]
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement && element.classList.contains('dock-split-child')
      ));
    const timelineChildElement = splitChildren[target.timelineChildIndex];
    if (!timelineChildElement?.contains(timelineElement)) return;

    const nextRatio = planTimelineGraphPanelExpansion({
      childHeight: timelineChildElement.getBoundingClientRect().height,
      splitHeight: splitElement.getBoundingClientRect().height,
      splitRatio: target.split.ratio,
      timelineChildIndex: target.timelineChildIndex,
      timelineContentHeight: timelineElement.getBoundingClientRect().height,
    });
    if (nextRatio === null) return;

    restoreSnapshotRef.current = {
      expandedRatio: nextRatio,
      splitId: target.split.id,
      ratio: target.split.ratio,
      timelineChildIndex: target.timelineChildIndex,
    };
    dockState.setSplitRatio(target.split.id, nextRatio);
  }, [restorePreviousPanelHeight, timelineCurveMode]);

  useEffect(() => () => {
    restorePreviousPanelHeight();
  }, [restorePreviousPanelHeight]);
}
