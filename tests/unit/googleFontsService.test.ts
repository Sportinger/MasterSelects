import { describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/services/googleFontsService');

import { isCssGenericFontFamily } from '../../src/services/fontFamily';
import { googleFontsService } from '../../src/services/googleFontsService';

describe('googleFontsService', () => {
  it('does not contact Google for a system font', async () => {
    const appendChild = vi.spyOn(document.head, 'appendChild');

    await googleFontsService.loadFont('Arial', 400);

    expect(appendChild).not.toHaveBeenCalled();
    appendChild.mockRestore();
  });

  it('recognizes CSS generic families and never contacts Google for them', async () => {
    const appendChild = vi.spyOn(document.head, 'appendChild');

    expect(isCssGenericFontFamily(' MONOSPACE ')).toBe(true);
    await googleFontsService.loadFont('monospace', 700);

    expect(appendChild).not.toHaveBeenCalled();
    appendChild.mockRestore();
  });

  it('waits for the Google Fonts stylesheet before waiting for the font face', async () => {
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load, ready: Promise.resolve() },
    });

    try {
      const pending = googleFontsService.loadFont('Roboto', 700);
      const stylesheet = document.head.querySelector<HTMLLinkElement>(
        'link[href*="Roboto"][href*="700"]',
      );
      expect(stylesheet).not.toBeNull();
      expect(load).not.toHaveBeenCalled();

      stylesheet!.dispatchEvent(new Event('load'));
      await pending;

      expect(load).toHaveBeenCalledWith('700 16px "Roboto"');
    } finally {
      document.head.querySelectorAll('link[href*="Roboto"]').forEach(link => link.remove());
      if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
      else delete (document as Document & { fonts?: FontFaceSet }).fonts;
    }
  });
});
