// Integration credentials of the phone Settings, stored exactly like the desktop: the YouTube Data API
// key goes through youtubeCredentialManager (encrypted in IndexedDB, never in a project archive).
import { Logger } from '../../../services/logger';
import { youtubeCredentialManager } from '../../../services/youtubeCredentialManager';
import { useSettingsStore } from '../../../stores/settingsStore';

const log = Logger.create('PhoneIntegrations');

/** Saves (or with an empty value clears) the key through the desktop's credential manager. */
export async function savePhoneYouTubeKey(value: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const key = value.trim();
  try {
    await youtubeCredentialManager.store(key);
  } catch (error) {
    log.error('Saving the YouTube key failed', error);
    return { ok: false, message: `The key was not saved: ${error instanceof Error ? error.message : String(error)}. Browser storage may be blocked (private window).` };
  }
  useSettingsStore.setState({ youtubeApiKey: key });
  return { ok: true, message: key ? 'YouTube key saved on this device.' : 'YouTube key removed from this device.' };
}
