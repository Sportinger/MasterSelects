import { createAudioEqBand, createDefaultAudioEqParams, createTenBandGraphicAudioEqParams } from './AudioEqDefaults';
import { normalizeAudioEqParams } from './AudioEqLegacy';
import type { AudioEqAudibleStateV2, AudioEqParamsV2, AudioEqPresetKind } from './AudioEqTypes';

export interface AudioEqPreset {
  id: string;
  name: string;
  tags: string[];
  favorite: boolean;
  params: AudioEqParamsV2;
  createdAt?: string;
  updatedAt?: string;
  builtin?: boolean;
}

export type AudioEqPresetApplyMode = 'full' | 'bands' | 'settings';

function cloneAudioEqParams(params: AudioEqParamsV2 | unknown): AudioEqParamsV2 {
  return normalizeAudioEqParams({ eq: params });
}

function withAudible(audible: AudioEqAudibleStateV2, displayPatch: Partial<AudioEqParamsV2['display']> = {}): AudioEqParamsV2 {
  const params = createDefaultAudioEqParams('custom');
  return {
    ...params,
    audible,
    display: {
      ...params.display,
      ...displayPatch,
    },
  };
}

export function createAudioEqParamsForPresetKind(kind: AudioEqPresetKind): AudioEqParamsV2 {
  if (kind === '3-band') {
    const params = createDefaultAudioEqParams('custom');
    return withAudible({
      presetKind: '3-band',
      phaseMode: 'zero-latency',
      characterMode: 'clean',
      bands: [
        createAudioEqBand({ id: 'low', type: 'low-shelf', frequencyHz: 120, gainDb: 0, q: 0.9 }),
        createAudioEqBand({ id: 'mid', type: 'bell', frequencyHz: 1000, gainDb: 0, q: 1.1 }),
        createAudioEqBand({ id: 'high', type: 'high-shelf', frequencyHz: 8000, gainDb: 0, q: 0.9 }),
      ],
    }, {
      ...params.display,
      selectedBandIds: ['mid'],
    });
  }

  if (kind === 'mastering') {
    return withAudible({
      presetKind: 'mastering',
      phaseMode: 'natural',
      characterMode: 'subtle',
      bands: [
        createAudioEqBand({ id: 'sub-cut', type: 'low-cut', frequencyHz: 30, gainDb: 0, q: 0.707, slopeDbPerOct: 12 }),
        createAudioEqBand({ id: 'low-mid', type: 'bell', frequencyHz: 250, gainDb: -0.8, q: 1.2 }),
        createAudioEqBand({ id: 'presence', type: 'bell', frequencyHz: 3000, gainDb: 0.9, q: 1.1 }),
        createAudioEqBand({ id: 'air', type: 'high-shelf', frequencyHz: 12000, gainDb: 1.4, q: 0.8 }),
      ],
    }, {
      graphRangeDb: 6,
      analyzerRangeDb: 6,
      selectedBandIds: ['presence'],
    });
  }

  return createDefaultAudioEqParams(kind);
}

function createVocalCleanupParams(): AudioEqParamsV2 {
  return withAudible({
    presetKind: 'custom',
    phaseMode: 'natural',
    characterMode: 'clean',
    bands: [
      createAudioEqBand({ id: 'vocal-rumble-cut', type: 'low-cut', frequencyHz: 75, gainDb: 0, q: 0.72, slopeDbPerOct: 18 }),
      createAudioEqBand({ id: 'vocal-mud-dip', type: 'bell', frequencyHz: 260, gainDb: -3.2, q: 2.2 }),
      createAudioEqBand({ id: 'vocal-presence', type: 'bell', frequencyHz: 3100, gainDb: 2.6, q: 1.1 }),
      createAudioEqBand({ id: 'vocal-sibilance', type: 'bell', frequencyHz: 7200, gainDb: -2.8, q: 3.4, dynamic: { enabled: true, mode: 'compress', thresholdDb: -30, rangeDb: 5, ratio: 2.4, attackMs: 5, releaseMs: 90, sidechainMode: 'self' } }),
      createAudioEqBand({ id: 'vocal-air', type: 'high-shelf', frequencyHz: 11500, gainDb: 1.8, q: 0.72 }),
    ],
  }, {
    graphRangeDb: 12,
    selectedBandIds: ['vocal-presence'],
  });
}

function createSurgicalRepairParams(): AudioEqParamsV2 {
  return withAudible({
    presetKind: 'custom',
    phaseMode: 'zero-latency',
    characterMode: 'clean',
    bands: [
      createAudioEqBand({ id: 'repair-hum', type: 'notch', frequencyHz: 60, gainDb: 0, q: 16 }),
      createAudioEqBand({ id: 'repair-ring-1', type: 'bell', frequencyHz: 188, gainDb: -5.5, q: 8 }),
      createAudioEqBand({ id: 'repair-ring-2', type: 'bell', frequencyHz: 840, gainDb: -3.5, q: 6.5 }),
      createAudioEqBand({ id: 'repair-harsh', type: 'bell', frequencyHz: 4200, gainDb: -4.2, q: 7.5 }),
      createAudioEqBand({ id: 'repair-hiss', type: 'high-shelf', frequencyHz: 9800, gainDb: -2, q: 0.8 }),
    ],
  }, {
    graphRangeDb: 12,
    selectedBandIds: ['repair-harsh'],
  });
}

