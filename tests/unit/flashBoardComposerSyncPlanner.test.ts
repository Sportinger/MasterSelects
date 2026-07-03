import { describe, expect, it } from 'vitest';

import { buildFlashBoardComposerSyncPatch } from '../../src/components/panels/flashboard/FlashBoardComposerSyncPlanner';
import { createDefaultFlashBoardComposer } from '../../src/stores/flashboardStore/defaults';

describe('FlashBoardComposerSyncPlanner', () => {
  it('stores the active model settings in composer state and the per-model settings map', () => {
    const patch = buildFlashBoardComposerSyncPatch({
      aspectRatio: '9:16',
      composer: createDefaultFlashBoardComposer(),
      duration: 10,
      effectiveGenerateAudio: true,
      effectiveReferenceMediaFileIds: [],
      imageSize: '2K',
      isAudioMode: false,
      isElevenLabsMode: false,
      isSunoMode: false,
      languageCode: '',
      languageOverride: false,
      maxReferenceMedia: undefined,
      mode: '1080p',
      multiShots: false,
      normalizedMultiPrompt: [],
      outputFormat: 'mp3_44100_128',
      providerId: 'kling-3.0',
      selectedEntry: {
        outputType: 'video',
        supportsImageToVideo: true,
      },
      service: 'kieai',
      sunoAudioWeight: 0.5,
      sunoCustomMode: false,
      sunoInstrumental: false,
      sunoNegativeTags: '',
      sunoStyle: '',
      sunoStyleWeight: 0.5,
      sunoTitle: '',
      sunoVocalGender: '',
      sunoWeirdnessConstraint: 0.5,
      version: '3.0',
      voiceId: '',
      voiceName: '',
      voiceSettings: {},
      areVoiceSettingsEqual: () => true,
    });

    expect(patch).toMatchObject({
      providerId: 'kling-3.0',
      version: '3.0',
      mode: '1080p',
      duration: 10,
      aspectRatio: '9:16',
      imageSize: '2K',
      generateAudio: true,
      modelSettingsByKey: {
        'kieai:kling-3.0': {
          version: '3.0',
          mode: '1080p',
          duration: 10,
          aspectRatio: '9:16',
          imageSize: '2K',
          generateAudio: true,
          multiShots: false,
        },
      },
    });
  });
});
