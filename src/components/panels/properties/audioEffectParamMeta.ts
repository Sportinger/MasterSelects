// Slider range, precision and unit of one audio effect parameter, shared by the desktop Audio FX
// Stack and the phone Audio effects sheet so both offer the same ranges.
import type { AudioEffectParamValue } from '../../../types/audio';

export function getParamControlMeta(
  paramName: string,
  defaultValue: AudioEffectParamValue,
): { min: number; max: number; decimals: number; suffix: string; sensitivity: number } {
  if (paramName.toLowerCase().includes('frequencyhz')) return { min: 20, max: 22000, decimals: 0, suffix: ' Hz', sensitivity: 60 };
  if (paramName === 'q') {
    const defaultQ = typeof defaultValue === 'number' ? defaultValue : 1;
    return { min: 0.1, max: Math.max(24, defaultQ * 2, 80), decimals: 2, suffix: '', sensitivity: 0.08 };
  }
  if (paramName === 'harmonics') return { min: 1, max: 8, decimals: 0, suffix: '', sensitivity: 0.1 };
  if (paramName.includes('thresholdDb')) return { min: -80, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName === 'reductionDb') return { min: 0, max: 60, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('rangeDb')) return { min: 0, max: 80, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('floorDb')) return { min: -100, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('ceilingDb')) return { min: -24, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.15 };
  if (paramName === 'targetPeakDb') return { min: -24, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.15 };
  if (paramName === 'targetRmsDb') return { min: -60, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName === 'targetLufs') return { min: -70, max: 0, decimals: 1, suffix: ' LUFS', sensitivity: 0.25 };
  if (paramName === 'maxGainDb') return { min: 0, max: 60, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('makeupGainDb') || paramName.includes('inputGainDb')) return { min: -24, max: 24, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'gainDb') return { min: -24, max: 24, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'pan') return { min: -1, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'driveDb') return { min: 0, max: 36, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'sourceChannel') return { min: 0, max: 7, decimals: 0, suffix: '', sensitivity: 0.1 };
  if (paramName === 'threshold') return { min: 0.01, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName.includes('kneeDb')) return { min: 0, max: 40, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'ratio') return { min: 1, max: 20, decimals: 2, suffix: ':1', sensitivity: 0.05 };
  if (paramName.includes('attackMs')) return { min: 0.1, max: 500, decimals: 1, suffix: ' ms', sensitivity: 1 };
  if (paramName.includes('releaseMs')) return { min: 1, max: 2000, decimals: 0, suffix: ' ms', sensitivity: 4 };
  if (paramName === 'delayMs') return { min: 1, max: 2000, decimals: 0, suffix: ' ms', sensitivity: 4 };
  if (paramName === 'feedback') return { min: 0, max: 0.95, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'mix') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'sensitivity') return { min: 0.1, max: 4, decimals: 2, suffix: '', sensitivity: 0.02 };
  if (paramName === 'toneHz') return { min: 200, max: 22000, decimals: 0, suffix: ' Hz', sensitivity: 60 };
  if (paramName === 'roomSize') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'decaySeconds') return { min: 0.1, max: 12, decimals: 2, suffix: ' s', sensitivity: 0.05 };
  if (paramName === 'damping') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (typeof defaultValue === 'number') return { min: -100, max: 100, decimals: 2, suffix: '', sensitivity: 0.5 };
  return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
}
