import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultFlashBoardComposer } from '../../src/stores/flashboardStore';
import { setFlashBoardGuidedMode } from '../../src/services/flashboard/FlashBoardGuidedMode';
import { prepareFlashBoardChatVisualReferences } from '../../src/services/flashboard/FlashBoardChatVisualReferences';

afterEach(() => setFlashBoardGuidedMode(false));

describe('FlashBoard Guided visual routing', () => {
  it('keeps Guided on DeepSeek by omitting inline visual references', async () => {
    setFlashBoardGuidedMode(true);
    const composer = createDefaultFlashBoardComposer();
    composer.referenceMediaFileIds = ['image-1'];

    await expect(prepareFlashBoardChatVisualReferences({
      composer,
      mediaFiles: [{
        id: 'image-1',
        name: 'reference.png',
        type: 'image',
        url: 'data:image/png;base64,AAAA',
      } as never],
    })).resolves.toEqual([]);
  });
});
