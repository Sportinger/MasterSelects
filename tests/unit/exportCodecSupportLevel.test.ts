import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkCodecSupport, getCodecString } from '../../src/engine/export/codecHelpers';

afterEach(() => { vi.unstubAllGlobals(); });

describe('export codec support probe', () => {
  it('probes with the level the export uses, so large high-rate frames are not reported unsupported', async () => {
    const probe = vi.fn(async (config: VideoEncoderConfig) => ({ supported: config.codec !== 'avc1.4d0028', config }));
    vi.stubGlobal('VideoEncoder', { isConfigSupported: probe });
    expect(await checkCodecSupport('h264', 3440, 1440, 60)).toBe(true);
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({
      codec: getCodecString('h264', { width: 3440, height: 1440, fps: 60 }), framerate: 60, width: 3440, height: 1440,
    }));
    expect(getCodecString('h264', { width: 3440, height: 1440, fps: 60 })).not.toBe('avc1.4d0028');
  });
});
