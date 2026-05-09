import { useEffect, useState } from 'react';

const SETTINGS_STORAGE_PREFIX = 'editable-draggable-number-settings:';
const LEGACY_BOUNDS_STORAGE_PREFIX = 'editable-draggable-number-bounds:';

export const EDITABLE_DRAGGABLE_NUMBER_SETTINGS_EVENT = 'editable-draggable-number-settings-updated';

export interface EditableDraggableNumberSettings {
  min?: number;
  max?: number;
  defaultValue?: number;
}

export interface EditableDraggableNumberSettingsEventDetail {
  persistenceKey?: string;
}

export function getEditableDraggableNumberSettings(
  persistenceKey?: string,
): EditableDraggableNumberSettings | null {
  if (!persistenceKey) return null;
  try {
    const raw = localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${persistenceKey}`);
    const legacyRaw = localStorage.getItem(`${LEGACY_BOUNDS_STORAGE_PREFIX}${persistenceKey}`);
    const source = raw ?? legacyRaw;
    if (!source) return null;
    const parsed = JSON.parse(source) as EditableDraggableNumberSettings;
    return {
      min: Number.isFinite(parsed.min) ? parsed.min : undefined,
      max: Number.isFinite(parsed.max) ? parsed.max : undefined,
      defaultValue: Number.isFinite(parsed.defaultValue) ? parsed.defaultValue : undefined,
    };
  } catch {
    return null;
  }
}

export function getEffectiveEditableDraggableNumberSettings({
  persistenceKey,
  min,
  max,
  defaultValue,
}: {
  persistenceKey?: string;
  min?: number;
  max?: number;
  defaultValue?: number;
}): EditableDraggableNumberSettings {
  const persistedSettings = getEditableDraggableNumberSettings(persistenceKey);
  return {
    min: persistedSettings?.min ?? min,
    max: persistedSettings?.max ?? max,
    defaultValue: persistedSettings?.defaultValue ?? defaultValue,
  };
}

export function saveEditableDraggableNumberSettings(
  persistenceKey: string,
  settings: EditableDraggableNumberSettings,
): void {
  localStorage.setItem(`${SETTINGS_STORAGE_PREFIX}${persistenceKey}`, JSON.stringify(settings));
}

export function clearEditableDraggableNumberSettings(persistenceKey: string): void {
  localStorage.removeItem(`${SETTINGS_STORAGE_PREFIX}${persistenceKey}`);
  localStorage.removeItem(`${LEGACY_BOUNDS_STORAGE_PREFIX}${persistenceKey}`);
}

export function dispatchEditableDraggableNumberSettingsUpdated(persistenceKey: string): void {
  window.dispatchEvent(
    new CustomEvent<EditableDraggableNumberSettingsEventDetail>(
      EDITABLE_DRAGGABLE_NUMBER_SETTINGS_EVENT,
      { detail: { persistenceKey } },
    ),
  );
}

export function useEditableDraggableNumberSettingsRevision(persistenceKey?: string): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const shouldRefresh = (updatedKey?: string | null) =>
      !persistenceKey || !updatedKey || updatedKey === persistenceKey;

    const handleSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<EditableDraggableNumberSettingsEventDetail>).detail;
      if (shouldRefresh(detail?.persistenceKey)) {
        setRevision((current) => current + 1);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (!persistenceKey) {
        setRevision((current) => current + 1);
        return;
      }

      if (
        event.key === `${SETTINGS_STORAGE_PREFIX}${persistenceKey}` ||
        event.key === `${LEGACY_BOUNDS_STORAGE_PREFIX}${persistenceKey}`
      ) {
        setRevision((current) => current + 1);
      }
    };

    window.addEventListener(EDITABLE_DRAGGABLE_NUMBER_SETTINGS_EVENT, handleSettingsUpdated);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(EDITABLE_DRAGGABLE_NUMBER_SETTINGS_EVENT, handleSettingsUpdated);
      window.removeEventListener('storage', handleStorage);
    };
  }, [persistenceKey]);

  return revision;
}
