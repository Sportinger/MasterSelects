import { createDefaultAudioEqDisplayState } from './AudioEqDefaults';
import { normalizeAudioEqParams } from './AudioEqLegacy';
import { addAudioEqBand, updateAudioEqBand } from './AudioEqOperations';
import { AUDIO_EQ_SCHEMA_VERSION, type AudioEqBand, type AudioEqParamsV2 } from './AudioEqTypes';

export const AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION = 1 as const;

export type AudioEqClipboardScope = 'full-curve' | 'bands';
export type AudioEqPasteMode = 'replace' | 'append' | 'merge-by-id';

export interface AudioEqClipboardPayload {
  schemaVersion: typeof AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION;
  scope: AudioEqClipboardScope;
  createdAt: string;
  sourceEffectId?: string;
  params?: AudioEqParamsV2;
  bands?: AudioEqBand[];
}

function cloneParams(params: AudioEqParamsV2 | unknown): AudioEqParamsV2 {
  return normalizeAudioEqParams({ eq: params });
}

function cloneBand(band: AudioEqBand): AudioEqBand {
  return {
    ...band,
    ...(band.channelMask ? { channelMask: [...band.channelMask] } : {}),
    ...(band.dynamic ? { dynamic: { ...band.dynamic } } : {}),
    ...(band.spectralDynamics ? { spectralDynamics: { ...band.spectralDynamics } } : {}),
  };
}

export function copyAudioEqCurve(
  params: AudioEqParamsV2 | unknown,
  sourceEffectId?: string,
  now = new Date().toISOString(),
): AudioEqClipboardPayload {
  return {
    schemaVersion: AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION,
    scope: 'full-curve',
    createdAt: now,
    ...(sourceEffectId ? { sourceEffectId } : {}),
    params: cloneParams(params),
  };
}

export function copyAudioEqBands(
  params: AudioEqParamsV2 | unknown,
  bandIds: readonly string[],
  sourceEffectId?: string,
  now = new Date().toISOString(),
): AudioEqClipboardPayload {
  const normalized = cloneParams(params);
  const selected = new Set(bandIds);
  const bands = normalized.audible.bands
    .filter(band => selected.size === 0 || selected.has(band.id))
    .map(cloneBand);

  return {
    schemaVersion: AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION,
    scope: 'bands',
    createdAt: now,
    ...(sourceEffectId ? { sourceEffectId } : {}),
    bands,
  };
}

export function serializeAudioEqClipboardPayload(payload: AudioEqClipboardPayload): string {
  return JSON.stringify(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBands(input: unknown): AudioEqBand[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const params = normalizeAudioEqParams({
    eq: {
      schemaVersion: AUDIO_EQ_SCHEMA_VERSION,
      audible: {
        presetKind: 'custom',
        phaseMode: 'zero-latency',
        characterMode: 'clean',
        bands: input,
      },
      display: createDefaultAudioEqDisplayState(),
    },
  });
  return params.audible.bands.map(cloneBand);
}

export function parseAudioEqClipboardPayload(raw: string): AudioEqClipboardPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.schemaVersion !== AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION) {
      return null;
    }

    const scope = parsed.scope === 'full-curve' || parsed.scope === 'bands'
      ? parsed.scope
      : null;
    if (!scope) {
      return null;
    }

    const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString();
    const sourceEffectId = typeof parsed.sourceEffectId === 'string' ? parsed.sourceEffectId : undefined;

    if (scope === 'full-curve') {
      return {
        schemaVersion: AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION,
        scope,
        createdAt,
        ...(sourceEffectId ? { sourceEffectId } : {}),
        params: cloneParams(parsed.params),
      };
    }

    return {
      schemaVersion: AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION,
      scope,
      createdAt,
      ...(sourceEffectId ? { sourceEffectId } : {}),
      bands: parseBands(parsed.bands),
    };
  } catch {
    return null;
  }
}

export function pasteAudioEqClipboardPayload(
  currentParams: AudioEqParamsV2 | unknown,
  payload: AudioEqClipboardPayload,
  mode: AudioEqPasteMode = 'replace',
): AudioEqParamsV2 {
  if (payload.scope === 'full-curve' && payload.params) {
    const bandPayload: AudioEqClipboardPayload = {
      schemaVersion: AUDIO_EQ_CLIPBOARD_SCHEMA_VERSION,
      scope: 'bands',
      createdAt: payload.createdAt,
      ...(payload.sourceEffectId ? { sourceEffectId: payload.sourceEffectId } : {}),
      bands: payload.params.audible.bands,
    };
    return mode === 'replace'
      ? cloneParams(payload.params)
      : pasteAudioEqClipboardPayload(currentParams, bandPayload, mode);
  }

  const bands = payload.bands?.map(cloneBand) ?? [];
  if (bands.length === 0) {
    return cloneParams(currentParams);
  }

  if (mode === 'replace') {
    const current = cloneParams(currentParams);
    return {
      ...current,
      audible: {
        ...current.audible,
        presetKind: 'custom',
        bands,
      },
      display: {
        ...current.display,
        selectedBandIds: [bands[0]?.id ?? ''],
      },
    };
  }

  if (mode === 'merge-by-id') {
    return bands.reduce((next, band) => {
      const exists = next.audible.bands.some(candidate => candidate.id === band.id);
      return exists
        ? updateAudioEqBand(next, band.id, band)
        : addAudioEqBand(next, band);
    }, cloneParams(currentParams));
  }

  return bands.reduce((next, band) => addAudioEqBand(next, band), cloneParams(currentParams));
}
