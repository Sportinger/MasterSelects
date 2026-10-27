import { useMediaStore } from '../../../stores/mediaStore';
import { captureToolTransaction } from '../toolTransaction';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import { createSubcompositionFromClipIds } from '../../timelineSubcomposition';
import { resolveEditableHookLayerMetadata } from '../editableHookIdentity';
import type { ToolResult } from '../types';
import { waitForCompositionReady } from './media/runtime';

export interface EditableHookCompositionContext {
  hookCompositionId: string;
  isNested: boolean;
  originalCompositionId: string | null;
  wrapperClipId?: string;
  wrapperDuration?: number;
  wrapperStartTime?: number;
}

export interface EditableHookCompositionExecution {
  context?: EditableHookCompositionContext;
  result: ToolResult;
}

function clipsContainHook(
  clips: readonly TimelineClip[],
  tracks: readonly { id: string }[],
  hookId: string,
): boolean {
  const metadata = resolveEditableHookLayerMetadata(clips, tracks);
  return [...metadata.values()].some((identity) => identity.id === hookId);
}

function hookCompositionIds(hookId: string): string[] {
  const media = useMediaStore.getState();
  const timeline = useTimelineStore.getState();
  return media.compositions.flatMap((composition) => {
    const active = composition.id === media.activeCompositionId;
    const clips = active
      ? timeline.clips
      : composition.timelineData?.clips as readonly TimelineClip[] | undefined;
    const tracks = active ? timeline.tracks : composition.timelineData?.tracks;
    return clips && tracks && clipsContainHook(clips, tracks, hookId)
      ? [composition.id]
      : [];
  });
}

export function editableHookExistsInProject(hookId: string): boolean {
  return hookCompositionIds(hookId).length > 0;
}

function uniqueHookCompositionId(hookId: string): string | Error {
  const matches = hookCompositionIds(hookId);
  if (matches.length === 0) return new Error(`Hook ${hookId} is incomplete or not editable`);
  if (matches.length > 1) return new Error(`Hook ${hookId} exists in multiple compositions`);
  return matches[0]!;
}

export async function wrapEditableHookInSubcomposition(input: {
  clipIds: readonly string[];
  hookId: string;
  name: string;
}): Promise<ToolResult> {
  const transaction = captureToolTransaction('wrapEditableHookInSubcomposition');
  const result = await createSubcompositionFromClipIds(input.clipIds, {
    includeLinkedAudio: false,
    name: input.name,
  });
  if (!result.success) return { success: false, error: result.reason };
  const wrapper = useTimelineStore.getState().clips.find((clip) => (
    clip.id === result.clipId
    || (clip.isComposition && clip.compositionId === result.compositionId)
  ));
  if (!wrapper) {
    return { success: false, error: 'Created graphic subcomposition has no parent timeline clip' };
  }
  transaction.run(() => useTimelineStore.getState().updateClip(wrapper.id, {
    linkedGroupId: input.hookId,
    name: input.name,
  }));
  return {
    success: true,
    data: {
      compositionId: result.compositionId,
      compositionName: input.name,
      layerClipIds: [...input.clipIds],
      wrapperClipId: wrapper.id,
    },
  };
}

export async function executeInEditableHookComposition(
  hookId: string,
  execute: (context: EditableHookCompositionContext) => Promise<ToolResult>,
): Promise<EditableHookCompositionExecution> {
  // The hook's edits run after composition switches (awaits): `execute` enters the tool's transaction explicitly.
  const transaction = captureToolTransaction('executeInEditableHookComposition');
  const mediaBefore = useMediaStore.getState();
  const timelineBefore = useTimelineStore.getState();
  const originalCompositionId = mediaBefore.activeCompositionId;
  if (
    originalCompositionId
    && clipsContainHook(timelineBefore.clips, timelineBefore.tracks, hookId)
  ) {
    const context: EditableHookCompositionContext = {
      hookCompositionId: originalCompositionId,
      isNested: false,
      originalCompositionId,
    };
    return { context, result: await transaction.run(() => execute(context)) };
  }

  const hookCompositionId = uniqueHookCompositionId(hookId);
  if (hookCompositionId instanceof Error) {
    return { result: { success: false, error: hookCompositionId.message } };
  }
  const wrapper = timelineBefore.clips.find((clip) => (
    clip.isComposition && clip.compositionId === hookCompositionId
  ));
  const context: EditableHookCompositionContext = {
    hookCompositionId,
    isNested: true,
    originalCompositionId,
    ...(wrapper === undefined
      ? {}
      : {
          wrapperClipId: wrapper.id,
          wrapperDuration: wrapper.duration,
          wrapperStartTime: wrapper.startTime,
        }),
  };

  await transaction.run(() => mediaBefore.openCompositionTab(hookCompositionId, { skipAnimation: true }));
  if (!await waitForCompositionReady(hookCompositionId)) {
    return { context, result: { success: false, error: `Could not open hook composition: ${hookCompositionId}` } };
  }

  let result: ToolResult;
  try {
    result = await transaction.run(() => execute(context));
  } finally {
    if (originalCompositionId) {
      await transaction.run(() => useMediaStore.getState().openCompositionTab(originalCompositionId, { skipAnimation: true }));
      await waitForCompositionReady(originalCompositionId);
    }
  }
  return { context, result };
}

export function updateNestedHookWrapper(
  context: EditableHookCompositionContext | undefined,
  input: { duration?: number; startTime?: number },
): ToolResult | null {
  if (!context?.isNested || (input.duration === undefined && input.startTime === undefined)) return null;
  if (!context.wrapperClipId || context.originalCompositionId !== useMediaStore.getState().activeCompositionId) {
    return { success: false, error: 'Hook placement cannot be changed outside its parent composition' };
  }
  const wrapper = useTimelineStore.getState().clips.find((clip) => clip.id === context.wrapperClipId);
  if (!wrapper) return { success: false, error: `Hook wrapper clip not found: ${context.wrapperClipId}` };
  const duration = input.duration ?? wrapper.duration;
  useTimelineStore.getState().updateClip(wrapper.id, {
    duration,
    outPoint: wrapper.inPoint + duration,
    startTime: input.startTime ?? wrapper.startTime,
  });
  return null;
}
