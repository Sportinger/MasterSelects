export type VectorAnimationProvider = 'lottie' | 'rive';

export type VectorAnimationPlaybackMode = 'forward' | 'reverse' | 'bounce' | 'reverse-bounce';

export type VectorAnimationStateMachineInputType = 'boolean' | 'number' | 'string' | 'trigger';

export type VectorAnimationStateMachineInputValue = boolean | number | string;

export interface VectorAnimationStateMachineInput {
  name: string;
  type: VectorAnimationStateMachineInputType;
  defaultValue?: VectorAnimationStateMachineInputValue;
}

export type VectorAnimationInputProperty = `lottieInput.${string}.${string}`;
export type VectorAnimationStateProperty = `lottieState.${string}`;

export interface VectorAnimationMetadata {
  provider: VectorAnimationProvider;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  totalFrames?: number;
  animationNames?: string[];
  defaultAnimationName?: string;
  artboardNames?: string[];
  stateMachineNames?: string[];
  stateMachineStates?: Record<string, string[]>;
  stateMachineInputs?: Record<string, VectorAnimationStateMachineInput[]>;
}

export interface VectorAnimationStateCue {
  id: string;
  time: number;
  stateName: string;
  immediate?: boolean;
}

export interface VectorAnimationClipSettings {
  loop: boolean;
  endBehavior: 'hold' | 'clear' | 'loop';
  playbackMode: VectorAnimationPlaybackMode;
  fit: 'contain' | 'cover' | 'fill';
  renderWidth?: number;
  renderHeight?: number;
  backgroundColor?: string;
  animationName?: string;
  artboard?: string;
  stateMachineName?: string;
  stateMachineState?: string;
  stateMachineStateCues?: VectorAnimationStateCue[];
  stateMachineInputValues?: Record<string, VectorAnimationStateMachineInputValue>;
}

export const DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS: VectorAnimationClipSettings = {
  loop: false,
  endBehavior: 'hold',
  playbackMode: 'forward',
  fit: 'contain',
};

export function mergeVectorAnimationSettings(
  sourceSettings?: VectorAnimationClipSettings,
): VectorAnimationClipSettings {
  return {
    ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
    ...sourceSettings,
  };
}

export function shouldLoopVectorAnimation(
  sourceSettings?: VectorAnimationClipSettings,
): boolean {
  const settings = mergeVectorAnimationSettings(sourceSettings);
  return settings.loop || settings.endBehavior === 'loop';
}

export function isVectorAnimationBounceMode(
  playbackMode: VectorAnimationPlaybackMode | undefined,
): boolean {
  return playbackMode === 'bounce' || playbackMode === 'reverse-bounce';
}

export function isVectorAnimationReverseStartMode(
  playbackMode: VectorAnimationPlaybackMode | undefined,
): boolean {
  return playbackMode === 'reverse' || playbackMode === 'reverse-bounce';
}

export function normalizeVectorAnimationRenderDimension(value?: number): number | undefined {
  if (!Number.isFinite(value) || value === undefined) {
    return undefined;
  }
  const rounded = Math.round(value);
  return rounded >= 16 && rounded <= 8192 ? rounded : undefined;
}

