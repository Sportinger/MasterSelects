import type { PreviewValueControl } from './previewTypes';
import { setAnimatedOperatorParameter, setOperatorConstant } from '../operators/effectGraphEditing';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { useTimelineStore } from '../../stores/timeline';
import { createFlockProperty } from '../../types/flock';
import { getFlockOperator } from '../flock/operators/flockOperatorRegistry';
import { startBatch, endBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';

export function editPreviewValue(control: PreviewValueControl, value: number | boolean | string) {
  const target = control.target;
  if ('effectId' in target) return target.storage === 'constant'
    ? setOperatorConstant(target.clipId, target.effectId, target.nodeId, target.parameter, value)
    : setAnimatedOperatorParameter(target.clipId, target.effectId, target.nodeId, target.parameter, value);
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(item => item.id === target.clipId);
  const node = clip?.flock?.nodes.find(item => item.id === target.nodeId);
  const spec = node && getFlockOperator(node.operator)?.params.find(item => item.id === target.parameter);
  if (!spec || state.isExporting || state.tracks.find(track => track.id === clip!.trackId)?.locked) throw new Error('The parameter is unavailable, locked or exporting.');
  const batch = startBatch('Change node value');
  try {
    if (typeof value === 'number' && spec.animatable && spec.invalidation !== 'topology') state.setPropertyValue(target.clipId, createFlockProperty(target.nodeId, target.parameter), value);
    else if (!state.setFlockGraphParam(target.clipId, target.nodeId, target.parameter, value)) throw new Error('Invalid node value.');
  } finally { if (batch.opened) endBatch(); }
}
