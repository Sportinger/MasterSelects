import { createAudioEqBand } from './AudioEqDefaults';
import { normalizeAudioEqParams } from './AudioEqLegacy';
import type { AudioEqBand, AudioEqParamsV2 } from './AudioEqTypes';

function uniqueBandId(baseId: string, bands: readonly AudioEqBand[]): string {
  const existing = new Set(bands.map(band => band.id));
  if (!existing.has(baseId)) {
    return baseId;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  return `${baseId}-${Date.now()}`;
}

export function addAudioEqBand(
  params: AudioEqParamsV2 | unknown,
  band: Partial<AudioEqBand> & Pick<AudioEqBand, 'frequencyHz'>,
): AudioEqParamsV2 {
  const normalized = normalizeAudioEqParams(params);
  const id = uniqueBandId(band.id ?? `band-${Math.round(band.frequencyHz)}hz`, normalized.audible.bands);
  return {
    ...normalized,
    audible: {
      ...normalized.audible,
      presetKind: 'custom',
      bands: [
        ...normalized.audible.bands,
        createAudioEqBand({ ...band, id }),
      ].slice(0, 24),
    },
    display: {
      ...normalized.display,
      selectedBandIds: [id],
    },
  };
}

export function updateAudioEqBand(
  params: AudioEqParamsV2 | unknown,
  bandId: string,
  patch: Partial<AudioEqBand>,
): AudioEqParamsV2 {
  const normalized = normalizeAudioEqParams(params);
  return {
    ...normalized,
    audible: {
      ...normalized.audible,
      presetKind: 'custom',
      bands: normalized.audible.bands.map(band => band.id === bandId
        ? createAudioEqBand({ ...band, ...patch, id: band.id, frequencyHz: patch.frequencyHz ?? band.frequencyHz })
        : band),
    },
  };
}

export function removeAudioEqBand(
  params: AudioEqParamsV2 | unknown,
  bandId: string,
): AudioEqParamsV2 {
  const normalized = normalizeAudioEqParams(params);
  return {
    ...normalized,
    audible: {
      ...normalized.audible,
      presetKind: 'custom',
      bands: normalized.audible.bands.filter(band => band.id !== bandId),
    },
    display: {
      ...normalized.display,
      selectedBandIds: (normalized.display.selectedBandIds ?? []).filter(id => id !== bandId),
      soloBandIds: (normalized.display.soloBandIds ?? []).filter(id => id !== bandId),
    },
  };
}

export function reorderAudioEqBand(
  params: AudioEqParamsV2 | unknown,
  bandId: string,
  newIndex: number,
): AudioEqParamsV2 {
  const normalized = normalizeAudioEqParams(params);
  const bands = [...normalized.audible.bands];
  const oldIndex = bands.findIndex(band => band.id === bandId);
  if (oldIndex < 0) {
    return normalized;
  }

  const [moved] = bands.splice(oldIndex, 1);
  bands.splice(Math.max(0, Math.min(bands.length, newIndex)), 0, moved);
  return {
    ...normalized,
    audible: {
      ...normalized.audible,
      presetKind: 'custom',
      bands,
    },
  };
}

export function isAudioEqAutomationOrphaned(property: string, params: AudioEqParamsV2 | unknown): boolean {
  const match = /^effect\.[^.]+\.eq\.audible\.bands\.([^.]+)\./.exec(property);
  if (!match) {
    return false;
  }

  const normalized = normalizeAudioEqParams(params);
  return !normalized.audible.bands.some(band => band.id === match[1]);
}
