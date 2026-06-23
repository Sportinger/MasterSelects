import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  FLASHBOARD_PROMPT_REFINER_MODEL,
  parseSunoPromptRefinement,
  refineFlashBoardPromptHosted,
  streamRefineFlashBoardPrompt,
} from '../../../services/flashboard/FlashBoardPromptRefiner';
import type { CatalogEntry } from '../../../services/flashboard/types';
import {
  buildFlashBoardPromptRefineDeltaUpdate,
  buildFlashBoardPromptRefineErrorRestoreUpdate,
  buildFlashBoardPromptRefineFinalUpdate,
  buildFlashBoardPromptRefineInput,
  buildFlashBoardPromptRefineUndoRestoreUpdate,
  hasFlashBoardPromptRefineInput,
  type FlashBoardPromptRefineFieldUpdate,
  type SunoPromptSnapshot,
} from './FlashBoardPromptRefinePlanner';

type FlashBoardPromptRefineInputOptions = Parameters<typeof buildFlashBoardPromptRefineInput>[0];

interface UseFlashBoardPromptRefineControllerInput {
  aspectRatio: string;
  canUseByoPromptRefiner: boolean;
  canUseHostedPromptRefiner: boolean;
  closePopover: () => void;
  duration: number;
  effectiveGenerateAudio: boolean;
  getMediaFile: FlashBoardPromptRefineInputOptions['getMediaFile'];
  hasHostedSession: boolean;
  hostedAIEnabled: boolean;
  imageSize: string;
  isAudioMode: boolean;
  isSunoMode: boolean;
  mode: string;
  multiShots: boolean;
  openAiApiKey: string;
  openAuthDialog: () => void;
  openPricingDialog: () => void;
  openSettings: () => void;
  prompt: string;
  providerId: string;
  referenceBadges: FlashBoardPromptRefineInputOptions['referenceBadges'];
  selectedEntry?: CatalogEntry;
  service: CatalogEntry['service'];
  setPrompt: Dispatch<SetStateAction<string>>;
  setSunoCustomMode: Dispatch<SetStateAction<boolean>>;
  setSunoNegativeTags: Dispatch<SetStateAction<string>>;
  setSunoStyle: Dispatch<SetStateAction<string>>;
  sunoAudioWeight: number;
  sunoCustomMode: boolean;
  sunoInstrumental: boolean;
  sunoNegativeTags: string;
  sunoStyle: string;
  sunoStyleWeight: number;
  sunoVocalGender: string;
  sunoWeirdnessConstraint: number;
  version: string;
}

