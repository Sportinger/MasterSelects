import { describe, expect, it } from 'vitest';
import { requestSuccess, transactionSuccess } from '../../src/services/projectDb/transactions';

class Transaction extends EventTarget {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  emit(type: 'complete' | 'error' | 'abort') {
    this[`on${type}`]?.();
    this.dispatchEvent(new Event(type));
  }
}

describe('project database write acknowledgement', () => {
  it('does not report a saved project before the transaction commits', async () => {
    const transaction = new Transaction();
    const request = { transaction, onsuccess: null, onerror: null, error: null };
    let saved = false;
    const result = requestSuccess(request as unknown as IDBRequest).then(() => { saved = true; });
    (request.onsuccess as (() => void) | null)?.();
    await Promise.resolve();
    expect(saved).toBe(false);
    transaction.emit('complete');
    await result;
    expect(saved).toBe(true);
  });

  it('rejects a write rolled back after its request succeeded', async () => {
    const transaction = new Transaction();
    const request = { transaction, onsuccess: null, onerror: null, error: null };
    const result = requestSuccess(request as unknown as IDBRequest);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    (request.onsuccess as (() => void) | null)?.();
    transaction.emit('abort');
    await rejected;
  });

  it('settles every waiter when a transaction is aborted without an error event', async () => {
    const transaction = new Transaction();
    const first = transactionSuccess(transaction as unknown as IDBTransaction);
    const second = transactionSuccess(transaction as unknown as IDBTransaction);
    const assertions = [first, second].map(result => expect(result).rejects.toMatchObject({ name: 'AbortError' }));
    transaction.emit('abort');
    await Promise.all(assertions);
  });
});
