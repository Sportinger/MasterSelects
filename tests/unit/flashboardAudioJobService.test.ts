import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../src/stores/settingsStore';
import type { FlashBoardGenerationRequest } from '../../src/stores/flashboardStore/types';
import { flashBoardJobService } from '../../src/services/flashboard/FlashBoardJobService';

const elevenLabsMock = vi.hoisted(() => ({
  setApiKey: vi.fn(),
  createSpeech: vi.fn(),
}));

const cloudAiMock = vi.hoisted(() => ({
  createElevenLabsSpeech: vi.fn(),
  createSunoMusic: vi.fn(),
  pollSunoMusicTaskUntilComplete: vi.fn(),
}));

vi.mock('../../src/services/elevenLabsService', () => ({
  DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT: 'mp3_44100_128',
  ELEVENLABS_MP3_MIME_TYPE: 'audio/mpeg',
  elevenLabsService: elevenLabsMock,
  isElevenLabsMp3OutputFormat: (value: string) => (
    ['mp3_44100_128', 'mp3_44100_192', 'mp3_22050_32'].includes(value)
  ),
}));

vi.mock('../../src/services/cloudAiService', () => ({
  cloudAiService: cloudAiMock,
}));

function createHostedSpeechRequest(): FlashBoardGenerationRequest {
  return {
    service: 'cloud',
    providerId: 'cloud-elevenlabs-tts',
    version: 'eleven_multilingual_v2',
    outputType: 'audio',
    prompt: 'Hello from the board',
    voiceId: 'voice-1',
    voiceName: 'Narrator',
    outputFormat: 'mp3_44100_128',
    voiceSettings: {
      speed: 1,
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: true,
    },
    referenceMediaFileIds: [],
  };
}

describe('FlashBoardJobService ElevenLabs audio jobs', () => {
  beforeEach(() => {
    flashBoardJobService.setUpdateCallback(null);
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      apiKeys: {
        openai: '',
        anthropic: '',
        assemblyai: '',
        deepgram: '',
        piapi: '',
        kieai: '',
        evolink: '',
        elevenlabs: 'eleven-key',
        youtube: '',
        klingAccessKey: '',
        klingSecretKey: '',
      },
      shouldUseApiKeyByDefault: (provider) => provider === 'elevenlabs',
    } as ReturnType<typeof useSettingsStore.getState>);
    elevenLabsMock.setApiKey.mockClear();
    elevenLabsMock.createSpeech.mockReset();
    cloudAiMock.createElevenLabsSpeech.mockReset();
    cloudAiMock.createSunoMusic.mockReset();
    cloudAiMock.pollSunoMusicTaskUntilComplete.mockReset();
  });

  it('routes ElevenLabs speech through hosted Cloud AI and returns a durable audio File completion', async () => {
    cloudAiMock.createElevenLabsSpeech.mockResolvedValue({
      audio: new Blob(['mp3-bytes'], { type: 'audio/mpeg' }),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      outputFormat: 'mp3_44100_128',
      size: 9,
    });

    const completed = new Promise<Parameters<Parameters<typeof flashBoardJobService.setUpdateCallback>[0]>[1]>((resolve, reject) => {
      flashBoardJobService.setUpdateCallback((_recordId, update) => {
        if (update.status === 'completed') {
          resolve(update);
        }
        if (update.status === 'failed') {
          reject(new Error(update.error));
        }
      });
    });

    flashBoardJobService.submit({
      recordId: 'record-audio',
      request: {
        service: 'elevenlabs',
        providerId: 'elevenlabs-tts',
        version: 'eleven_multilingual_v2',
        outputType: 'audio',
        prompt: 'Hello from the board',
        voiceId: 'voice-1',
        voiceName: 'Narrator',
        outputFormat: 'mp3_44100_128',
        voiceSettings: {
          speed: 1,
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0,
          useSpeakerBoost: true,
        },
        referenceMediaFileIds: [],
      },
    });

    const update = await completed;

    expect(elevenLabsMock.setApiKey).not.toHaveBeenCalled();
    expect(elevenLabsMock.createSpeech).not.toHaveBeenCalled();
    expect(cloudAiMock.createElevenLabsSpeech).toHaveBeenCalledWith(expect.objectContaining({
      voiceId: 'voice-1',
      text: 'Hello from the board',
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
    }), expect.stringMatching(/^flashboard-audio:record-audio:/), expect.any(AbortSignal));
    expect(update.mediaType).toBe('audio');
    expect(update.assetFile).toBeInstanceOf(File);
    expect(update.assetFile?.type).toBe('audio/mpeg');
    expect(update.assetFile?.name).toMatch(/^ai_voice_narrator_hello_from_the_board_\d+\.mp3$/);
  });

  it('routes Suno music through hosted Cloud AI when Kie.ai BYO is not enabled', async () => {
    cloudAiMock.createSunoMusic.mockResolvedValue('suno-task-1');
    cloudAiMock.pollSunoMusicTaskUntilComplete.mockResolvedValue({
      createdAt: new Date(),
      id: 'suno-task-1',
      progress: 1,
      results: [{ audioUrl: 'https://cdn.example.com/song.mp3' }],
      status: 'completed',
    });

    const completed = new Promise<Parameters<Parameters<typeof flashBoardJobService.setUpdateCallback>[0]>[1]>((resolve, reject) => {
      flashBoardJobService.setUpdateCallback((_recordId, update) => {
        if (update.status === 'completed') {
          resolve(update);
        }
        if (update.status === 'failed') {
          reject(new Error(update.error));
        }
      });
    });

    flashBoardJobService.submit({
      recordId: 'record-suno',
      request: {
        service: 'suno',
        providerId: 'suno-music',
        version: 'V5',
        outputType: 'audio',
        prompt: 'A minimal synthwave intro',
        sunoCustomMode: false,
        sunoInstrumental: true,
        referenceMediaFileIds: [],
      },
    });

    const update = await completed;

    expect(cloudAiMock.createSunoMusic).toHaveBeenCalledWith(expect.objectContaining({
      instrumental: true,
      model: 'V5',
      prompt: 'A minimal synthwave intro',
    }), expect.stringMatching(/^flashboard-suno:record-suno:/), expect.any(AbortSignal));
    expect(cloudAiMock.pollSunoMusicTaskUntilComplete).toHaveBeenCalledWith(
      'suno-task-1',
      expect.any(Function),
      10000,
      900000,
      expect.any(AbortSignal),
    );
    expect(update.mediaType).toBe('audio');
    expect(update.assetUrl).toBe('https://cdn.example.com/song.mp3');
  });

  it('keeps 100 hosted jobs active before applying the local queue', () => {
    cloudAiMock.createElevenLabsSpeech.mockImplementation(() => new Promise(() => undefined));

    for (let index = 0; index <= 100; index += 1) {
      flashBoardJobService.submit({
        recordId: `record-hosted-${index}`,
        request: createHostedSpeechRequest(),
      });
    }

    expect(flashBoardJobService.getRunningCount()).toBe(100);
    expect(flashBoardJobService.getQueueLength()).toBe(1);

    for (let index = 0; index <= 100; index += 1) {
      flashBoardJobService.cancel(`record-hosted-${index}`);
    }

    expect(flashBoardJobService.getRunningCount()).toBe(0);
    expect(flashBoardJobService.getQueueLength()).toBe(0);
  });
});
