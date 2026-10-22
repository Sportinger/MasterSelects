import { RepositoryError } from './repository/contracts';

/**
 * Browsers without the File System Access API (Firefox, Safari) can pick a
 * project folder only through a running Native Helper. Without it, opening a
 * folder is an environment state the person can fix, not a product crash.
 */
export const PROJECT_BACKEND_UNAVAILABLE_MESSAGE =
  'Opening a project folder needs Chrome or Edge, or the MasterSelects Native Helper running on this computer. Start the Native Helper and try again.';

export class ProjectBackendUnavailableError extends RepositoryError {
  constructor() {
    super('unsupported', PROJECT_BACKEND_UNAVAILABLE_MESSAGE);
  }
}

export function isProjectBackendUnavailable(error: unknown): error is ProjectBackendUnavailableError {
  return error instanceof ProjectBackendUnavailableError;
}

/**
 * Where File > Open Project can look. A folder picker (Chrome/Edge) or a
 * running Native Helper opens real folders; without both, the projects stored
 * in this browser and imported .msproj archives are still openable.
 */
export type OpenProjectRoute = 'folder-picker' | 'native-helper' | 'browser-storage' | 'unavailable';

export interface OpenProjectEnvironment {
  folderPicker: boolean;
  /** Connects to the helper on demand; only asked when no folder picker exists. */
  nativeHelper(): Promise<boolean>;
  browserStorage: boolean;
}

export async function selectOpenProjectRoute(environment: OpenProjectEnvironment): Promise<OpenProjectRoute> {
  if (environment.folderPicker) return 'folder-picker';
  if (await environment.nativeHelper()) return 'native-helper';
  return environment.browserStorage ? 'browser-storage' : 'unavailable';
}

/**
 * Importing a file that is not an archive, an archive in an unknown format, a
 * name clash or a full disk is the person's input or environment, not a
 * product failure: callers warn and explain instead of reporting an error.
 */
export function isExpectedArchiveImportRejection(error: unknown): boolean {
  return error instanceof RepositoryError && (error.code === 'unsupported' || error.code === 'conflict' || error.code === 'quota');
}
