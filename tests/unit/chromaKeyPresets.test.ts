import { describe, expect, it } from 'vitest';
import { chromaKey, CHROMA_KEY_PRESETS } from '../../src/effects/keying/chroma-key';
import { chromaKeyNumbers } from '../../src/effects/keying/chroma-key/keyerContract';
import { chromaKeyCpuPixel, type ChromaKeyCpuScreen } from '../../src/effects/keying/chroma-key/keyerCpu';

// A picked green screen: the key compares every pixel with this colour (keyerContract.ts).
const SCREEN: ChromaKeyCpuScreen = { color: [60 / 255, 150 / 255, 70 / 255], channel: 1, found: 1 };
type Rgba = readonly [number, number, number, number];
const mix = (a: readonly number[], b: readonly number[], t: number): Rgba => [0, 1, 2].map(i => a[i] * (1 - t) + b[i] * t).concat(1) as unknown as Rgba;
const SKIN = [0.85, 0.62, 0.5];
// A wisp of hair or chiffon: a little performer over a lot of screen.
const WISP = mix(SCREEN.color, SKIN, 0.3);
// The screen in a shadowed corner: dimmer and greyer than the lit screen, so the default key leaves a grey speck.
const SHADOW: Rgba = [0.18, 0.27, 0.19, 1];

function alpha(input: Rgba, preset: Record<string, number | string>): number {
  const numbers = chromaKeyNumbers(preset);
  return chromaKeyCpuPixel(input, SCREEN, {
    screen: 'custom', screenColor: SCREEN.color, clipBlack: numbers.clipBlack, clipWhite: numbers.clipWhite,
    spillSuppression: numbers.spill, view: 'result',
  })[3];
}
const preset = (id: string) => CHROMA_KEY_PRESETS.find(candidate => candidate.id === id)!.params as Record<string, number | string>;

describe('Chroma Key presets', () => {
  it('are declared on the effect and set only controls of the current keyer, within their ranges', () => {
    expect(chromaKey.presets).toBe(CHROMA_KEY_PRESETS);
    expect(CHROMA_KEY_PRESETS.map(entry => entry.name)).toEqual(['Fine Hair', 'Firm Figure', 'Uneven Screen', 'Soft Blend']);
    for (const entry of CHROMA_KEY_PRESETS) {
      for (const [key, value] of Object.entries(entry.params)) {
        const definition = chromaKey.params[key];
        expect(definition, `${entry.name}: ${key}`).toBeDefined();
        expect(definition.deprecated, `${entry.name}: ${key} is retired`).toBeUndefined();
        if (typeof value === 'number') {
          expect(value).toBeGreaterThanOrEqual(definition.min!);
          expect(value).toBeLessThanOrEqual(definition.max!);
        }
      }
      // A preset never leaves Clip Black at or above Clip White (the card would report a hard cut).
      expect(chromaKeyNumbers(entry.params).reversed, entry.name).toBe(false);
    }
  });

  it('keep what their names promise: Fine Hair keeps wisps, Uneven Screen takes out shadowed screen, Firm Figure fills the body', () => {
    const defaults = {};
    expect(alpha(WISP, preset('fine-hair'))).toBeGreaterThan(alpha(WISP, defaults) + 0.05);
    expect(alpha(SHADOW, defaults)).toBeGreaterThan(0.1);
    expect(alpha(SHADOW, preset('uneven-screen'))).toBeLessThan(alpha(SHADOW, defaults));
    expect(alpha(SHADOW, preset('uneven-screen'))).toBe(0);
    // A pale costume with a little screen glow: solid in Firm Figure.
    const costume = mix(SCREEN.color, [0.9, 0.9, 0.88], 0.75);
    expect(alpha(costume, preset('firm-figure'))).toBe(1);
    expect(alpha(costume, preset('firm-figure'))).toBeGreaterThanOrEqual(alpha(costume, defaults));
  });
});
