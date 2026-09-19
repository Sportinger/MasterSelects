import { describe, expect, it } from 'vitest';

import {
  MOBILE_PORTRAIT_PREVIEW_WIDTH_RATIO,
  resolveMobilePreviewSplitRatio,
} from '../../src/components/dock/mobilePreviewLayoutFit';

const baseParams = {
  compositionHeight: 1080,
  compositionWidth: 1920,
  containerHeight: 1_000,
  containerWidth: 768,
  dividerSize: 4,
  minimumPreviewHeight: 200,
  minimumRemainingHeight: 304,
  previewChromeHeight: 80,
  previewWidthRatio: 1,
};

describe('mobile Preview layout fit', () => {
  it('fits a landscape composition to the full available Preview width', () => {
    const ratio = resolveMobilePreviewSplitRatio(baseParams);

    expect(ratio).not.toBeNull();
    const firstChildHeight = ratio! * baseParams.containerHeight
      - baseParams.dividerSize / 2;
    const canvasHeight = firstChildHeight - baseParams.previewChromeHeight;
    expect(canvasHeight).toBeCloseTo(768 * 9 / 16);
  });

  it('fits a portrait composition into an exact half-width upper row', () => {
    const ratio = resolveMobilePreviewSplitRatio({
      ...baseParams,
      compositionHeight: 1920,
      compositionWidth: 1080,
      minimumRemainingHeight: 150,
      previewWidthRatio: MOBILE_PORTRAIT_PREVIEW_WIDTH_RATIO,
    });

    expect(MOBILE_PORTRAIT_PREVIEW_WIDTH_RATIO).toBe(0.5);
    expect(ratio).not.toBeNull();
    const firstChildHeight = ratio! * baseParams.containerHeight
      - baseParams.dividerSize / 2;
    const canvasHeight = firstChildHeight - baseParams.previewChromeHeight;
    const halfPaneWidth = 768 * 0.5 - baseParams.dividerSize / 2;
    expect(canvasHeight).toBeCloseTo(halfPaneWidth * 16 / 9);
  });

  it('keeps the lower panels above their minimum height when fitting cannot win', () => {
    const ratio = resolveMobilePreviewSplitRatio({
      ...baseParams,
      containerHeight: 700,
      containerWidth: 1_200,
    });

    expect(ratio).not.toBeNull();
    const remainingHeight = (1 - ratio!) * 700 - baseParams.dividerSize / 2;
    expect(remainingHeight).toBeCloseTo(baseParams.minimumRemainingHeight);
  });

  it('ignores incomplete composition or container geometry', () => {
    expect(resolveMobilePreviewSplitRatio({
      ...baseParams,
      compositionWidth: 0,
    })).toBeNull();
  });
});
