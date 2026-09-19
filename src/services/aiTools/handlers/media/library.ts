import { effectiveWordTiming } from '../../../transcription/effectiveWordTiming';
import type { ToolResult } from '../../types';
import { Logger } from '../../../logger';
import { waitForCompositionReady, type MediaStore } from './runtime';
import { isUserVisibleComposition } from '../../../../stores/mediaStore/compositionVisibility';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
  type MutationEntityKind,
} from '../mutationEntityResults';

const log = Logger.create('AITool:Media');

interface MutationEntityRef {
  kind: MutationEntityKind;
  id: string;
}

interface MutationEntities {
  created: MutationEntityRef[];
  updated: MutationEntityRef[];
  deleted: MutationEntityRef[];
}

function mediaEntityRef(type: 'mediaItem' | 'composition' | 'folder', id: string): MutationEntityRef {
  return { kind: type, id };
}

function createMediaMutationEnvelope(
  entities: MutationEntities,
  ...timelineEnvelopes: Array<ReturnType<typeof describeMutationEntities>>
) {
  const stateRevisionBefore = timelineEnvelopes.length > 0
    ? Math.min(...timelineEnvelopes.map((envelope) => envelope.stateRevisionBefore))
    : null;
  const stateRevisionAfter = timelineEnvelopes.length > 0
    ? Math.max(...timelineEnvelopes.map((envelope) => envelope.stateRevisionAfter))
    : null;
  const revisionAdvanced = stateRevisionBefore !== null
    && stateRevisionAfter !== null
    && stateRevisionAfter > stateRevisionBefore;
  return {
    stateRevisionBefore: revisionAdvanced ? stateRevisionBefore : null,
    stateRevisionAfter: revisionAdvanced ? stateRevisionAfter : null,
    entities: {
      created: [
        ...entities.created,
        ...timelineEnvelopes.flatMap((envelope) => envelope.entities.created),
      ],
      updated: [
        ...entities.updated,
        ...timelineEnvelopes.flatMap((envelope) => envelope.entities.updated),
      ],
      deleted: [
        ...entities.deleted,
        ...timelineEnvelopes.flatMap((envelope) => envelope.entities.deleted),
      ],
    },
  };
}

function emptyMutationEntities(): MutationEntities {
  return { created: [], updated: [], deleted: [] };
}

export async function handleGetMediaItems(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const folderId = (args.folderId as string | undefined) || null;
  const { files, compositions, folders } = mediaStore;
  const timelineClips = useTimelineStore.getState().clips;

  // Filter by folder
  const folderFiles = files.filter(f => f.parentId === folderId);
  const folderComps = compositions.filter(c => c.parentId === folderId && isUserVisibleComposition(c));
  const subFolders = folders.filter(f => f.parentId === folderId);

  return {
    success: true,
    data: {
      folderId: folderId || 'root',
      folders: subFolders.map(f => ({
        id: f.id,
        name: f.name,
        type: 'folder',
        isExpanded: f.isExpanded,
      })),
      files: folderFiles.map((f) => {
        const analyzedClip = timelineClips.find(clip =>
          (clip.source?.mediaFileId || clip.mediaFileId) === f.id
          && clip.faceAnalysisStatus !== undefined);
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          duration: f.duration,
          width: f.width,
          height: f.height,
          fps: f.fps,
          codec: f.codec,
          audioCodec: f.audioCodec,
          container: f.container,
          isImporting: f.isImporting === true,
          importProgress: f.importProgress ?? null,
          fileSize: f.fileSize ?? null,
          hasAudio: f.hasAudio ?? null,
          analysisStatus: f.analysisStatus ?? 'none',
          analysisProgress: f.analysisProgress ?? 0,
          analysisCoverage: f.analysisCoverage ?? 0,
          faceAnalysisStatus: f.faceAnalysisStatus ?? analyzedClip?.faceAnalysisStatus ?? 'none',
          faceAnalysisProgress: f.faceAnalysisProgress ?? analyzedClip?.faceAnalysisProgress ?? 0,
          faceAnalysisError: (f.faceAnalysisStatus ?? analyzedClip?.faceAnalysisStatus) === 'error'
            ? f.faceAnalysisMessage ?? analyzedClip?.faceAnalysisMessage
            : undefined,
          uniquePeople: f.analysis?.faceAnalysis?.people.length
            ?? analyzedClip?.analysis?.faceAnalysis?.people.length
            ?? 0,
          transcriptStatus: f.transcriptStatus ?? 'none',
          transcriptCoverage: f.transcriptCoverage ?? 0,
          transcriptWordCount: f.transcript?.length ?? 0,
          transcriptProviderProgress: f.transcriptFusionProgress?.providerProgress,
        };
      }),
      compositions: folderComps.map(c => ({
        id: c.id,
        name: c.name,
        type: 'composition',
        width: c.width,
        height: c.height,
        duration: c.duration,
        frameRate: c.frameRate,
      })),
      totalItems: subFolders.length + folderFiles.length + folderComps.length,
      allFolders: folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId })),
    },
  };
}

