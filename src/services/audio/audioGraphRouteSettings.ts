import { AUDIO_EQ_BAND_PARAMS, hasAudioEffect } from '../../engine/audio/AudioEffectRegistry';
import { clampAudioPan, dbToLinearGain, finiteNumber } from '../../engine/audio/audioMath';
import { AUDIO_EQ_DEFAULT_Q, AUDIO_EQ_LEGACY_BANDS } from '../../engine/audio/eq/AudioEqDefaults';
import { normalizeAudioEqParams } from '../../engine/audio/eq/AudioEqLegacy';
import type {
  AudioEffectInstance,
  Effect,
  MasterAudioState,
  TimelineClip,
  TimelineTrack,
} from '../../types';
import type { AudioGraphEffectPlanStep } from '../../engine/audio/AudioGraphTypes';
import type { AudioEqBand } from '../../engine/audio/eq/AudioEqTypes';

export interface AudioRouteEffectSettings {
  volume: number;
  eqGains: number[];
  processors: LiveAudioRouteProcessor[];
}

export interface LiveAudioRouteSettings extends AudioRouteEffectSettings {
  muted: boolean;
  pan: number;
  master: AudioRouteEffectSettings;
}

export type LiveAudioBiquadFilterType =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'lowshelf'
  | 'highshelf'
  | 'peaking'
  | 'notch'
  | 'allpass';

export type LiveAudioRouteProcessor =
  | {
      id: string;
      type: 'pan';
      pan: number;
    }
  | {
      id: string;
      type: 'high-pass' | 'low-pass';
      frequencyHz: number;
      q: number;
    }
  | {
      id: string;
      type: 'parametric-eq';
      frequencyHz: number;
      gainDb: number;
      q: number;
    }
  | {
      id: string;
      type: 'biquad-filter';
      filterType: LiveAudioBiquadFilterType;
      frequencyHz: number;
      q: number;
      gainDb: number;
    }
  | {
      id: string;
      type: 'dynamic-eq-band';
      band: AudioEqBand;
    }
  | {
      id: string;
      type: 'hum-notch';
      frequencyHz: number;
      q: number;
      harmonics: number;
      mix: number;
    }
  | {
      id: string;
      type: 'de-click';
      threshold: number;
      ratio: number;
      mix: number;
    }
  | {
      id: string;
      type: 'noise-reduction';
      thresholdDb: number;
      reductionDb: number;
      sensitivity: number;
      attackMs: number;
      releaseMs: number;
      mix: number;
    }
  | {
      id: string;
      type: 'spectral-gate';
      thresholdDb: number;
      reductionDb: number;
      lowFrequencyHz: number;
      highFrequencyHz: number;
      attackMs: number;
      releaseMs: number;
      mix: number;
    }
  | {
      id: string;
      type: 'compressor';
      thresholdDb: number;
      ratio: number;
      kneeDb: number;
      attackMs: number;
      releaseMs: number;
      makeupGainDb: number;
    }
  | {
      id: string;
      type: 'de-esser';
      frequencyHz: number;
      thresholdDb: number;
      ratio: number;
      kneeDb: number;
      attackMs: number;
      releaseMs: number;
      makeupGainDb: number;
    }
  | {
      id: string;
      type: 'limiter';
      ceilingDb: number;
      inputGainDb: number;
    }
  | {
      id: string;
      type: 'noise-gate';
      thresholdDb: number;
      floorDb: number;
      attackMs: number;
      releaseMs: number;
    }
  | {
      id: string;
      type: 'expander';
      thresholdDb: number;
      ratio: number;
      rangeDb: number;
      attackMs: number;
      releaseMs: number;
    }
  | {
      id: string;
      type: 'delay';
      delayMs: number;
      feedback: number;
      mix: number;
      toneHz: number;
    }
  | {
      id: string;
      type: 'reverb';
      roomSize: number;
      decaySeconds: number;
      damping: number;
      mix: number;
    }
  | {
      id: string;
      type: 'saturation';
      driveDb: number;
      toneHz: number;
      mix: number;
    }
  | {
      id: string;
      type: 'polarity-invert';
      channelMode: 'all' | 'left' | 'right';
    }
  | {
      id: string;
      type: 'mono-sum' | 'channel-swap';
    }
  | {
      id: string;
      type: 'stereo-split';
      sourceChannel: number;
    };

type AudioEffectInstanceWithRuntimeFlags = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

const AUDIO_EQ_GAIN_EPSILON_DB = 0.0001;
const AUDIO_EQ_PARAM_EPSILON = 0.001;

