// Media Panel Tool Handlers

import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import type { CallerContext } from '../policy';
import { Logger } from '../../logger';
import { activateDockPanel, flashPreviewCanvas } from '../aiFeedback';
import { validateFilePath, getAllowedRoots } from '../../security/fileAccessBroker';
import { fetchWithDevBridgeAuth, hasDevBridgeToken } from '../../security/devBridgeAuth';
import { NativeHelperClient } from '../../nativeHelper';

const log = Logger.create('AITool:Media');

type MediaStore = ReturnType<typeof useMediaStore.getState>;
type LocalFileBackend = 'devBridge' | 'nativeHelper';

const DEFAULT_LOCAL_FILE_EXTENSIONS = [
  '.mp4', '.webm', '.mov', '.mkv', '.avi',
  '.mp3', '.wav', '.aac', '.ogg', '.m4a',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  '.obj', '.gltf', '.glb',
  '.ply', '.splat', '.ksplat', '.spz', '.sog', '.lcc', '.zip',
] as const;

const LOCAL_FILE_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.obj': 'model/obj',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.ply': 'application/octet-stream',
  '.splat': 'application/octet-stream',
  '.ksplat': 'application/octet-stream',
  '.spz': 'application/octet-stream',
  '.sog': 'application/octet-stream',
  '.lcc': 'application/octet-stream',
  '.zip': 'application/zip',
};

function normalizeLocalPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function parseExtensionFilter(extensions?: string): string[] {
  if (!extensions) {
    return [...DEFAULT_LOCAL_FILE_EXTENSIONS];
  }

  return extensions
    .split(',')
    .map(ext => ext.trim().toLowerCase())
    .filter(Boolean)
    .map(ext => ext.startsWith('.') ? ext : `.${ext}`);
}

function guessMimeTypeFromPath(filePath: string): string {
  const normalizedPath = normalizeLocalPath(filePath).toLowerCase();
  const dotIndex = normalizedPath.lastIndexOf('.');
  if (dotIndex === -1) {
    return 'application/octet-stream';
  }

  return LOCAL_FILE_MIME_TYPES[normalizedPath.slice(dotIndex)] || 'application/octet-stream';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompositionReady(compositionId: string, timeoutMs: number = 2500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const mediaState = useMediaStore.getState();
    const timelineState = useTimelineStore.getState();
    const composition = mediaState.compositions.find((comp) => comp.id === compositionId);

    const isActive = mediaState.activeCompositionId === compositionId;
    const expectedTracks = composition?.timelineData?.tracks ?? [];
    const timelineTracksMatch = expectedTracks.length === 0 || (
      timelineState.tracks.length === expectedTracks.length &&
      expectedTracks.every((track, index) => timelineState.tracks[index]?.id === track.id)
    );

    if (isActive && timelineTracksMatch) {
      return true;
    }

    await delay(25);
  }

  return false;
}

function getLocalFileBackend(callerContext: CallerContext): LocalFileBackend | null {
  const devBridgeAvailable = hasDevBridgeToken();
  const nativeHelperAvailable = NativeHelperClient.isConnected();

  if (callerContext === 'nativeHelper' && nativeHelperAvailable) {
    return 'nativeHelper';
  }

  if (callerContext === 'devBridge' && devBridgeAvailable) {
    return 'devBridge';
  }

  if (devBridgeAvailable) {
    return 'devBridge';
  }

  if (nativeHelperAvailable) {
    return 'nativeHelper';
  }

  return null;
}

