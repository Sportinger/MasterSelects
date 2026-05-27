const AUDIO_LAYER_ADVANCED_MODE_STORAGE_KEY = 'masterselects.audioLayerAdvancedMode';

export function readStoredAudioLayerAdvancedMode(fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(AUDIO_LAYER_ADVANCED_MODE_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }

  return fallback;
}

export function persistAudioLayerAdvancedMode(enabled: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(AUDIO_LAYER_ADVANCED_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Persisting a view preference is best-effort; the in-memory state still updates.
  }
}
