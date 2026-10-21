/**
 * The project repository rejects edits while this tab may not write: another
 * tab owns the project, folder access is missing, or a project is still being
 * activated. The store boundary throws a RepositoryError('ownership') so the
 * edit is not applied; UI handlers do not catch it. These rejections are an
 * expected state, not a crash: the global error hooks route them here so the
 * person sees why the edit did nothing.
 */
export interface EditRejection {
  message: string;
  at: number;
}

/** Shown when this tab may not write; shared by the repository guard and up-front UI checks. */
export const READ_ONLY_PROJECT_MESSAGE = 'This project is read-only. Close the other writing tab or grant folder access before editing.';

type Listener = (rejection: EditRejection) => void;
const listeners = new Set<Listener>();

export function isEditRejection(error: unknown): error is Error & { code: 'ownership' } {
  return error instanceof Error && error.name === 'RepositoryError'
    && (error as Error & { code?: unknown }).code === 'ownership';
}

export function announceEditRejection(error: Error): void {
  const rejection = { message: error.message, at: Date.now() };
  for (const listener of listeners) listener(rejection);
}

export function subscribeEditRejections(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Handlers that catch an edit failure themselves report an ownership rejection
 * like the global hooks do: a warning plus the visible notice, never an error
 * report. Returns false for every other error so real failures stay reported.
 */
export function noteCaughtEditRejection(error: unknown, warn: (message: string, data?: unknown) => void): boolean {
  if (!isEditRejection(error)) return false;
  warn(`Edit not applied: ${error.message}`, { code: error.code });
  announceEditRejection(error);
  return true;
}
