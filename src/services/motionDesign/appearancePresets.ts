import {
  createMotionAppearanceId,
  type AppearanceItem,
  type AppearanceStack,
  type MotionLayerDefinition,
} from '../../types/motionDesign';
import {
  MOTION_MAX_APPEARANCES,
  MOTION_MAX_GRADIENT_STOPS,
} from '../../engine/motion/MotionBuffers';

export interface MotionAppearancePreset {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  items: AppearanceItem[];
}

export interface AppliedMotionAppearancePreset {
  motion: MotionLayerDefinition;
  appearanceIdMap: Record<string, string>;
  gradientStopIdMap: Record<string, string>;
}

export function createMotionAppearancePreset(
  appearance: AppearanceStack,
  name: string,
  id = createMotionAppearanceId('appearance-preset'),
): MotionAppearancePreset {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error('Appearance preset name must not be empty');
  }
  const items = clonePresetItems(appearance.items);
  validatePresetItems(items);
  return {
    schemaVersion: 1,
    id,
    name: normalizedName,
    createdAt: Date.now(),
    items,
  };
}

export function serializeMotionAppearancePreset(
  preset: MotionAppearancePreset,
): string {
  validateMotionAppearancePreset(preset);
  return JSON.stringify(structuredClone(preset));
}

export function parseMotionAppearancePreset(
  serialized: string,
): MotionAppearancePreset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Appearance preset is not valid JSON');
  }
  validateMotionAppearancePreset(parsed);
  return structuredClone(parsed);
}

export function applyMotionAppearancePreset(
  motion: MotionLayerDefinition,
  preset: MotionAppearancePreset,
): AppliedMotionAppearancePreset {
  validateMotionAppearancePreset(preset);
  const appearanceIdMap: Record<string, string> = {};
  const gradientStopIdMap: Record<string, string> = {};
  const items = preset.items.map((source): AppearanceItem => {
    const item = structuredClone(source);
    const nextAppearanceId = createMotionAppearanceId(item.kind);
    appearanceIdMap[item.id] = nextAppearanceId;
    item.id = nextAppearanceId;
    if (item.kind === 'linear-gradient' || item.kind === 'radial-gradient') {
      item.stops = item.stops.map((stop) => {
        const nextStopId = createMotionAppearanceId('stop');
        gradientStopIdMap[stop.id] = nextStopId;
        return { ...stop, id: nextStopId };
      });
    }
    return item;
  });

  return {
    motion: {
      ...motion,
      appearance: {
        version: 1,
        items,
        selectedItemId: items[items.length - 1]?.id,
      },
    },
    appearanceIdMap,
    gradientStopIdMap,
  };
}

function clonePresetItems(items: readonly AppearanceItem[]): AppearanceItem[] {
  if (items.some((item) => item.kind === 'texture-fill')) {
    throw new Error('Appearance presets cannot embed texture or media fills');
  }
  return items.map((item) => structuredClone(item));
}

function validateMotionAppearancePreset(
  value: unknown,
): asserts value is MotionAppearancePreset {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Appearance preset must be an object');
  }
  const preset = value as Partial<MotionAppearancePreset>;
  if (preset.schemaVersion !== 1) {
    throw new Error('Unsupported appearance preset schema version');
  }
  if (typeof preset.id !== 'string' || !preset.id.trim()) {
    throw new Error('Appearance preset id must not be empty');
  }
  if (typeof preset.name !== 'string' || !preset.name.trim()) {
    throw new Error('Appearance preset name must not be empty');
  }
  if (
    typeof preset.createdAt !== 'number'
    || !Number.isFinite(preset.createdAt)
  ) {
    throw new Error('Appearance preset createdAt must be finite');
  }
  if (!Array.isArray(preset.items)) {
    throw new Error('Appearance preset items must be an array');
  }
  validatePresetItems(preset.items as AppearanceItem[]);
}

function validatePresetItems(items: readonly AppearanceItem[]): void {
  if (items.length > MOTION_MAX_APPEARANCES) {
    throw new Error(
      `Appearance presets support at most ${MOTION_MAX_APPEARANCES} items`,
    );
  }
  const appearanceIds = new Set<string>();
  const stopIds = new Set<string>();
  for (const item of items) {
    if (
      !item
      || typeof item !== 'object'
      || typeof item.id !== 'string'
      || !item.id
    ) {
      throw new Error('Every appearance preset item requires an id');
    }
    if (appearanceIds.has(item.id)) {
      throw new Error(`Duplicate appearance preset item id: ${item.id}`);
    }
    appearanceIds.add(item.id);
    if (item.kind === 'texture-fill') {
      throw new Error('Appearance presets cannot embed texture or media fills');
    }
    if (
      item.kind !== 'color-fill'
      && item.kind !== 'stroke'
      && item.kind !== 'linear-gradient'
      && item.kind !== 'radial-gradient'
    ) {
      throw new Error(
        `Unsupported appearance preset item kind: ${String((item as { kind?: unknown }).kind)}`,
      );
    }
    if (!isUnitNumber(item.opacity)) {
      throw new Error(`${item.id}.opacity must be between 0 and 1`);
    }
    if (item.kind === 'color-fill' || item.kind === 'stroke') {
      validateColor(item.color, `${item.id}.color`);
    }
    if (item.kind === 'stroke') {
      if (!isFiniteNumber(item.width) || item.width < 0) {
        throw new Error(`${item.id}.width must be a non-negative number`);
      }
    }
    if (item.kind === 'linear-gradient' || item.kind === 'radial-gradient') {
      if (
        !Array.isArray(item.stops)
        || item.stops.length < 2
        || item.stops.length > MOTION_MAX_GRADIENT_STOPS
      ) {
        throw new Error(
          `${item.id} must contain 2-${MOTION_MAX_GRADIENT_STOPS} stops`,
        );
      }
      for (const stop of item.stops) {
        if (!stop.id || stopIds.has(stop.id)) {
          throw new Error(`Duplicate or missing gradient stop id: ${stop.id}`);
        }
        stopIds.add(stop.id);
        if (!isUnitNumber(stop.offset)) {
          throw new Error(`${stop.id}.offset must be between 0 and 1`);
        }
        validateColor(stop.color, `${stop.id}.color`);
      }
    }
  }
}

function validateColor(
  color: { r: number; g: number; b: number; a: number },
  fieldName: string,
): void {
  if (
    !color
    || !isUnitNumber(color.r)
    || !isUnitNumber(color.g)
    || !isUnitNumber(color.b)
    || !isUnitNumber(color.a)
  ) {
    throw new Error(`${fieldName} channels must be between 0 and 1`);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUnitNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}