function createNeutralEffectSettings(): AudioRouteEffectSettings {
  return {
    volume: 1,
    eqGains: new Array(AUDIO_EQ_BAND_PARAMS.length).fill(0),
    processors: [],
  };
}

function mergeEffectSettings(
  target: AudioRouteEffectSettings,
  source: AudioRouteEffectSettings,
): void {
  target.volume *= source.volume;
  for (let index = 0; index < target.eqGains.length; index += 1) {
    target.eqGains[index] += source.eqGains[index] ?? 0;
  }
  target.processors.push(...source.processors);
}

function getExactLegacyGraphicBandIndex(band: AudioEqBand): number {
  if (
    band.enabled === false ||
    band.dynamic?.enabled === true ||
    band.spectralDynamics?.enabled === true ||
    band.type !== 'bell' ||
    band.stereoMode !== 'stereo' ||
    Math.abs(band.q - AUDIO_EQ_DEFAULT_Q) > AUDIO_EQ_PARAM_EPSILON
  ) {
    return -1;
  }

  return AUDIO_EQ_LEGACY_BANDS.findIndex(legacyBand => (
    legacyBand.id === band.id &&
    Math.abs(legacyBand.frequencyHz - band.frequencyHz) <= AUDIO_EQ_PARAM_EPSILON
  ));
}

function isDynamicAudioEqGainBand(band: AudioEqBand): boolean {
  return band.dynamic?.enabled === true && (
    band.type === 'bell' ||
    band.type === 'low-shelf' ||
    band.type === 'high-shelf' ||
    band.type === 'tilt-shelf'
  );
}

function audioEqSlopeStageCount(band: AudioEqBand): number {
  if (band.brickwall === true && (band.type === 'low-cut' || band.type === 'high-cut')) {
    return 8;
  }
  const slope = Number.isFinite(band.slopeDbPerOct) ? Math.abs(band.slopeDbPerOct ?? 12) : 12;
  if (
    band.type === 'low-cut' ||
    band.type === 'high-cut' ||
    band.type === 'low-shelf' ||
    band.type === 'high-shelf'
  ) {
    return Math.max(1, Math.min(8, Math.round(slope / 12)));
  }
  return 1;
}

function cascadeLiveProcessor(
  processor: LiveAudioRouteProcessor,
  band: AudioEqBand,
): LiveAudioRouteProcessor[] {
  if (processor.type !== 'biquad-filter') return [processor];
  const stages = audioEqSlopeStageCount(band);
  if (stages <= 1) return [processor];
  return Array.from({ length: stages }, (_, index) => ({
    ...processor,
    id: `${processor.id}:stage-${index + 1}`,
    gainDb: (band.type === 'low-shelf' || band.type === 'high-shelf' || band.type === 'tilt-shelf')
      ? processor.gainDb / stages
      : processor.gainDb,
    q: Math.max(0.025, Math.min(100, processor.q * (1 + index * 0.06))),
  }));
}

function audioEqBandToLiveProcessors(band: AudioEqBand): LiveAudioRouteProcessor[] {
  if (band.enabled === false || band.stereoMode !== 'stereo') {
    return [];
  }

  if (isDynamicAudioEqGainBand(band)) {
    return [{
      id: `band:${band.id}`,
      type: 'dynamic-eq-band',
      band,
    }];
  }

  const base = {
    id: `band:${band.id}`,
    frequencyHz: band.frequencyHz,
    q: band.q,
    gainDb: band.gainDb,
  };

  if (band.type === 'bell') {
    if (Math.abs(band.gainDb) <= AUDIO_EQ_GAIN_EPSILON_DB) return [];
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'peaking' }, band);
  }

  if (band.type === 'low-shelf') {
    if (Math.abs(band.gainDb) <= AUDIO_EQ_GAIN_EPSILON_DB) return [];
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'lowshelf' }, band);
  }

  if (band.type === 'high-shelf') {
    if (Math.abs(band.gainDb) <= AUDIO_EQ_GAIN_EPSILON_DB) return [];
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'highshelf' }, band);
  }

  if (band.type === 'tilt-shelf') {
    if (Math.abs(band.gainDb) <= AUDIO_EQ_GAIN_EPSILON_DB) return [];
    return cascadeLiveProcessor({
      ...base,
      type: 'biquad-filter',
      filterType: band.gainDb >= 0 ? 'highshelf' : 'lowshelf',
    }, band);
  }

  if (band.type === 'low-cut') {
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'highpass', gainDb: 0 }, band);
  }

  if (band.type === 'high-cut') {
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'lowpass', gainDb: 0 }, band);
  }

  if (band.type === 'notch') {
    return [{ ...base, type: 'biquad-filter', filterType: 'notch', gainDb: 0 }];
  }

  if (band.type === 'band-pass') {
    return [{ ...base, type: 'biquad-filter', filterType: 'bandpass', gainDb: 0 }];
  }

  if (band.type === 'all-pass') {
    return [{ ...base, type: 'biquad-filter', filterType: 'allpass', gainDb: 0 }];
  }

  return [];
}

