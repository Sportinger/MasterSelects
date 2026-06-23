import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_MODEL_ID,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
  SUNO_MODEL_IDS,
  type SunoModelId,
  type SunoVocalGender,
} from '../../../services/sunoService';

export interface FlashBoardSunoOption {
  id: string;
  label: string;
}

export interface FlashBoardSunoOptionsState {
  currentModelId: SunoModelId;
  modelButtonLabel: string;
  modeButtonLabel: string;
  modelOptions: FlashBoardSunoOption[];
  tuningChanged: boolean;
  vocalGenderOptions: FlashBoardSunoOption[];
}

export interface FlashBoardSunoTuningResetState {
  audioWeight: number;
  styleWeight: number;
  vocalGender: '';
  weirdnessConstraint: number;
}

interface BuildFlashBoardSunoOptionsStateInput {
  audioWeight: number;
  customMode: boolean;
  instrumental: boolean;
  modelId: string | undefined;
  styleWeight: number;
  vocalGender: SunoVocalGender | '';
  weirdnessConstraint: number;
}

const SUNO_MODEL_LABELS: Record<SunoModelId, string> = {
  V5_5: 'V5.5',
  V5: 'V5',
  V4_5PLUS: 'V4.5+',
  V4_5: 'V4.5',
  V4: 'V4',
};

const SUNO_VOCAL_GENDER_OPTIONS: FlashBoardSunoOption[] = [
  { id: 'f', label: 'Female' },
  { id: 'm', label: 'Male' },
];

export function normalizeFlashBoardSunoWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 100) / 100;
}

export function normalizeFlashBoardSunoModel(value: string | undefined): SunoModelId {
  return value && SUNO_MODEL_IDS.includes(value as SunoModelId)
    ? value as SunoModelId
    : DEFAULT_SUNO_MODEL_ID;
}

export function buildFlashBoardSunoOptionsState({
  audioWeight,
  customMode,
  instrumental,
  modelId,
  styleWeight,
  vocalGender,
  weirdnessConstraint,
}: BuildFlashBoardSunoOptionsStateInput): FlashBoardSunoOptionsState {
  const currentModelId = normalizeFlashBoardSunoModel(modelId);
  const normalizedAudioWeight = normalizeFlashBoardSunoWeight(audioWeight, DEFAULT_SUNO_AUDIO_WEIGHT);
  const normalizedStyleWeight = normalizeFlashBoardSunoWeight(styleWeight, DEFAULT_SUNO_STYLE_WEIGHT);
  const normalizedWeirdnessConstraint = normalizeFlashBoardSunoWeight(
    weirdnessConstraint,
    DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
  );
  const modeButtonLabel = customMode
    ? instrumental ? 'Custom inst.' : 'Custom song'
    : instrumental ? 'Simple inst.' : 'Simple song';

  return {
    currentModelId,
    modelButtonLabel: SUNO_MODEL_LABELS[currentModelId] ?? currentModelId,
    modeButtonLabel,
    modelOptions: SUNO_MODEL_IDS.map((model) => ({
      id: model,
      label: SUNO_MODEL_LABELS[model] ?? model,
    })),
    tuningChanged: normalizedStyleWeight !== DEFAULT_SUNO_STYLE_WEIGHT
      || normalizedWeirdnessConstraint !== DEFAULT_SUNO_WEIRDNESS_CONSTRAINT
      || normalizedAudioWeight !== DEFAULT_SUNO_AUDIO_WEIGHT
      || vocalGender !== '',
    vocalGenderOptions: SUNO_VOCAL_GENDER_OPTIONS,
  };
}

export function buildFlashBoardSunoTuningResetState(): FlashBoardSunoTuningResetState {
  return {
    audioWeight: DEFAULT_SUNO_AUDIO_WEIGHT,
    styleWeight: DEFAULT_SUNO_STYLE_WEIGHT,
    vocalGender: '',
    weirdnessConstraint: DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
  };
}