function createAirAndWidthParams(): AudioEqParamsV2 {
  return withAudible({
    presetKind: 'custom',
    phaseMode: 'natural',
    characterMode: 'subtle',
    bands: [
      createAudioEqBand({ id: 'air-low-trim', type: 'low-shelf', frequencyHz: 145, gainDb: -0.8, q: 0.8 }),
      createAudioEqBand({ id: 'air-presence-dip', type: 'bell', frequencyHz: 2400, gainDb: -1.2, q: 1.6 }),
      createAudioEqBand({ id: 'air-wide-lift', type: 'high-shelf', frequencyHz: 9600, gainDb: 3, q: 0.65 }),
    ],
  }, {
    graphRangeDb: 6,
    selectedBandIds: ['air-wide-lift'],
  });
}

const AUDIO_EQ_FACTORY_PRESETS: readonly AudioEqPreset[] = Object.freeze([
  {
    id: 'factory-10-band-flat',
    name: '10-Band Flat',
    tags: ['graphic', 'default'],
    favorite: false,
    builtin: true,
    params: createTenBandGraphicAudioEqParams(),
  },
  {
    id: 'factory-3-band-flat',
    name: '3-Band Flat',
    tags: ['simple', 'track'],
    favorite: false,
    builtin: true,
    params: createAudioEqParamsForPresetKind('3-band'),
  },
  {
    id: 'factory-parametric-flat',
    name: 'Parametric Flat',
    tags: ['parametric', 'single-band'],
    favorite: false,
    builtin: true,
    params: createAudioEqParamsForPresetKind('parametric'),
  },
  {
    id: 'factory-mastering-polish',
    name: 'Mastering Polish',
    tags: ['mastering', 'subtle'],
    favorite: false,
    builtin: true,
    params: createAudioEqParamsForPresetKind('mastering'),
  },
  {
    id: 'factory-vocal-cleanup',
    name: 'Vocal Cleanup',
    tags: ['voice', 'dialogue', 'dynamic'],
    favorite: false,
    builtin: true,
    params: createVocalCleanupParams(),
  },
  {
    id: 'factory-surgical-repair',
    name: 'Surgical Repair',
    tags: ['repair', 'notch', 'cleanup'],
    favorite: false,
    builtin: true,
    params: createSurgicalRepairParams(),
  },
  {
    id: 'factory-air-and-width',
    name: 'Air And Width',
    tags: ['mastering', 'air', 'high-end'],
    favorite: false,
    builtin: true,
    params: createAirAndWidthParams(),
  },
]);

export function cloneAudioEqPreset(preset: AudioEqPreset): AudioEqPreset {
  return {
    ...preset,
    tags: [...preset.tags],
    params: cloneAudioEqParams(preset.params),
  };
}

export function getAudioEqFactoryPresets(): AudioEqPreset[] {
  return AUDIO_EQ_FACTORY_PRESETS.map(cloneAudioEqPreset);
}

export function findAudioEqFactoryPreset(id: string): AudioEqPreset | null {
  const preset = AUDIO_EQ_FACTORY_PRESETS.find(candidate => candidate.id === id);
  return preset ? cloneAudioEqPreset(preset) : null;
}

export function applyAudioEqPreset(
  currentParams: AudioEqParamsV2 | unknown,
  preset: AudioEqPreset,
  mode: AudioEqPresetApplyMode = 'full',
): AudioEqParamsV2 {
  const current = cloneAudioEqParams(currentParams);
  const presetParams = cloneAudioEqParams(preset.params);

  if (mode === 'bands') {
    return {
      ...current,
      audible: {
        ...current.audible,
        presetKind: presetParams.audible.presetKind,
        bands: presetParams.audible.bands,
      },
      display: {
        ...current.display,
        selectedBandIds: presetParams.display.selectedBandIds ?? [],
      },
    };
  }

  if (mode === 'settings') {
    return {
      ...current,
      audible: {
        ...current.audible,
        phaseMode: presetParams.audible.phaseMode,
        characterMode: presetParams.audible.characterMode,
      },
      display: {
        ...current.display,
        analyzerMode: presetParams.display.analyzerMode,
        analyzerRangeDb: presetParams.display.analyzerRangeDb,
        graphRangeDb: presetParams.display.graphRangeDb,
        pianoDisplay: presetParams.display.pianoDisplay,
        showGainReduction: presetParams.display.showGainReduction,
        showPhaseCurve: presetParams.display.showPhaseCurve,
      },
    };
  }

  return presetParams;
}

export function createUserAudioEqPreset(
  input: {
    id?: string;
    name: string;
    tags?: string[];
    favorite?: boolean;
    params: AudioEqParamsV2 | unknown;
    now?: string;
  },
): AudioEqPreset {
  const now = input.now ?? new Date().toISOString();
  const normalizedName = input.name.trim() || 'Untitled EQ Preset';
  return {
    id: input.id ?? `user-eq-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: normalizedName,
    tags: input.tags?.map(tag => tag.trim()).filter(Boolean) ?? [],
    favorite: input.favorite ?? false,
    params: cloneAudioEqParams(input.params),
    createdAt: now,
    updatedAt: now,
    builtin: false,
  };
}
