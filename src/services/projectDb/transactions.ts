export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function requestSuccess(request: IDBRequest): Promise<void> {
  // A successful put/delete request can still be rolled back before commit.
  // Register now, while the request is pending, so aborts cannot strand callers.
  if (request.transaction) return transactionSuccess(request.transaction);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function transactionSuccess(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      transaction.removeEventListener('complete', complete);
      transaction.removeEventListener('abort', abort);
      transaction.removeEventListener('error', error);
    };
    const complete = () => { cleanup(); resolve(); };
    const abort = () => {
      cleanup();
      reject(transaction.error ?? new DOMException('Database transaction aborted', 'AbortError'));
    };
    const error = () => {
      cleanup();
      reject(transaction.error ?? new DOMException('Database transaction failed', 'UnknownError'));
    };
    transaction.addEventListener('complete', complete);
    transaction.addEventListener('abort', abort);
    transaction.addEventListener('error', error);
  });
}
