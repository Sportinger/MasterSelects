import type { AudioRoute, MasterAudioRoute } from './routeGraphTypes';

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function createEqFilters(ctx: BaseAudioContext): BiquadFilterNode[] {
  return EQ_FREQUENCIES.map(freq => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1.4;
    filter.gain.value = 0;
    return filter;
  });
}

function configureStereoAnalysers(
  ctx: BaseAudioContext,
  analyserNode: AnalyserNode,
): {
  stereoSplitterNode: ChannelSplitterNode;
  leftAnalyserNode: AnalyserNode;
  rightAnalyserNode: AnalyserNode;
} {
  const stereoSplitterNode = ctx.createChannelSplitter(2);
  const leftAnalyserNode = ctx.createAnalyser();
  const rightAnalyserNode = ctx.createAnalyser();
  leftAnalyserNode.fftSize = analyserNode.fftSize;
  rightAnalyserNode.fftSize = analyserNode.fftSize;
  leftAnalyserNode.smoothingTimeConstant = analyserNode.smoothingTimeConstant;
  rightAnalyserNode.smoothingTimeConstant = analyserNode.smoothingTimeConstant;

  return {
    stereoSplitterNode,
    leftAnalyserNode,
    rightAnalyserNode,
  };
}

export function createMasterRouteGraph(ctx: AudioContext): MasterAudioRoute {
  const inputNode = ctx.createGain();
  inputNode.gain.value = 1;

  const gainNode = ctx.createGain();
  gainNode.gain.value = 1;

  const analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.2;

  const {
    stereoSplitterNode,
    leftAnalyserNode,
    rightAnalyserNode,
  } = configureStereoAnalysers(ctx, analyserNode);

  return {
    inputNode,
    gainNode,
    analyserNode,
    stereoSplitterNode,
    leftAnalyserNode,
    rightAnalyserNode,
    eqFilters: createEqFilters(ctx),
    processorNodes: [],
    meterBuffer: new Float32Array(analyserNode.fftSize),
    leftMeterBuffer: new Float32Array(leftAnalyserNode.fftSize),
    rightMeterBuffer: new Float32Array(rightAnalyserNode.fftSize),
    frequencyBuffer: new Float32Array(analyserNode.frequencyBinCount),
    lastVolume: 1,
    lastEQGains: new Array(EQ_FREQUENCIES.length).fill(0),
    lastProcessorSignature: '',
  };
}

export function createAudioRouteGraph(
  ctx: AudioContext,
  sourceNode: AudioNode,
): AudioRoute {
  const cutGainNode = ctx.createGain();
  const gainNode = ctx.createGain();
  gainNode.gain.value = 1;

  const panNode = ctx.createStereoPanner();
  panNode.pan.value = 0;

  const analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.2;

  const {
    stereoSplitterNode,
    leftAnalyserNode,
    rightAnalyserNode,
  } = configureStereoAnalysers(ctx, analyserNode);

  return {
    sourceNode,
    cutGainNode,
    gainNode,
    panNode,
    analyserNode,
    stereoSplitterNode,
    leftAnalyserNode,
    rightAnalyserNode,
    eqFilters: createEqFilters(ctx),
    processorNodes: [],
    meterBuffer: new Float32Array(analyserNode.fftSize),
    leftMeterBuffer: new Float32Array(leftAnalyserNode.fftSize),
    rightMeterBuffer: new Float32Array(rightAnalyserNode.fftSize),
    frequencyBuffer: new Float32Array(analyserNode.frequencyBinCount),
    isConnected: true,
    lastVolume: 1,
    lastPan: 0,
    lastEQGains: new Array(EQ_FREQUENCIES.length).fill(0),
    lastProcessorSignature: '',
  };
}
