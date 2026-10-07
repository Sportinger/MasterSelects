import type { BoundOperatorNode } from '../../types/operatorGraph';
import type { Effect } from '../../types/effects';
import { GAIT_ANGLE_OUTPUTS } from '../parameterSources/controlOperators';
import { STICK_FIGURE_EFFECT } from './stickFigureJointRuntime';

const LIMB_PARAMS: Readonly<Record<string, readonly [string, string]>> = {
  legL: ['hipL', 'kneeL'], legR: ['hipR', 'kneeR'], armL: ['shoulderL', 'elbowL'], armR: ['shoulderR', 'elbowR'],
};

export interface QuickConnection { portId: string; property: string }
export interface QuickConnectPlan { label: string; connections: QuickConnection[] }

/**
 * The obvious wiring of a rig node on its own clip: gait and limb IK onto the clip's Stick Figure,
 * Attach to Joint and Ballistic onto the clip's position (and rotation). Null when nothing fits.
 */
export function rigQuickConnect(node: BoundOperatorNode, clip: { effects: readonly Effect[] }): QuickConnectPlan | null {
  const figureId = typeof node.constants?.figure === 'string' ? node.constants.figure : '';
  const figure = clip.effects.find(effect => effect.type === STICK_FIGURE_EFFECT && (!figureId || effect.id === figureId));
  switch (node.operator) {
    case 'rig.gait-cycle':
      return figure ? { label: 'Connect to stick figure joints',
        connections: GAIT_ANGLE_OUTPUTS.map(portId => ({ portId, property: `effect.${figure.id}.${portId}` })) } : null;
    case 'rig.limb-ik': {
      const params = LIMB_PARAMS[String(node.constants?.limb ?? 'legL')];
      return figure && params ? { label: 'Connect to limb joints', connections: [
        { portId: 'upper', property: `effect.${figure.id}.${params[0]}` },
        { portId: 'lower', property: `effect.${figure.id}.${params[1]}` },
      ] } : null;
    }
    case 'rig.attach':
      return { label: 'Connect to clip position and rotation', connections: [
        { portId: 'x', property: 'position.x' }, { portId: 'y', property: 'position.y' }, { portId: 'rotation', property: 'rotation.z' },
      ] };
    case 'control.ballistic':
      return { label: 'Connect to clip position', connections: [
        { portId: 'x', property: 'position.x' }, { portId: 'y', property: 'position.y' },
      ] };
    default:
      return null;
  }
}
