import { GAIT_ANGLE_OUTPUTS } from '../parameterSources/controlOperators';
import { addControlNode, setParameterSourceBinding } from '../parameterSources/parameterSourceActions';
import { useTimelineStore } from '../../stores/timeline';
import { BLANK_CLIP_COLOR } from '../timeline/blankClip';
import { STICK_FIGURE_PARAMS } from '../../effects/generate/stickFigure/params';
import type { SkeletonGait, SkeletonJoint } from './skeletonRig';
import {
  isSkeletonActionId,
  parseSkeletonActions,
  serializeSkeletonActions,
  SKELETON_ACTIONS,
  type SkeletonActionId,
  type SkeletonActionInstance,
} from './skeletonActions';
import { parseStickFigureRef, STICK_FIGURE_EFFECT } from './stickFigureJointRuntime';

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

export interface CreateStickFigureOptions {
  trackId?: string;
  start?: number;
  duration?: number;
  name?: string;
  facing?: 'left' | 'right';
  color?: string;
  /** Pelvis X in figure pixels (0 = frame centre). */
  x?: number;
  /** Any visible Stick Figure parameters (scale, groundY, turn, angles, lengths...), validated by name, type and options. */
  params?: Record<string, unknown>;
}

/** Validate figure parameters so a typo fails loudly instead of being stored and ignored. */
export function validateStickFigureParams(params: Record<string, unknown>): Record<string, string | number | boolean> {
  const valid: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    const spec = (STICK_FIGURE_PARAMS as Record<string, { default: unknown; hidden?: boolean; options?: { value: unknown }[] }>)[key];
    if (!spec || spec.hidden) {
      const names = Object.entries(STICK_FIGURE_PARAMS).filter(([, item]) => !(item as { hidden?: boolean }).hidden).map(([name]) => name);
      throw new Error(`Unknown stick figure parameter: ${key}. Valid: ${names.join(', ')}`);
    }
    if (typeof value !== typeof spec.default || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error(`Stick figure parameter ${key} must be a ${typeof spec.default}.`);
    }
    if (spec.options && !spec.options.some(option => option.value === value)) {
      throw new Error(`Stick figure parameter ${key} must be one of ${spec.options.map(option => String(option.value)).join(', ')}.`);
    }
    valid[key] = value as string | number | boolean;
  }
  return valid;
}

/** A Blank clip carrying one Stick Figure effect: the starting point of a rig. */
export function createStickFigureRig(options: CreateStickFigureOptions = {}): { clipId: string; effectId: string; figure: string } {
  const extra = options.params ? validateStickFigureParams(options.params) : {};
  const state = useTimelineStore.getState();
  const track = options.trackId
    ? state.tracks.find(item => item.id === options.trackId && item.type === 'video')
    : state.tracks.find(item => item.type === 'video' && !item.locked);
  if (!track) throw new Error(options.trackId ? 'Track not found or not a video track.' : 'Add a video track first.');
  const clipId = state.addSolidClip(track.id, Math.max(0, options.start ?? state.playheadPosition), BLANK_CLIP_COLOR,
    Math.max(0.1, options.duration ?? 5), true);
  if (!clipId) throw new Error('Could not create the Blank clip.');
  state.updateClip(clipId, { name: options.name?.trim() || 'Stick Figure' });
  const effectId = useTimelineStore.getState().addClipEffect(clipId, STICK_FIGURE_EFFECT);
  const params: Record<string, string | number | boolean> = { ...extra };
  if (options.facing) params.facing = options.facing;
  if (options.color) params.color = options.color;
  if (Number.isFinite(options.x)) params.rootX = options.x!;
  if (Object.keys(params).length) useTimelineStore.getState().updateClipEffect(clipId, effectId, params);
  return { clipId, effectId, figure: `${clipId}|${effectId}` };
}

/** Resolve a figure reference (`clipId|effectId`, or a clip id with one Stick Figure). */
export function resolveStickFigure(ref: string): { clipId: string; effectId: string } {
  const parsed = parseStickFigureRef(ref);
  const clip = useTimelineStore.getState().clips.find(item => item.id === (parsed?.clipId ?? ref));
  const effect = clip?.effects.find(item => item.type === STICK_FIGURE_EFFECT && (!parsed || item.id === parsed.effectId));
  if (!clip || !effect) throw new Error(`Stick figure not found: ${ref}`);
  return { clipId: clip.id, effectId: effect.id };
}

function readActions(clipId: string, effectId: string): SkeletonActionInstance[] {
  const effect = useTimelineStore.getState().clips.find(item => item.id === clipId)?.effects.find(item => item.id === effectId);
  if (!effect || effect.type !== STICK_FIGURE_EFFECT) throw new Error('Stick figure not found.');
  return parseSkeletonActions(effect.params.actions);
}

function writeActions(clipId: string, effectId: string, actions: readonly SkeletonActionInstance[]): void {
  useTimelineStore.getState().updateClipEffect(clipId, effectId, { actions: serializeSkeletonActions(actions) });
}

export interface ActionPatch {
  start?: number;
  duration?: number;
  strength?: number;
  /** Forward travel in figure pixels; null restores the action's own distance. */
  distance?: number | null;
  target?: { figure: string; joint: SkeletonJoint } | null;
}

function applyPatch(instance: SkeletonActionInstance, patch: ActionPatch): SkeletonActionInstance {
  const next: SkeletonActionInstance = { ...instance };
  if (patch.start !== undefined) {
    if (!Number.isFinite(patch.start)) throw new Error('Start must be a number.');
    next.start = Math.max(0, patch.start);
  }
  if (patch.duration !== undefined) {
    if (!(patch.duration > 0)) throw new Error('Duration must be greater than zero.');
    next.duration = patch.duration;
  }
  if (patch.strength !== undefined) {
    if (!Number.isFinite(patch.strength) || patch.strength < 0 || patch.strength > 2) throw new Error('Strength must be between 0 and 2.');
    next.strength = patch.strength;
  }
  if (patch.distance === null) delete next.distance;
  else if (patch.distance !== undefined) {
    if (!Number.isFinite(patch.distance)) throw new Error('Distance must be a number.');
    next.distance = patch.distance;
  }
  if (patch.target === null) delete next.target;
  else if (patch.target) next.target = { figure: patch.target.figure, joint: patch.target.joint };
  return next;
}

/** Add an action clip to a figure's lane (clip seconds). Returns the new action id. */
export function addStickFigureAction(clipId: string, effectId: string, action: SkeletonActionId, start: number,
  patch: Omit<ActionPatch, 'start'> = {}): string {
  if (!isSkeletonActionId(action)) throw new Error(`Unknown action: ${String(action)}`);
  const id = `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const instance = applyPatch({ id, action, start: 0, duration: SKELETON_ACTIONS[action].duration }, { ...patch, start });
  writeActions(clipId, effectId, [...readActions(clipId, effectId), instance]);
  return id;
}

export function updateStickFigureAction(clipId: string, effectId: string, actionId: string, patch: ActionPatch): SkeletonActionInstance {
  const actions = readActions(clipId, effectId);
  const index = actions.findIndex(item => item.id === actionId);
  if (index === -1) throw new Error('Action not found.');
  const next = applyPatch(actions[index], patch);
  writeActions(clipId, effectId, actions.map((item, position) => position === index ? next : item));
  return next;
}

export function removeStickFigureAction(clipId: string, effectId: string, actionId: string): void {
  const actions = readActions(clipId, effectId);
  if (!actions.some(item => item.id === actionId)) throw new Error('Action not found.');
  writeActions(clipId, effectId, actions.filter(item => item.id !== actionId));
}
