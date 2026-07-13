import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import type { FileImportResult } from '../../../stores/mediaStore/types';
import { requireMediaFileImportResult } from '../../../stores/mediaStore/helpers/importResult';
import { captureSnapshot } from '../../../stores/historyStore';
import { projectFileService } from '../../projectFileService';
import { runTimelinePlacementCommand } from '../../timelinePlacementCommands';
import { Logger } from '../../logger';
import type { CaptureRecordingResult } from './sessionTypes';
import {
  ArtifactCaptureRecordingBlobStore,
  deleteCaptureRecoveryEntry,
  getCaptureRecoveryStorage,
  readCaptureRecoveryEntries,
  reassembleCaptureRecoveryRecording,
  upsertCaptureRecoveryEntry,
  type CaptureRecoveryBlobStore,
  type CaptureRecoveryEntry,
} from './recoveryPersistence';

const log = Logger.create('ScreenCapture');
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface CaptureCommitResult {
  sessionId: string;
  mediaFileId: string;
  fileName: string;
  placedClipId?: string;
  placementError?: string;
  alreadyCommitted: boolean;
}

export interface CaptureCommitOptions {
  placeOnTimeline?: boolean;
  recoveryStorage?: RecoveryStorage;
  blobStore?: CaptureRecoveryBlobStore;
  isProjectOpen?: () => boolean;
  listFolders?: () => readonly { id: string; name: string; parentId: string | null }[];
  createFolder?: (name: string, parentId?: string | null) => { id: string };
  importFile?: (
    file: File,
    parentId?: string | null,
    options?: { forceCopyToProject?: boolean; projectFileName?: string },
  ) => Promise<FileImportResult>;
  getMediaFileById?: (id: string) => MediaFile | undefined;
  patchMediaDuration?: (id: string, durationSeconds: number) => void;
  captureHistorySnapshot?: (label: string, options?: { isAutoCapture?: boolean }) => void;
  placeMediaOnTimeline?: (mediaFileId: string) => Promise<{ success: boolean; createdClipId?: string; reason?: string }>;
  deleteRecovery?: (sessionId: string) => Promise<void>;
}

const commitPromises = new Map<string, Promise<CaptureCommitResult>>();

function captureExtension(mimeType: string): string {
  const base = mimeType.split(';', 1)[0]?.trim().toLowerCase();
  if (base === 'video/mp4') return 'mp4';
  if (base === 'video/quicktime') return 'mov';
  return 'webm';
}

function recordingFileName(startedAt: number, mimeType: string): string {
  const date = new Date(startedAt);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `Screen Recording ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.${captureExtension(mimeType)}`;
}

async function restoreRecordingFile(
  entry: CaptureRecoveryEntry,
  result: CaptureRecordingResult,
  blobStore: CaptureRecoveryBlobStore,
): Promise<File> {
  const fileName = recordingFileName(entry.startedAt, result.mimeType);
  const blob = await reassembleCaptureRecoveryRecording(entry, blobStore);
  return new File([blob], fileName, { type: result.mimeType, lastModified: entry.startedAt });
}

async function defaultPlaceMediaOnTimeline(mediaFileId: string) {
  const previous = useMediaStore.getState();
  useMediaStore.setState({
    selectedIds: [mediaFileId],
    sourceMonitorFileId: mediaFileId,
    sourceMonitorInPoint: null,
    sourceMonitorOutPoint: null,
  });
  try {
    return await runTimelinePlacementCommand('place-on-top');
  } finally {
    useMediaStore.setState({
      selectedIds: previous.selectedIds,
      sourceMonitorFileId: previous.sourceMonitorFileId,
      sourceMonitorInPoint: previous.sourceMonitorInPoint,
      sourceMonitorOutPoint: previous.sourceMonitorOutPoint,
    });
  }
}

function patchDefaultMediaDuration(id: string, durationSeconds: number): void {
  useMediaStore.setState(state => ({
    files: state.files.map(file => file.id === id ? { ...file, duration: durationSeconds } : file),
  }));
}

export function getCaptureDurationFallback(
  probedDuration: number | undefined,
  recorderDuration: number,
): number | undefined {
  const probeIsValid = typeof probedDuration === 'number' && probedDuration > 0 && Number.isFinite(probedDuration);
  return !probeIsValid && recorderDuration > 0 && Number.isFinite(recorderDuration) ? recorderDuration : undefined;
}

