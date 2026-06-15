import type { TransitionType } from './types';

export type ThreeDTransitionOption =
  | 'flip-horizontal'
  | 'flip-vertical'
  | 'card-spin'
  | 'tumble-away'
  | 'roll-3d'
  | 'spinback-3d'
  | 'cube-3d'
  | 'door-3d'
  | 'fold-3d'
  | 'origami-fold'
  | 'page-peel';

export type ThreeDTransitionFamily = 'cube' | 'door' | 'flip' | 'fold' | 'peel' | 'roll' | 'spin' | 'tumble';

export interface ThreeDTransitionGroup {
  id: ThreeDTransitionFamily;
  label: string;
  defaultType: TransitionType;
  transitions: Partial<Record<ThreeDTransitionOption, TransitionType>>;
}

export const THREE_D_TRANSITION_GROUPS: readonly ThreeDTransitionGroup[] = [{
  id: 'flip',
  label: 'Flip',
  defaultType: 'flip-horizontal',
  transitions: {
    'flip-horizontal': 'flip-horizontal',
    'flip-vertical': 'flip-vertical',
  },
}, {
  id: 'tumble',
  label: 'Tumble',
  defaultType: 'tumble-away',
  transitions: {
    'tumble-away': 'tumble-away',
  },
}, {
  id: 'roll',
  label: 'Roll',
  defaultType: 'roll-3d',
  transitions: {
    'roll-3d': 'roll-3d',
  },
}, {
  id: 'spin',
  label: 'Spin',
  defaultType: 'card-spin',
  transitions: {
    'card-spin': 'card-spin',
    'spinback-3d': 'spinback-3d',
  },
}, {
  id: 'cube',
  label: 'Cube',
  defaultType: 'cube-3d',
  transitions: {
    'cube-3d': 'cube-3d',
  },
}, {
  id: 'door',
  label: 'Door',
  defaultType: 'door-3d',
  transitions: {
    'door-3d': 'door-3d',
  },
}, {
  id: 'fold',
  label: 'Fold',
  defaultType: 'fold-3d',
  transitions: {
    'fold-3d': 'fold-3d',
    'origami-fold': 'origami-fold',
  },
}, {
  id: 'peel',
  label: 'Peel',
  defaultType: 'page-peel',
  transitions: {
    'page-peel': 'page-peel',
  },
}];

export function getThreeDTransitionOption(type: string): ThreeDTransitionOption | undefined {
  return THREE_D_TRANSITION_GROUPS
    .flatMap((group) => Object.entries(group.transitions) as [ThreeDTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getThreeDTransitionGroup(type: string): ThreeDTransitionGroup | undefined {
  return THREE_D_TRANSITION_GROUPS.find((group) =>
    Object.values(group.transitions).some((transitionType) => transitionType === type)
  );
}
