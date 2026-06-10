import type { GuidedToolChoreography } from './types';

export type GuidedToolCall = Parameters<GuidedToolChoreography>[0];
export type GuidedAction = ReturnType<GuidedToolChoreography>[number];
export type GuidedActionFamily = NonNullable<GuidedAction['family']>;
export type GuidedTargetRef = NonNullable<Extract<GuidedAction, { target?: unknown }>['target']>;
export type ValidationCheck = Extract<GuidedAction, { type: 'confirmState' }>['check'];
export type GuidedMaskPathVertexInput = Extract<GuidedAction, { type: 'drawMaskPath' }>['vertices'][number];
export type GuidedMaskCreateOptions = NonNullable<Extract<GuidedAction, { type: 'drawMaskPath' }>['mask']>;
