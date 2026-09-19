import { describe, expect, it } from 'vitest';
import { buildAIStudioGenerationRequest } from '../../src/components/panels/ai-studio/AIStudioGenerationRequest';
import { getCatalogEntry } from '../../src/services/flashboard/FlashBoardModelCatalog';
import { createDefaultFlashBoardComposer } from '../../src/stores/flashboardStore/defaults';

describe('AI Studio generation request', () => {
  it('requires a prompt for the default image model', () => {
    const composer = createDefaultFlashBoardComposer();
    const entry = getCatalogEntry(composer.service!, composer.providerId!);

    expect(buildAIStudioGenerationRequest(composer, entry)).toEqual({
      error: 'Enter a prompt first.',
    });
  });

  it('keeps the active model settings when building the request', () => {
    const composer = {
      ...createDefaultFlashBoardComposer(),
      draftPrompt: 'A glass sculpture in soft studio light',
      aspectRatio: '3:2',
      imageSize: '2K',
    };
    const entry = getCatalogEntry(composer.service!, composer.providerId!);
    const plan = buildAIStudioGenerationRequest(composer, entry);

    expect(plan.error).toBeUndefined();
    expect(plan.request).toMatchObject({
      aspectRatio: '3:2',
      imageSize: '2K',
      outputType: 'image',
      prompt: composer.draftPrompt,
      providerId: composer.providerId,
      service: composer.service,
    });
  });

  it('uses adaptive aspect ratio for Seedance 2.5 exact-frame generation', () => {
    const composer = {
      ...createDefaultFlashBoardComposer(),
      aspectRatio: '16:9',
      draftPrompt: 'The subject turns toward the camera.',
      outputType: 'video' as const,
      providerId: 'bytedance/seedance-2-5',
      service: 'cloud' as const,
      startMediaFileId: 'start-frame-1',
    };
    const entry = getCatalogEntry(composer.service, composer.providerId);
    const plan = buildAIStudioGenerationRequest(composer, entry);

    expect(plan.error).toBeUndefined();
    expect(plan.request).toMatchObject({
      aspectRatio: 'adaptive',
      providerId: 'bytedance/seedance-2-5',
      startMediaFileId: 'start-frame-1',
    });
  });
});
