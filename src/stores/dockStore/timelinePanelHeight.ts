import type { DockLayout, DockNode, DockSplit } from '../../types/dock';

const MIN_SPLIT_RATIO = 0.1;
const MAX_SPLIT_RATIO = 0.9;

interface TimelineLayoutPath {
  heightRatio: number;
  verticalSteps: Array<{
    childIndex: 0 | 1;
    containerHeightRatio: number;
    split: DockSplit;
  }>;
}

function findTimelineLayoutPath(
  node: DockNode,
  containerHeightRatio = 1,
  verticalSteps: TimelineLayoutPath['verticalSteps'] = [],
): TimelineLayoutPath | null {
  if (node.kind === 'tab-group') {
    return node.panels.some((panel) => panel.type === 'timeline')
      ? { heightRatio: containerHeightRatio, verticalSteps }
      : null;
  }

  for (const childIndex of [0, 1] as const) {
    const childHeightRatio = node.direction === 'vertical'
      ? containerHeightRatio * (childIndex === 0 ? node.ratio : 1 - node.ratio)
      : containerHeightRatio;
    const childVerticalSteps = node.direction === 'vertical'
      ? [...verticalSteps, { childIndex, containerHeightRatio, split: node }]
      : verticalSteps;
    const result = findTimelineLayoutPath(
      node.children[childIndex],
      childHeightRatio,
      childVerticalSteps,
    );
    if (result) return result;
  }

  return null;
}

function replaceSplitRatio(node: DockNode, splitId: string, ratio: number): DockNode {
  if (node.kind === 'tab-group') return node;
  if (node.id === splitId) return { ...node, ratio };

  const first = replaceSplitRatio(node.children[0], splitId, ratio);
  const second = replaceSplitRatio(node.children[1], splitId, ratio);
  if (first === node.children[0] && second === node.children[1]) return node;
  return { ...node, children: [first, second] };
}

export function getTimelinePanelHeightRatio(layout: DockLayout): number | null {
  return findTimelineLayoutPath(layout.root)?.heightRatio ?? null;
}

export function preserveTimelinePanelHeightRatio(
  layout: DockLayout,
  desiredHeightRatio: number | null,
): DockLayout {
  if (desiredHeightRatio === null || !Number.isFinite(desiredHeightRatio)) return layout;

  const path = findTimelineLayoutPath(layout.root);
  const adjustableStep = path?.verticalSteps.at(-1);
  if (!adjustableStep || adjustableStep.containerHeightRatio <= 0) return layout;

  const desiredChildRatio = Math.max(
    MIN_SPLIT_RATIO,
    Math.min(MAX_SPLIT_RATIO, desiredHeightRatio / adjustableStep.containerHeightRatio),
  );
  const nextSplitRatio = adjustableStep.childIndex === 0
    ? desiredChildRatio
    : 1 - desiredChildRatio;
  if (Math.abs(nextSplitRatio - adjustableStep.split.ratio) < 0.000001) return layout;

  return {
    ...layout,
    root: replaceSplitRatio(layout.root, adjustableStep.split.id, nextSplitRatio),
  };
}