export async function handleGetMediaTranscript(
  args: Record<string, unknown>,
  mediaStore: MediaStore,
): Promise<ToolResult> {
  const mediaFileId = typeof args.mediaFileId === 'string' ? args.mediaFileId.trim() : '';
  if (!mediaFileId) return { success: false, error: 'mediaFileId is required.' };

  const rawCursor = args.cursor ?? 0;
  const rawLimit = args.limit ?? 500;
  if (!Number.isInteger(rawCursor) || Number(rawCursor) < 0) {
    return { success: false, error: 'cursor must be a non-negative integer word offset.' };
  }
  if (!Number.isInteger(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 1000) {
    return { success: false, error: 'limit must be an integer from 1 to 1000.' };
  }
  const cursor = Number(rawCursor);
  const limit = Number(rawLimit);

  let file = mediaStore.files.find(candidate => candidate.id === mediaFileId);
  if (!file) return { success: false, error: `Media item not found: ${mediaFileId}` };
  if (file.type !== 'video' && file.type !== 'audio') {
    return { success: false, error: 'Media transcript reading requires a video or audio source.' };
  }

  if (!file.transcript?.length && file.transcriptStatus !== 'transcribing') {
    const { hydrateAndProjectMediaSourceArtifacts } = await import('../../../mediaArtifacts/mediaSourceArtifacts');
    await hydrateAndProjectMediaSourceArtifacts(mediaFileId);
    file = useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId) ?? file;
  }

  const status = file.transcriptStatus ?? 'none';
  if (status !== 'ready') {
    return {
      success: false,
      error: status === 'error'
        ? `Transcript failed for media source: ${mediaFileId}`
        : `Transcript is not ready for media source: ${mediaFileId}`,
      data: { mediaFileId, mediaName: file.name, status },
    };
  }

  const words = (file.transcript ?? []).toSorted((left, right) => (
    effectiveWordTiming(left).start - effectiveWordTiming(right).start
    || effectiveWordTiming(left).end - effectiveWordTiming(right).end
  ));
  if (cursor > words.length) {
    return { success: false, error: `cursor exceeds transcript word count (${words.length}).` };
  }
  const cutBoundaries = file.duration && file.duration > 0 && words.length
    ? await (await import('../../../transcription/transcriptCutBoundaryAnalysis'))
      .analyzeTranscriptCutBoundaries(mediaFileId, words, file.duration)
    : [];
  const page = words.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < words.length ? cursor + page.length : null;

  return {
    success: true,
    data: {
      mediaFileId,
      mediaName: file.name,
      status,
      transcriptCoverage: file.transcriptCoverage ?? 0,
      totalWordCount: words.length,
      cursor,
      limit,
      nextCursor,
      complete: nextCursor === null,
      words: page.map((word, index) => ({
        ...cutBoundaries[cursor + index],
        id: word.id,
        text: word.text,
        start: word.start,
        end: word.end,
        ...(word.alignedStart === undefined ? {} : { alignedStart: word.alignedStart }),
        ...(word.alignedEnd === undefined ? {} : { alignedEnd: word.alignedEnd }),
        ...(word.alignmentConfidence === undefined ? {} : { alignmentConfidence: word.alignmentConfidence }),
        ...(word.confidence === undefined ? {} : { confidence: word.confidence }),
        ...(word.speaker === undefined ? {} : { speaker: word.speaker }),
      })),
    },
  };
}

function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('AI tool execution cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('AI tool execution cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForMediaTranscript(
  mediaFileId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    signal?.throwIfAborted();
    const currentStore = useMediaStore.getState();
    const currentFile = currentStore.files.find((candidate) => candidate.id === mediaFileId);
    if (!currentFile) return { success: false, error: `Media item not found: ${mediaFileId}` };
    const status = currentFile.transcriptStatus ?? 'none';
    if (status === 'ready') {
      const transcript = await handleGetMediaTranscript({ mediaFileId, limit: 1000 }, currentStore);
      if (!transcript.success) return transcript;
      const data = transcript.data && typeof transcript.data === 'object'
        ? transcript.data as Record<string, unknown>
        : {};
      return {
        success: true,
        data: {
          ...data,
          waitedMs: Date.now() - startedAt,
          waitStrategy: 'bounded-internal-wait-v1',
        },
      };
    }
    if (status === 'error') {
      return {
        success: false,
        error: `Transcript failed for media source: ${mediaFileId}`,
        data: { mediaFileId, mediaName: currentFile.name, status },
      };
    }
    await waitForDelay(750, signal);
  }
  const currentFile = useMediaStore.getState().files.find((candidate) => candidate.id === mediaFileId);
  return {
    success: false,
    error: `Transcript did not become ready within ${timeoutMs}ms.`,
    data: {
      mediaFileId,
      mediaName: currentFile?.name,
      status: currentFile?.transcriptStatus ?? 'unknown',
      timedOut: true,
    },
  };
}

