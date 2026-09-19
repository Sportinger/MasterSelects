import { openDatabase } from './projectDb/openDatabase';
import { requestResult, transactionSuccess } from './projectDb/transactions';
import { Logger } from './logger';

const log = Logger.create('YouTubeCredentialManager');

const DB_NAME = 'multicam-settings';
const DB_VERSION = 3;
const STORE_NAME = 'api-keys';
const ENCRYPTION_KEY_ID = 'encryption-key';
const YOUTUBE_KEY_ID = 'youtube-api-key';

// These identifiers were used by the retired browser-owned AI credential
// system. The v3 migration removes every known spelling while preserving the
// separately reviewed YouTube integration credential.
const RETIRED_AI_CREDENTIAL_IDS = [
  'openai-api-key',
  'anthropic-api-key',
  'anthropic',
  'assemblyai-api-key',
  'deepgram-api-key',
  'piapi-api-key',
  'evolink-api-key',
  'elevenlabs-api-key',
  'kieai-api-key',
  'claude-api-key',
  'kling-access-key',
  'kling-secret-key',
  'klingAccessKey',
  'klingSecretKey',
] as const;

interface EncryptedCredential {
  data: number[];
  iv: number[];
}

async function generateEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key);
}

async function importKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function encrypt(value: string, key: CryptoKey): Promise<EncryptedCredential> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    data: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv),
  };
}

async function decrypt(value: EncryptedCredential, key: CryptoKey): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(value.iv) },
    key,
    new Uint8Array(value.data),
  );
  return new TextDecoder().decode(decrypted);
}

async function openDB(): Promise<IDBDatabase> {
  const open = () => openDatabase(DB_NAME, DB_VERSION, (db, _event, transaction) => {
    const store = db.objectStoreNames.contains(STORE_NAME)
      ? transaction.objectStore(STORE_NAME)
      : db.createObjectStore(STORE_NAME, { keyPath: 'id' });

    for (const id of RETIRED_AI_CREDENTIAL_IDS) store.delete(id);
  });
  try {
    return await open();
  } catch (error) {
    // A transient WebKit open abort must not disable credentials for this load.
    // Retry only before obtaining a connection; never replay credential writes.
    if (typeof error !== 'object' || error === null
      || !('name' in error) || error.name !== 'AbortError') throw error;
    return open();
  }
}

async function withCredentialRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  try {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    const [result] = await Promise.all([requestResult(request), transactionSuccess(transaction)]);
    return result;
  } finally {
    db.close();
  }
}

async function dbGet<T>(id: string): Promise<T | null> {
  const record = await withCredentialRequest<{ value: T } | undefined>('readonly', store => store.get(id));
  return record?.value ?? null;
}

async function dbSet(id: string, value: unknown): Promise<void> {
  await withCredentialRequest('readwrite', store => store.put({ id, value }));
}

async function dbDelete(id: string): Promise<void> {
  await withCredentialRequest('readwrite', store => store.delete(id));
}

async function getOrCreateEncryptionKey(candidate: ArrayBuffer): Promise<ArrayBuffer> {
  const db = await openDB();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let selected = candidate;
    const request = store.get(ENCRYPTION_KEY_ID);
    const completed = transactionSuccess(transaction);
    request.onsuccess = () => {
      // One readwrite transaction also serializes first-use creation across tabs.
      if (request.result?.value) selected = request.result.value;
      else {
        try { store.put({ id: ENCRYPTION_KEY_ID, value: candidate }); }
        catch { transaction.abort(); }
      }
    };
    await completed;
    return selected;
  } finally {
    db.close();
  }
}

class YouTubeCredentialManager {
  private async getEncryptionKey(): Promise<CryptoKey> {
    // Read durable state on each operation; a failed write must not leave a
    // cached key that encrypts later credentials without a matching stored key.
    const stored = await dbGet<ArrayBuffer>(ENCRYPTION_KEY_ID);
    if (stored) return importKey(stored);
    const candidate = await exportKey(await generateEncryptionKey());
    return importKey(await getOrCreateEncryptionKey(candidate));
  }

  async store(apiKey: string): Promise<void> {
    const normalized = apiKey.trim();
    if (!normalized) {
      await this.clear();
      return;
    }

    await dbSet(YOUTUBE_KEY_ID, await encrypt(normalized, await this.getEncryptionKey()));
    log.info('YouTube integration credential stored');
  }

  async get(): Promise<string | null> {
    const stored = await dbGet<EncryptedCredential>(YOUTUBE_KEY_ID);
    if (!stored) return null;

    try {
      return await decrypt(stored, await this.getEncryptionKey());
    } catch (error) {
      log.error('Failed to decrypt YouTube integration credential', error);
      return null;
    }
  }

  async clear(): Promise<void> {
    await dbDelete(YOUTUBE_KEY_ID);
    log.info('YouTube integration credential cleared');
  }
}

export const youtubeCredentialManager = new YouTubeCredentialManager();
