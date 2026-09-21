import type { AudioEqBand } from '../../../engine/audio/eq/AudioEqTypes';

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
  | { id: string; type: 'math-graph'; program: import('../../operators/audioOperatorGraph').AudioMathProgram }
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