function readAudioEqRouteSettings(params: Record<string, unknown> | undefined): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();
  const eq = normalizeAudioEqParams(params);
  const soloBandIds = new Set(eq.display.soloBandIds ?? []);
  const soloBands = soloBandIds.size > 0
    ? eq.audible.bands.filter(band => soloBandIds.has(band.id))
    : [];
  const liveBands = soloBands.length > 0 ? soloBands : eq.audible.bands;

  for (const band of liveBands) {
    const legacyIndex = getExactLegacyGraphicBandIndex(band);
    if (legacyIndex >= 0) {
      settings.eqGains[legacyIndex] += band.gainDb;
      continue;
    }

    settings.processors.push(...audioEqBandToLiveProcessors(band));
  }

  return settings;
}

function readAudioEffectParams(
  descriptorId: string,
  params: Record<string, unknown> | undefined,
): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();

  if (descriptorId === 'audio-volume') {
    settings.volume *= Math.max(0, finiteNumber(params?.volume, 1));
    return settings;
  }

  if (descriptorId === 'audio-pan') {
    const pan = clampAudioPan(finiteNumber(params?.pan, 0));
    if (Math.abs(pan) > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'pan',
        pan,
      });
    }
    return settings;
  }

  if (descriptorId === 'audio-eq') {
    return readAudioEqRouteSettings(params);
  }

  if (descriptorId === 'audio-parametric-eq') {
    settings.processors.push({
      id: descriptorId,
      type: 'parametric-eq',
      frequencyHz: finiteNumber(params?.frequencyHz, 1000),
      gainDb: finiteNumber(params?.gainDb, 0),
      q: finiteNumber(params?.q, 1),
    });
    return settings;
  }

  if (descriptorId === 'audio-high-pass') {
    settings.processors.push({
      id: descriptorId,
      type: 'high-pass',
      frequencyHz: finiteNumber(params?.frequencyHz, 20),
      q: finiteNumber(params?.q, 0.707),
    });
    return settings;
  }

  if (descriptorId === 'audio-low-pass') {
    settings.processors.push({
      id: descriptorId,
      type: 'low-pass',
      frequencyHz: finiteNumber(params?.frequencyHz, 22000),
      q: finiteNumber(params?.q, 0.707),
    });
    return settings;
  }

  if (descriptorId === 'audio-hum-notch') {
    const mix = finiteNumber(params?.mix, 1);
    if (mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'hum-notch',
        frequencyHz: finiteNumber(params?.frequencyHz, 50),
        q: finiteNumber(params?.q, 30),
        harmonics: finiteNumber(params?.harmonics, 2),
        mix,
      });
    }
    return settings;
  }

  if (descriptorId === 'audio-de-click') {
    const mix = finiteNumber(params?.mix, 1);
    if (mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'de-click',
        threshold: finiteNumber(params?.threshold, 0.35),
        ratio: finiteNumber(params?.ratio, 4),
        mix,
      });
    }
    return settings;
  }

  if (descriptorId === 'audio-noise-reduction') {
    const reductionDb = finiteNumber(params?.reductionDb, 0);
    const mix = finiteNumber(params?.mix, 0);
    if (reductionDb > 0.0001 && mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'noise-reduction',
        thresholdDb: finiteNumber(params?.thresholdDb, -60),
        reductionDb,
        sensitivity: finiteNumber(params?.sensitivity, 1),
        attackMs: finiteNumber(params?.attackMs, 5),
        releaseMs: finiteNumber(params?.releaseMs, 160),
        mix,
      });
    }
    return settings;
  }

  if (descriptorId === 'audio-spectral-gate') {
    const reductionDb = finiteNumber(params?.reductionDb, 0);
    const mix = finiteNumber(params?.mix, 1);
    if (reductionDb > 0.0001 && mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'spectral-gate',
        thresholdDb: finiteNumber(params?.thresholdDb, -60),
        reductionDb,
        lowFrequencyHz: finiteNumber(params?.lowFrequencyHz, 250),
        highFrequencyHz: finiteNumber(params?.highFrequencyHz, 5000),
        attackMs: finiteNumber(params?.attackMs, 8),
        releaseMs: finiteNumber(params?.releaseMs, 180),
        mix,
      });
    }
    return settings;
  }

  if (descriptorId === 'audio-compressor') {
    settings.processors.push({
      id: descriptorId,
      type: 'compressor',
      thresholdDb: finiteNumber(params?.thresholdDb, 0),
      ratio: finiteNumber(params?.ratio, 1),
      kneeDb: finiteNumber(params?.kneeDb, 0),
      attackMs: finiteNumber(params?.attackMs, 10),
      releaseMs: finiteNumber(params?.releaseMs, 120),
      makeupGainDb: finiteNumber(params?.makeupGainDb, 0),
    });
  }

  if (descriptorId === 'audio-de-esser') {
    settings.processors.push({
      id: descriptorId,
      type: 'de-esser',
      frequencyHz: finiteNumber(params?.frequencyHz, 6500),
      thresholdDb: finiteNumber(params?.thresholdDb, 0),
      ratio: finiteNumber(params?.ratio, 1),
      kneeDb: finiteNumber(params?.kneeDb, 6),
      attackMs: finiteNumber(params?.attackMs, 1),
      releaseMs: finiteNumber(params?.releaseMs, 80),
      makeupGainDb: finiteNumber(params?.makeupGainDb, 0),
    });
  }

  if (descriptorId === 'audio-limiter') {
    settings.processors.push({
      id: descriptorId,
      type: 'limiter',
      ceilingDb: finiteNumber(params?.ceilingDb, 0),
      inputGainDb: finiteNumber(params?.inputGainDb, 0),
    });
  }

  if (descriptorId === 'audio-noise-gate') {
    settings.processors.push({
      id: descriptorId,
      type: 'noise-gate',
      thresholdDb: finiteNumber(params?.thresholdDb, -120),
      floorDb: finiteNumber(params?.floorDb, -80),
      attackMs: finiteNumber(params?.attackMs, 2),
      releaseMs: finiteNumber(params?.releaseMs, 80),
    });
  }

  if (descriptorId === 'audio-expander') {
    const ratio = finiteNumber(params?.ratio, 1);
    const rangeDb = finiteNumber(params?.rangeDb, 0);
    if (ratio > 1.0001 && rangeDb > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'expander',
        thresholdDb: finiteNumber(params?.thresholdDb, 0),
        ratio,
        rangeDb,
        attackMs: finiteNumber(params?.attackMs, 2),
        releaseMs: finiteNumber(params?.releaseMs, 120),
      });
    }
  }

  if (descriptorId === 'audio-delay') {
    const mix = finiteNumber(params?.mix, 0);
    if (mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'delay',
        delayMs: finiteNumber(params?.delayMs, 250),
        feedback: finiteNumber(params?.feedback, 0),
        mix,
        toneHz: finiteNumber(params?.toneHz, 12000),
      });
    }
  }

  if (descriptorId === 'audio-reverb') {
    const mix = finiteNumber(params?.mix, 0);
    if (mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'reverb',
        roomSize: finiteNumber(params?.roomSize, 0.35),
        decaySeconds: finiteNumber(params?.decaySeconds, 1.2),
        damping: finiteNumber(params?.damping, 0.35),
        mix,
      });
    }
  }

  if (descriptorId === 'audio-saturation') {
    const mix = finiteNumber(params?.mix, 0);
    if (mix > 0.0001) {
      settings.processors.push({
        id: descriptorId,
        type: 'saturation',
        driveDb: finiteNumber(params?.driveDb, 0),
        toneHz: finiteNumber(params?.toneHz, 16000),
        mix,
      });
    }
  }

  if (descriptorId === 'audio-polarity-invert') {
    const rawMode = params?.channelMode;
    settings.processors.push({
      id: descriptorId,
      type: 'polarity-invert',
      channelMode: rawMode === 'left' || rawMode === 'right' ? rawMode : 'all',
    });
  }

  if (descriptorId === 'audio-mono-sum') {
    settings.processors.push({
      id: descriptorId,
      type: 'mono-sum',
    });
  }

  if (descriptorId === 'audio-channel-swap') {
    settings.processors.push({
      id: descriptorId,
      type: 'channel-swap',
    });
  }

  if (descriptorId === 'audio-stereo-split') {
    settings.processors.push({
      id: descriptorId,
      type: 'stereo-split',
      sourceChannel: finiteNumber(params?.sourceChannel, 0),
    });
  }

  return settings;
}

