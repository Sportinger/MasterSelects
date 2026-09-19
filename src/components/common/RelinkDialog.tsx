// RelinkDialog - Dialog to relink missing media files
// Shows list of missing files, allows searching folders, updates status

import { useState, useCallback, useEffect, useRef, type ChangeEvent } from 'react';
import './WelcomeOverlay.css';
import './RelinkDialog.css';
import { Logger } from '../../services/logger';

const log = Logger.create('RelinkDialog');
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { projectFileService } from '../../services/projectFileService';
import {
  applyRelinkMatch,
  createRelinkCandidateMapFromFiles,
  createRelinkCandidateMapFromHandles,
  findRelinkMatch,
  mediaNeedsRelink,
  setRelinkHandleSource,
  type RelinkCandidate,
  type RelinkCandidateMap,
  type RelinkMatch,
} from '../../services/project/relinkMedia';
import {
  getProjectMediaSourceRootStates,
  registerProjectMediaSourceRoot,
  registerProjectMediaSourceRootDescriptor,
  requestProjectMediaSourceRootAccess,
  type ProjectMediaSourceRootState,
} from '../../services/project/mediaSourceRoots';

interface RelinkDialogProps {
  onClose: () => void;
}

interface FileStatus {
  id: string;
  name: string;
  filePath?: string;
  status: 'missing' | 'found' | 'searching';
  match?: RelinkMatch;
}

type FileSystemEntryHandle = FileSystemFileHandle | FileSystemDirectoryHandle;
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterableIterator<FileSystemEntryHandle>;
};

type RelinkPickerWindow = Window & typeof globalThis & {
  showDirectoryPicker: (options?: object) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker: (options?: object) => Promise<FileSystemFileHandle[]>;
};

const IMAGE_FILE_PATTERN = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;
const VIDEO_FILE_PATTERN = /\.(?:3gp|avi|m4v|mkv|mov|mp4|mpe?g|webm|wmv)$/i;

function getNativeMediaAccept(statuses: FileStatus[]): string {
  const accepts = new Set<string>();
  for (const status of statuses) {
    const name = status.filePath ?? status.name;
    if (IMAGE_FILE_PATTERN.test(name)) accepts.add('image/*');
    if (VIDEO_FILE_PATTERN.test(name)) accepts.add('video/*');
  }
  return [...accepts].join(',');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getMissingFiles(files: MediaFile[]): MediaFile[] {
  return files.filter(mediaNeedsRelink);
}

async function collectSourceRootFiles(
  dirHandle: FileSystemDirectoryHandle,
  sourceRootId: string,
): Promise<Map<string, FileSystemFileHandle>> {
  const foundFiles = new Map<string, FileSystemFileHandle>();

  const scanDirectory = async (dir: FileSystemDirectoryHandle, parentPath = ''): Promise<void> => {
    try {
      for await (const entry of (dir as IterableDirectoryHandle).values()) {
        const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
          setRelinkHandleSource(entry, sourceRootId, relativePath);
          foundFiles.set(relativePath.toLowerCase(), entry);
        } else if (entry.kind === 'directory') {
          await scanDirectory(entry, relativePath);
        }
      }
    } catch (error) {
      log.warn('Error scanning source directory', { sourceRootId, error });
    }
  };

  await scanDirectory(dirHandle);
  return foundFiles;
}

function matchStatuses(
  statuses: FileStatus[],
  mediaFiles: MediaFile[],
  candidates: RelinkCandidateMap,
  direct?: { statusId: string; candidate: RelinkCandidate },
): FileStatus[] {
  const mediaById = new Map(mediaFiles.map(file => [file.id, file]));

  return statuses.map((status) => {
    if (status.status === 'found' && status.match) {
      return status;
    }

    const mediaFile = mediaById.get(status.id);
    if (!mediaFile) {
      return status;
    }

    const match = findRelinkMatch(mediaFile, candidates, {
      directCandidate: direct?.statusId === status.id ? direct.candidate : undefined,
    });

    return match
      ? { ...status, status: 'found' as const, match }
      : status;
  });
}

