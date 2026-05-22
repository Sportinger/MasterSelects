import { describe, expect, it } from 'vitest';
import {
  formatStoredToolMessageForApi,
  formatToolResultForApi,
} from '../../src/components/panels/aiChatSerialization';

const SAMPLE_DATA_URL = 'data:image/png;base64,QUJDREVGR0g=';

describe('AI chat tool-result serialization', () => {
  it('omits raw image data URLs even when the tool result is below the truncation limit', () => {
    const content = formatToolResultForApi({
      success: true,
      data: {
        capturedAt: 1.25,
        dataUrl: SAMPLE_DATA_URL,
        height: 360,
        width: 640,
      },
    });

    expect(content).not.toContain('data:image/png;base64');
    expect(content).not.toContain('QUJDREVGR0g=');

    const parsed = JSON.parse(content) as {
      data: { capturedAt: number; dataUrl: string; height: number; width: number };
      success: boolean;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.width).toBe(640);
    expect(parsed.data.height).toBe(360);
    expect(parsed.data.capturedAt).toBe(1.25);
    expect(parsed.data.dataUrl).toContain('image data omitted from text context');
  });

  it('sanitizes old full UI tool messages before rebuilding API messages from history', () => {
    const storedUiContent = JSON.stringify({
      success: true,
      data: {
        frameCount: 8,
        gridSize: '4x2',
        dataUrl: SAMPLE_DATA_URL,
        width: 1280,
        height: 360,
      },
    }, null, 2);

    const apiContent = formatStoredToolMessageForApi(storedUiContent);

    expect(apiContent).not.toContain('data:image/png;base64');
    expect(apiContent).not.toContain('QUJDREVGR0g=');

    const parsed = JSON.parse(apiContent) as {
      data: { dataUrl: string; frameCount: number; gridSize: string };
      success: boolean;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.frameCount).toBe(8);
    expect(parsed.data.gridSize).toBe('4x2');
    expect(parsed.data.dataUrl).toContain('image data omitted from text context');
  });

  it('redacts image data URLs from non-JSON stored tool content as a fallback', () => {
    const apiContent = formatStoredToolMessageForApi(`preview=${SAMPLE_DATA_URL}`);

    expect(apiContent).not.toContain('data:image/png;base64');
    expect(apiContent).not.toContain('QUJDREVGR0g=');
    expect(apiContent).toContain('image data omitted from text context');
  });
});
