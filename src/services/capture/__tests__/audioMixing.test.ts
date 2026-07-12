import { describe, expect, it, vi } from 'vitest';
import { createCaptureAudioMix } from '../recording/audioMixing';

function fakeTrack(kind: 'audio' | 'video') {
  return { kind, stop: vi.fn() } as unknown as MediaStreamTrack;
}

function fakeStream(tracks: MediaStreamTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(track => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter(track => track.kind === 'video'),
  } as unknown as MediaStream;
}

function createGraph() {
  const nodes: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const node = () => {
    const value = { connect: vi.fn(), disconnect: vi.fn() };
    nodes.push(value);
    return value;
  };
  const analysers: Array<ReturnType<typeof node> & { fftSize: number; getFloatTimeDomainData: ReturnType<typeof vi.fn> }> = [];
  const destinationTrack = fakeTrack('audio');
  const context = {
    state: 'running',
    createMediaStreamSource: vi.fn(() => node()),
    createGain: vi.fn(() => ({ ...node(), gain: { value: 1 } })),
    createAnalyser: vi.fn(() => {
      const analyser = {
        ...node(),
        fftSize: 256,
        getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(0.5)),
      };
      analysers.push(analyser);
      return analyser;
    }),
    createMediaStreamDestination: vi.fn(() => ({ ...node(), stream: fakeStream([destinationTrack]) })),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return { context, nodes, analysers, destinationTrack };
}

describe('capture audio mixing', () => {
  it('mixes display audio and microphone into one destination with working meters', async () => {
    const videoTrack = fakeTrack('video');
    const displayTrack = fakeTrack('audio');
    const microphoneTrack = fakeTrack('audio');
    const graph = createGraph();
    const createMediaStream = vi.fn((tracks: MediaStreamTrack[]) => fakeStream(tracks));

    const mix = await createCaptureAudioMix({
      displayStream: fakeStream([videoTrack, displayTrack]),
      includeDisplayAudio: true,
      includeMicrophone: true,
      microphoneDeviceId: 'mic-1',
      getUserMedia: vi.fn(async () => fakeStream([microphoneTrack])),
      createAudioContext: () => graph.context as unknown as AudioContext,
      createMediaStream,
    });

    expect(graph.context.createMediaStreamSource).toHaveBeenCalledTimes(2);
    expect(mix.recordingStream.getVideoTracks()).toEqual([videoTrack]);
    expect(mix.recordingStream.getAudioTracks()).toEqual([graph.destinationTrack]);
    expect(mix.getLevels()).toEqual({ display: 0.5, microphone: 0.5 });
    expect(mix).toMatchObject({ hasDisplayAudio: true, hasMicrophoneAudio: true });

    await mix.close();
    await mix.close();
    expect(microphoneTrack.stop).toHaveBeenCalledOnce();
    expect(graph.destinationTrack.stop).toHaveBeenCalledOnce();
    expect(graph.context.close).toHaveBeenCalledOnce();
    expect(mix.getLevels()).toEqual({ display: 0, microphone: 0 });
  });
});
