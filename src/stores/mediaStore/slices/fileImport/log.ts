import { Logger } from '../../../../services/logger';

export const fileImportLog = Logger.create('Import');

/**
 * Logs a failed import. An AbortError means the media item was removed or replaced while its
 * import ran (or the import was cancelled): an intended stop, logged at info, not an error.
 * Returns whether it was a real failure.
 */
export function reportImportFailure(fileName: string, error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    fileImportLog.info(`Import stopped: ${fileName}`, { reason: error.message });
    return false;
  }
  fileImportLog.error(`Import failed: ${fileName}`, error);
  return true;
}
