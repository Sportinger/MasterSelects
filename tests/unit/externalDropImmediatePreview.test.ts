import { describe, expect, it, vi } from 'vitest';
import { resolveExternalDropImmediatePreview } from '../../src/components/timeline/hooks/externalDropImmediatePreview';

function preview(type: string, file: File | null = null) {
  return resolveExternalDropImmediatePreview({
    dataTransfer: {
      types: ['Files'],
      items: [{ kind: 'file', type, getAsFile: () => file }],
      files: [],
    } as unknown as DataTransfer,
    currentPreview: null,
    metadataCache: null,
    requestVideoMetadata: vi.fn(),
  });
}

describe('native desktop file drag previews', () => {
  it.each(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac'])(
    'recognizes protected %s items before the browser exposes their File', type => {
      expect(preview(type)).toMatchObject({ isAudio: true, isVideo: false, hasAudio: true });
    },
  );

  it('keeps video and image drags on visual tracks', () => {
    expect(preview('video/mp4')).toMatchObject({ isAudio: false, isVideo: true });
    expect(preview('image/png')).toMatchObject({ isAudio: false, isVideo: true, hasAudio: false });
  });

  it('uses the filename when a dropped audio file has no MIME type', () => {
    expect(preview('', new File(['mp3'], 'MUSIC.MP3'))).toMatchObject({
      isAudio: true, isVideo: false, hasAudio: true,
    });
  });
});
