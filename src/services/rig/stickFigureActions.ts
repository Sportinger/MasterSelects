import { GAIT_ANGLE_OUTPUTS } from '../parameterSources/controlOperators';
import { addControlNode, setParameterSourceBinding } from '../parameterSources/parameterSourceActions';
import type { SkeletonGait } from './skeletonRig';

const GAIT_SPEED: Record<SkeletonGait, number> = { walk: 1, run: 1.6, idle: 0.3 };

/**
 * Quick build: one Gait Cycle node driving every joint angle of a Stick Figure effect. The figure's
 * ground mode (Plant by default) turns the leg swing into the body bounce. Returns the node id.
 */
export function driveStickFigureWithGait(clipId: string, effectId: string, gait: SkeletonGait): string {
  const nodeId = addControlNode(clipId, 'rig.gait-cycle', { x: -320, y: -300 }, { gait, speed: GAIT_SPEED[gait] });
  for (const output of GAIT_ANGLE_OUTPUTS) {
    setParameterSourceBinding(clipId, `effect.${effectId}.${output}`, { source: { nodeId, portId: output }, enabled: true, exposed: true });
  }
  return nodeId;
}