export function getTrackAudioMuted(track: TimelineTrack): boolean {
  return track.audioState?.muted ?? track.muted === true;
}

export function getTrackAudioSolo(track: TimelineTrack): boolean {
  return track.audioState?.solo ?? track.solo === true;
}

export function getTrackVolumeDb(track: TimelineTrack): number {
  return finiteNumber(track.audioState?.volumeDb, 0);
}

export function getTrackPan(track: TimelineTrack): number {
  return clampAudioPan(track.audioState?.pan);
}

function getTrackSendReturnGain(track: TimelineTrack, trackVolume: number): number {
  return (track.audioState?.sends ?? []).reduce((total, send) => {
    if (send.enabled === false) return total;
    const sendGain = dbToLinearGain(send.gainDb);
    const faderGain = send.preFader ? 1 : trackVolume;
    return total + sendGain * faderGain;
  }, 0);
}

function assignProcessorOwnerId(
  processor: LiveAudioRouteProcessor,
  ownerId: string,
  descriptorId: string,
): LiveAudioRouteProcessor {
  return {
    ...processor,
    id: processor.id === descriptorId ? ownerId : `${ownerId}:${processor.id}`,
  };
}

export function collectLegacyAudioEffectRouteSettings(
  effects: readonly Effect[] | undefined,
  excludedIds: ReadonlySet<string> = new Set(),
): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();

  for (const effect of effects ?? []) {
    if (excludedIds.has(effect.id)) continue;
    if (effect.enabled === false || !hasAudioEffect(effect.type)) continue;
    const effectSettings = readAudioEffectParams(effect.type, effect.params);
    effectSettings.processors = effectSettings.processors.map(processor => (
      assignProcessorOwnerId(processor, effect.id, effect.type)
    ));
    mergeEffectSettings(settings, effectSettings);
  }

  return settings;
}

