import { useCallback, useMemo, useState } from 'react';
import type {
  FlashBoardComposerState,
  FlashBoardSunoVocalGender,
} from '../../../stores/flashboardStore/types';
import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_CUSTOM_MODE,
  DEFAULT_SUNO_INSTRUMENTAL,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
} from '../../../services/sunoService';
import { getSunoStyleLimit } from './FlashBoardGenerationActionStatePlanner';
import {
  buildFallbackPrompt,
  type FlashBoardMultishotPlannerPrompt,
} from './FlashBoardMultishotPlanner';
import {
  buildFlashBoardSunoOptionsState,
  buildFlashBoardSunoTuningResetState,
  normalizeFlashBoardSunoWeight,
} from './FlashBoardSunoOptionsPlanner';

interface PromptRefineCallbacks {
  clearPromptRefineError: () => void;
  clearPromptRefineState: () => void;
}

interface PromptRefineCallbacksRef {
  current: PromptRefineCallbacks;
}

interface UseFlashBoardPromptSunoControllerInput {
  composer: FlashBoardComposerState;
  isSunoMode: boolean;
  multiShots: boolean;
  normalizedMultiPrompt: FlashBoardMultishotPlannerPrompt[];
  promptRefineCallbacksRef: PromptRefineCallbacksRef;
  version: string;
}

export function useFlashBoardPromptSunoController({
  composer,
  isSunoMode,
  multiShots,
  normalizedMultiPrompt,
  promptRefineCallbacksRef,
  version,
}: UseFlashBoardPromptSunoControllerInput) {
  const [prompt, setPrompt] = useState('');
  const [sunoCustomMode, setSunoCustomMode] = useState(composer.sunoCustomMode ?? DEFAULT_SUNO_CUSTOM_MODE);
  const [sunoInstrumental, setSunoInstrumental] = useState(composer.sunoInstrumental ?? DEFAULT_SUNO_INSTRUMENTAL);
  const [sunoStyle, setSunoStyle] = useState(composer.sunoStyle ?? '');
  const [sunoTitle] = useState(composer.sunoTitle ?? '');
  const [sunoNegativeTags, setSunoNegativeTags] = useState(composer.sunoNegativeTags ?? '');
  const [sunoVocalGender, setSunoVocalGender] = useState<FlashBoardSunoVocalGender | ''>(
    composer.sunoVocalGender ?? '',
  );
  const [sunoStyleWeight, setSunoStyleWeight] = useState(
    normalizeFlashBoardSunoWeight(composer.sunoStyleWeight, DEFAULT_SUNO_STYLE_WEIGHT),
  );
  const [sunoWeirdnessConstraint, setSunoWeirdnessConstraint] = useState(
    normalizeFlashBoardSunoWeight(composer.sunoWeirdnessConstraint, DEFAULT_SUNO_WEIRDNESS_CONSTRAINT),
  );
  const [sunoAudioWeight, setSunoAudioWeight] = useState(
    normalizeFlashBoardSunoWeight(composer.sunoAudioWeight, DEFAULT_SUNO_AUDIO_WEIGHT),
  );

  const effectivePrompt = useMemo(() => {
    const trimmedPrompt = prompt.trim();

    if (trimmedPrompt) {
      return trimmedPrompt;
    }

    if (multiShots) {
      return buildFallbackPrompt(normalizedMultiPrompt);
    }

    return '';
  }, [multiShots, normalizedMultiPrompt, prompt]);

  const sunoOptionsState = useMemo(() => buildFlashBoardSunoOptionsState({
    audioWeight: sunoAudioWeight,
    customMode: sunoCustomMode,
    instrumental: sunoInstrumental,
    modelId: version,
    styleWeight: sunoStyleWeight,
    vocalGender: sunoVocalGender,
    weirdnessConstraint: sunoWeirdnessConstraint,
  }), [
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoStyleWeight,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    version,
  ]);

  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value);
    promptRefineCallbacksRef.current.clearPromptRefineError();
  }, [promptRefineCallbacksRef]);

  const handleSunoStyleChange = useCallback((value: string) => {
    setSunoStyle(value);
    promptRefineCallbacksRef.current.clearPromptRefineError();
    if (value.trim()) {
      setSunoCustomMode(true);
    }
  }, [promptRefineCallbacksRef]);

  const handleSunoNegativeTagsChange = useCallback((value: string) => {
    setSunoNegativeTags(value);
    promptRefineCallbacksRef.current.clearPromptRefineError();
  }, [promptRefineCallbacksRef]);

  const handleClearPrompt = useCallback(() => {
    setPrompt('');
    if (isSunoMode) {
      setSunoStyle('');
      setSunoNegativeTags('');
    }
    promptRefineCallbacksRef.current.clearPromptRefineState();
  }, [isSunoMode, promptRefineCallbacksRef]);

  const handleSunoVocalGenderChange = useCallback((value: string) => {
    setSunoVocalGender(value as FlashBoardSunoVocalGender | '');
  }, []);

  const handleSunoStyleWeightChange = useCallback((value: number) => {
    setSunoStyleWeight(normalizeFlashBoardSunoWeight(value, DEFAULT_SUNO_STYLE_WEIGHT));
  }, []);

  const handleSunoWeirdnessConstraintChange = useCallback((value: number) => {
    setSunoWeirdnessConstraint(normalizeFlashBoardSunoWeight(value, DEFAULT_SUNO_WEIRDNESS_CONSTRAINT));
  }, []);

  const handleSunoAudioWeightChange = useCallback((value: number) => {
    setSunoAudioWeight(normalizeFlashBoardSunoWeight(value, DEFAULT_SUNO_AUDIO_WEIGHT));
  }, []);

  const resetSunoTuning = useCallback(() => {
    const resetState = buildFlashBoardSunoTuningResetState();
    setSunoVocalGender(resetState.vocalGender);
    setSunoStyleWeight(resetState.styleWeight);
    setSunoWeirdnessConstraint(resetState.weirdnessConstraint);
    setSunoAudioWeight(resetState.audioWeight);
  }, []);

  return {
    currentSunoModelId: sunoOptionsState.currentModelId,
    effectivePrompt,
    handleClearPrompt,
    handlePromptChange,
    handleSunoNegativeTagsChange,
    handleSunoStyleChange,
    handleSunoVocalGenderChange,
    prompt,
    resetSunoTuning,
    setPrompt,
    setSunoAudioWeight: handleSunoAudioWeightChange,
    setSunoCustomMode,
    setSunoInstrumental,
    setSunoNegativeTags,
    setSunoStyle,
    setSunoStyleWeight: handleSunoStyleWeightChange,
    setSunoWeirdnessConstraint: handleSunoWeirdnessConstraintChange,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoModelButtonLabel: sunoOptionsState.modelButtonLabel,
    sunoModeButtonLabel: sunoOptionsState.modeButtonLabel,
    sunoModelOptions: sunoOptionsState.modelOptions,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleLimit: getSunoStyleLimit(version),
    sunoStyleWeight,
    sunoTitle,
    sunoTuningChanged: sunoOptionsState.tuningChanged,
    sunoVocalGender,
    sunoVocalGenderOptions: sunoOptionsState.vocalGenderOptions,
    sunoWeirdnessConstraint,
  };
}
