import type { MIDIParameterBinding } from '../../types/midi';
import { applyMIDIParameterBindingValue } from './midiParameterApplicators';
import { resolveMIDIParameterCurrentValue } from './midiParameterValueResolvers';
import { resolveParameterRange } from './midiParameterUtils';

const MIDI_PARAMETER_DAMPING_TIME_CONSTANT_MS = 90;
const MIDI_PARAMETER_DAMPING_MIN_EPSILON = 0.0001;
const MIDI_PARAMETER_DAMPING_FALLBACK_DELTA_MS = 1000 / 60;
const MIDI_PARAMETER_DAMPING_MAX_DELTA_MS = 50;

interface MIDIParameterDampingState {
  binding: MIDIParameterBinding;
  currentValue: number;
  targetValue: number;
  lastTimestamp: number | null;
  frameId: number | null;
}

const dampedMIDIParameterStates = new Map<string, MIDIParameterDampingState>();

function mapMIDIValueToParameter(binding: MIDIParameterBinding, midiValue: number): number {
  const safeMIDIValue = Math.max(0, Math.min(127, Number.isFinite(midiValue) ? midiValue : 0));
  const { min, max } = resolveParameterRange(binding);
  const normalizedValue = binding.invert ? 127 - safeMIDIValue : safeMIDIValue;
  return min + (normalizedValue / 127) * (max - min);
}

function resolveDampingEpsilon(binding: MIDIParameterBinding): number {
  const { min, max } = resolveParameterRange(binding);
  return Math.max(Math.abs(max - min) * 0.0005, MIDI_PARAMETER_DAMPING_MIN_EPSILON);
}

function getDampingStepFactor(deltaMs: number): number {
  const safeDeltaMs = !Number.isFinite(deltaMs) || deltaMs <= 0
    ? MIDI_PARAMETER_DAMPING_FALLBACK_DELTA_MS
    : Math.min(deltaMs, MIDI_PARAMETER_DAMPING_MAX_DELTA_MS);

  return Math.min(1, 1 - Math.exp(-safeDeltaMs / MIDI_PARAMETER_DAMPING_TIME_CONSTANT_MS));
}

function cancelAnimationFrameIfAvailable(frameId: number | null): void {
  if (frameId === null || typeof globalThis.cancelAnimationFrame !== 'function') {
    return;
  }

  globalThis.cancelAnimationFrame(frameId);
}

export function cancelDampedMIDIParameterBinding(bindingId: string): void {
  const state = dampedMIDIParameterStates.get(bindingId);
  if (!state) {
    return;
  }

  cancelAnimationFrameIfAvailable(state.frameId);
  dampedMIDIParameterStates.delete(bindingId);
}

export function resetDampedMIDIParameterBindings(): void {
  dampedMIDIParameterStates.forEach((state) => {
    cancelAnimationFrameIfAvailable(state.frameId);
  });
  dampedMIDIParameterStates.clear();
}

function scheduleDampedMIDIParameterFrame(bindingId: string): void {
  const state = dampedMIDIParameterStates.get(bindingId);
  if (!state || state.frameId !== null) {
    return;
  }

  if (typeof globalThis.requestAnimationFrame !== 'function') {
    applyMIDIParameterBindingValue(state.binding, state.targetValue);
    dampedMIDIParameterStates.delete(bindingId);
    return;
  }

  state.frameId = globalThis.requestAnimationFrame((timestamp) => {
    runDampedMIDIParameterFrame(bindingId, timestamp);
  });
}

function runDampedMIDIParameterFrame(bindingId: string, timestamp: number): void {
  const state = dampedMIDIParameterStates.get(bindingId);
  if (!state) {
    return;
  }

  state.frameId = null;
  const deltaMs = state.lastTimestamp === null
    ? 0
    : Math.max(0, timestamp - state.lastTimestamp);
  state.lastTimestamp = timestamp;

  const epsilon = resolveDampingEpsilon(state.binding);
  const diff = state.targetValue - state.currentValue;
  if (Math.abs(diff) <= epsilon) {
    applyMIDIParameterBindingValue(state.binding, state.targetValue);
    dampedMIDIParameterStates.delete(bindingId);
    return;
  }

  const nextValue = state.currentValue + diff * getDampingStepFactor(deltaMs);
  state.currentValue = nextValue;

  const didApply = applyMIDIParameterBindingValue(state.binding, nextValue);
  if (!didApply) {
    dampedMIDIParameterStates.delete(bindingId);
    return;
  }

  if (Math.abs(state.targetValue - nextValue) <= epsilon) {
    applyMIDIParameterBindingValue(state.binding, state.targetValue);
    dampedMIDIParameterStates.delete(bindingId);
    return;
  }

  scheduleDampedMIDIParameterFrame(bindingId);
}

function startDampedMIDIParameterBinding(binding: MIDIParameterBinding, targetValue: number): void {
  const existingState = dampedMIDIParameterStates.get(binding.id);
  const currentValue = existingState?.currentValue ?? resolveMIDIParameterCurrentValue(binding, targetValue);
  const state: MIDIParameterDampingState = existingState ?? {
    binding,
    currentValue,
    targetValue,
    lastTimestamp: null,
    frameId: null,
  };

  state.binding = binding;
  state.targetValue = targetValue;
  state.currentValue = currentValue;
  dampedMIDIParameterStates.set(binding.id, state);

  if (Math.abs(targetValue - currentValue) <= resolveDampingEpsilon(binding)) {
    applyMIDIParameterBindingValue(binding, targetValue);
    cancelDampedMIDIParameterBinding(binding.id);
    return;
  }

  scheduleDampedMIDIParameterFrame(binding.id);
}

export async function triggerMIDIParameterBinding(
  binding: MIDIParameterBinding,
  midiValue: number
): Promise<void> {
  const value = mapMIDIValueToParameter(binding, midiValue);

  if (binding.damping) {
    startDampedMIDIParameterBinding(binding, value);
    return;
  }

  cancelDampedMIDIParameterBinding(binding.id);
  applyMIDIParameterBindingValue(binding, value);
}
