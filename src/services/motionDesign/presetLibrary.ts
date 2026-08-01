import {
  parseMotionAppearancePreset,
  serializeMotionAppearancePreset,
  type MotionAppearancePreset,
} from './appearancePresets';

const STORAGE_KEY = 'masterselects.motionAppearancePresets';
const STORAGE_VERSION = 1 as const;
export const MOTION_APPEARANCE_PRESET_LIBRARY_CAP = 100;

interface AppearancePresetLibraryEnvelope {
  version: typeof STORAGE_VERSION;
  presets: string[];
}

export interface MotionAppearancePresetLibraryRead {
  presets: MotionAppearancePreset[];
  warnings: string[];
}

/** User-local library only; project-embedded appearance presets are a later stage. */
export function listMotionAppearancePresets(): MotionAppearancePresetLibraryRead {
  if (typeof localStorage === 'undefined') return { presets: [], warnings: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { presets: [], warnings: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) return { presets: [], warnings: ['Appearance preset library was invalid'] };
    const warnings: string[] = [];
    const presets = parsed.presets.flatMap((serialized, index) => {
      try {
        return [parseMotionAppearancePreset(serialized)];
      } catch {
        warnings.push(`Skipped corrupt appearance preset at index ${index}`);
        return [];
      }
    });
    return { presets, warnings };
  } catch {
    return { presets: [], warnings: ['Appearance preset library could not be read'] };
  }
}

export function saveMotionAppearancePresetToLibrary(preset: MotionAppearancePreset): MotionAppearancePresetLibraryRead {
  const current = listMotionAppearancePresets();
  const presets = [...current.presets.filter((item) => item.id !== preset.id), structuredClone(preset)]
    // The library is capped at 100 presets; oldest presets are evicted.
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MOTION_APPEARANCE_PRESET_LIBRARY_CAP);
  persist(presets);
  return { presets, warnings: current.warnings };
}

export function deleteMotionAppearancePresetFromLibrary(id: string): MotionAppearancePresetLibraryRead {
  const current = listMotionAppearancePresets();
  const presets = current.presets.filter((preset) => preset.id !== id);
  persist(presets);
  return { presets, warnings: current.warnings };
}

export function getMotionAppearancePresetFromLibrary(id: string): MotionAppearancePreset | undefined {
  return listMotionAppearancePresets().presets.find((preset) => preset.id === id);
}

function persist(presets: readonly MotionAppearancePreset[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const envelope: AppearancePresetLibraryEnvelope = {
      version: STORAGE_VERSION,
      presets: presets.map((preset) => serializeMotionAppearancePreset(preset)),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage is best-effort; callers retain their in-memory result.
  }
}

function isEnvelope(value: unknown): value is AppearancePresetLibraryEnvelope {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { version?: unknown }).version === STORAGE_VERSION
    && Array.isArray((value as { presets?: unknown }).presets)
    && (value as { presets: unknown[] }).presets.every((preset) => typeof preset === 'string');
}
