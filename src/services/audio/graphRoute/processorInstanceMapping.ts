import { hasAudioEffect } from '../../../engine/audio/AudioEffectRegistry';
import { audioMathProgram } from '../../operators/audioOperatorGraph';
import { clampAudioPan, finiteNumber } from '../../../engine/audio/audioMath';
import type { AudioGraphEffectPlanStep } from '../../../engine/audio/AudioGraphTypes';
import type { AudioEffectInstance, Effect } from '../../nodeGraph/clipGraphProjectionDomain';
import { readAudioEqRouteSettings } from './eqRouteSettings';
import { createNeutralEffectSettings, mergeEffectSettings } from './routeSettingsMath';
import type { AudioRouteEffectSettings, LiveAudioRouteProcessor } from './routeSettingsModel';

type AudioEffectInstanceWithRuntimeFlags = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

function readAudioEffectParams(
  descriptorId: string,
  params: Record<string, unknown> | undefined,
): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();

  if (descriptorId === 'audio-math') {
    settings.processors.push({ id: descriptorId, type: 'math-graph', program: audioMathProgram(params?.operatorGraph) });
    return settings;
  }

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
