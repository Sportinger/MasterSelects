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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });

      for (const id of RETIRED_AI_CREDENTIAL_IDS) {
        store?.delete(id);
      }
    };
  });
}

async function dbGet<T>(id: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.value ?? null);
  });
}

async function dbSet(id: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ id, value });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function dbDelete(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

class YouTubeCredentialManager {
  private encryptionKey: CryptoKey | null = null;

  private async getEncryptionKey(): Promise<CryptoKey> {
    if (this.encryptionKey) return this.encryptionKey;

    const stored = await dbGet<ArrayBuffer>(ENCRYPTION_KEY_ID);
    if (stored) {
      this.encryptionKey = await importKey(stored);
      return this.encryptionKey;
    }

    this.encryptionKey = await generateEncryptionKey();
    await dbSet(ENCRYPTION_KEY_ID, await exportKey(this.encryptionKey));
    return this.encryptionKey;
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