export function collectAudioEffectInstanceRouteSettings(
  effects: readonly AudioEffectInstance[] | undefined,
): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();

  for (const effect of effects ?? []) {
    const runtimeEffect = effect as AudioEffectInstanceWithRuntimeFlags;
    if (
      runtimeEffect.enabled === false
      || runtimeEffect.disabled === true
      || runtimeEffect.bypassed === true
      || !hasAudioEffect(runtimeEffect.descriptorId)
    ) {
      continue;
    }
    const effectSettings = readAudioEffectParams(runtimeEffect.descriptorId, runtimeEffect.params);
    effectSettings.processors = effectSettings.processors.map(processor => (
      assignProcessorOwnerId(processor, runtimeEffect.id, runtimeEffect.descriptorId)
    ));
    mergeEffectSettings(settings, effectSettings);
  }

  return settings;
}

export function audioGraphPlanStepsToEffectInstances(
  steps: readonly AudioGraphEffectPlanStep[] | undefined,
): AudioEffectInstance[] {
  return (steps ?? [])
    .filter(step => hasAudioEffect(step.descriptorId))
    .map(step => {
      const params: AudioEffectInstance['params'] = {};
      for (const [paramName, value] of Object.entries(step.params)) {
        params[paramName] = value;
      }

      return {
        id: step.effectId,
        descriptorId: step.descriptorId,
        enabled: true,
        params,
        automationMode: step.automationMode,
      };
    });
}

export function createLiveAudioRouteSettings(input: {
  clip: TimelineClip;
  track?: TimelineTrack;
  masterAudioState?: MasterAudioState;
  interpolatedClipEffects: readonly Effect[];
}): LiveAudioRouteSettings {
  const clipAudioEffectIds = new Set((input.clip.audioState?.effectStack ?? []).map(effect => effect.id));
  const clipAudioSettings = collectAudioEffectInstanceRouteSettings(input.clip.audioState?.effectStack);
  const legacyClipSettings = collectLegacyAudioEffectRouteSettings(input.interpolatedClipEffects, clipAudioEffectIds);
  const trackEffectSettings = collectAudioEffectInstanceRouteSettings(input.track?.audioState?.effectStack);
  const masterEffectSettings = collectAudioEffectInstanceRouteSettings(input.masterAudioState?.effectStack);

  const route = createNeutralEffectSettings();
  mergeEffectSettings(route, clipAudioSettings);
  mergeEffectSettings(route, legacyClipSettings);
  mergeEffectSettings(route, trackEffectSettings);

  const trackVolume = input.track ? dbToLinearGain(getTrackVolumeDb(input.track)) : 1;
  const sendReturnGain = input.track ? getTrackSendReturnGain(input.track, trackVolume) : 0;
  const masterVolume = dbToLinearGain(input.masterAudioState?.volumeDb);

  route.volume *= trackVolume + sendReturnGain;
  masterEffectSettings.volume *= masterVolume;

  return {
    ...route,
    master: masterEffectSettings,
    muted: input.clip.audioState?.muted === true || (input.track ? getTrackAudioMuted(input.track) : false),
    pan: input.track ? getTrackPan(input.track) : 0,
  };
}
