import type { KeyframeEditOperation } from '../../stores/timeline/editOperations/transactionTypes';
import type { MotionPathNode, MotionPathPosition, MotionPathSpatialHandle } from './motionPathGeometry';

export function buildMotionPathPositionUpsertOperations(
  clipId: string,
  node: Pick<MotionPathNode,
    'time' | 'xKeyframeId' | 'yKeyframeId' | 'xEasing' | 'yEasing'>,
  position: MotionPathPosition,
): KeyframeEditOperation[] {
  const xOperation: KeyframeEditOperation = node.xKeyframeId
    ? {
        type: 'keyframe-update-value',
        keyframeId: node.xKeyframeId,
        clipId,
        property: 'position.x',
        value: { value: position.x },
      }
    : {
        type: 'keyframe-create',
        clipId,
        property: 'position.x',
        time: node.time,
        value: { value: position.x },
        easing: node.yEasing ?? 'linear',
      };
  const yOperation: KeyframeEditOperation = node.yKeyframeId
    ? {
        type: 'keyframe-update-value',
        keyframeId: node.yKeyframeId,
        clipId,
        property: 'position.y',
        value: { value: position.y },
      }
    : {
        type: 'keyframe-create',
        clipId,
        property: 'position.y',
        time: node.time,
        value: { value: position.y },
        easing: node.xEasing ?? 'linear',
      };

  return [xOperation, yOperation];
}

export function buildMotionPathBezierHandleOperations(
  clipId: string,
  handle: Pick<MotionPathSpatialHandle,
    'direction' | 'nodePosition' | 'temporalOffset' | 'xKeyframeId' | 'yKeyframeId'>,
  position: MotionPathPosition,
): KeyframeEditOperation[] {
  return [
    {
      type: 'keyframe-update-bezier-handle',
      keyframeId: handle.xKeyframeId,
      clipId,
      property: 'position.x',
      handle: handle.direction,
      position: {
        x: handle.temporalOffset,
        y: position.x - handle.nodePosition.x,
      },
    },
    {
      type: 'keyframe-update-bezier-handle',
      keyframeId: handle.yKeyframeId,
      clipId,
      property: 'position.y',
      handle: handle.direction,
      position: {
        x: handle.temporalOffset,
        y: position.y - handle.nodePosition.y,
      },
    },
  ];
}
