import { audioGraphPlanStepsToEffectInstances } from '../../../services/audio/audioGraphRouteSettings';
import { analyzeAudioBufferLoudnessSummary } from '../../../services/audio/LoudnessEnvelopeGenerator';
import { AudioEffectRenderer } from '../AudioEffectRenderer';
import type { AudioGraphRenderPlan } from '../AudioGraphTypes';
import { dbToLinearGain } from '../audioMath';
import type { AudioMixer } from '../AudioMixer';
import type { AudioExportProgressSink } from './progress';

export interface RenderMasterBusAudioOptions {
  mixedBuffer: AudioBuffer;
  audioGraphPlan: AudioGraphRenderPlan;
  graphEffectRenderer: AudioEffectRenderer;
  mixer: AudioMixer;
  normalize: boolean;
  shouldCancel: () => boolean;
  onProgress?: AudioExportProgressSink;
}

export async function renderExportMasterBusAudio(options: RenderMasterBusAudioOptions): Promise<AudioBuffer> {
  if (options.shouldCancel()) return options.mixedBuffer;

  const masterEffects = audioGraphPlanStepsToEffectInstances(options.audioGraphPlan.master.effectChain);
  let masteredBuffer = options.mixedBuffer;

  if (masterEffects.length > 0) {
    options.onProgress?.({ phase: 'effects', percent: 95, message: 'Rendering master audio effects...' });
    masteredBuffer = await options.graphEffectRenderer.renderEffectInstances(
      options.mixedBuffer,
      masterEffects,
      [],
      options.mixedBuffer.duration
    );
  }

  options.mixer.processMasterBuffer(masteredBuffer, {
    normalize: false,
    masterVolumeDb: options.audioGraphPlan.master.volumeDb,
    masterLimiterEnabled: false,
  });

  const targetGainDb = applyTargetLoudness(masteredBuffer, options.audioGraphPlan.master.targetLufs);
  if (targetGainDb !== null) {
    options.onProgress?.({
      phase: 'effects',
      percent: 97,
      message: `Applying target loudness: ${targetGainDb >= 0 ? '+' : ''}${targetGainDb.toFixed(2)} dB`,
    });
  }

  return options.mixer.processMasterBuffer(masteredBuffer, {
    normalize: options.normalize,
    masterVolumeDb: 0,
    masterLimiterEnabled: options.audioGraphPlan.master.limiterEnabled,
    masterTruePeakCeilingDb: options.audioGraphPlan.master.truePeakCeilingDb,
  });
}

function applyTargetLoudness(buffer: AudioBuffer, targetLufs: number | undefined): number | null {
  if (typeof targetLufs !== 'number' || !Number.isFinite(targetLufs)) {
    return null;
  }

  const summary = analyzeAudioBufferLoudnessSummary(buffer);
  const integratedLufs = summary.integratedLufs;
  if (typeof integratedLufs !== 'number' || !Number.isFinite(integratedLufs) || integratedLufs <= -90) {
    return null;
  }

  const gainDb = Math.max(-24, Math.min(24, targetLufs - integratedLufs));
  if (Math.abs(gainDb) <= 0.05) {
    return null;
  }

  const gain = dbToLinearGain(gainDb);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < data.length; sampleIndex += 1) {
      data[sampleIndex] *= gain;
    }
  }

  return gainDb;
}
