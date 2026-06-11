import { clearMasterAudio, playheadState } from './PlayheadState';
import {
  clampStemBufferMixerGain,
  recordStemBufferMixerSessionStart,
  recordStemBufferMixerSessionStop,
} from './audioTrackStemBufferMixerSessionControls';
import {
  type StemBufferMixerLayer,
  type StemBufferMixerSession,
} from './audioTrackStemSyncModel';

export {
  getStemBufferMixerDebugSnapshot,
  publishStemBufferMixerMeter,
  publishStemBufferMixerMeters,
  recordStemBufferMixerLifecycle,
  setStemBufferMixerMasterClock,
  updateStemBufferMixerGains,
} from './audioTrackStemBufferMixerSessionControls';

type CreateStemBufferMixerSessionParams = {
  clipId: string;
  context: AudioContext;
  key: string;
  layers: StemBufferMixerLayer[];
  buffers: Map<string, AudioBuffer>;
  startAt: number;
  startOffset: number;
  masterVolume: number;
  meterTrackId: string;
};

function disconnectAudioNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Ignore cleanup errors.
  }
}

export function stopStemBufferMixerSession(session: StemBufferMixerSession): void {
  recordStemBufferMixerSessionStop(session);
  if (playheadState.masterAudioClock === session.getSourceTime) clearMasterAudio();
  for (const source of session.sources) {
    try {
      source.stop();
    } catch {
      // Source nodes may already have ended.
    }
    disconnectAudioNode(source);
  }
  for (const gain of session.gains.values()) disconnectAudioNode(gain);
  disconnectAudioNode(session.masterGain);
  disconnectAudioNode(session.analyser);
  disconnectAudioNode(session.stereoSplitter);
  disconnectAudioNode(session.leftAnalyser);
  disconnectAudioNode(session.rightAnalyser);
}

export function createStemBufferMixerSession(
  params: CreateStemBufferMixerSessionParams,
): StemBufferMixerSession | null {
  const { clipId, context, key, layers, buffers, startAt, startOffset, masterVolume, meterTrackId } = params;
  const masterGain = context.createGain();
  const analyser = context.createAnalyser();
  const stereoSplitter = context.createChannelSplitter(2);
  const leftAnalyser = context.createAnalyser();
  const rightAnalyser = context.createAnalyser();
  analyser.fftSize = 1024;
  leftAnalyser.fftSize = analyser.fftSize;
  rightAnalyser.fftSize = analyser.fftSize;
  masterGain.gain.value = clampStemBufferMixerGain(masterVolume);
  analyser.connect(masterGain);
  analyser.connect(stereoSplitter);
  stereoSplitter.connect(leftAnalyser, 0);
  stereoSplitter.connect(rightAnalyser, 1);
  masterGain.connect(context.destination);

  const gains = new Map<string, GainNode>();
  const sources: AudioBufferSourceNode[] = [];
  for (const layer of layers) {
    const buffer = buffers.get(layer.id);
    if (!buffer) continue;
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = clampStemBufferMixerGain(layer.gain);
    source.buffer = buffer;
    source.playbackRate.value = 1;
    source.connect(gain);
    gain.connect(analyser);
    source.start(startAt, Math.min(startOffset, Math.max(0, buffer.duration - 0.02)));
    gains.set(layer.id, gain);
    sources.push(source);
  }
  if (sources.length === 0) {
    disconnectAudioNode(masterGain);
    return null;
  }

  const session: StemBufferMixerSession = {
    key,
    clipId,
    context,
    masterGain,
    analyser,
    stereoSplitter,
    leftAnalyser,
    rightAnalyser,
    meterSamples: new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>,
    leftMeterSamples: new Float32Array(leftAnalyser.fftSize) as Float32Array<ArrayBuffer>,
    rightMeterSamples: new Float32Array(rightAnalyser.fftSize) as Float32Array<ArrayBuffer>,
    meterTrackId,
    getSourceTime: () => {
      if (context.state === 'closed') return null;
      const sourceTime = startOffset + (context.currentTime - startAt);
      return Number.isFinite(sourceTime) ? Math.max(0, sourceTime) : null;
    },
    sources,
    gains,
    startedAtContextTime: startAt,
    startedClipTime: startOffset,
    sourceCount: sources.length,
    lastGainSignature: '',
    lastMeterPublishAt: 0,
  };
  recordStemBufferMixerSessionStart(session);
  return session;
}
