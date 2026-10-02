// getMediaItems: the media panel as one listing, subfolders included, so a
// project organized into folders never reads as an empty media pool.

import type { ToolResult } from '../../types';
import type { MediaStore } from './runtime';
import { isUserVisibleComposition } from '../../../../stores/mediaStore/compositionVisibility';
import { useTimelineStore } from '../../../../stores/timeline';

const DEFAULT_MEDIA_ITEMS_LIMIT = 200;
const MAX_MEDIA_ITEMS_LIMIT = 500;

/** The folder and every folder below it; null is the media panel root. */
function collectFolderScope(folders: MediaStore['folders'], folderId: string | null, recursive: boolean): Set<string | null> {
  const scope = new Set<string | null>([folderId]);
  if (!recursive) return scope;
  for (let grew = true; grew;) {
    grew = false;
    for (const folder of folders) {
      if (!scope.has(folder.id) && scope.has(folder.parentId)) {
        scope.add(folder.id);
        grew = true;
      }
    }
  }
  return scope;
}

function folderPathOf(folders: MediaStore['folders'], parentId: string | null): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let id = parentId; id && !seen.has(id);) {
    seen.add(id);
    const folder = folders.find(candidate => candidate.id === id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parentId;
  }
  return names.join('/');
}

export async function handleGetMediaItems(
  args: Record<string, unknown>,
  mediaStore: MediaStore
): Promise<ToolResult> {
  const folderId = (args.folderId as string | undefined) || null;
  if (folderId && !mediaStore.folders.some(folder => folder.id === folderId)) {
    return { success: false, error: `Media folder not found: ${folderId}` };
  }
  const recursive = args.recursive !== false;
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const limit = Math.min(MAX_MEDIA_ITEMS_LIMIT, Math.max(1, Math.floor(Number(args.limit) || DEFAULT_MEDIA_ITEMS_LIMIT)));
  const { files, compositions, folders } = mediaStore;
  const timelineClips = useTimelineStore.getState().clips;

  // Media in subfolders is part of the project: list the whole subtree unless asked not to.
  const scope = collectFolderScope(folders, folderId, recursive);
  const scopedFiles = files.filter(f => scope.has(f.parentId));
  const folderFiles = scopedFiles.slice(offset, offset + limit);
  const folderComps = compositions.filter(c => scope.has(c.parentId) && isUserVisibleComposition(c));
  const subFolders = folders.filter(f => f.id !== folderId && scope.has(f.parentId));
  const hasMore = offset + folderFiles.length < scopedFiles.length;

  return {
    success: true,
    data: {
      folderId: folderId || 'root',
      recursive,
      folders: subFolders.map(f => ({
        id: f.id,
        name: f.name,
        type: 'folder',
        parentId: f.parentId,
        path: folderPathOf(folders, f.id),
        isExpanded: f.isExpanded,
      })),
      fileCounts: {
        total: scopedFiles.length,
        video: scopedFiles.filter(f => f.type === 'video').length,
        audio: scopedFiles.filter(f => f.type === 'audio').length,
        image: scopedFiles.filter(f => f.type === 'image').length,
      },
      offset,
      hasMore,
      ...(hasMore ? { nextOffset: offset + folderFiles.length } : {}),
      files: folderFiles.map((f) => {
        const analyzedClip = timelineClips.find(clip =>
          (clip.source?.mediaFileId || clip.mediaFileId) === f.id
          && clip.faceAnalysisStatus !== undefined);
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          folderPath: folderPathOf(folders, f.parentId),
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
        folderPath: folderPathOf(folders, c.parentId),
        width: c.width,
        height: c.height,
        duration: c.duration,
        frameRate: c.frameRate,
      })),
      totalItems: subFolders.length + scopedFiles.length + folderComps.length,
      allFolders: folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId })),
    },
  };
}

