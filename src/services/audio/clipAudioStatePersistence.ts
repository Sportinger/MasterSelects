import type { ClipAudioState } from '../../types';

const MAX_PERSISTED_STEM_WAVEFORM_SAMPLES = 2048;
const STEM_WAVEFORM_QUANTIZATION = 1000;

function clonePersistedStemWaveform(waveform: readonly number[] | undefined): number[] | undefined {
  if (!waveform?.length) return undefined;

  const maxSamples = Math.min(MAX_PERSISTED_STEM_WAVEFORM_SAMPLES, waveform.length);
  const samples: number[] = [];

  for (let index = 0; index < maxSamples; index += 1) {
    const start = Math.floor((index / maxSamples) * waveform.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / maxSamples) * waveform.length));
    let clamped = 0;
    for (let sampleIndex = start; sampleIndex < Math.min(waveform.length, end); sampleIndex += 1) {
      const value = waveform[sampleIndex] ?? 0;
      if (Number.isFinite(value)) {
        clamped = Math.max(clamped, Math.max(0, Math.min(1, value)));
      }
    }
    samples.push(Math.round(clamped * STEM_WAVEFORM_QUANTIZATION) / STEM_WAVEFORM_QUANTIZATION);
  }

  return samples;
}

export function clonePersistedClipAudioState(audioState: ClipAudioState | undefined): ClipAudioState | undefined {
  if (!audioState) return undefined;

  const { stemSeparation, ...rest } = audioState;
  const cloned = structuredClone(rest) as ClipAudioState;

  if (stemSeparation) {
    const { stems, ...stemStateRest } = stemSeparation;
    cloned.stemSeparation = {
      ...structuredClone(stemStateRest),
      stems: stems.map((stem) => {
        const { waveform, ...persistedStem } = stem;
        const clonedStem = structuredClone(persistedStem);
        const persistedWaveform = clonePersistedStemWaveform(waveform);
        return persistedWaveform
          ? { ...clonedStem, waveform: persistedWaveform }
          : clonedStem;
      }),
    };
  }

  return cloned;
}
