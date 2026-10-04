import type { ToolResult } from '../types';
import { isSkeletonActionId, parseSkeletonActions, SKELETON_ACTIONS, skeletonActionContact } from '../../rig/skeletonActions';
import { SKELETON_JOINTS, type SkeletonJoint } from '../../rig/skeletonRig';
import { addStickFigureAction, createStickFigureRig, resolveStickFigure, updateStickFigureAction } from '../../rig/stickFigureActions';
import { validateChoreography } from '../../rig/choreographyValidation';
import { STICK_FIGURE_EFFECT, stickFigureRef } from '../../rig/stickFigureJointRuntime';
import { useTimelineStore } from '../../../stores/timeline';

const fail = (error: unknown): ToolResult => ({ success: false, error: error instanceof Error ? error.message : String(error) });
const optionalNumber = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
};

function targetOf(args: Record<string, unknown>): { figure: string; joint: SkeletonJoint } | undefined {
  if (args.targetFigure === undefined || args.targetFigure === '') return undefined;
  const target = resolveStickFigure(String(args.targetFigure));
  const joint = String(args.targetJoint ?? 'head');
  if (!(SKELETON_JOINTS as readonly string[]).includes(joint)) throw new Error(`Unknown joint: ${joint}`);
  return { figure: stickFigureRef(target.clipId, target.effectId), joint: joint as SkeletonJoint };
}

export async function handleCreateRig(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const facing = args.facing === undefined ? undefined : String(args.facing);
    if (facing !== undefined && facing !== 'left' && facing !== 'right') throw new Error('facing must be left or right.');
    const created = createStickFigureRig({
      start: optionalNumber(args.start, 'start'), duration: optionalNumber(args.duration, 'duration'),
      trackId: typeof args.trackId === 'string' ? args.trackId : undefined, name: typeof args.name === 'string' ? args.name : undefined,
      facing, color: typeof args.color === 'string' ? args.color : undefined, x: optionalNumber(args.x, 'x'),
    });
    return { success: true, data: created };
  } catch (error) { return fail(error); }
}

export async function handleAddActionClip(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { clipId, effectId } = resolveStickFigure(String(args.figure ?? ''));
    if (!isSkeletonActionId(args.action)) throw new Error(`Unknown action: ${String(args.action)}`);
    const start = optionalNumber(args.start, 'start');
    if (start === undefined) throw new Error('start is required.');
    const target = targetOf(args);
    const actionId = addStickFigureAction(clipId, effectId, args.action, start, {
      duration: optionalNumber(args.duration, 'duration'), strength: optionalNumber(args.strength, 'strength'), ...(target ? { target } : {}),
    });
    return { success: true, data: { actionId, figure: stickFigureRef(clipId, effectId) } };
  } catch (error) { return fail(error); }
}

export async function handleSetActionTarget(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { clipId, effectId } = resolveStickFigure(String(args.figure ?? ''));
    const action = updateStickFigureAction(clipId, effectId, String(args.actionId ?? ''), { target: targetOf(args) ?? null });
    return { success: true, data: { action } };
  } catch (error) { return fail(error); }
}

export async function handleListRigs(): Promise<ToolResult> {
  const rigs = useTimelineStore.getState().clips.flatMap(clip => clip.effects
    .filter(effect => effect.type === STICK_FIGURE_EFFECT)
    .map(effect => ({
      figure: stickFigureRef(clip.id, effect.id), clipName: clip.name, start: clip.startTime, duration: clip.duration,
      facing: effect.params.facing ?? 'right',
      actions: parseSkeletonActions(effect.params.actions).map(action => ({
        ...action, label: SKELETON_ACTIONS[action.action].label,
        contactTimelineTime: (() => { const contact = skeletonActionContact(action); return contact === undefined ? null : clip.startTime + contact; })(),
      })),
    })));
  return { success: true, data: { rigs } };
}

export async function handleValidateChoreography(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const issues = validateChoreography({
      start: optionalNumber(args.start, 'start'), end: optionalNumber(args.end, 'end'), fps: optionalNumber(args.fps, 'fps'),
    });
    return { success: true, data: { issueCount: issues.length, issues } };
  } catch (error) { return fail(error); }
}
