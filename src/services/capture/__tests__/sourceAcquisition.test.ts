import { describe, expect, it, vi } from 'vitest';
import {
  acquireDisplaySource,
  mapCaptureAcquisitionError,
} from '../sourceAcquisition';

function track(settings: MediaTrackSettings, capabilities: MediaTrackCapabilities = {}) {
  return {
    getSettings: () => settings,
    getCapabilities: () => capabilities,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function stream(videoTrack: MediaStreamTrack, audioTracks: MediaStreamTrack[] = []) {
  return {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => audioTracks,
    getTracks: () => [videoTrack, ...audioTracks],
  } as unknown as MediaStream;
}

describe('display source acquisition', () => {
  it('invokes the picker immediately and reports the actual returned source capabilities', async () => {
    let resolvePicker!: (value: MediaStream) => void;
    const picker = new Promise<MediaStream>(resolve => { resolvePicker = resolve; });
    const getDisplayMedia = vi.fn((_constraints?: unknown) => picker);
    const promise = acquireDisplaySource({
      preferredSurface: 'monitor',
      includeAudio: true,
      includeCursor: true,
      muteCapturedTab: false,
    }, {
      secureContext: true,
      mediaDevices: { getDisplayMedia },
    });

    expect(getDisplayMedia).toHaveBeenCalledOnce();
    resolvePicker(stream(
      track({ displaySurface: 'window', width: 1280, height: 720 }, { cursor: ['always'] } as MediaTrackCapabilities),
      [track({})],
    ));
    const acquired = await promise;

    expect(acquired.snapshot).toEqual({
      surface: 'window',
      dimensions: { width: 1280, height: 720 },
      hasDisplayAudio: true,
      cursorSupported: true,
    });
    expect(getDisplayMedia.mock.calls[0]?.[0]).toMatchObject({
      surfaceSwitching: 'include',
      systemAudio: 'include',
    });
  });

  it.each([
    [new DOMException('Permission denied', 'NotAllowedError'), 'permission-denied'],
    [new DOMException('The document is not active', 'InvalidStateError'), 'invalid-state'],
    [new DOMException('Picker canceled', 'AbortError'), 'permission-denied'],
  ] as const)('maps acquisition failure %s', (failure, code) => {
    expect(mapCaptureAcquisitionError(failure)).toMatchObject({ code });
  });
});