async function getCompletedMediaTranscript(
  mediaFileId: string,
  mediaStore: MediaStore,
  waitedMs: number,
): Promise<ToolResult> {
  const transcript = await handleGetMediaTranscript({ mediaFileId, limit: 1000 }, mediaStore);
  if (!transcript.success) return transcript;
  const data = transcript.data && typeof transcript.data === 'object'
    ? transcript.data as Record<string, unknown>
    : {};
  return {
    success: true,
    data: {
      ...data,
      waitedMs,
      waitStrategy: 'bounded-internal-wait-v1',
    },
  };
}

export async function handleStartMediaTranscription(
  args: Record<string, unknown>,
  mediaStore: MediaStore,
  _callerContext?: unknown,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const mediaFileId = args.mediaFileId as string;
  const waitForCompletion = args.waitForCompletion === true;
  const requestedTimeoutMs = Number(args.timeoutMs ?? 180_000);
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(10_000, Math.min(300_000, Math.round(requestedTimeoutMs)))
    : 180_000;
  const file = mediaStore.files.find(candidate => candidate.id === mediaFileId);
  if (!file) return { success: false, error: `Media item not found: ${mediaFileId}` };
  if (!file.file) return { success: false, error: `Source file is unavailable: ${mediaFileId}` };
  if (file.type !== 'video' && file.type !== 'audio') {
    return { success: false, error: 'Media transcription requires a video or audio source.' };
  }
  if (file.type === 'video' && file.hasAudio === false && !file.audioCodec) {
    return { success: false, error: 'This video source has no audio track to transcribe.' };
  }
  if (file.transcriptStatus === 'ready') {
    if (waitForCompletion && file.transcript?.length) {
      return getCompletedMediaTranscript(mediaFileId, mediaStore, 0);
    }
    const { hydrateAndProjectMediaSourceArtifacts } = await import('../../../mediaArtifacts/mediaSourceArtifacts');
    await hydrateAndProjectMediaSourceArtifacts(mediaFileId);
    if (waitForCompletion) {
      const hydratedStore = useMediaStore.getState();
      const hydratedFile = hydratedStore.files.find(candidate => candidate.id === mediaFileId);
      const transcriptStore = hydratedFile?.transcriptStatus === 'ready'
        ? hydratedStore
        : mediaStore;
      return getCompletedMediaTranscript(mediaFileId, transcriptStore, 0);
    }
    return {
      success: true,
      data: {
        mediaFileId,
        mediaName: file.name,
        provider: 'best-quality',
        status: 'already-ready',
      },
    };
  }

  const {
    getActiveTranscriptionRunClipId,
  } = await import('../../../transcription/transcriptionRunController');
  const activeTargetId = getActiveTranscriptionRunClipId();
  if (activeTargetId === `media-source:${mediaFileId}`) {
    if (waitForCompletion) {
      return waitForMediaTranscript(mediaFileId, timeoutMs, signal);
    }
    return {
      success: true,
      data: {
        mediaFileId,
        mediaName: file.name,
        provider: 'best-quality',
        status: 'already-running',
      },
    };
  }

  const { queueMediaFileTranscription } = await import('../../../clipTranscriber');
  const status = queueMediaFileTranscription(mediaFileId, 'auto', { provider: 'hybrid' });
  if (waitForCompletion) {
    return waitForMediaTranscript(mediaFileId, timeoutMs, signal);
  }
  return {
    success: true,
    data: {
      mediaFileId,
      mediaName: file.name,
      provider: 'best-quality',
      status,
      message: status === 'started'
        ? 'Best Quality transcription started directly on the media source. Poll getMediaItems until transcriptStatus is ready or error.'
        : 'Best Quality transcription was queued behind the active source. Poll getMediaItems until transcriptStatus is ready or error.',
    },
  };
}

