import { describe, expect, it, vi } from 'vitest';

import { googleFontsService } from '../../src/services/googleFontsService';

describe('googleFontsService', () => {
  it('does not contact Google for a system font', async () => {
    const appendChild = vi.spyOn(document.head, 'appendChild');

    await googleFontsService.loadFont('Arial', 400);

    expect(appendChild).not.toHaveBeenCalled();
    appendChild.mockRestore();
  });
});
