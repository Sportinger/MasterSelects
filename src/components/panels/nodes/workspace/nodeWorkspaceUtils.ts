import type { NodeGraphNode } from '../../../../services/nodeGraph';
import type { AnimatableProperty, TimelineClip } from '../../../../stores/timeline/types';

export const NODE_WORKSPACE_INSPECTOR_WIDTH_KEY = 'masterselects.nodeWorkspace.inspectorWidth';
export const NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH = 320;
export const NODE_WORKSPACE_INSPECTOR_MIN_WIDTH = 280;
export const NODE_WORKSPACE_INSPECTOR_MAX_WIDTH = 760;

export function clampNodeWorkspaceInspectorWidth(width: number, panelWidth?: number): number {
  const maxForPanel = panelWidth
    ? Math.max(NODE_WORKSPACE_INSPECTOR_MIN_WIDTH, Math.min(NODE_WORKSPACE_INSPECTOR_MAX_WIDTH, panelWidth - 260))
    : NODE_WORKSPACE_INSPECTOR_MAX_WIDTH;
  return Math.min(maxForPanel, Math.max(NODE_WORKSPACE_INSPECTOR_MIN_WIDTH, width));
}

export function formatParamValue(value: string | number | boolean): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
  }
  return String(value);
}

export function createEffectPropertyKey(effectId: string, paramName: string): AnimatableProperty {
  return `effect.${effectId}.${paramName}` as AnimatableProperty;
}

export function createNodeGraphParamPropertyKey(nodeId: string, paramName: string): AnimatableProperty {
  return `node.${nodeId}.${paramName}` as AnimatableProperty;
}

function isForcedBuiltInNode(nodeId: string): nodeId is 'transform' | 'mask' | 'color' {
  return nodeId === 'transform' || nodeId === 'mask' || nodeId === 'color';
}

export function canDeleteNodeFromClip(clip: TimelineClip, node: NodeGraphNode | null | undefined): boolean {
  if (!node) return false;
  if (node.binding?.kind === 'keyframe-node' || node.binding?.kind === 'parameter-source') return true;
  if (node.kind === 'custom' || node.kind === 'effect') {
    return true;
  }
  if (isForcedBuiltInNode(node.id)) {
    return clip.nodeGraph?.forcedBuiltIns?.includes(node.id) ?? false;
  }
  return false;
}