export async function handleStartMediaAnalysis(
  args: Record<string, unknown>,
  mediaStore: MediaStore,
): Promise<ToolResult> {
  const mediaFileId = args.mediaFileId as string;
  const file = mediaStore.files.find(candidate => candidate.id === mediaFileId);
  if (!file) return { success: false, error: `Media item not found: ${mediaFileId}` };
  if (!file.file) return { success: false, error: `Source file is unavailable: ${mediaFileId}` };
  if (file.type !== 'video') {
    return { success: false, error: 'Media analysis requires a video source.' };
  }

  const {
    analyzeMediaFile,
    getCurrentAnalyzingClipId,
    isAnalysisRunning,
  } = await import('../../../clipAnalyzer');
  if (isAnalysisRunning()) {
    const activeTargetId = getCurrentAnalyzingClipId();
    if (activeTargetId === mediaFileId) {
      return {
        success: true,
        data: { mediaFileId, mediaName: file.name, status: 'already-running' },
      };
    }
    return {
      success: false,
      error: `Another video analysis is already running${activeTargetId ? ` for ${activeTargetId}` : ''}.`,
    };
  }

  void analyzeMediaFile(mediaFileId).catch(() => {
    // The analyzer publishes the exact source error for getMediaItems.
  });
  return {
    success: true,
    data: {
      mediaFileId,
      mediaName: file.name,
      status: 'started',
      message: 'Video analysis started directly on the media source. Poll getMediaItems for analysisStatus, progress, and errors.',
    },
  };
}

export async function handleCreateMediaFolder(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const name = args.name as string;
  const parentFolderId = (args.parentFolderId as string | undefined) || null;

  const folder = mediaStore.createFolder(name, parentFolderId);
  const entities = emptyMutationEntities();
  entities.created.push(mediaEntityRef('folder', folder.id));

  return {
    success: true,
    data: {
      folderId: folder.id,
      folderName: folder.name,
      parentId: parentFolderId,
      ...createMediaMutationEnvelope(entities),
    },
  };
}

export async function handleRenameMediaItem(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const itemId = args.itemId as string;
  const newName = args.newName as string;

  // Try to find the item in files, compositions, or folders
  const file = mediaStore.files.find(f => f.id === itemId);
  const comp = mediaStore.compositions.find(c => c.id === itemId && isUserVisibleComposition(c));
  const folder = mediaStore.folders.find(f => f.id === itemId);

  if (file) {
    mediaStore.renameFile(itemId, newName);
    const entities = emptyMutationEntities();
    entities.updated.push(mediaEntityRef('mediaItem', itemId));
    return { success: true, data: { itemId, newName, type: 'file', ...createMediaMutationEnvelope(entities) } };
  } else if (comp) {
    mediaStore.updateComposition(itemId, { name: newName });
    const entities = emptyMutationEntities();
    entities.updated.push(mediaEntityRef('composition', itemId));
    return { success: true, data: { itemId, newName, type: 'composition', ...createMediaMutationEnvelope(entities) } };
  } else if (folder) {
    mediaStore.renameFolder(itemId, newName);
    const entities = emptyMutationEntities();
    entities.updated.push(mediaEntityRef('folder', itemId));
    return { success: true, data: { itemId, newName, type: 'folder', ...createMediaMutationEnvelope(entities) } };
  }

  return { success: false, error: `Item not found: ${itemId}` };
}

export async function handleDeleteMediaItem(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const itemId = args.itemId as string;

  const file = mediaStore.files.find(f => f.id === itemId);
  const comp = mediaStore.compositions.find(c => c.id === itemId && isUserVisibleComposition(c));
  const folder = mediaStore.folders.find(f => f.id === itemId);

  if (file) {
    const timelineSnapshot = captureMutationEntitySnapshot(
      'clip',
      useTimelineStore.getState().clips,
    );
    const result = await mediaStore.deleteMediaFilesEverywhere([itemId]);
    const entities = emptyMutationEntities();
    entities.deleted.push(mediaEntityRef('mediaItem', itemId));
    return {
      success: true,
      data: {
        itemId,
        deletedName: file.name,
        type: 'file',
        removedClipCount: result.removedClipCount,
        artifactFailures: result.artifactFailures,
        ...createMediaMutationEnvelope(
          entities,
          describeMutationEntities(timelineSnapshot, useTimelineStore.getState().clips),
        ),
      },
    };
  } else if (comp) {
    mediaStore.removeComposition(itemId);
    const entities = emptyMutationEntities();
    entities.deleted.push(mediaEntityRef('composition', itemId));
    return {
      success: true,
      data: {
        itemId,
        deletedName: comp.name,
        type: 'composition',
        ...createMediaMutationEnvelope(entities),
      },
    };
  } else if (folder) {
    mediaStore.removeFolder(itemId);
    const entities = emptyMutationEntities();
    entities.deleted.push(mediaEntityRef('folder', itemId));
    return {
      success: true,
      data: {
        itemId,
        deletedName: folder.name,
        type: 'folder',
        note: 'All contents also deleted',
        ...createMediaMutationEnvelope(entities),
      },
    };
  }

  return { success: false, error: `Item not found: ${itemId}` };
}

