import { afterEach, expect, it, vi } from 'vitest';
import { noteCaughtEditRejection, READ_ONLY_PROJECT_MESSAGE, subscribeEditRejections } from '../../src/services/editRejection';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { isProjectBackendUnavailable, ProjectBackendUnavailableError } from '../../src/services/project/projectBackendAvailability';

// Production groups 0d8641123b37c2b5, e4bf0c25e0dcb690 and 2fd187eb29b3b0f6:
// a read-only delete, a missing file backend and a Firefox IndexedDB
// UnknownError were reported as crashes although they are expected states.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('turns a caught read-only rejection into a warning and the visible notice', () => {
  const notices: string[] = [];
  const unsubscribe = subscribeEditRejections(rejection => notices.push(rejection.message));
  const warn = vi.fn();
  expect(noteCaughtEditRejection(new RepositoryError('ownership', READ_ONLY_PROJECT_MESSAGE), warn)).toBe(true);
  expect(noteCaughtEditRejection(new RepositoryError('corrupt', 'Segment checksum mismatch'), warn)).toBe(false);
  unsubscribe();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(notices).toEqual([READ_ONLY_PROJECT_MESSAGE]);
});

it('marks only a missing project file backend as an environment state with guidance', () => {
  const error = new ProjectBackendUnavailableError();
  expect(isProjectBackendUnavailable(error)).toBe(true);
  expect(error).toMatchObject({ name: 'RepositoryError', code: 'unsupported' });
  expect(error.message).toContain('Native Helper');
  expect(isProjectBackendUnavailable(new RepositoryError('unsupported', 'Unsupported repository format'))).toBe(false);
});

it('retries an IndexedDB UnknownError once, then continues without the credential', async () => {
  vi.resetModules();
  const requests: Array<{ error: DOMException | null; onerror?: () => void }> = [];
  const open = vi.fn(() => { const request = { error: null }; requests.push(request); return request; });
  vi.stubGlobal('indexedDB', { open });
  const { youtubeCredentialManager } = await import('../../src/services/youtubeCredentialManager');
  const pending = youtubeCredentialManager.getOrNullIfStorageUnavailable();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    requests[attempt].error = new DOMException('The operation failed for reasons unrelated to the database itself', 'UnknownError');
    requests[attempt].onerror?.();
  }
  await expect(pending).resolves.toBeNull();
  expect(open).toHaveBeenCalledTimes(2);
});
