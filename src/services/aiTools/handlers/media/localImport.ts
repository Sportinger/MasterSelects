// Local file import tool handlers: importLocalFiles (with optional timeline
// placement) and listLocalFiles, gated by the file access broker.

import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { ToolResult } from '../../types';
import type { CallerContext } from '../../policy';
import { Logger } from '../../../logger';
import { activateDockPanel, flashPreviewCanvas } from '../../aiFeedback';
import { validateFilePath, getAllowedRoots } from '../../../security/fileAccessBroker';
import { computeTimelineOccupancy } from '../../../timeline/timelineOccupancy';
import {
  placeSignalAssetOnTimeline,
} from '../../../../runtime/renderers/signalTimelineRendererAdapter';
import {
  fetchLocalFileBlob,
  listLocalDirectory,
  normalizeLocalPath,
} from './localFileAccess';
import { waitForCompositionReady, type MediaStore } from './runtime';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
  type MutationEntitySnapshot,
} from '../mutationEntityResults';
import type { TimelineClip, TimelineTrack } from '../../../../types/timeline';

const log = Logger.create('AITool:Media');

const IMPORT_MUTATION_WARNINGS = [
  'The shared mutation entity model has no mediaItem kind yet; imported mediaItem refs use clip.',
  'Waveform, audio-proxy, and video-proxy generation may continue asynchronously after imported media items are returned.',
];

function createImportMutationEnvelope(
  importedIds: readonly string[],
  mediaItemIdsBefore: ReadonlySet<string>,
  trackSnapshot: MutationEntitySnapshot<TimelineTrack>,
  clipSnapshot: MutationEntitySnapshot<TimelineClip>,
) {
  const trackEnvelope = describeMutationEntities(trackSnapshot, useTimelineStore.getState().tracks);
  const clipEnvelope = describeMutationEntities(clipSnapshot, useTimelineStore.getState().clips);
  const stateRevisionBefore = Math.min(
    trackEnvelope.stateRevisionBefore,
    clipEnvelope.stateRevisionBefore,
  );
  const stateRevisionAfter = Math.max(
    trackEnvelope.stateRevisionAfter,
    clipEnvelope.stateRevisionAfter,
  );
  const revisionAdvanced = stateRevisionAfter > stateRevisionBefore;
  const createdMediaItemIds = [...new Set(importedIds)]
    .filter((id) => !mediaItemIdsBefore.has(id));

  return {
    stateRevisionBefore: revisionAdvanced ? stateRevisionBefore : null,
    stateRevisionAfter: revisionAdvanced ? stateRevisionAfter : null,
    entities: {
      created: [
        ...createdMediaItemIds.map((id) => ({ kind: 'mediaItem' as const, id })),
        ...trackEnvelope.entities.created,
        ...clipEnvelope.entities.created,
      ],
      updated: [
        ...trackEnvelope.entities.updated,
        ...clipEnvelope.entities.updated,
      ],
      deleted: [
        ...trackEnvelope.entities.deleted,
        ...clipEnvelope.entities.deleted,
      ],
    },
    warnings: IMPORT_MUTATION_WARNINGS,
  };
}

type LocalFileImportStage =
  | 'validate'
  | 'fetchLocalFileBlob'
  | 'createFile'
  | 'mediaStore.importFile'
  | 'timelinePlacement';

export function resolveLocalImportAppendPoint(targetTrackId: string): number {
  const { clips, tracks } = useTimelineStore.getState();
  const existingClips = clips.filter(clip => clip.trackId === targetTrackId);
  // agent-kernel WP2: canonical occupancy semantics
  return existingClips.length > 0
    ? computeTimelineOccupancy(existingClips, tracks).occupied?.endSeconds ?? 0
    : 0;
}

