import { normalizeAudioEqParams } from './AudioEqLegacy';
import type { AudioEqCharacterMode, AudioEqParamsV2 } from './AudioEqTypes';

export interface AudioEqCharacterProcessResult {
  channels: Float32Array[];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function copyFloat32Array(input: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  output.set(input);
  return output;
}

function characterSettings(mode: AudioEqCharacterMode): {
  drive: number;
  mix: number;
  asymmetry: number;
  lowMemory: number;
  toneHz: number;
} {
  switch (mode) {
    case 'subtle':
      return {
        drive: 1.18,
        mix: 0.22,
        asymmetry: 0.035,
        lowMemory: 0.055,
        toneHz: 15_000,
      };
    case 'warm':
      return {
        drive: 1.72,
        mix: 0.42,
        asymmetry: 0.09,
        lowMemory: 0.095,
        toneHz: 11_500,
      };
    case 'clean':
    default:
      return {
        drive: 1,
        mix: 0,
        asymmetry: 0,
        lowMemory: 0,
        toneHz: 20_000,
      };
  }
}

export function hasAudioEqCharacterMode(params: AudioEqParamsV2 | unknown): boolean {
  return normalizeAudioEqParams(params).audible.characterMode !== 'clean';
}

export function processAudioEqCharacterChannels(
  channels: readonly Float32Array[],
  params: AudioEqParamsV2 | unknown,
  options: { sampleRate: number },
): AudioEqCharacterProcessResult {
  const mode = normalizeAudioEqParams(params).audible.characterMode;
  if (mode === 'clean') {
    return { channels: channels.map(copyFloat32Array) };
  }

  const settings = characterSettings(mode);
  const sampleRate = Math.max(1, options.sampleRate);
  const lowAlpha = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate);
  const toneAlpha = 1 - Math.exp(-2 * Math.PI * settings.toneHz / sampleRate);
  const normalizer = Math.tanh(settings.drive + Math.abs(settings.asymmetry));
  const outputChannels = channels.map((input) => {
    const output = new Float32Array(input.length);
    let lowState = 0;
    let toneState = 0;

    for (let index = 0; index < input.length; index += 1) {
      const dry = input[index] ?? 0;
      lowState += lowAlpha * (dry - lowState);
      const driven = dry * settings.drive + lowState * settings.lowMemory + settings.asymmetry * dry * dry;
      const saturated = Math.tanh(driven) / Math.max(0.000001, normalizer);
      toneState += toneAlpha * (saturated - toneState);
      output[index] = clamp(dry * (1 - settings.mix) + toneState * settings.mix, -1.15, 1.15);
    }

    return output;
  });

  return { channels: outputChannels };
}