export function RelinkDialog({ onClose }: RelinkDialogProps) {
  const { files } = useMediaStore();
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchedFolders, setSearchedFolders] = useState<string[]>([]);
  const [folderSelectionError, setFolderSelectionError] = useState<string>('');
  const [sourceRoots, setSourceRoots] = useState<ProjectMediaSourceRootState[]>([]);
  const nativeFileInputRef = useRef<HTMLInputElement>(null);
  const nativeFolderInputRef = useRef<HTMLInputElement>(null);
  const nativePhotoInputRef = useRef<HTMLInputElement>(null);
  const pendingNativeStatusIdRef = useRef<string | null>(null);
  const pendingNativeSourceRootIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Safari exposes folder upload through the long-established
    // webkitdirectory input attribute instead of showDirectoryPicker().
    nativeFolderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  // Initialize file statuses and auto-scan Raw folder
  useEffect(() => {
    let cancelled = false;

    const initializeStatuses = async () => {
      const missingFiles = getMissingFiles(files);
      const initialStatuses: FileStatus[] = missingFiles.map(f => ({
        id: f.id,
        name: f.name,
        filePath: f.filePath,
        status: 'missing' as const,
      }));
      if (cancelled) return;
      setFileStatuses(initialStatuses);

      // Auto-scan the project folder for missing files if project is open.
      // Raw is matched first so canonical project media wins over duplicate names.
      if (projectFileService.isProjectOpen() && missingFiles.length > 0) {
        log.debug('Auto-scanning project folder...');
        const rawFiles = await projectFileService.scanRawFolder();
        let updatedStatuses = initialStatuses;
        const searched: string[] = [];

        if (rawFiles.size > 0) {
          log.debug(`Found ${rawFiles.size} files in Raw folder`);
          const candidates = await createRelinkCandidateMapFromHandles(rawFiles.values());
          if (candidates.size > 0) {
            updatedStatuses = matchStatuses(updatedStatuses, missingFiles, candidates);
            searched.push('Raw (project folder)');
          }
        }

        if (updatedStatuses.some(status => status.status === 'missing')) {
          const projectFiles = await projectFileService.scanProjectFolder();
          if (projectFiles.size > 0) {
            log.debug(`Found ${projectFiles.size} files in project folder`);
            const candidates = await createRelinkCandidateMapFromHandles(projectFiles.values());
            if (candidates.size > 0) {
              updatedStatuses = matchStatuses(updatedStatuses, missingFiles, candidates);
              searched.push('Project folder');
            }
          }
        }

        const roots = await getProjectMediaSourceRootStates();
        if (cancelled) return;
        setSourceRoots(roots);
        for (const root of roots) {
          if (root.permission !== 'granted' || !root.handle) continue;
          const sourceFiles = await collectSourceRootFiles(root.handle, root.id);
          const candidates = await createRelinkCandidateMapFromHandles(sourceFiles.values());
          if (candidates.size === 0) continue;
          updatedStatuses = matchStatuses(updatedStatuses, missingFiles, candidates);
          searched.push(root.name);
        }

        if (cancelled) return;
        setFileStatuses(updatedStatuses);
        if (searched.length > 0) {
          setSearchedFolders(searched);
        }
      }
    };

    initializeStatuses();
    return () => {
      cancelled = true;
    };
  }, [files]);

  // Scan a folder for missing files
  const scanFolder = useCallback(async (
    dirHandle: FileSystemDirectoryHandle,
    preferredRootId?: string,
  ) => {
    setIsSearching(true);
    try {
      const root = await registerProjectMediaSourceRoot(dirHandle, preferredRootId);
      const foundFiles = await collectSourceRootFiles(dirHandle, root.id);
      log.debug(`Found ${foundFiles.size} files in ${dirHandle.name}`);

      const candidates = await createRelinkCandidateMapFromHandles(foundFiles.values());
      setFileStatuses(prev => matchStatuses(prev, files, candidates));
      setSearchedFolders(prev => [...new Set([...prev, dirHandle.name])]);
      setSourceRoots(await getProjectMediaSourceRootStates());
    } finally {
      setIsSearching(false);
    }
  }, [files]);

  const handleReconnectSourceRoot = useCallback(async (root: ProjectMediaSourceRootState) => {
    let handle = await requestProjectMediaSourceRootAccess(root);
    if (!handle) {
      if (typeof (window as RelinkPickerWindow).showDirectoryPicker !== 'function') {
        const input = nativeFolderInputRef.current;
        if (!input) return;
        pendingNativeSourceRootIdRef.current = root.id;
        setFolderSelectionError('');
        input.value = '';
        input.click();
        return;
      }
      try {
        handle = await (window as RelinkPickerWindow).showDirectoryPicker({
          mode: 'read',
          startIn: 'videos',
        });
      } catch (error) {
        if (!isAbortError(error)) log.error('Source folder reconnect error', error);
        return;
      }
    }
    await scanFolder(handle, root.id);
  }, [scanFolder]);

  // Handle browse button
  const handleBrowse = useCallback(async () => {
    if (projectFileService.activeBackend === 'native') {
      setIsSearching(true);
      try {
        const result = await projectFileService.pickAndScanFolder('Search folder for missing media');
        if (!result) {
          return;
        }

        const candidates = await createRelinkCandidateMapFromHandles(result.files.values());
        setFileStatuses(prev => matchStatuses(prev, files, candidates));
        setSearchedFolders(prev => [...prev, result.name]);
      } catch (e) {
        log.error('Native browse error', e);
      } finally {
        setIsSearching(false);
      }
      return;
    }

    try {
      if (typeof (window as RelinkPickerWindow).showDirectoryPicker !== 'function') {
        const input = nativeFolderInputRef.current;
        if (!input) return;
        pendingNativeSourceRootIdRef.current = null;
        setFolderSelectionError('');
        input.value = '';
        input.click();
        return;
      }

      const dirHandle = await (window as RelinkPickerWindow).showDirectoryPicker({
        mode: 'read',
        startIn: 'videos',
      });

      if (dirHandle) {
        await scanFolder(dirHandle);
      }
    } catch (e) {
      if (!isAbortError(e)) {
        log.error('Browse error', e);
      }
    }
  }, [files, scanFolder]);

  // Handle picking individual file - allows multiple selection to relink several at once
  const handlePickFile = useCallback(async (fileStatus: FileStatus) => {
    // Check how many files are still missing
    const missingFiles = fileStatuses.filter(s => s.status === 'missing');
    const allowMultiple = missingFiles.length > 1;

    if (typeof (window as RelinkPickerWindow).showOpenFilePicker !== 'function') {
      const input = nativeFileInputRef.current;
      if (!input) return;
      pendingNativeStatusIdRef.current = fileStatus.id;
      input.multiple = allowMultiple;
      input.accept = getNativeMediaAccept(allowMultiple ? missingFiles : [fileStatus]);
      input.value = '';
      input.click();
      return;
    }

    try {
      const handles = await (window as RelinkPickerWindow).showOpenFilePicker({
        multiple: allowMultiple, // Allow multiple selection if there are multiple missing files
        excludeAcceptAllOption: false,
      });

      if (handles && handles.length > 0) {
        const selectedFiles = await createRelinkCandidateMapFromHandles(handles);
        const directCandidate = handles.length === 1
          ? [...selectedFiles.values()][0]?.[0]
          : undefined;

        log.debug(`User selected ${selectedFiles.size} file(s)`);

        const updatedStatuses = matchStatuses(fileStatuses, files, selectedFiles, directCandidate
          ? { statusId: fileStatus.id, candidate: directCandidate }
          : undefined);
        setFileStatuses(updatedStatuses);

        // If there are still missing files after selection, offer to scan the folder
        const stillMissing = updatedStatuses.filter(s => s.status === 'missing');

        if (stillMissing.length > 0 && handles.length > 0) {
          // Automatically open folder picker starting from the selected file's location
          try {
            const dirHandle = await (window as RelinkPickerWindow).showDirectoryPicker({
              mode: 'read',
              startIn: handles[0], // Start in same folder as selected file
            });
            if (dirHandle) {
              log.debug('Scanning folder for remaining files...');
              await scanFolder(dirHandle);
            }
          } catch (e) {
            // User cancelled - that's fine, we still have the manually selected files
            if (!isAbortError(e)) {
              log.debug('Folder access declined, using manually selected files only');
            }
          }
        }
      }
    } catch (e) {
      if (!isAbortError(e)) {
        log.error('Pick file error', e);
      }
    }
  }, [fileStatuses, files, scanFolder]);

  const handleNativeFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    const statusId = pendingNativeStatusIdRef.current;
    pendingNativeStatusIdRef.current = null;
    event.currentTarget.value = '';
    if (selectedFiles.length === 0) return;

    const candidates = createRelinkCandidateMapFromFiles(selectedFiles);
    const directCandidate = statusId && selectedFiles.length === 1
      ? [...candidates.values()][0]?.[0]
      : undefined;
    setFileStatuses((previous) => matchStatuses(
      previous,
      files,
      candidates,
      statusId && directCandidate ? { statusId, candidate: directCandidate } : undefined,
    ));
    log.debug(`User selected ${selectedFiles.length} file(s) through native input`);
  }, [files]);

  const handlePickPhotos = useCallback(() => {
    const input = nativePhotoInputRef.current;
    if (!input) return;
    const missingFiles = fileStatuses.filter((status) => status.status === 'missing');
    pendingNativeStatusIdRef.current = missingFiles.length === 1 ? missingFiles[0]!.id : null;
    input.value = '';
    input.click();
  }, [fileStatuses]);

  const handleNativeFolderChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    const preferredRootId = pendingNativeSourceRootIdRef.current ?? undefined;
    pendingNativeSourceRootIdRef.current = null;
    event.currentTarget.value = '';
    if (selectedFiles.length === 0) return;

    const relativePath = selectedFiles[0]?.webkitRelativePath;
    const folderName = relativePath?.split('/').filter(Boolean)[0];
    if (!folderName) {
      log.warn('Folder selection did not expose relative paths');
      setFolderSelectionError('This selection did not include folder paths. On iPhone or iPad, use iOS/iPadOS 18.4 or newer and select the folder in Files.');
      return;
    }

    setFolderSelectionError('');
    const root = registerProjectMediaSourceRootDescriptor(folderName, preferredRootId);
    const candidates = createRelinkCandidateMapFromFiles(selectedFiles, root);
    setFileStatuses((previous) => matchStatuses(previous, files, candidates));

    setSearchedFolders((previous) => [...previous, folderName]);
    void getProjectMediaSourceRootStates().then(setSourceRoots);
    log.debug(`Scanned ${selectedFiles.length} file(s) through Safari folder input`);
  }, [files]);

  // Apply all found files
  const handleApply = useCallback(async () => {
    const rejected = new Set<string>();
    const appliedIds = new Set<string>();
    const errors: string[] = [];
    for (const status of fileStatuses) {
      if (status.status === 'found' && status.match) {
        try {
          const applied = await applyRelinkMatch(status.id, status.match);
          if (!applied) throw new Error(`Could not reconnect “${status.name}”. Choose its original media file.`);
          appliedIds.add(status.id);
          log.info(`Applied: ${status.name}`);
        } catch (error) {
          rejected.add(status.id);
          errors.push(error instanceof Error ? error.message : `Could not reconnect “${status.name}”.`);
        }
      }
    }

    if (rejected.size > 0) {
      setFileStatuses(previous => previous.filter(status => !appliedIds.has(status.id)).map(status => rejected.has(status.id)
        ? { ...status, status: 'missing', match: undefined }
        : status));
      setFolderSelectionError(errors.join(' '));
      return;
    }
    onClose();
  }, [fileStatuses, onClose]);

  const missingCount = fileStatuses.filter(s => s.status === 'missing').length;
  const foundCount = fileStatuses.filter(s => s.status === 'found').length;
  const usesSafariFileFallback = typeof (window as RelinkPickerWindow).showOpenFilePicker !== 'function';
  const usesSafariFolderFallback = projectFileService.activeBackend !== 'native'
    && typeof (window as RelinkPickerWindow).showDirectoryPicker !== 'function';

  return (
    <div className="welcome-overlay-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <input
        ref={nativeFileInputRef}
        type="file"
        multiple
        style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -10000, top: 0 }}
        onChange={handleNativeFileChange}
      />
      <input
        ref={nativeFolderInputRef}
        type="file"
        multiple
        style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -10000, top: 0 }}
        onChange={handleNativeFolderChange}
      />
      <input
        ref={nativePhotoInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -10000, top: 0 }}
        onChange={handleNativeFileChange}
      />
      <div className="welcome-overlay relink-dialog">
        <h2 className="relink-title">Relink Media</h2>
        <p className="relink-subtitle">
          {missingCount} missing · {foundCount} found
        </p>

        {/* File list */}
        <div className="relink-file-list">
          {fileStatuses.map(status => (
            <div
              key={status.id}
              className={`relink-file-item ${status.status}`}
              onClick={() => status.status === 'missing' && handlePickFile(status)}
            >
              <span className={`relink-status-icon ${status.status}`}>
                {status.status === 'missing' ? '!' : status.status === 'found' ? '✓' : '...'}
              </span>
              <div className="relink-file-info">
                <span className="relink-file-name">{status.name}</span>
                {status.filePath && status.filePath !== status.name && (
                  <span className="relink-file-path">{status.filePath}</span>
                )}
              </div>
              {status.status === 'missing' && (
                <span className="relink-pick-hint">
                  {missingCount > 1 ? 'Click to select files' : 'Click to locate'}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Searched folders */}
        {searchedFolders.length > 0 && (
          <div className="relink-searched">
            Searched: {searchedFolders.join(', ')}
          </div>
        )}
        {folderSelectionError && (
          <div className="relink-folder-error" role="alert">{folderSelectionError}</div>
        )}

        {sourceRoots.length > 0 && missingCount > 0 && (
          <div className="relink-known-sources">
            <span className="relink-known-sources-label">Project source folders</span>
            <div className="relink-known-source-list">
              {sourceRoots.map((root) => (
                <button
                  key={root.id}
                  className="relink-btn relink-btn-secondary relink-source-root-btn"
                  onClick={() => void handleReconnectSourceRoot(root)}
                  onPointerUp={(event) => event.currentTarget.blur()}
                  disabled={isSearching}
                  type="button"
                >
                  Reconnect {root.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="relink-actions">
          <div className="relink-source-actions">
            {usesSafariFileFallback && (
              <button
                className="relink-btn relink-btn-secondary"
                onClick={handlePickPhotos}
                disabled={missingCount === 0}
              >
                Photos / Videos...
              </button>
            )}
            <button
              className="relink-btn relink-btn-secondary"
              onClick={handleBrowse}
              disabled={isSearching}
              title={usesSafariFolderFallback
                ? 'This opens the iPad Files app. The Photos library is available through Photos / Videos.'
                : undefined}
            >
              {isSearching ? 'Searching...' : usesSafariFolderFallback ? 'Files / Folder...' : 'Search Folder...'}
            </button>
          </div>
          <div className="relink-actions-right">
            <button className="relink-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="relink-btn relink-btn-primary"
              onClick={handleApply}
              disabled={foundCount === 0}
            >
              Apply ({foundCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
