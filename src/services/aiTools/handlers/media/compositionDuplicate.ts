import type { ToolResult } from '../../types';
import { Logger } from '../../../logger';
import {
  isProjectStoreSyncInProgress,
  waitForProjectStoreSync,
} from '../../../project/projectStoreSyncGuard';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import { describeCompositionDuplicateBlocker } from '../../../../stores/mediaStore/slices/composition/compositionDuplicate';
import { collectPrivateChildCompositionIds } from '../../../../stores/mediaStore/slices/composition/privateCompositionTree';
import type { TimelineTrack } from '../../../../types/timeline';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from '../mutationEntityResults';
import {
  createMediaMutationEnvelope,
  emptyMutationEntities,
  mediaEntityRef,
} from './library';
import { waitForCompositionReady, type MediaStore } from './runtime';

const log = Logger.create('AITool:Media');

/** Upper bound for waiting on a timeline restore or project sync before copying. */
export const DUPLICATE_STORE_SYNC_WAIT_MS = 10_000;

interface TimelineShape {
  clips: readonly unknown[];
  tracks: readonly Pick<TimelineTrack, 'type'>[];
}

function timelineCounts(timeline: TimelineShape | undefined) {
  const tracks = timeline?.tracks ?? [];
  return {
    clipCount: timeline?.clips.length ?? 0,
    trackCount: tracks.length,
    videoTrackCount: tracks.filter((track) => track.type === 'video').length,
    audioTrackCount: tracks.filter((track) => track.type === 'audio').length,
  };
}

/** Resolve once no restore/sync holds the store-sync guard, or false after the timeout. */
async function waitForStoreSyncToSettle(timeoutMs: number): Promise<boolean> {
  if (!isProjectStoreSyncInProgress()) return true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    waitForProjectStoreSync().then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  return settled && !isProjectStoreSyncInProgress();
}

function parseArgs(args: Record<string, unknown>):
  | { ok: true; compositionId: string; name?: string; open: boolean }
  | { ok: false; error: string } {
  const compositionId = typeof args.compositionId === 'string' ? args.compositionId.trim() : '';
  if (!compositionId) return { ok: false, error: 'compositionId is required.' };
  if (args.name !== undefined && typeof args.name !== 'string') {
    return { ok: false, error: 'name must be a string.' };
  }
  const name = typeof args.name === 'string' ? args.name.trim() : undefined;
  if (name === '') return { ok: false, error: 'name must not be empty.' };
  if (args.open !== undefined && typeof args.open !== 'boolean') {
    return { ok: false, error: 'open must be a boolean.' };
  }
  return { ok: true, compositionId, name, open: args.open === true };
}

export async function handleDuplicateComposition(
  args: Record<string, unknown>,
  _mediaStore: MediaStore,
): Promise<ToolResult> {
  const parsed = parseArgs(args);
  if (!parsed.ok) return { success: false, error: parsed.error };
  const { compositionId, name, open } = parsed;

  // A restore holding the store-sync guard may have loaded the live timeline
  // only partially; copying it then would silently lose clips.
  if (!(await waitForStoreSyncToSettle(DUPLICATE_STORE_SYNC_WAIT_MS))) {
    return {
      success: false,
      error: `A timeline restore or project sync was still running after ${DUPLICATE_STORE_SYNC_WAIT_MS} ms, `
        + 'so the live timeline could not be copied. Retry duplicateComposition.',
    };
  }

  const before = useMediaStore.getState();
  const source = before.compositions.find((composition) => composition.id === compositionId);
  const blocker = describeCompositionDuplicateBlocker(source, compositionId);
  if (blocker || !source) return { success: false, error: blocker ?? `Composition not found: ${compositionId}` };

  const sourceWasActive = before.activeCompositionId === compositionId;
  const sourceCounts = timelineCounts(sourceWasActive ? useTimelineStore.getState() : source.timelineData);

  const duplicate = before.duplicateComposition(compositionId, name === undefined ? undefined : { name });
  if (!duplicate) {
    return {
      success: false,
      error: `Composition ${compositionId} could not be duplicated; the CompositionCrud log has the reason.`,
    };
  }

  const afterDuplicate = useMediaStore.getState();
  const privateCopyIds = [...collectPrivateChildCompositionIds(afterDuplicate.compositions, duplicate.id)]
    .filter((id) => afterDuplicate.compositions.some((composition) => composition.id === id));
  const entities = emptyMutationEntities();
  entities.created.push(
    mediaEntityRef('composition', duplicate.id),
    ...privateCopyIds.map((id) => mediaEntityRef('composition', id)),
  );

  const copyCounts = timelineCounts(duplicate.timelineData);
  const warnings: string[] = [];
  if (copyCounts.clipCount !== sourceCounts.clipCount || copyCounts.trackCount !== sourceCounts.trackCount) {
    warnings.push(
      `The copy has ${copyCounts.clipCount} clips on ${copyCounts.trackCount} tracks, `
        + `the source ${sourceCounts.clipCount} clips on ${sourceCounts.trackCount} tracks.`,
    );
  }

  const timelineEnvelopes: Array<ReturnType<typeof describeMutationEntities>> = [];
  let opened = false;
  if (open) {
    const trackSnapshot = captureMutationEntitySnapshot('track', useTimelineStore.getState().tracks);
    const clipSnapshot = captureMutationEntitySnapshot('clip', useTimelineStore.getState().clips);
    await afterDuplicate.openCompositionTab(duplicate.id);
    opened = await waitForCompositionReady(duplicate.id);
    if (!opened) {
      log.warn(`Timed out waiting for duplicated composition ${duplicate.id} to become active`);
      warnings.push('The copy was created but did not become the active composition in time.');
    }
    timelineEnvelopes.push(
      describeMutationEntities(trackSnapshot, useTimelineStore.getState().tracks),
      describeMutationEntities(clipSnapshot, useTimelineStore.getState().clips),
    );
  }

  return {
    success: true,
    data: {
      compositionId: duplicate.id,
      name: duplicate.name,
      parentId: duplicate.parentId,
      width: duplicate.width,
      height: duplicate.height,
      frameRate: duplicate.frameRate,
      duration: duplicate.duration,
      ...copyCounts,
      source: {
        compositionId,
        name: source.name,
        wasActive: sourceWasActive,
        copiedFrom: sourceWasActive ? 'live-timeline' : 'stored-timeline',
        ...sourceCounts,
      },
      privateCompositionCopies: privateCopyIds.length,
      opened,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...createMediaMutationEnvelope(entities, ...timelineEnvelopes),
    },
  };
}
