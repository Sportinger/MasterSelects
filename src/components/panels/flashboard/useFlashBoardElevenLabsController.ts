import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
} from '../../../stores/flashboardStore/defaults';
import { cloudAiService } from '../../../services/cloudAiService';
import {
  elevenLabsService,
  type ElevenLabsMp3OutputFormat,
} from '../../../services/elevenLabsService';
import {
  buildFlashBoardElevenLabsOptionsState,
  findFlashBoardElevenLabsVoiceById,
} from './FlashBoardElevenLabsOptionsPlanner';
import {
  areFlashBoardVoiceSettingsEqual,
  buildDefaultFlashBoardVoiceSettings,
  buildFlashBoardVoiceSelection,
  buildFlashBoardVoiceSettingNumberPatch,
  buildFlashBoardVoiceSettingsPatch,
  normalizeFlashBoardElevenLabsOutputFormat,
  normalizeFlashBoardVoiceSettings,
  type FlashBoardVoiceSettingNumberKey,
} from './FlashBoardVoiceSettingsPlanner';

interface UseFlashBoardElevenLabsControllerInput {
  elevenLabsApiKey: string;
  hasElevenLabsKey: boolean;
  hasHostedAudioAccess: boolean;
  initialLanguageCode?: string;
  initialLanguageOverride?: boolean;
  initialOutputFormat?: string;
  initialVoiceId?: string;
  initialVoiceName?: string;
  initialVoiceSettings?: Parameters<typeof normalizeFlashBoardVoiceSettings>[0];
  isElevenLabsMode: boolean;
  isHostedAudioMode: boolean;
  setVersion: Dispatch<SetStateAction<string>>;
  version: string;
}

