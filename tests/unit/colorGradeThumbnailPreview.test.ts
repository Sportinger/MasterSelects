import { describe, expect, it } from 'vitest';

import {
  applyColorGradeThumbnailPreview,
  createNodeColorGradeThumbnailPreview,
  type ColorGradeThumbnailPreview,
} from '../../src/services/colorGrades/colorGradeThumbnailPreview';
import {
  DEFAULT_PRIMARY_COLOR_PARAMS,
  type RuntimePrimaryColorParams,
} from '../../src/types/colorCorrection';

function preview(params: Partial<RuntimePrimaryColorParams>): ColorGradeThumbnailPreview {
  return {
    graphHash: JSON.stringify(params),
    primaryNodes: [{ ...DEFAULT_PRIMARY_COLOR_PARAMS, ...params }],
    curvesByNode: [],
  };
}

describe('color grade thumbnail previews', () => {
  it('applies exposure to thumbnail pixels', () => {
    const result = applyColorGradeThumbnailPreview(
      new Uint8ClampedArray([64, 64, 64, 255]),
      preview({ exposure: 1 }),
    );

    expect(result[0]).toBeGreaterThan(120);
    expect(result[1]).toBe(result[0]);
    expect(result[2]).toBe(result[0]);
    expect(result[3]).toBe(255);
  });

  it('preserves channel-specific wheel changes', () => {
    const result = applyColorGradeThumbnailPreview(
      new Uint8ClampedArray([64, 64, 64, 255]),
      preview({ gainR: 2 }),
    );

    expect(result[0]).toBeGreaterThan(result[1]);
    expect(result[1]).toBe(result[2]);
  });

  it('builds cumulative node previews only through the requested node', () => {
    const nodes = [
      {
        id: 'first',
        type: 'primary',
        enabled: true,
        params: { exposure: 1 },
      },
      {
        id: 'second',
        type: 'primary',
        enabled: true,
        params: { exposure: 2 },
      },
    ];

    const first = createNodeColorGradeThumbnailPreview(nodes, 'first');
    const second = createNodeColorGradeThumbnailPreview(nodes, 'second');

    expect(first?.primaryNodes).toHaveLength(1);
    expect(second?.primaryNodes).toHaveLength(2);
    expect(second?.graphHash).not.toBe(first?.graphHash);
  });
});
