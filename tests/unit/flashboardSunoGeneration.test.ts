import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFlashBoardGenerationActionState } from '../../src/components/panels/flashboard/FlashBoardGenerationActionStatePlanner';
import { buildFlashBoardGenerationRequest } from '../../src/components/panels/flashboard/FlashBoardGenerationRequestPlanner';
import { sunoService } from '../../src/services/sunoService';

function buildSunoRequest(overrides: Partial<Parameters<typeof buildFlashBoardGenerationRequest>[0]> = {}) {
  return buildFlashBoardGenerationRequest({
    aspectRatio: '16:9',
    duration: 42,
    effectiveGenerateAudio: false,
    effectivePrompt: '',
    effectiveReferenceMediaFileIds: [],
    imageSize: '1K',
    isAudioRequest: true,
    isSunoRequest: true,
    languageCode: '',
    languageOverride: false,
    mode: 'std',
    multiShots: false,
    normalizedMultiPrompt: [],
    outputFormat: '',
    providerId: 'suno-music',
    selectedEntry: {
      modes: [],
      outputType: 'audio',
    },
    service: 'cloud',
    sunoAudioWeight: 0.6,
    sunoCustomMode: true,
    sunoInstrumental: true,
    sunoNegativeTags: 'harsh noise',
    sunoStyle: 'ambient piano',
    sunoStyleWeight: 0.7,
    sunoTitle: 'Quiet Light',
    sunoVocalGender: 'f',
    sunoWeirdnessConstraint: 0.4,
    version: 'V5_5',
    voiceId: '',
    voiceName: '',
    voiceSettings: {},
    ...overrides,
  });
}

describe('FlashBoard Suno generation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sunoService.setApiKey('');
  });

  it('allows a custom V5.5 instrumental request without lyrics and keeps duration', () => {
    expect(buildSunoRequest()).toMatchObject({
      duration: 42,
      prompt: '',
      sunoCustomMode: true,
      sunoInstrumental: true,
      sunoNegativeTags: 'harsh noise',
      sunoStyle: 'ambient piano',
      sunoTitle: 'ambient piano',
      sunoVocalGender: undefined,
    });
  });

  it('enables generation for custom instrumental style without lyrics', () => {
    const actionState = buildFlashBoardGenerationActionState({
      accountAuthenticated: false,
      duration: 20,
      effectiveGenerateAudio: false,
      effectivePrompt: '',
      hasElevenLabsKey: false,
      hasEvolinkKey: false,
      hasGenerationBoard: true,
      hasHostedSession: false,
      hasImageReferenceInput: false,
      hasKieAiKey: true,
      hasReferenceMediaInput: false,
      hasVideoReferenceInput: false,
      hostedAIEnabled: false,
      imageSize: '1K',
      isAudioMode: true,
      isHostedAudioMode: false,
      isSunoMode: true,
      languageCode: '',
      languageOverride: false,
      maxMultiShots: 6,
      mode: 'std',
      multiShotDurationTotal: 0,
      multiShots: false,
      normalizedMultiPrompt: [],
      providerId: 'suno-music',
      selectedElevenLabsCharacterLimit: null,
      selectedEntry: { outputType: 'audio' },
      seedanceReferenceValidationError: null,
      service: 'suno',
      sunoCustomMode: true,
      sunoInstrumental: true,
      sunoStyle: 'ambient piano',
      supportsMultiShot: false,
      usePiApiKeyByDefault: false,
      version: 'V5_5',
      voiceId: '',
    });

    expect(actionState.audioValidationError).toBeNull();
    expect(actionState.canGenerate).toBe(true);
  });

  it('omits custom-only fields in simple mode and duration outside custom V5.5', () => {
    const simpleRequest = buildSunoRequest({
      effectivePrompt: 'Dreamy instrumental study music',
      sunoCustomMode: false,
    });
    const olderCustomRequest = buildSunoRequest({ version: 'V5' });

    expect(simpleRequest).toMatchObject({
      duration: undefined,
      sunoNegativeTags: undefined,
      sunoStyle: undefined,
      sunoStyleWeight: undefined,
      sunoTitle: undefined,
      sunoWeirdnessConstraint: undefined,
    });
    expect(olderCustomRequest.duration).toBeUndefined();
  });

  it('sends the documented custom-instrumental matrix and clamps V5.5 duration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: { taskId: 'task-custom' },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    sunoService.setApiKey('test-key');

    await sunoService.createMusic({
      customMode: true,
      duration: 999,
      instrumental: true,
      model: 'V5_5',
      negativeTags: 'harsh noise',
      prompt: '',
      style: 'ambient piano',
      styleWeight: 0.7,
      title: 'Quiet Light',
      vocalGender: 'f',
      weirdnessConstraint: 0.4,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      customMode: true,
      duration: 360,
      instrumental: true,
      model: 'V5_5',
      negativeTags: 'harsh noise',
      style: 'ambient piano',
      styleWeight: 0.7,
      title: 'Quiet Light',
      weirdnessConstraint: 0.4,
    });
    expect(requestBody).not.toHaveProperty('prompt');
    expect(requestBody).not.toHaveProperty('vocalGender');
  });

  it('strips custom-only parameters from the provider request in simple mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: { taskId: 'task-simple' },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    sunoService.setApiKey('test-key');

    await sunoService.createMusic({
      customMode: false,
      duration: 60,
      instrumental: false,
      model: 'V5_5',
      negativeTags: 'ignored',
      prompt: 'Warm indie pop',
      style: 'ignored',
      styleWeight: 0.2,
      title: 'ignored',
      vocalGender: 'f',
      weirdnessConstraint: 0.8,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      customMode: false,
      instrumental: false,
      model: 'V5_5',
      prompt: 'Warm indie pop',
    });
    expect(requestBody).not.toHaveProperty('duration');
    expect(requestBody).not.toHaveProperty('negativeTags');
    expect(requestBody).not.toHaveProperty('style');
    expect(requestBody).not.toHaveProperty('styleWeight');
    expect(requestBody).not.toHaveProperty('title');
    expect(requestBody).not.toHaveProperty('vocalGender');
    expect(requestBody).not.toHaveProperty('weirdnessConstraint');
  });

  it('keeps a stream-only FIRST_SUCCESS result available for preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: {
        createTime: Date.now(),
        response: {
          sunoData: [{
            id: 'track-1',
            imageUrl: 'https://cdn.example/cover.jpg',
            streamAudioUrl: 'https://cdn.example/preview.mp3',
            title: 'Early Track',
          }],
        },
        status: 'FIRST_SUCCESS',
        taskId: 'task-preview',
      },
    }), { status: 200 })));
    sunoService.setApiKey('test-key');

    const task = await sunoService.getMusicTaskStatus('task-preview');

    expect(task).toMatchObject({
      progress: 0.75,
      status: 'processing',
      results: [{
        id: 'track-1',
        imageUrl: 'https://cdn.example/cover.jpg',
        streamAudioUrl: 'https://cdn.example/preview.mp3',
      }],
    });
  });
});