export function useFlashBoardElevenLabsController({
  elevenLabsApiKey,
  hasElevenLabsKey,
  hasHostedAudioAccess,
  initialLanguageCode,
  initialLanguageOverride,
  initialOutputFormat,
  initialVoiceId,
  initialVoiceName,
  initialVoiceSettings,
  isElevenLabsMode,
  isHostedAudioMode,
  setVersion,
  version,
}: UseFlashBoardElevenLabsControllerInput) {
  const [voiceId, setVoiceId] = useState(initialVoiceId ?? '');
  const [voiceName, setVoiceName] = useState(initialVoiceName ?? '');
  const [languageOverride, setLanguageOverride] = useState(initialLanguageOverride ?? false);
  const [languageCode, setLanguageCode] = useState(initialLanguageCode ?? '');
  const [outputFormat, setOutputFormat] = useState<ElevenLabsMp3OutputFormat>(
    normalizeFlashBoardElevenLabsOutputFormat(initialOutputFormat),
  );
  const [voiceSettings, setVoiceSettings] = useState(
    () => normalizeFlashBoardVoiceSettings(initialVoiceSettings),
  );
  const [elevenLabsModels, setElevenLabsModels] = useState<Parameters<typeof buildFlashBoardElevenLabsOptionsState>[0]['elevenLabsModels']>([]);
  const [isLoadingElevenLabsModels, setIsLoadingElevenLabsModels] = useState(false);
  const [elevenLabsModelsError, setElevenLabsModelsError] = useState<string | null>(null);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [elevenLabsVoices, setElevenLabsVoices] = useState<Parameters<typeof buildFlashBoardElevenLabsOptionsState>[0]['elevenLabsVoices']>([]);
  const [isLoadingElevenLabsVoices, setIsLoadingElevenLabsVoices] = useState(false);
  const [elevenLabsVoicesError, setElevenLabsVoicesError] = useState<string | null>(null);
  const [voiceRefreshNonce, setVoiceRefreshNonce] = useState(0);

  const optionsState = useMemo(() => buildFlashBoardElevenLabsOptionsState({
    elevenLabsModels,
    elevenLabsModelsError,
    elevenLabsVoices,
    isLoadingElevenLabsModels,
    outputFormat,
    version,
  }), [
    elevenLabsModels,
    elevenLabsModelsError,
    elevenLabsVoices,
    isLoadingElevenLabsModels,
    outputFormat,
    version,
  ]);

  const voiceSettingsChanged = !areFlashBoardVoiceSettingsEqual(voiceSettings, DEFAULT_ELEVENLABS_VOICE_SETTINGS);

  useEffect(() => {
    const canLoadHostedAudio = isHostedAudioMode && hasHostedAudioAccess;
    const canLoadLocalAudio = !isHostedAudioMode && hasElevenLabsKey;

    if (!isElevenLabsMode || (!canLoadHostedAudio && !canLoadLocalAudio)) {
      queueMicrotask(() => {
        setElevenLabsModels([]);
        setElevenLabsModelsError(null);
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    if (!isHostedAudioMode) {
      elevenLabsService.setApiKey(elevenLabsApiKey);
    }
    queueMicrotask(() => {
      if (cancelled) return;
      setIsLoadingElevenLabsModels(true);
      setElevenLabsModelsError(null);
    });

    const modelsPromise = isHostedAudioMode
      ? cloudAiService.listElevenLabsModels()
      : elevenLabsService.listModels(controller.signal);

    void modelsPromise
      .then((models) => {
        if (cancelled) return;

        const textToSpeechModels = models.filter((model) => model.canDoTextToSpeech);
        setElevenLabsModels(textToSpeechModels);
        setVersion((current) => (
          textToSpeechModels.some((model) => model.modelId === current)
            ? current
            : textToSpeechModels[0]?.modelId ?? DEFAULT_ELEVENLABS_MODEL_ID
        ));
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Failed to load ElevenLabs models.';
        setElevenLabsModelsError(message);
        setElevenLabsModels([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingElevenLabsModels(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    elevenLabsApiKey,
    hasElevenLabsKey,
    hasHostedAudioAccess,
    isElevenLabsMode,
    isHostedAudioMode,
    setVersion,
  ]);

  useEffect(() => {
    const canLoadHostedAudio = isHostedAudioMode && hasHostedAudioAccess;
    const canLoadLocalAudio = !isHostedAudioMode && hasElevenLabsKey;

    if (!isElevenLabsMode || (!canLoadHostedAudio && !canLoadLocalAudio)) {
      queueMicrotask(() => {
        setElevenLabsVoices([]);
        setElevenLabsVoicesError(null);
      });
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      if (!isHostedAudioMode) {
        elevenLabsService.setApiKey(elevenLabsApiKey);
      }
      setIsLoadingElevenLabsVoices(true);
      setElevenLabsVoicesError(null);

      const voicesParams = {
        pageSize: 20,
        search: voiceSearch.trim() || undefined,
        sort: 'name',
        sortDirection: 'asc',
      } as const;
      const voicesPromise = isHostedAudioMode
        ? cloudAiService.listElevenLabsVoices(voicesParams)
        : elevenLabsService.listVoices(voicesParams, controller.signal);

      void voicesPromise
        .then((result) => {
          if (controller.signal.aborted) return;
          setElevenLabsVoices(result.voices);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : 'Failed to load ElevenLabs voices.';
          setElevenLabsVoicesError(message);
          setElevenLabsVoices([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoadingElevenLabsVoices(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    elevenLabsApiKey,
    hasElevenLabsKey,
    hasHostedAudioAccess,
    isElevenLabsMode,
    isHostedAudioMode,
    voiceRefreshNonce,
    voiceSearch,
  ]);

  const handleSelectVoice = useCallback((selectedVoiceId: string) => {
    const selectedVoice = findFlashBoardElevenLabsVoiceById(elevenLabsVoices, selectedVoiceId);
    if (!selectedVoice) {
      return;
    }

    const selection = buildFlashBoardVoiceSelection(selectedVoice);
    setVoiceId(selection.voiceId);
    setVoiceName(selection.name);
  }, [elevenLabsVoices]);

  const handlePreviewVoice = useCallback((previewUrl: string | undefined) => {
    if (!previewUrl) {
      return;
    }

    const audio = new Audio(previewUrl);
    audio.preload = 'none';
    void audio.play().catch(() => undefined);
  }, []);

  const handleOutputFormatChange = useCallback((value: string) => {
    setOutputFormat(normalizeFlashBoardElevenLabsOutputFormat(value));
  }, []);

  const handleVoiceSettingNumberChange = useCallback((key: FlashBoardVoiceSettingNumberKey, value: string) => {
    const patch = buildFlashBoardVoiceSettingNumberPatch(key, value);
    if (!patch) {
      return;
    }

    setVoiceSettings((current) => buildFlashBoardVoiceSettingsPatch(current, patch));
  }, []);

  const handleSpeakerBoostChange = useCallback((value: boolean) => {
    setVoiceSettings((current) => buildFlashBoardVoiceSettingsPatch(current, {
      useSpeakerBoost: value,
    }));
  }, []);

  const handleRefreshVoices = useCallback(() => {
    setVoiceRefreshNonce((current) => current + 1);
  }, []);

  const resetVoiceSettings = useCallback(() => {
    setVoiceSettings(buildDefaultFlashBoardVoiceSettings());
  }, []);

  return {
    ...optionsState,
    elevenLabsVoicesError,
    handleOutputFormatChange,
    handlePreviewVoice,
    handleRefreshVoices,
    handleSelectVoice,
    handleSpeakerBoostChange,
    handleVoiceSettingNumberChange,
    isLoadingElevenLabsVoices,
    languageCode,
    languageOverride,
    outputFormat,
    resetVoiceSettings,
    setLanguageCode,
    setLanguageOverride,
    setVoiceId,
    setVoiceName,
    setVoiceSearch,
    voiceId,
    voiceName,
    voiceSearch,
    voiceSettings,
    voiceSettingsChanged,
  };
}
