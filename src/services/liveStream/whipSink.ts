import type {
  ActiveStreamSink,
  LiveStreamConfig,
  StreamSinkCallbacks,
} from './streamTypes';

interface WhipSinkDeps {
  RTCPeerConnectionImpl?: typeof RTCPeerConnection;
  fetchImpl?: typeof fetch;
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange', handleChange);
      resolve();
    };
    const handleChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timeout = globalThis.setTimeout(finish, 2_000);
    pc.addEventListener('icegatheringstatechange', handleChange);
  });
}

function redactResponseText(text: string, token: string): string {
  const redacted = token ? text.replaceAll(token, '[redacted]') : text;
  return redacted.slice(0, 200);
}

function preferH264(pc: RTCPeerConnection): void {
  try {
    const capabilities = globalThis.RTCRtpReceiver?.getCapabilities('video');
    if (!capabilities) return;
    const codecs = capabilities.codecs.toSorted((left, right) => {
      const leftH264 = left.mimeType.toLowerCase() === 'video/h264';
      const rightH264 = right.mimeType.toLowerCase() === 'video/h264';
      return Number(rightH264) - Number(leftH264);
    });
    pc.getTransceivers()
      .find(transceiver => transceiver.sender.track?.kind === 'video')
      ?.setCodecPreferences(codecs);
  } catch {
    // Codec preference is an optional browser optimization.
  }
}

async function setVideoBitrate(pc: RTCPeerConnection, bitrate: number): Promise<void> {
  const sender = pc.getSenders().find(candidate => candidate.track?.kind === 'video');
  if (!sender) return;
  try {
    const parameters = sender.getParameters();
    if (parameters.encodings.length === 0) parameters.encodings = [{}];
    parameters.encodings.forEach(encoding => { encoding.maxBitrate = bitrate; });
    await sender.setParameters(parameters);
  } catch {
    // Some browsers reject encoding parameters until negotiation completes.
  }
}

export async function startWhipSink(input: {
  mixedStream: MediaStream;
  config: LiveStreamConfig;
  callbacks: StreamSinkCallbacks;
  deps?: WhipSinkDeps;
}): Promise<ActiveStreamSink> {
  const RTCPeerConnectionImpl = input.deps?.RTCPeerConnectionImpl ?? globalThis.RTCPeerConnection;
  const fetchImpl = input.deps?.fetchImpl ?? globalThis.fetch;
  if (!RTCPeerConnectionImpl) throw new Error('WebRTC streaming is not supported in this browser.');
  if (!fetchImpl) throw new Error('WHIP networking is not available in this browser.');

  const pc = new RTCPeerConnectionImpl();
  let stopping = false;
  let fatalReported = false;
  let disconnectedTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let statsTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  let cachedBytesSent = 0;
  let resourceUrl: string | null = null;

  const reportFatal = (error: Error) => {
    if (stopping || fatalReported) return;
    fatalReported = true;
    input.callbacks.onFatalError(error);
  };

  const handleConnectionState = () => {
    const state = pc.connectionState;
    input.callbacks.onStatusMessage?.(`WHIP connection: ${state}`);
    if (state !== 'disconnected' && disconnectedTimer) {
      globalThis.clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }
    if (state === 'failed' || state === 'closed') {
      reportFatal(new Error(`WHIP connection ${state}.`));
    } else if (state === 'disconnected' && !disconnectedTimer) {
      disconnectedTimer = globalThis.setTimeout(() => {
        disconnectedTimer = null;
        if (pc.connectionState === 'disconnected') {
          reportFatal(new Error('WHIP connection remained disconnected for more than 5 seconds.'));
        }
      }, 5_000);
    }
  };
  pc.addEventListener('connectionstatechange', handleConnectionState);

  try {
    input.mixedStream.getTracks().forEach(track => {
      const sender = pc.addTrack(track, input.mixedStream);
      const transceiver = pc.getTransceivers().find(candidate => candidate.sender === sender);
      if (transceiver) transceiver.direction = 'sendonly';
    });
    preferH264(pc);
    await setVideoBitrate(pc, input.config.videoBitrateKbps * 1000);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    const offerSdp = pc.localDescription?.sdp ?? offer.sdp ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/sdp' };
    if (input.config.whipBearerToken) {
      headers.Authorization = `Bearer ${input.config.whipBearerToken}`;
    }
    const response = await fetchImpl(input.config.whipUrl, {
      method: 'POST',
      headers,
      body: offerSdp,
    });
    if (response.status !== 200 && response.status !== 201) {
      const responseText = redactResponseText(await response.text(), input.config.whipBearerToken);
      throw new Error(`WHIP POST failed (${response.status} ${response.statusText}): ${responseText}`.trim());
    }
    const location = response.headers.get('Location');
    if (location) resourceUrl = new URL(location, input.config.whipUrl).toString();
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  } catch (error) {
    stopping = true;
    pc.removeEventListener('connectionstatechange', handleConnectionState);
    pc.close();
    throw error;
  }

  const updateStats = async () => {
    try {
      const report = await pc.getStats();
      let total = 0;
      report.forEach(stat => {
        if (stat.type === 'outbound-rtp' && !stat.isRemote) total += Number(stat.bytesSent) || 0;
      });
      cachedBytesSent = total;
    } catch {
      // Keep the last successful sample while the peer connection is live.
    }
  };
  void updateStats();
  statsTimer = globalThis.setInterval(() => { void updateStats(); }, 1_000);

  let stopPromise: Promise<void> | null = null;
  return {
    stop: () => {
      stopPromise ??= (async () => {
        stopping = true;
        if (statsTimer) globalThis.clearInterval(statsTimer);
        if (disconnectedTimer) globalThis.clearTimeout(disconnectedTimer);
        pc.removeEventListener('connectionstatechange', handleConnectionState);
        if (resourceUrl) {
          const headers: Record<string, string> = {};
          if (input.config.whipBearerToken) headers.Authorization = `Bearer ${input.config.whipBearerToken}`;
          await fetchImpl(resourceUrl, { method: 'DELETE', headers }).catch(() => undefined);
        }
        pc.close();
      })();
      return stopPromise;
    },
    getStats: () => ({ bytesSent: cachedBytesSent, queuedBytes: 0 }),
  };
}
