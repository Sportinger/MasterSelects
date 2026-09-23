export interface TemporalSampleMetadata {
  interpolation: 'nearest' | 'linear';
  samples: readonly {
    delay: number;
    currentInput: boolean;
    contributions: readonly { sourceTime: number; weight: number }[];
  }[];
}

/** Use the temporal owner's resolved PTS groups, never an FPS estimate. */
export function temporalSampleMetadata(window: { times: readonly number[];
  samples: readonly { age: number; group: number; nextGroup: number; blend: number }[] },
  factor: number, nearest: boolean): TemporalSampleMetadata {
  return { interpolation: nearest ? 'nearest' : 'linear', samples: window.samples.map(sample => ({
    delay: sample.age / factor, currentInput: sample.group === 0,
    contributions: sample.group === 0 ? [] : sample.nextGroup === sample.group || sample.blend === 0
      ? [{ sourceTime: window.times[sample.group - 1], weight: 1 }]
      : [{ sourceTime: window.times[sample.group - 1], weight: 1 - sample.blend },
        { sourceTime: window.times[sample.nextGroup - 1], weight: sample.blend }],
  })) };
}
