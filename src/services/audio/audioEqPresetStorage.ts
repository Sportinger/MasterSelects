import {
  cloneAudioEqPreset,
  createUserAudioEqPreset,
  type AudioEqPreset,
} from '../../engine/audio/eq/AudioEqPresets';

const AUDIO_EQ_USER_PRESETS_STORAGE_KEY = 'masterselects.audioEq.userPresets.v1';
const AUDIO_EQ_PRESET_FAVORITES_STORAGE_KEY = 'masterselects.audioEq.presetFavorites.v1';

interface AudioEqPresetStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface AudioEqUserPresetStoragePayload {
  schemaVersion: 1;
  presets: AudioEqPreset[];
}

interface AudioEqPresetFavoriteStoragePayload {
  schemaVersion: 1;
  favoritePresetIds: string[];
}

function getDefaultStorage(): AudioEqPresetStorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

function parseStoredPresets(raw: string | null): AudioEqPreset[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('schemaVersion' in parsed) ||
      !('presets' in parsed)
    ) {
      return [];
    }

    const payload = parsed as AudioEqUserPresetStoragePayload;
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.presets)) {
      return [];
    }

    return payload.presets
      .filter(preset => typeof preset?.name === 'string' && typeof preset?.id === 'string')
      .map(preset => cloneAudioEqPreset({
        ...preset,
        builtin: false,
      }));
  } catch {
    return [];
  }
}

export function loadAudioEqUserPresets(storage: AudioEqPresetStorageLike | null = getDefaultStorage()): AudioEqPreset[] {
  if (!storage) {
    return [];
  }

  return parseStoredPresets(storage.getItem(AUDIO_EQ_USER_PRESETS_STORAGE_KEY));
}

export function saveAudioEqUserPresets(
  presets: readonly AudioEqPreset[],
  storage: AudioEqPresetStorageLike | null = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }

  const payload: AudioEqUserPresetStoragePayload = {
    schemaVersion: 1,
    presets: presets.map(preset => cloneAudioEqPreset({
      ...preset,
      builtin: false,
    })),
  };
  storage.setItem(AUDIO_EQ_USER_PRESETS_STORAGE_KEY, JSON.stringify(payload));
}

export function upsertAudioEqUserPreset(
  preset: AudioEqPreset,
  storage: AudioEqPresetStorageLike | null = getDefaultStorage(),
): AudioEqPreset[] {
  const current = loadAudioEqUserPresets(storage);
  const nextPreset = cloneAudioEqPreset({
    ...preset,
    builtin: false,
    updatedAt: new Date().toISOString(),
  });
  const existingIndex = current.findIndex(candidate => candidate.id === nextPreset.id);
  const next = existingIndex >= 0
    ? current.map(candidate => candidate.id === nextPreset.id ? nextPreset : candidate)
    : [...current, nextPreset];
  saveAudioEqUserPresets(next, storage);
  return next;
}

export function createAndSaveAudioEqUserPreset(
  input: Parameters<typeof createUserAudioEqPreset>[0],
  storage: AudioEqPresetStorageLike | null = getDefaultStorage(),
): AudioEqPreset[] {
  return upsertAudioEqUserPreset(createUserAudioEqPreset(input), storage);
}

export function deleteAudioEqUserPreset(
  presetId: string,
  storage: AudioEqPresetStorageLike | null = getDefaultStorage(),
): AudioEqPreset[] {
  const next = loadAudioEqUserPresets(storage).filter(preset => preset.id !== presetId);
  saveAudioEqUserPresets(next, storage);
  return next;
}

export function clearAudioEqUserPresets(storage: AudioEqPresetStorageLike | null = getDefaultStorage()): void {
  storage?.removeItem(AUDIO_EQ_USER_PRESETS_STORAGE_KEY);
}

function parseStoredFavoriteIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('schemaVersion' in parsed) ||
      !('favoritePresetIds' in parsed)
    ) {
      return [];
    }

    const payload = parsed as AudioEqPresetFavoriteStoragePayload;
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.favoritePresetIds)) {
      return [];
    }
    return [...new Set(payload.favoritePresetIds.filter(id => typeof id === 'string' && id.trim().length > 0))];
  } catch {
    return [];
  }
}

export function loadAudioEqPresetFavoriteIds(storage: AudioEqPresetStorageLike | null = getDefaultStorage()): string[] {
  if (!storage) return [];
  return parseStoredFavoriteIds(storage.getItem(AUDIO_EQ_PRESET_FAVORITES_STORAGE_KEY));
}

export function saveAudioEqPresetFavoriteIds(
  favoritePresetIds: readonly string[],
  storage: AudioEqPresetStorageLike | null = getDefaultStorage(),
): string[] {
  const next = [...new Set(favoritePresetIds.filter(id => id.trim().length > 0))];
  if (!storage) return next;
  const payload: AudioEqPresetFavoriteStoragePayload = {
    schemaVersion: 1,
    favoritePresetIds: next,
  };
  storage.setItem(AUDIO_EQ_PRESET_FAVORITES_STORAGE_KEY, JSON.stringify(payload));
  return next;
}

export function toggleAudioEqPresetFavoriteId(
  presetId: string,
  storage: AudioEqPresetStorageLike | null = getDefaultStorage(),
): string[] {
  const current = new Set(loadAudioEqPresetFavoriteIds(storage));
  if (current.has(presetId)) {
    current.delete(presetId);
  } else {
    current.add(presetId);
  }
  return saveAudioEqPresetFavoriteIds([...current], storage);
}