async function fetchLocalFileBlob(filePath: string, callerContext: CallerContext): Promise<Blob> {
  const normalizedPath = normalizeLocalPath(filePath);
  const backend = getLocalFileBackend(callerContext);

  if (backend === 'devBridge') {
    const encodedPath = encodeURIComponent(normalizedPath);
    const response = await fetchWithDevBridgeAuth(`/api/local-file?path=${encodedPath}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return response.blob();
  }

  if (backend === 'nativeHelper') {
    const buffer = await NativeHelperClient.getDownloadedFile(normalizedPath);
    if (!buffer) {
      throw new Error('Native Helper could not read the requested file');
    }

    return new Blob([buffer], { type: guessMimeTypeFromPath(normalizedPath) });
  }

  throw new Error('No local file backend available. Start the dev bridge or connect the Native Helper.');
}

async function listLocalDirectory(directory: string, extensions: string | undefined, callerContext: CallerContext): Promise<Array<{
  name: string;
  path: string;
  size: number;
  modified: string;
}>> {
  const normalizedDir = normalizeLocalPath(directory);
  const extFilter = parseExtensionFilter(extensions);
  const backend = getLocalFileBackend(callerContext);

  if (backend === 'devBridge') {
    let url = `/api/local-files?dir=${encodeURIComponent(normalizedDir)}`;
    if (extFilter.length > 0) {
      url += `&ext=${encodeURIComponent(extFilter.join(','))}`;
    }

    const response = await fetchWithDevBridgeAuth(url);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(body.error || `HTTP ${response.status}`);
    }

    const data = await response.json() as { files?: Array<{ name: string; path: string; size: number; modified: string }> };
    return data.files || [];
  }

  if (backend === 'nativeHelper') {
    const entries = await NativeHelperClient.listDir(normalizedDir);
    return entries
      .filter(entry => entry.kind === 'file')
      .filter(entry => {
        const ext = entry.name.includes('.') ? `.${entry.name.split('.').pop()!.toLowerCase()}` : '';
        return extFilter.length === 0 || extFilter.includes(ext);
      })
      .map(entry => ({
        name: entry.name,
        path: `${normalizedDir}/${entry.name}`,
        size: entry.size,
        modified: new Date(entry.modified * 1000).toISOString(),
      }));
  }

  throw new Error('No local file backend available. Start the dev bridge or connect the Native Helper.');
}

export async function handleGetMediaItems(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const folderId = (args.folderId as string | undefined) || null;
  const { files, compositions, folders } = mediaStore;

  // Filter by folder
  const folderFiles = files.filter(f => f.parentId === folderId);
  const folderComps = compositions.filter(c => c.parentId === folderId);
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
      files: folderFiles.map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        duration: f.duration,
        width: f.width,
        height: f.height,
      })),
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

  return {
    success: true,
    data: {
      folderId: folder.id,
      folderName: folder.name,
      parentId: parentFolderId,
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
  const comp = mediaStore.compositions.find(c => c.id === itemId);
  const folder = mediaStore.folders.find(f => f.id === itemId);

  if (file) {
    mediaStore.renameFile(itemId, newName);
    return { success: true, data: { itemId, newName, type: 'file' } };
  } else if (comp) {
    mediaStore.updateComposition(itemId, { name: newName });
    return { success: true, data: { itemId, newName, type: 'composition' } };
  } else if (folder) {
    mediaStore.renameFolder(itemId, newName);
    return { success: true, data: { itemId, newName, type: 'folder' } };
  }

  return { success: false, error: `Item not found: ${itemId}` };
}

export async function handleDeleteMediaItem(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const itemId = args.itemId as string;

  const file = mediaStore.files.find(f => f.id === itemId);
  const comp = mediaStore.compositions.find(c => c.id === itemId);
  const folder = mediaStore.folders.find(f => f.id === itemId);

  if (file) {
    mediaStore.removeFile(itemId);
    return { success: true, data: { itemId, deletedName: file.name, type: 'file' } };
  } else if (comp) {
    mediaStore.removeComposition(itemId);
    return { success: true, data: { itemId, deletedName: comp.name, type: 'composition' } };
  } else if (folder) {
    mediaStore.removeFolder(itemId);
    return { success: true, data: { itemId, deletedName: folder.name, type: 'folder', note: 'All contents also deleted' } };
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

  mediaStore.moveToFolder(itemIds, targetFolderId);

  return {
    success: true,
    data: {
      movedIds: itemIds,
      targetFolderId: targetFolderId || 'root',
      itemCount: itemIds.length,
    },
  };
}

export async function handleCreateComposition(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const requestedName = typeof args.name === 'string' ? args.name.trim() : '';
  const name = requestedName || `Composition ${mediaStore.compositions.length + 1}`;
  const width = (args.width as number) || 1920;
  const height = (args.height as number) || 1080;
  const frameRate = (args.frameRate as number) || 30;
  const duration = (args.duration as number) || 60;
  const openAfterCreate = args.openAfterCreate !== false; // default true

  const comp = mediaStore.createComposition(name, {
    width,
    height,
    frameRate,
    duration,
  });

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
    },
  };
}

export async function handleOpenComposition(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const compositionId = args.compositionId as string;

  const comp = mediaStore.compositions.find(c => c.id === compositionId);
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
  mediaStore.setSelection(itemIds);
  return {
    success: true,
    data: { selectedIds: itemIds, count: itemIds.length },
  };
}

export async function handleImportLocalFiles(
  args: Record<string, unknown>,
  mediaStore: MediaStore,
  callerContext: CallerContext = 'internal',
): Promise<ToolResult> {
  const paths = args.paths as string[];
  const addToTimeline = (args.addToTimeline as boolean) || false;

  // Visual feedback: activate media panel during import
  activateDockPanel('media');
  flashPreviewCanvas('import');

  const results: Array<{ id: string; name: string; type: string; duration?: number; path: string }> = [];
  const errors: Array<{ path: string; error: string }> = [];

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

    try {
      const normalizedPath = normalizeLocalPath(filePath);
      log.info(`Fetching: ${normalizedPath}`);

      const blob = await fetchLocalFileBlob(normalizedPath, callerContext);
      const fileName = normalizedPath.split('/').pop() || 'unknown';
      const file = new File([blob], fileName, { type: blob.type });

      const mediaFile = await mediaStore.importFile(file);
      results.push({
        id: mediaFile.id,
        name: mediaFile.name,
        type: mediaFile.type,
        duration: mediaFile.duration,
        path: filePath,
      });
      log.info(`Imported: ${mediaFile.name} (${mediaFile.type})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error(`Failed to import: ${filePath}`, err);
      errors.push({ path: filePath, error: msg });
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
      const existingClips = useTimelineStore.getState().clips.filter(c => c.trackId === targetTrackId);
      currentTime = existingClips.length > 0
        ? Math.max(...existingClips.map(c => c.startTime + c.duration))
        : 0;
    }

    const placedClips: Array<{ name: string; trackId: string; startTime: number }> = [];
    for (const result of results) {
      const mediaFile = useMediaStore.getState().files.find(f => f.id === result.id);
      if (mediaFile && mediaFile.file) {
        await useTimelineStore.getState().addClip(targetTrackId!, mediaFile.file, currentTime, mediaFile.duration, mediaFile.id);
        placedClips.push({ name: result.name, trackId: targetTrackId!, startTime: currentTime });
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
