import { fileSystemService } from '../fileSystemService';
import { projectDB } from '../projectDB';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import {
  createRelinkCandidateMapFromFiles,
  findRelinkMatch,
  type RelinkCandidate,
} from './relink/relinkMatching';
import {
  registerProjectMediaSourceRoot,
  registerProjectMediaSourceRootDescriptor,
  resolveFileWithinProjectMediaSourceRoot,
} from './mediaSourceRoots';

async function getMediaHandle(mediaFile: MediaFile): Promise<FileSystemFileHandle | null> {
  const cached = fileSystemService.getFileHandle(mediaFile.id);
  if (cached) return cached;
  try {
    const stored = await projectDB.getStoredHandle(`media_${mediaFile.id}`);
    return stored?.kind === 'file' ? stored as FileSystemFileHandle : null;
  } catch {
    return null;
  }
}

export async function connectCurrentProjectMediaSourceRoot(
  handle: FileSystemDirectoryHandle,
): Promise<{ linkedMediaCount: number; rootId: string; rootName: string }> {
  const root = await registerProjectMediaSourceRoot(handle);
  const assignments = new Map<string, string>();

  for (const mediaFile of useMediaStore.getState().files) {
    if (mediaFile.liveInput) continue;
    const mediaHandle = await getMediaHandle(mediaFile);
    if (!mediaHandle) continue;
    const relativePath = await resolveFileWithinProjectMediaSourceRoot(root.id, mediaHandle);
    if (relativePath) assignments.set(mediaFile.id, relativePath);
  }

  if (assignments.size > 0) {
    useMediaStore.setState((state) => ({
      files: state.files.map((file) => {
        const sourceRelativePath = assignments.get(file.id);
        return sourceRelativePath
          ? {
              ...file,
              filePath: sourceRelativePath,
              sourceRelativePath,
              sourceRootId: root.id,
            }
          : file;
      }),
    }));
  }

  return {
    linkedMediaCount: assignments.size,
    rootId: root.id,
    rootName: root.name,
  };
}

function selectedFolderName(files: File[]): string | null {
  for (const file of files) {
    const firstSegment = file.webkitRelativePath?.replace(/\\/g, '/').split('/').filter(Boolean)[0];
    if (firstSegment) return firstSegment;
  }
  return null;
}

function primaryCandidate(match: ReturnType<typeof findRelinkMatch>): RelinkCandidate | null {
  if (!match) return null;
  if (match.kind === 'single' || match.kind === 'linked-source') return match.candidate;
  return match.frames[0]?.candidate ?? null;
}

/**
 * WebKit does not expose persistent external directory handles. Its
 * `webkitdirectory` input still supplies every File with a relative path, so
 * retain the same project metadata and ask for the folder again on reconnect.
 */
export function connectCurrentProjectMediaSourceFiles(
  selectedFiles: Iterable<File>,
  preferredRootId?: string,
): { linkedMediaCount: number; rootId: string; rootName: string } | null {
  const files = Array.from(selectedFiles);
  const rootName = selectedFolderName(files);
  if (!rootName) return null;

  const root = registerProjectMediaSourceRootDescriptor(rootName, preferredRootId);
  const candidates = createRelinkCandidateMapFromFiles(files, root);
  const assignments = new Map<string, RelinkCandidate>();
  for (const mediaFile of useMediaStore.getState().files) {
    if (mediaFile.liveInput) continue;
    const candidate = primaryCandidate(findRelinkMatch(mediaFile, candidates));
    if (candidate?.relativePath) assignments.set(mediaFile.id, candidate);
  }

  if (assignments.size > 0) {
    useMediaStore.setState((state) => ({
      files: state.files.map((file) => {
        const candidate = assignments.get(file.id);
        return candidate?.relativePath
          ? {
              ...file,
              filePath: candidate.relativePath,
              sourceRelativePath: candidate.relativePath,
              sourceRootId: root.id,
            }
          : file;
      }),
    }));
  }

  return {
    linkedMediaCount: assignments.size,
    rootId: root.id,
    rootName: root.name,
  };
}
