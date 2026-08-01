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
import type { ElevenLabsMp3OutputFormat } from '../../../services/elevenLabs/config';
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
  hasHostedAudioAccess: boolean;
  initialLanguageCode?: string;
  initialLanguageOverride?: boolean;
  initialOutputFormat?: string;
  initialVoiceId?: string;
  initialVoiceName?: string;
  initialVoiceSettings?: Parameters<typeof normalizeFlashBoardVoiceSettings>[0];
  isElevenLabsMode: boolean;
  setVersion: Dispatch<SetStateAction<string>>;
  version: string;
}

const HOSTED_ELEVENLABS_ACCESS_ERROR = 'Hosted ElevenLabs access is required.';

export function useFlashBoardElevenLabsController({
  hasHostedAudioAccess,
  initialLanguageCode,
  initialLanguageOverride,
  initialOutputFormat,
  initialVoiceId,
  initialVoiceName,
  initialVoiceSettings,
  isElevenLabsMode,
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
    if (!isElevenLabsMode) {
      queueMicrotask(() => {
        setElevenLabsModels([]);
        setElevenLabsModelsError(null);
        setIsLoadingElevenLabsModels(false);
      });
      return;
    }

    if (!hasHostedAudioAccess) {
      queueMicrotask(() => {
        setElevenLabsModels([]);
        setElevenLabsModelsError(HOSTED_ELEVENLABS_ACCESS_ERROR);
        setIsLoadingElevenLabsModels(false);
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setIsLoadingElevenLabsModels(true);
      setElevenLabsModelsError(null);
    });

    void cloudAiService.listElevenLabsModels()
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
    hasHostedAudioAccess,
    isElevenLabsMode,
    setVersion,
  ]);

  useEffect(() => {
    if (!isElevenLabsMode) {
      queueMicrotask(() => {
        setElevenLabsVoices([]);
        setElevenLabsVoicesError(null);
        setIsLoadingElevenLabsVoices(false);
      });
      return;
    }

    if (!hasHostedAudioAccess) {
      queueMicrotask(() => {
        setElevenLabsVoices([]);
        setElevenLabsVoicesError(HOSTED_ELEVENLABS_ACCESS_ERROR);
        setIsLoadingElevenLabsVoices(false);
      });
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsLoadingElevenLabsVoices(true);
      setElevenLabsVoicesError(null);

      const voicesParams = {
        pageSize: 20,
        search: voiceSearch.trim() || undefined,
        sort: 'name',
        sortDirection: 'asc',
      } as const;
      void cloudAiService.listElevenLabsVoices(voicesParams)
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
    hasHostedAudioAccess,
    isElevenLabsMode,
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