export function normalizeVectorAnimationStateName(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeVectorAnimationStateCues(
  cues?: VectorAnimationStateCue[],
): VectorAnimationStateCue[] {
  return (cues ?? [])
    .map((cue) => ({
      ...cue,
      stateName: cue.stateName.trim(),
      time: Number.isFinite(cue.time) ? Math.max(0, cue.time) : 0,
    }))
    .filter((cue) => cue.stateName.length > 0)
    .sort((a, b) => a.time - b.time);
}

export function resolveVectorAnimationStateName(
  settings: VectorAnimationClipSettings,
  clipLocalTime: number,
): string | undefined {
  const cues = normalizeVectorAnimationStateCues(settings.stateMachineStateCues);
  if (cues.length === 0) {
    return normalizeVectorAnimationStateName(settings.stateMachineState);
  }

  const safeTime = Number.isFinite(clipLocalTime) ? Math.max(0, clipLocalTime) : 0;
  let activeCue: VectorAnimationStateCue | undefined;
  for (const cue of cues) {
    if (cue.time > safeTime + 1e-6) {
      break;
    }
    activeCue = cue;
  }

  return activeCue?.stateName ?? normalizeVectorAnimationStateName(settings.stateMachineState);
}

function encodePropertyPart(value: string): string {
  return encodeURIComponent(value).replaceAll('.', '%2E');
}

function decodePropertyPart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function createVectorAnimationInputProperty(
  stateMachineName: string,
  inputName: string,
): VectorAnimationInputProperty {
  return `lottieInput.${encodePropertyPart(stateMachineName)}.${encodePropertyPart(inputName)}` as VectorAnimationInputProperty;
}

export function createVectorAnimationStateProperty(
  stateMachineName: string,
): VectorAnimationStateProperty {
  return `lottieState.${encodePropertyPart(stateMachineName)}` as VectorAnimationStateProperty;
}

export function parseVectorAnimationInputProperty(
  property: string,
): { stateMachineName: string; inputName: string } | null {
  const parts = property.split('.');
  if (parts.length !== 3 || parts[0] !== 'lottieInput') {
    return null;
  }

  const stateMachineName = decodePropertyPart(parts[1]);
  const inputName = decodePropertyPart(parts[2]);
  if (!stateMachineName || !inputName) {
    return null;
  }

  return { stateMachineName, inputName };
}

export function parseVectorAnimationStateProperty(
  property: string,
): { stateMachineName: string } | null {
  const parts = property.split('.');
  if (parts.length !== 2 || parts[0] !== 'lottieState') {
    return null;
  }

  const stateMachineName = decodePropertyPart(parts[1]);
  if (!stateMachineName) {
    return null;
  }

  return { stateMachineName };
}

export function getVectorAnimationStateIndex(
  stateNames: readonly string[],
  stateName: string | undefined,
): number {
  if (!stateName) {
    return 0;
  }
  const index = stateNames.indexOf(stateName);
  return index >= 0 ? index : 0;
}

export function getVectorAnimationStateNameAtIndex(
  stateNames: readonly string[],
  value: number,
): string | undefined {
  if (stateNames.length === 0) {
    return undefined;
  }
  const index = Math.max(0, Math.min(stateNames.length - 1, Math.round(value)));
  return stateNames[index];
}

export function formatVectorAnimationStateLabel(stateName: string | undefined): string | undefined {
  const trimmed = stateName?.trim();
  if (!trimmed) {
    return undefined;
  }
  return /^[a-z]$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

export function getVectorAnimationStateLabelAtIndex(
  stateNames: readonly string[],
  value: number,
): string | undefined {
  return formatVectorAnimationStateLabel(getVectorAnimationStateNameAtIndex(stateNames, value));
}

export function getVectorAnimationInputDefaultValue(
  input: VectorAnimationStateMachineInput,
): VectorAnimationStateMachineInputValue {
  if (input.defaultValue !== undefined) {
    return input.defaultValue;
  }
  if (input.type === 'boolean') {
    return false;
  }
  if (input.type === 'number') {
    return 0;
  }
  return '';
}

export function coerceVectorAnimationInputValue(
  input: VectorAnimationStateMachineInput,
  value: VectorAnimationStateMachineInputValue | undefined,
): VectorAnimationStateMachineInputValue {
  const fallback = getVectorAnimationInputDefaultValue(input);

  if (input.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value >= 0.5;
    if (typeof value === 'string') return value === 'true' || value === '1';
    return fallback;
  }

  if (input.type === 'number') {
    const numericValue = typeof value === 'number'
      ? value
      : typeof value === 'boolean'
        ? Number(value)
        : Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export function vectorAnimationInputValueToNumber(
  value: VectorAnimationStateMachineInputValue | undefined,
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }
  return 0;
}

export function getVectorAnimationInputNumericValue(
  settings: VectorAnimationClipSettings,
  input: VectorAnimationStateMachineInput,
): number {
  const value = settings.stateMachineInputValues?.[input.name];
  return vectorAnimationInputValueToNumber(coerceVectorAnimationInputValue(input, value));
}