export async function handleMoveMediaItems(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const itemIds = args.itemIds as string[];
  const targetFolderId = (args.targetFolderId as string | undefined) || null;

  // Verify target folder exists (if not root)
  if (targetFolderId !== null) {
    const targetFolder = mediaStore.folders.find(f => f.id === targetFolderId);
    if (!targetFolder) {
      return { success: false, error: `Target folder not found: ${targetFolderId}` };
    }
  }

  const visibleCompositionIds = new Set(mediaStore.compositions.filter(isUserVisibleComposition).map((composition) => composition.id));
  const movableIds = itemIds.filter((id) =>
    mediaStore.files.some((file) => file.id === id) ||
    mediaStore.folders.some((folder) => folder.id === id) ||
    visibleCompositionIds.has(id)
  );
  const entities = emptyMutationEntities();
  entities.updated.push(...movableIds.map((id) => {
    if (mediaStore.files.some((file) => file.id === id)) return mediaEntityRef('mediaItem', id);
    if (visibleCompositionIds.has(id)) return mediaEntityRef('composition', id);
    return mediaEntityRef('folder', id);
  }));
  mediaStore.moveToFolder(movableIds, targetFolderId);

  return {
    success: true,
    data: {
      movedIds: movableIds,
      targetFolderId: targetFolderId || 'root',
      itemCount: movableIds.length,
      ...createMediaMutationEnvelope(entities),
    },
  };
}

export async function handleCreateComposition(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const requestedName = typeof args.name === 'string' ? args.name.trim() : '';
  const name = requestedName || `Composition ${mediaStore.compositions.filter(isUserVisibleComposition).length + 1}`;
  const width = (args.width as number) || 1920;
  const height = (args.height as number) || 1080;
  const frameRate = (args.frameRate as number) || 30;
  const duration = (args.duration as number) || 60;
  const openAfterCreate = args.openAfterCreate !== false; // default true
  const trackSnapshot = captureMutationEntitySnapshot(
    'track',
    useTimelineStore.getState().tracks,
  );
  const clipSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );

  const comp = mediaStore.createComposition(name, {
    width,
    height,
    frameRate,
    duration,
  });
  const entities = emptyMutationEntities();
  entities.created.push(mediaEntityRef('composition', comp.id));

  // Auto-open so subsequent operations target this composition
  if (openAfterCreate) {
    mediaStore.openCompositionTab(comp.id);
    const ready = await waitForCompositionReady(comp.id);
    if (!ready) {
      log.warn(`Timed out waiting for composition ${comp.id} to become active after creation`);
    }
  }

  return {
    success: true,
    data: {
      compositionId: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration: comp.duration,
      opened: openAfterCreate,
      ...createMediaMutationEnvelope(
        entities,
        describeMutationEntities(trackSnapshot, useTimelineStore.getState().tracks),
        describeMutationEntities(clipSnapshot, useTimelineStore.getState().clips),
      ),
    },
  };
}

export async function handleOpenComposition(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const compositionId = args.compositionId as string;

  const comp = mediaStore.compositions.find(c => c.id === compositionId && isUserVisibleComposition(c));
  if (!comp) {
    return { success: false, error: `Composition not found: ${compositionId}` };
  }

  mediaStore.openCompositionTab(compositionId);
  const ready = await waitForCompositionReady(compositionId);
  if (!ready) {
    log.warn(`Timed out waiting for composition ${compositionId} to become active after open`);
  }

  return {
    success: true,
    data: {
      compositionId: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration: comp.duration,
    },
  };
}

export async function handleSelectMediaItems(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const itemIds = args.itemIds as string[];
  const visibleCompositionIds = new Set(mediaStore.compositions.filter(isUserVisibleComposition).map((composition) => composition.id));
  const selectableIds = itemIds.filter((id) =>
    mediaStore.files.some((file) => file.id === id) ||
    mediaStore.folders.some((folder) => folder.id === id) ||
    visibleCompositionIds.has(id)
  );
  mediaStore.setSelection(selectableIds);
  return {
    success: true,
    data: { selectedIds: selectableIds, count: selectableIds.length },
  };
}
