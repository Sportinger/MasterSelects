import { describe, expect, it } from 'vitest';

import type { CommonsSourceAsset } from '../../src/services/seedancePreproduction/contracts';
import { selectSeedanceGenerationAssets } from '../../src/services/seedancePreproduction/referenceSelection';

function asset(id: string, sceneId: string, options?: { imported?: boolean; selected?: boolean }): CommonsSourceAsset {
  return {
    id,
    creator: '',
    credit: '',
    description: id,
    importToken: `token-${id}`,
    license: 'CC0',
    licenseUrl: '',
    mimeType: 'image/jpeg',
    originalUrl: `https://upload.wikimedia.org/${id}.jpg`,
    pageId: id.length,
    requirementId: `requirement-${id}`,
    retrievedAt: 1,
    sceneIds: [sceneId],
    selected: options?.selected !== false,
    sourceUrl: `https://commons.wikimedia.org/${id}`,
    thumbnailUrl: `https://upload.wikimedia.org/${id}-thumb.jpg`,
    title: id,
    ...(options?.imported ? { mediaFileId: `media-${id}` } : {}),
  };
}

describe('Seedance generation reference selection', () => {
  it('fills the model limit round-robin across scenes instead of taking one scene first', () => {
    const selected = selectSeedanceGenerationAssets([
      asset('scene-1-a', 'scene-1'),
      asset('scene-1-b', 'scene-1'),
      asset('scene-2-a', 'scene-2'),
      asset('scene-2-b', 'scene-2', { imported: true }),
      asset('scene-3-a', 'scene-3'),
      asset('excluded', 'scene-4', { selected: false }),
    ], 4);

    expect(selected.map((candidate) => candidate.id)).toEqual([
      'scene-1-a',
      'scene-2-b',
      'scene-3-a',
      'scene-1-b',
    ]);
  });
});
