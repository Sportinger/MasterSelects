import { describe, expect, it } from 'vitest';
import {
  createDownloadKey,
  detectDownloadPlatform,
  extractVideoId,
  parseDownloadUrls,
} from '../../src/services/mediaDiscovery/videoUrlDownloads';
import { pickDefaultDownloadFormat } from '../../src/services/mediaDiscovery/downloadFormats';
import { findPastedDownloadUrl } from '../../src/components/panels/media/panel/mediaPanelClipboard';
import type { FormatRecommendation } from '../../src/services/nativeHelper';

function videoFormat(id: string, resolution: string): FormatRecommendation {
  return { id, label: `${resolution} H.264 (30fps)`, resolution, vcodec: 'H.264', acodec: null, needsMerge: true };
}

const MP3_FORMAT: FormatRecommendation = {
  id: '__masterselects_audio_mp3',
  label: 'MP3 audio',
  resolution: 'Audio',
  vcodec: null,
  acodec: 'MP3',
  needsMerge: false,
};

describe('video URL downloads', () => {
  it('extracts YouTube ids from watch, short, shorts and live links', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(extractVideoId('https://youtube.com/watch?feature=share&v=aqz-KE-bpKQ&t=4')).toBe('aqz-KE-bpKQ');
    expect(extractVideoId('https://youtu.be/aqz-KE-bpKQ?si=abc')).toBe('aqz-KE-bpKQ');
    expect(extractVideoId('https://www.youtube.com/shorts/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(extractVideoId('https://www.youtube.com/live/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(extractVideoId('https://vimeo.com/76979871')).toBeNull();
  });

  it('keys YouTube downloads by video id and other links by a stable hash', () => {
    expect(createDownloadKey('https://youtu.be/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    const key = createDownloadKey('https://www.tiktok.com/@a/video/1');
    expect(key).toMatch(/^url-/);
    expect(createDownloadKey('https://www.tiktok.com/@a/video/1')).toBe(key);
    expect(detectDownloadPlatform('https://x.com/a/status/1')).toBe('twitter');
  });

  it('parses unique links and trims trailing punctuation', () => {
    expect(parseDownloadUrls('see https://youtu.be/aqz-KE-bpKQ), and https://youtu.be/aqz-KE-bpKQ.'))
      .toEqual(['https://youtu.be/aqz-KE-bpKQ']);
  });

  it('treats only link-only clipboard text as a pasted download', () => {
    expect(findPastedDownloadUrl('  https://youtu.be/aqz-KE-bpKQ\n')).toBe('https://youtu.be/aqz-KE-bpKQ');
    expect(findPastedDownloadUrl('https://a.example/v/1\nhttps://b.example/v/2')).toBe('https://a.example/v/1');
    expect(findPastedDownloadUrl('Watch this: https://youtu.be/aqz-KE-bpKQ')).toBeNull();
    expect(findPastedDownloadUrl('just text')).toBeNull();
    expect(findPastedDownloadUrl('')).toBeNull();
  });

  it('defaults to the sharpest video format up to 1080p', () => {
    const formats = [videoFormat('4k', '2160p'), videoFormat('qhd', '1440p'), videoFormat('fhd', '1080p'), videoFormat('hd', '720p'), MP3_FORMAT];
    expect(pickDefaultDownloadFormat(formats)?.id).toBe('fhd');
    expect(pickDefaultDownloadFormat([videoFormat('4k', '2160p'), MP3_FORMAT])?.id).toBe('4k');
    expect(pickDefaultDownloadFormat([MP3_FORMAT])?.id).toBe(MP3_FORMAT.id);
    expect(pickDefaultDownloadFormat([])).toBeNull();
  });
});
