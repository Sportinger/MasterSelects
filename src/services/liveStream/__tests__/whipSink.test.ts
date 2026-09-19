import { describe, expect, it, vi } from 'vitest';
import type { LiveStreamConfig } from '../streamTypes';
import { startWhipSink } from '../whipSink';

function createConfig(): LiveStreamConfig {
  return {
    transport: 'whip',
    rtmpRelay: 'auto',
    rtmpUrl: '',
    rtmpStreamKey: '',
    whipUrl: 'https://whip.example/live/channel',
    whipBearerToken: 'top-secret-token',
    resolution: '720p',
    fps: 30,
    videoBitrateKbps: 3_500,
    audioBitrateKbps: 128,
    includeMasterAudio: true,
    includeMicrophone: false,
    recordLocally: false,
    chatPlatform: 'twitch',
    chatChannel: '',
  };
}

class FakeSender {
  readonly track: MediaStreamTrack;
  readonly setParameters = vi.fn(async () => undefined);
  constructor(track: MediaStreamTrack) { this.track = track; }
  getParameters(): RTCRtpSendParameters { return { encodings: [{}] } as RTCRtpSendParameters; }
}

class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = [];
  readonly senders: FakeSender[] = [];
  readonly transceivers: Array<{ sender: FakeSender; direction: RTCRtpTransceiverDirection; setCodecPreferences: ReturnType<typeof vi.fn> }> = [];
  iceGatheringState: RTCIceGatheringState = 'complete';
  connectionState: RTCPeerConnectionState = 'connected';
  localDescription: RTCSessionDescription | null = null;
  closed = false;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  constructor() {
    super();
    FakePeerConnection.instances.push(this);
  }
  addTrack(track: MediaStreamTrack): RTCRtpSender {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    this.transceivers.push({ sender, direction: 'sendrecv', setCodecPreferences: vi.fn() });
    return sender as unknown as RTCRtpSender;
  }
  getSenders(): RTCRtpSender[] { return this.senders as unknown as RTCRtpSender[]; }
  getTransceivers(): RTCRtpTransceiver[] { return this.transceivers as unknown as RTCRtpTransceiver[]; }
  async createOffer(): Promise<RTCSessionDescriptionInit> { return { type: 'offer', sdp: 'offer-sdp' }; }
  async setLocalDescription(description: RTCLocalSessionDescriptionInit): Promise<void> {
    this.localDescription = { type: description.type, sdp: description.sdp ?? '' } as RTCSessionDescription;
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> { this.remoteDescription = description; }
  async getStats(): Promise<RTCStatsReport> { return new Map() as unknown as RTCStatsReport; }
  close(): void { this.closed = true; this.connectionState = 'closed'; }
}

function createStream(): MediaStream {
  const video = { kind: 'video' } as MediaStreamTrack;
  const audio = { kind: 'audio' } as MediaStreamTrack;
  return { getTracks: () => [video, audio] } as MediaStream;
}

function response(input: { status: number; statusText?: string; body: string; location?: string }): Response {
  return {
    status: input.status,
    statusText: input.statusText ?? '',
    headers: new Headers(input.location ? { Location: input.location } : {}),
    text: async () => input.body,
  } as Response;
}

describe('startWhipSink', () => {
  it('posts the offer with bearer auth, resolves Location, and deletes the resource on stop', async () => {
    FakePeerConnection.instances = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: 201, body: 'answer-sdp', location: '../resource/42' }))
      .mockResolvedValueOnce(response({ status: 204, body: '' }));
    const sink = await startWhipSink({
      mixedStream: createStream(),
      config: createConfig(),
      callbacks: { onFatalError: vi.fn() },
      deps: {
        RTCPeerConnectionImpl: FakePeerConnection as unknown as typeof RTCPeerConnection,
        fetchImpl,
      },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://whip.example/live/channel', expect.objectContaining({
      method: 'POST',
      body: 'offer-sdp',
      headers: {
        'Content-Type': 'application/sdp',
        Authorization: 'Bearer top-secret-token',
      },
    }));
    expect(FakePeerConnection.instances[0].remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' });

    await sink.stop();
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://whip.example/resource/42', expect.objectContaining({ method: 'DELETE' }));
    expect(FakePeerConnection.instances[0].closed).toBe(true);
  });

  it('rejects a non-OK response without exposing the bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      status: 401,
      statusText: 'Unauthorized',
      body: `bad credential: ${createConfig().whipBearerToken}`,
    }));
    let error: Error | null = null;
    try {
      await startWhipSink({
        mixedStream: createStream(),
        config: createConfig(),
        callbacks: { onFatalError: vi.fn() },
        deps: {
          RTCPeerConnectionImpl: FakePeerConnection as unknown as typeof RTCPeerConnection,
          fetchImpl,
        },
      });
    } catch (cause) {
      error = cause as Error;
    }
    expect(error?.message).toContain('401 Unauthorized');
    expect(error?.message).not.toContain(createConfig().whipBearerToken);
  });
});
