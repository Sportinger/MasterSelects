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
