// RelinkDialog - Dialog to relink missing media files
// Shows list of missing files, allows searching folders, updates status

import { useState, useCallback, useEffect } from 'react';
import { Logger } from '../../services/logger';

const log = Logger.create('RelinkDialog');
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { projectFileService } from '../../services/projectFileService';
import {
  applyRelinkMatch,
  createRelinkCandidateMapFromHandles,
  findRelinkMatch,
  mediaNeedsRelink,
  type RelinkCandidate,
  type RelinkCandidateMap,
  type RelinkMatch,
} from '../../services/project/relinkMedia';

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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getMissingFiles(files: MediaFile[]): MediaFile[] {
  return files.filter(mediaNeedsRelink);
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
  const scanFolder = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
    setIsSearching(true);

    // Collect all files from directory recursively
    const foundFiles = new Map<string, FileSystemFileHandle>();

    const scanDirectory = async (dir: FileSystemDirectoryHandle) => {
      try {
        for await (const entry of (dir as IterableDirectoryHandle).values()) {
          if (entry.kind === 'file') {
            const fileName = entry.name.toLowerCase();
            foundFiles.set(fileName, entry);
          } else if (entry.kind === 'directory') {
            await scanDirectory(entry);
          }
        }
      } catch (e) {
        log.warn('Error scanning directory', e);
      }
    };

    await scanDirectory(dirHandle);
    log.debug(`Found ${foundFiles.size} files in ${dirHandle.name}`);

    const candidates = await createRelinkCandidateMapFromHandles(foundFiles.values());
    setFileStatuses(prev => matchStatuses(prev, files, candidates));

    setSearchedFolders(prev => [...prev, dirHandle.name]);
    setIsSearching(false);
  }, [files]);

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
        log.warn('Directory picker is not available in this browser');
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

    try {
      const handles = await (window as RelinkPickerWindow).showOpenFilePicker({
        multiple: allowMultiple, // Allow multiple selection if there are multiple missing files
        excludeAcceptAllOption: false,
      });

      if (handles && handles.length > 0) {
        const selectedFiles = await createRelinkCandidateMapFromHandles(handles);
        const directCandidate = handles.length === 1
          ? [...selectedFiles.values()][0]
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

  // Apply all found files
  const handleApply = useCallback(async () => {
    for (const status of fileStatuses) {
      if (status.status === 'found' && status.match) {
        const applied = await applyRelinkMatch(status.id, status.match);
        if (applied) {
          log.info(`Applied: ${status.name}`);
        }
      }
    }

    onClose();
  }, [fileStatuses, onClose]);

  const missingCount = fileStatuses.filter(s => s.status === 'missing').length;
  const foundCount = fileStatuses.filter(s => s.status === 'found').length;

  return (
    <div className="welcome-overlay-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
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

        {/* Actions */}
        <div className="relink-actions">
          <button
            className="relink-btn relink-btn-secondary"
            onClick={handleBrowse}
            disabled={isSearching}
          >
            {isSearching ? 'Searching...' : 'Search Folder...'}
          </button>
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