export function useFlashBoardPromptRefineController({
  aspectRatio,
  canUseByoPromptRefiner,
  canUseHostedPromptRefiner,
  closePopover,
  duration,
  effectiveGenerateAudio,
  getMediaFile,
  hasHostedSession,
  hostedAIEnabled,
  imageSize,
  isAudioMode,
  isSunoMode,
  mode,
  multiShots,
  openAiApiKey,
  openAuthDialog,
  openPricingDialog,
  openSettings,
  prompt,
  providerId,
  referenceBadges,
  selectedEntry,
  service,
  setPrompt,
  setSunoCustomMode,
  setSunoNegativeTags,
  setSunoStyle,
  sunoAudioWeight,
  sunoCustomMode,
  sunoInstrumental,
  sunoNegativeTags,
  sunoStyle,
  sunoStyleWeight,
  sunoVocalGender,
  sunoWeirdnessConstraint,
  version,
}: UseFlashBoardPromptRefineControllerInput) {
  const promptRefineAbortRef = useRef<AbortController | null>(null);
  const [isRefiningPrompt, setIsRefiningPrompt] = useState(false);
  const [promptRefineError, setPromptRefineError] = useState<string | null>(null);
  const [promptBeforeAiRewrite, setPromptBeforeAiRewrite] = useState<string | null>(null);
  const [sunoBeforeAiRewrite, setSunoBeforeAiRewrite] = useState<SunoPromptSnapshot | null>(null);

  const hasPromptRefineInput = hasFlashBoardPromptRefineInput({
    isSunoMode,
    prompt,
    referenceCount: referenceBadges.length,
    sunoNegativeTags,
    sunoStyle,
  });
  const promptRefineTitle = !canUseHostedPromptRefiner && !canUseByoPromptRefiner
    ? hasHostedSession
      ? 'Enable hosted credits to refine prompts'
      : 'Sign in to refine prompts with MasterSelects Cloud'
    : !hasPromptRefineInput
      ? isSunoMode
        ? 'Add lyrics, style, or a song idea first'
        : 'Add a prompt or reference image first'
      : isSunoMode
        ? `Write Suno lyrics and style with Cloud ${FLASHBOARD_PROMPT_REFINER_MODEL}`
        : `Refine prompt with Cloud ${FLASHBOARD_PROMPT_REFINER_MODEL}`;

  useEffect(() => {
    if (!promptRefineError?.startsWith('Add ')) {
      return;
    }

    if (hasPromptRefineInput) {
      setPromptRefineError(null);
    }
  }, [hasPromptRefineInput, promptRefineError]);

  const applyPromptRefineFieldUpdate = useCallback((update: FlashBoardPromptRefineFieldUpdate | null) => {
    if (!update) {
      return;
    }

    if (update.prompt !== undefined) setPrompt(update.prompt);
    if (update.sunoStyle !== undefined) setSunoStyle(update.sunoStyle);
    if (update.sunoNegativeTags !== undefined) setSunoNegativeTags(update.sunoNegativeTags);
    if (update.sunoCustomMode !== undefined) setSunoCustomMode(update.sunoCustomMode);
  }, [setPrompt, setSunoCustomMode, setSunoNegativeTags, setSunoStyle]);

  const clearPromptRefineError = useCallback(() => {
    setPromptRefineError(null);
  }, []);

  const clearPromptRefineState = useCallback(() => {
    setPromptBeforeAiRewrite(null);
    setSunoBeforeAiRewrite(null);
    setPromptRefineError(null);
  }, []);

  const handleRefinePrompt = useCallback(async () => {
    if (isAudioMode && !isSunoMode && selectedEntry?.promptRefinerProfile !== 'suno-sounds') {
      return;
    }

    closePopover();

    if (!canUseHostedPromptRefiner && !canUseByoPromptRefiner) {
      if (!hasHostedSession) {
        setPromptRefineError('Sign in to refine prompts with MasterSelects Cloud.');
        openAuthDialog();
      } else if (!hostedAIEnabled) {
        setPromptRefineError('Enable hosted credits to refine prompts.');
        openPricingDialog();
      } else {
        setPromptRefineError('Add an OpenAI API key in Settings to refine prompts.');
        openSettings();
      }
      return;
    }

    if (!selectedEntry) {
      setPromptRefineError('Choose a generation model before refining the prompt.');
      return;
    }

    if (!hasPromptRefineInput) {
      setPromptRefineError(isSunoMode ? 'Add lyrics, style, or a song idea first.' : 'Add a prompt or reference image first.');
      return;
    }

    setIsRefiningPrompt(true);
    setPromptRefineError(null);

    const previousPrompt = prompt;
    const previousSunoPrompt: SunoPromptSnapshot = {
      prompt,
      style: sunoStyle,
      negativeTags: sunoNegativeTags,
    };
    let streamedPrompt = '';
    let streamedSunoFields = false;
    promptRefineAbortRef.current?.abort();
    const abortController = new AbortController();
    promptRefineAbortRef.current = abortController;
    setPromptBeforeAiRewrite(previousPrompt);
    setSunoBeforeAiRewrite(isSunoMode ? previousSunoPrompt : null);
    if (isSunoMode) {
      setPrompt('');
      setSunoStyle('');
      setSunoNegativeTags('');
      setSunoCustomMode(true);
    } else {
      setPrompt('');
    }

    try {
      const refinerInput = buildFlashBoardPromptRefineInput({
        apiKey: openAiApiKey,
        prompt,
        entry: selectedEntry,
        service,
        providerId,
        version,
        mode,
        duration,
        aspectRatio,
        imageSize,
        generateAudio: effectiveGenerateAudio,
        getMediaFile,
        isSunoMode,
        multiShots,
        sunoStyle,
        sunoNegativeTags,
        sunoInstrumental,
        sunoCustomMode,
        sunoVocalGender,
        sunoStyleWeight,
        sunoWeirdnessConstraint,
        sunoAudioWeight,
        referenceBadges,
      });

      const refinedPrompt = canUseHostedPromptRefiner
        ? await refineFlashBoardPromptHosted(refinerInput, {
          signal: abortController.signal,
        })
        : await streamRefineFlashBoardPrompt(refinerInput, {
          signal: abortController.signal,
          onDelta: (_delta, fullText) => {
            streamedPrompt = fullText;
            const deltaUpdate = buildFlashBoardPromptRefineDeltaUpdate({
              fullText,
              isSunoMode,
              parsedSuno: isSunoMode ? parseSunoPromptRefinement(fullText) : undefined,
            });
            applyPromptRefineFieldUpdate(deltaUpdate.fields);
            if (deltaUpdate.hasSunoFields) {
              streamedSunoFields = true;
            }
          },
        });

      applyPromptRefineFieldUpdate(buildFlashBoardPromptRefineFinalUpdate({
        isSunoMode,
        parsedSuno: isSunoMode ? parseSunoPromptRefinement(refinedPrompt) : undefined,
        refinedPrompt,
      }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      applyPromptRefineFieldUpdate(buildFlashBoardPromptRefineErrorRestoreUpdate({
        isSunoMode,
        previousPrompt,
        previousSunoPrompt,
        streamedPrompt,
        streamedSunoFields,
      }));
      setPromptRefineError(error instanceof Error ? error.message : 'Failed to refine prompt.');
    } finally {
      if (promptRefineAbortRef.current === abortController) {
        promptRefineAbortRef.current = null;
      }
      setIsRefiningPrompt(false);
    }
  }, [
    applyPromptRefineFieldUpdate,
    aspectRatio,
    closePopover,
    canUseByoPromptRefiner,
    canUseHostedPromptRefiner,
    duration,
    effectiveGenerateAudio,
    getMediaFile,
    hasHostedSession,
    hasPromptRefineInput,
    hostedAIEnabled,
    imageSize,
    isAudioMode,
    isSunoMode,
    mode,
    multiShots,
    openAiApiKey,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    prompt,
    providerId,
    referenceBadges,
    selectedEntry,
    service,
    setPrompt,
    setSunoCustomMode,
    setSunoNegativeTags,
    setSunoStyle,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    version,
  ]);

  const handleRestorePromptBeforeAiRewrite = useCallback(() => {
    const restoreUpdate = buildFlashBoardPromptRefineUndoRestoreUpdate({
      isSunoMode,
      promptBeforeAiRewrite,
      sunoBeforeAiRewrite,
    });

    if (!restoreUpdate) {
      return;
    }

    promptRefineAbortRef.current?.abort();
    applyPromptRefineFieldUpdate(restoreUpdate);
    setPromptBeforeAiRewrite(null);
    setSunoBeforeAiRewrite(null);
    setPromptRefineError(null);
  }, [applyPromptRefineFieldUpdate, isSunoMode, promptBeforeAiRewrite, sunoBeforeAiRewrite]);

  useEffect(() => () => {
    promptRefineAbortRef.current?.abort();
  }, []);

  return {
    canRestorePrompt: promptBeforeAiRewrite !== null || sunoBeforeAiRewrite !== null,
    clearPromptRefineError,
    clearPromptRefineState,
    handleRefinePrompt,
    handleRestorePromptBeforeAiRewrite,
    isRefiningPrompt,
    promptRefineError,
    promptRefineTitle,
  };
}
