// Media library tool handlers: browsing, folders, rename/delete/move,
// selection, and composition create/open.

import type { ToolResult } from '../../types';
import { Logger } from '../../../logger';
import { waitForCompositionReady, type MediaStore } from './runtime';
import { isUserVisibleComposition } from '../../../../stores/mediaStore/compositionVisibility';
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
          analysisStatus: f.analysisStatus ?? 'none',
          analysisCoverage: f.analysisCoverage ?? 0,
          faceAnalysisStatus: analyzedClip?.faceAnalysisStatus ?? 'none',
          faceAnalysisError: analyzedClip?.faceAnalysisStatus === 'error'
            ? analyzedClip.faceAnalysisMessage
            : undefined,
          uniquePeople: analyzedClip?.analysis?.faceAnalysis?.people.length ?? 0,
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
      // Also include all folders for reference
      allFolders: folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId })),
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
