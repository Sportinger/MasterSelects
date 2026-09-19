import { describe, expect, it } from 'vitest';

import {
  inspectAgentMediaGenerationModel,
  previewAgentMediaGeneration,
} from '../../src/services/flashboard/FlashBoardAgentGeneration';
import { checkToolAccess } from '../../src/services/aiTools/policy';

function inspected(value: Record<string, unknown>) {
  return value as {
    availableModels: Array<{ name: string; providerId: string }>;
    settings: {
      acceptedReferenceKinds: string[];
      aspectRatios: string[];
      constraints: string[];
      defaults: Record<string, unknown>;
      durations: number[];
      imageSizes: string[];
      modeControlLabel?: string;
      modeLabels: Record<string, string>;
      modes: string[];
      providerId: string;
      requiredReferenceMediaType?: string;
      requiresPrompt: boolean;
      requiresReferenceMedia: boolean;
      supportsGenerateAudio: boolean;
      versions: string[];
    };
    settingsToken: string;
  };
}

describe('FlashBoard agent media generation', () => {
  it('keeps the public atomic boundary kernel-only', () => {
    expect(checkToolAccess('inspectMediaGenerationModel', 'chat').allowed).toBe(false);
    expect(checkToolAccess('startMediaGeneration', 'chat').allowed).toBe(false);
    expect(checkToolAccess('inspectMediaGenerationModel', 'kernel').allowed).toBe(true);
    expect(checkToolAccess('startMediaGeneration', 'kernel').allowed).toBe(true);
  });

  it('selects Nano Banana 2 by default and returns all current settings', async () => {
    const result = inspected(await inspectAgentMediaGenerationModel({ outputType: 'image' }));

    expect(result.settings.providerId).toBe('nano-banana-2');
    expect(result.settings.versions).toContain('latest');
    expect(result.settings.imageSizes).toEqual(['1K', '2K', '4K']);
    expect(result.settings.aspectRatios).toContain('16:9');
    expect(result.settings.defaults).toMatchObject({ imageSize: '1K', version: 'latest' });
    expect(result.settingsToken).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.availableModels).toContainEqual({
      name: 'Nano Banana Pro',
      providerId: 'nano-banana-pro',
    });
  });

  it('selects Kling by default and exposes modes, durations, audio, and alternatives', async () => {
    const result = inspected(await inspectAgentMediaGenerationModel({ outputType: 'video' }));

    expect(result.settings.providerId).toBe('cloud-kling');
    expect(result.settings.modes).toEqual(['std', 'pro', '4K']);
    expect(result.settings.modeControlLabel).toBe('Resolution');
    expect(result.settings.modeLabels).toMatchObject({ std: '720p', pro: '1080p' });
    expect(result.settings.durations).toContain(15);
    expect(result.settings.supportsGenerateAudio).toBe(true);
    expect(result.settings.constraints).toContainEqual(expect.stringContaining('generateAudio=true'));
    expect(result.settings.defaults).toMatchObject({ duration: 5, mode: 'std' });
    expect(result.availableModels).toContainEqual({
      name: 'Seedance 2.0',
      providerId: 'bytedance/seedance-2',
    });

    await expect(previewAgentMediaGeneration({
      generateAudio: false,
      multiShots: true,
      outputType: 'video',
      prompt: 'Three connected cinematic shots.',
      providerId: result.settings.providerId,
      referenceMediaFileIds: [],
      settingsToken: result.settingsToken,
    })).rejects.toThrow('requires generateAudio=true');
  });

  it('describes utility-model input requirements without guessing', async () => {
    const result = inspected(await inspectAgentMediaGenerationModel({
      outputType: 'video',
      providerId: 'Topaz Video Upscale',
    }));

    expect(result.settings).toMatchObject({
      acceptedReferenceKinds: ['video-input'],
      providerId: 'topaz/video-upscale',
      requiredReferenceMediaType: 'video',
      requiresPrompt: false,
      requiresReferenceMedia: true,
    });
  });

  it('resolves an explicitly requested alternative by its display name', async () => {
    const result = inspected(await inspectAgentMediaGenerationModel({
      outputType: 'video',
      providerId: 'Seedance 2.0',
    }));

    expect(result.settings.providerId).toBe('bytedance/seedance-2');
    expect(result.settings.modes).toEqual(['480p', '720p', '1080p']);
    expect(result.settings.modeControlLabel).toBe('Resolution');
  });

  it('requires the exact inspected token and validates every chosen setting', async () => {
    const selection = inspected(await inspectAgentMediaGenerationModel({
      outputType: 'image',
      providerId: 'Nano Banana 2',
    }));
    await expect(previewAgentMediaGeneration({
      aspectRatio: '16:9',
      imageSize: '1K',
      outputType: 'image',
      prompt: 'A cinematic wide shot of a lighthouse at blue hour.',
      providerId: selection.settings.providerId,
      referenceMediaFileIds: [],
      settingsToken: selection.settingsToken,
      version: 'latest',
    })).resolves.toMatchObject({
      confirmationRequired: true,
      destination: 'AI Gen / Images',
    });

    await expect(previewAgentMediaGeneration({
      outputType: 'image',
      prompt: 'A lighthouse.',
      providerId: selection.settings.providerId,
      referenceMediaFileIds: [],
      settingsToken: `sha256:${'0'.repeat(64)}`,
    })).rejects.toThrow('were not inspected');
  });
});
