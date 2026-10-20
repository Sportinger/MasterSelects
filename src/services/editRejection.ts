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
