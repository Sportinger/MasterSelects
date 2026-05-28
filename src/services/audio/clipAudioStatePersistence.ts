import type { ClipAudioState } from '../../types';

export function clonePersistedClipAudioState(audioState: ClipAudioState | undefined): ClipAudioState | undefined {
  if (!audioState) return undefined;

  const { stemSeparation, ...rest } = audioState;
  const cloned = structuredClone(rest) as ClipAudioState;

  if (stemSeparation) {
    const { stems, ...stemStateRest } = stemSeparation;
    cloned.stemSeparation = {
      ...structuredClone(stemStateRest),
      stems: stems.map((stem) => {
        const { waveform: _waveform, ...persistedStem } = stem;
        return structuredClone(persistedStem);
      }),
    };
  }

  return cloned;
}
