import { describe, expect, it } from 'vitest';
import { buildAIStudioModelPatch } from '../../src/components/panels/ai-studio/AIStudioModelDefaults';
import { getCatalogEntry } from '../../src/services/flashboard/FlashBoardModelCatalog';
import { createDefaultFlashBoardComposer } from '../../src/stores/flashboardStore/defaults';

describe('AI Studio model defaults', () => {
  it('materializes displayed Seedance defaults when persisted settings are incomplete', () => {
    const entry = getCatalogEntry('cloud', 'bytedance/seedance-2-5');
    expect(entry).toBeDefined();

    const composer = {
      ...createDefaultFlashBoardComposer(),
      aspectRatio: undefined,
      duration: undefined,
      mode: undefined,
      outputType: 'video' as const,
      providerId: 'bytedance/seedance-2-5',
    };

    expect(buildAIStudioModelPatch(entry!, composer)).toMatchObject({
      aspectRatio: '16:9',
      duration: 4,
      mode: '480p',
    });
  });

  it('does not require a second click for an already selected aspect ratio', () => {
    const entry = getCatalogEntry('cloud', 'bytedance/seedance-2-5');
    expect(entry).toBeDefined();

    const composer = {
      ...createDefaultFlashBoardComposer(),
      aspectRatio: '9:16',
      duration: 13,
      mode: '720p',
      outputType: 'video' as const,
      providerId: 'bytedance/seedance-2-5',
    };

    expect(buildAIStudioModelPatch(entry!, composer)).toEqual({});
  });
});