async function commitOnce(
  result: CaptureRecordingResult,
  options: CaptureCommitOptions,
): Promise<CaptureCommitResult> {
  const storage = options.recoveryStorage ?? getCaptureRecoveryStorage();
  const blobStore = options.blobStore ?? new ArtifactCaptureRecordingBlobStore();
  const entry = readCaptureRecoveryEntries(storage).find(candidate => candidate.sessionId === result.sessionId);
  if (!entry) throw new Error('No recoverable screen recording is available for this session.');
  if (!(options.isProjectOpen ?? (() => projectFileService.isProjectOpen()))()) {
    throw new Error('Open or create a project before recording the screen.');
  }

  const getMediaFileById = options.getMediaFileById ?? (id => useMediaStore.getState().files.find(file => file.id === id));
  const alreadyCommitted = Boolean(entry.committedMediaFileId);
  let imported = entry.committedMediaFileId ? getMediaFileById(entry.committedMediaFileId) : undefined;
  let fileName = imported?.name ?? recordingFileName(entry.startedAt, result.mimeType);

  if (entry.committedMediaFileId && !imported) {
    throw new Error('The committed screen recording is missing from the Media Library.');
  }

  if (!imported) {
    const listFolders = options.listFolders ?? (() => useMediaStore.getState().folders);
    const createFolder = options.createFolder ?? ((name, parentId) => useMediaStore.getState().createFolder(name, parentId));
    const folderId = listFolders().find(folder => folder.name === 'Recordings' && folder.parentId === null)?.id
      ?? createFolder('Recordings', null).id;
    const file = await restoreRecordingFile(entry, result, blobStore);
    const importFile = options.importFile ?? ((...args) => useMediaStore.getState().importFile(...args));
    imported = requireMediaFileImportResult(await importFile(file, folderId, {
      forceCopyToProject: true,
      projectFileName: file.name,
    }), 'Screen recording import');
    if (imported.type !== 'video') throw new Error(`Recorded file "${file.name}" did not import as video.`);
    fileName = file.name;

    const durationFallback = getCaptureDurationFallback(imported.duration, result.durationSeconds);
    if (durationFallback !== undefined) {
      (options.patchMediaDuration ?? patchDefaultMediaDuration)(imported.id, durationFallback);
      imported = { ...imported, duration: durationFallback };
    }

    upsertCaptureRecoveryEntry(storage, {
      ...entry,
      status: 'committed',
      committedMediaFileId: imported.id,
      committedAt: Date.now(),
    });
  }

  let placedClipId: string | undefined;
  let placementError: string | undefined;
  if (options.placeOnTimeline && !alreadyCommitted) {
    const captureHistorySnapshot = options.captureHistorySnapshot ?? captureSnapshot;
    captureHistorySnapshot('Screen recording imported', { isAutoCapture: true });
    const placement = await (options.placeMediaOnTimeline ?? defaultPlaceMediaOnTimeline)(imported.id);
    if (placement.success) {
      placedClipId = placement.createdClipId;
      captureHistorySnapshot('Place screen recording');
    } else {
      placementError = placement.reason ?? 'The screen recording could not be placed on the timeline.';
      log.warn(placementError, { mediaFileId: imported.id });
    }
  }

  try {
    await (options.deleteRecovery ?? (sessionId => deleteCaptureRecoveryEntry(storage, blobStore, sessionId)))(result.sessionId);
  } catch (error) {
    log.warn('Screen recording recovery cleanup failed', { sessionId: result.sessionId, error });
  }

  return {
    sessionId: result.sessionId,
    mediaFileId: imported.id,
    fileName,
    placedClipId,
    placementError,
    alreadyCommitted,
  };
}

export function commitCaptureRecording(
  result: CaptureRecordingResult,
  options: CaptureCommitOptions = {},
): Promise<CaptureCommitResult> {
  const existing = commitPromises.get(result.sessionId);
  if (existing) return existing;
  const promise = commitOnce(result, options);
  commitPromises.set(result.sessionId, promise);
  void promise.catch(() => commitPromises.delete(result.sessionId));
  return promise;
}
