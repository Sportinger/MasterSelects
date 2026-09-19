import { describe, expect, it } from 'vitest';

import {
  TURBORES_PRORES_FOURCCS,
  classifyProResCodec,
  decideTurboResCodec,
  getProResCodecLabel,
  getTurboResProResFourCC,
} from '../../src/services/mediaRuntime/prores/turboResCodecIdentity';

describe('TurboRes ProRes codec identity', () => {
  it('recognizes every classic ProRes FourCC supported by TurboRes', () => {
    for (const fourCC of TURBORES_PRORES_FOURCCS) {
      expect(getTurboResProResFourCC(fourCC)).toBe(fourCC);
      expect(classifyProResCodec(fourCC)).toBe('classic');
      expect(getProResCodecLabel(fourCC)).toMatch(/^ProRes /);
    }
  });

  it('normalizes case without guessing from friendly codec names', () => {
    expect(getTurboResProResFourCC(' APCH ')).toBe('apch');
    expect(getTurboResProResFourCC('ProRes 422 HQ')).toBeUndefined();
    expect(classifyProResCodec('avc1')).toBe('not-prores');
  });

  it('keeps the disabled flag and unsupported ProRes RAW explicit', () => {
    expect(decideTurboResCodec('apch', false)).toEqual({
      kind: 'disabled',
      fourCC: 'apch',
    });
    expect(decideTurboResCodec('apch', true)).toEqual({
      kind: 'turbores',
      fourCC: 'apch',
    });
    expect(decideTurboResCodec('aprn', true)).toEqual({
      kind: 'unsupported-prores-raw',
      fourCC: 'aprn',
    });
  });
});
