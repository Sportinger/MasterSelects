import type { MIDIParameterBinding } from '../../types/midi';

export function getFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function resolveParameterRange(binding: MIDIParameterBinding): { min: number; max: number } {
  if (
    typeof binding.min === 'number' &&
    typeof binding.max === 'number' &&
    Number.isFinite(binding.min) &&
    Number.isFinite(binding.max) &&
    binding.max > binding.min
  ) {
    return { min: binding.min, max: binding.max };
  }

  const center = typeof binding.currentValue === 'number' && Number.isFinite(binding.currentValue)
    ? binding.currentValue
    : 0;
  const range = Math.max(Math.abs(center), 1) * 4;
  return {
    min: center - range / 2,
    max: center + range / 2,
  };
}

export function roundIntegerParameter(property: string, value: number): number {
  if (
    property.endsWith('.maxSplats') ||
    property.endsWith('.sortFrequency') ||
    property.endsWith('.seed') ||
    property.endsWith('.curveSegments') ||
    property.endsWith('.bevelSegments') ||
    property.endsWith('.featherQuality')
  ) {
    return Math.round(value);
  }

  return value;
}