export async function handleImportLocalFiles(
  args: Record<string, unknown>,
  mediaStore: MediaStore,
  callerContext: CallerContext = 'internal',
): Promise<ToolResult> {
  const paths = args.paths as string[];
  const addToTimeline = (args.addToTimeline as boolean) || false;
  const mediaItemIdsBefore = new Set([
    ...(mediaStore.files ?? []).map((file) => file.id),
    ...(mediaStore.signalAssets ?? []).map((item) => item.id),
  ]);
  const trackSnapshot = captureMutationEntitySnapshot(
    'track',
    useTimelineStore.getState().tracks,
  );
  const clipSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );

  // Visual feedback: activate media panel during import
  activateDockPanel('media');
  flashPreviewCanvas('import');

  const results: Array<{ id: string; name: string; type: string; duration?: number; path: string; blobSize?: number }> = [];
  const errors: Array<{ path: string; error: string; stage?: LocalFileImportStage }> = [];

  // Validate all paths through file access broker
  const hasRoots = getAllowedRoots().length > 0;
  if (hasRoots) {
    for (const filePath of paths) {
      const validation = validateFilePath(filePath);
      if (!validation.allowed) {
        errors.push({ path: filePath, error: `Access denied: ${validation.reason}` });
      }
    }
    if (errors.length > 0 && errors.length === paths.length) {
      return {
        success: false,
        error: 'All paths were denied by file access policy',
        data: { errors },
      };
    }
  }

  for (const filePath of paths) {
    // Skip paths that failed validation
    if (hasRoots) {
      const validation = validateFilePath(filePath);
      if (!validation.allowed) {
        continue; // Already recorded in errors above
      }
    }

    let importStage: LocalFileImportStage = 'fetchLocalFileBlob';
    try {
      const normalizedPath = normalizeLocalPath(filePath);
      log.info(`Fetching: ${normalizedPath}`);

      const blob = await fetchLocalFileBlob(normalizedPath, callerContext);
      importStage = 'createFile';
      const fileName = normalizedPath.split('/').pop() || 'unknown';
      const file = new File([blob], fileName, { type: blob.type });

      importStage = 'mediaStore.importFile';
      const importedItem = await mediaStore.importFile(file);
      results.push({
        id: importedItem.id,
        name: importedItem.name,
        type: importedItem.type,
        duration: importedItem.type === 'signal' ? undefined : importedItem.duration,
        path: filePath,
        blobSize: blob.size,
      });
      log.info(`Imported: ${importedItem.name} (${importedItem.type})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error(`Failed to import: ${filePath}`, { stage: importStage, error: err });
      errors.push({ path: filePath, error: msg, stage: importStage });
    }
  }

  // Optionally add to timeline
  if (addToTimeline && results.length > 0) {
    const activeCompositionId = useMediaStore.getState().activeCompositionId;
    if (activeCompositionId) {
      const ready = await waitForCompositionReady(activeCompositionId);
      if (!ready) {
        log.warn(`Timed out waiting for active composition ${activeCompositionId} before addToTimeline`);
      }
    }

    const timelineStore = useTimelineStore.getState();
    const requestedTrackId = args.trackId as string | undefined;
    const createTrack = (args.createTrack as boolean) || false;
    const trackType = (args.trackType as 'video' | 'audio') || 'video';
    const requestedStartTime = args.startTime as number | undefined;
    const sequential = args.sequential !== false; // default true

    let targetTrackId: string | null = null;

    // 1. Create new track if requested
    if (createTrack) {
      targetTrackId = timelineStore.addTrack(trackType);
      log.info(`Created new ${trackType} track: ${targetTrackId}`);
    }
    // 2. Use specified track
    else if (requestedTrackId) {
      const track = useTimelineStore.getState().tracks.find(t => t.id === requestedTrackId);
      if (track) {
        targetTrackId = requestedTrackId;
      } else {
        log.warn(`Track ${requestedTrackId} not found, falling back to first track`);
      }
    }

    // 3. Fallback: first matching track
    if (!targetTrackId) {
      const matchingTracks = useTimelineStore.getState().tracks.filter(t => t.type === trackType);
      targetTrackId = matchingTracks.length > 0 ? matchingTracks[0].id : null;
    }

    // 4. Last resort: create one
    if (!targetTrackId) {
      targetTrackId = useTimelineStore.getState().addTrack(trackType);
      log.info(`Auto-created ${trackType} track: ${targetTrackId}`);
    }

    // Determine start time
    let currentTime: number;
    if (requestedStartTime !== undefined) {
      currentTime = requestedStartTime;
    } else {
      // Append after last clip on this track
      currentTime = resolveLocalImportAppendPoint(targetTrackId);
    }

    const placedClips: Array<{ name: string; trackId: string; startTime: number; clipId?: string; type?: string }> = [];
    for (const result of results) {
      const mediaState = useMediaStore.getState();
      const signalAsset = mediaState.signalAssets.find(item => item.id === result.id);
      if (signalAsset) {
        const targetTrack = useTimelineStore.getState().tracks.find(track => track.id === targetTrackId);
        if (targetTrack?.type !== 'video') {
          log.warn(`Skipping SignalAsset timeline placement on non-video track: ${signalAsset.name}`);
          continue;
        }

        const placement = await placeSignalAssetOnTimeline(signalAsset, targetTrackId!, currentTime, useTimelineStore.getState());
        if (placement.clipId) {
          placedClips.push({
            name: result.name,
            trackId: targetTrackId!,
            startTime: currentTime,
            clipId: placement.clipId,
            type: 'signal',
          });
          if (sequential) {
            currentTime += placement.plan.duration;
          }
        }
        continue;
      }

      const mediaFile = mediaState.files.find(f => f.id === result.id);
      if (mediaFile && mediaFile.file) {
        await useTimelineStore.getState().addClip(targetTrackId!, mediaFile.file, currentTime, mediaFile.duration, mediaFile.id);
        placedClips.push({ name: result.name, trackId: targetTrackId!, startTime: currentTime, type: mediaFile.type });
        if (sequential) {
          currentTime += mediaFile.duration || 5;
        }
      }
    }
    return {
      success: errors.length === 0,
      data: {
        imported: results,
        errors: errors.length > 0 ? errors : undefined,
        totalImported: results.length,
        totalFailed: errors.length,
        placedClips,
        trackId: targetTrackId,
        ...createImportMutationEnvelope(
          results.map((result) => result.id),
          mediaItemIdsBefore,
          trackSnapshot,
          clipSnapshot,
        ),
      },
    };
  }

  return {
    success: errors.length === 0,
    data: {
      imported: results,
      errors: errors.length > 0 ? errors : undefined,
      totalImported: results.length,
      totalFailed: errors.length,
      ...createImportMutationEnvelope(
        results.map((result) => result.id),
        mediaItemIdsBefore,
        trackSnapshot,
        clipSnapshot,
      ),
    },
  };
}

export async function handleListLocalFiles(
  args: Record<string, unknown>,
  callerContext: CallerContext = 'internal',
): Promise<ToolResult> {
  const directory = args.directory as string;
  const extensions = args.extensions as string | undefined;

  // Validate directory through file access broker (when roots are configured)
  const hasRoots = getAllowedRoots().length > 0;
  if (hasRoots) {
    const validation = validateFilePath(directory);
    if (!validation.allowed) {
      return { success: false, error: `Access denied: ${validation.reason}` };
    }
  }

  try {
    const normalizedDir = normalizeLocalPath(directory);
    const files = await listLocalDirectory(normalizedDir, extensions, callerContext);
    return {
      success: true,
      data: {
        directory: normalizedDir,
        files,
        totalFiles: files.length,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
