import { describe, expect, it, vi } from 'vitest';
import { createProgramTap, type ProgramTapDeps } from '../programTap';

type FakeTrack = MediaStreamTrack & { requestFrame?: () => void };

function createTrack(withRequestFrame = false): FakeTrack {
  return {
    ...(withRequestFrame ? { requestFrame: vi.fn() } : {}),
    stop: vi.fn(),
  } as unknown as FakeTrack;
}

function createStream(videoTrack: FakeTrack) {
  const tracks: MediaStreamTrack[] = [videoTrack];
  return {
    stream: {
      addTrack: vi.fn((track: MediaStreamTrack) => tracks.push(track)),
      getAudioTracks: () => tracks.filter(track => track !== videoTrack),
      getVideoTracks: () => [videoTrack],
      getTracks: () => [...tracks],
    } as unknown as MediaStream,
    tracks,
  };
}

function createHarness(source: HTMLCanvasElement | OffscreenCanvas | null) {
  const context = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  };
  const videoTrack = createTrack(true);
  const { stream } = createStream(videoTrack);
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    captureStream: vi.fn(() => stream),
  } as unknown as HTMLCanvasElement;
  let tick: (() => void) | undefined;
  const worker = { close: vi.fn() };
  const deps: ProgramTapDeps = {
    getSourceCanvas: () => source,
    createCanvas: () => canvas,
    createTickWorker: (_intervalMs, onTick) => {
      tick = onTick;
      return worker;
    },
  };
  return {
    canvas,
    context,
    deps,
    stream,
    videoTrack,
    worker,
    tick: () => tick?.(),
  };
}

describe('createProgramTap', () => {
  it('draws a letterboxed frame and requests it from the capture track', () => {
    const source = { width: 1000, height: 1000 } as HTMLCanvasElement;
    const harness = createHarness(source);
    createProgramTap(
      { width: 1280, height: 720, fps: 30, includeMasterAudio: false },
      harness.deps,
    );

    harness.tick();

    expect(harness.context.fillRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(harness.context.drawImage).toHaveBeenCalledWith(source, 280, 0, 720, 720);
    expect(harness.videoTrack.requestFrame).toHaveBeenCalledOnce();
  });

  it('draws black when the source canvas is unavailable', () => {
    const harness = createHarness(null);
    createProgramTap(
      { width: 1920, height: 1080, fps: 60, includeMasterAudio: false },
      harness.deps,
    );

    expect(() => harness.tick()).not.toThrow();
    expect(harness.context.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    expect(harness.context.drawImage).not.toHaveBeenCalled();
    expect(harness.videoTrack.requestFrame).toHaveBeenCalledOnce();
  });

  it('adds a clone of the acquired master audio track and releases it on close', () => {
    const harness = createHarness(null);
    const audioTrackClone = createTrack();
    const audioTrack = createTrack();
    (audioTrack as unknown as { clone: () => FakeTrack }).clone = vi.fn(() => audioTrackClone);
    const release = vi.fn();
    harness.deps.acquireMasterAudio = vi.fn(() => ({ track: audioTrack, release }));

    const tap = createProgramTap(
      { width: 1280, height: 720, fps: 30, includeMasterAudio: true },
      harness.deps,
    );
    tap.close();

    expect(tap.hasProgramAudio).toBe(true);
    expect(harness.stream.addTrack).toHaveBeenCalledWith(audioTrackClone);
    expect(release).toHaveBeenCalledOnce();
    expect(audioTrackClone.stop).toHaveBeenCalledOnce();
    // The shared master-tap track must stay alive for other acquirers.
    expect(audioTrack.stop).not.toHaveBeenCalled();
  });

  it('closes the worker and tracks idempotently', () => {
    const harness = createHarness(null);
    const audioTrackClone = createTrack();
    const audioTrack = createTrack();
    (audioTrack as unknown as { clone: () => FakeTrack }).clone = vi.fn(() => audioTrackClone);
    const release = vi.fn();
    harness.deps.acquireMasterAudio = vi.fn(() => ({ track: audioTrack, release }));
    const tap = createProgramTap(
      { width: 1280, height: 720, fps: 30, includeMasterAudio: true },
      harness.deps,
    );

    tap.close();
    tap.close();

    expect(harness.worker.close).toHaveBeenCalledOnce();
    expect(harness.videoTrack.stop).toHaveBeenCalledOnce();
    expect(audioTrackClone.stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
