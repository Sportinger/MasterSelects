import { Logger } from '../../logger';
import { apiKeyManager } from '../../apiKeyManager';

const log = Logger.create('ProjectCore');

const KEYS_FILE_NAME = '.keys.enc';

export async function saveProjectKeysFile(projectHandle: FileSystemDirectoryHandle | null): Promise<void> {
  if (!projectHandle) return;

  try {
    const content = await apiKeyManager.exportKeysForFile();
    if (!content) {
      log.debug('No API keys to save to file');
      return;
    }

    const fileHandle = await projectHandle.getFileHandle(KEYS_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    log.debug('API keys saved to project file');
  } catch (e) {
    log.warn('Failed to save keys file:', e);
  }
}

export async function loadProjectKeysFile(projectHandle: FileSystemDirectoryHandle | null): Promise<boolean> {
  if (!projectHandle) return false;

  try {
    const fileHandle = await projectHandle.getFileHandle(KEYS_FILE_NAME);
    const file = await fileHandle.getFile();
    const content = await file.text();

    if (!content) return false;

    const restored = await apiKeyManager.importKeysFromFile(content);
    if (restored) {
      log.info('API keys restored from project file');
    }
    return restored;
  } catch {
    // File does not exist; that is fine.
    return false;
  }
}
