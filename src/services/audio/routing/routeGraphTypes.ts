import type { AudioEqDynamicRuntimeState } from '../../../engine/audio/eq/AudioEqDynamic';
import type { SpectralGateState } from '../../../engine/audio/spectralGateProcessor';
import type { LiveAudioRouteProcessor } from '../audioGraphRouteSettings';

export interface AudioRoute {
  // AudioNode (not just MediaElementAudioSourceNode) so the same chain machinery
  // can route a generated source - e.g. the MIDI synth bus - through track
  // gain/FX/EQ/pan/meter into the shared master bus.
  sourceNode: AudioNode;
  cutGainNode: GainNode;
  gainNode: GainNode;
  panNode: StereoPannerNode;
  analyserNode: AnalyserNode;
  stereoSplitterNode: ChannelSplitterNode;
  leftAnalyserNode: AnalyserNode;
  rightAnalyserNode: AnalyserNode;
  eqFilters: BiquadFilterNode[];
  processorNodes: AudioRouteProcessorNode[];
  meterBuffer: Float32Array<ArrayBuffer>;
  leftMeterBuffer: Float32Array<ArrayBuffer>;
  rightMeterBuffer: Float32Array<ArrayBuffer>;
  frequencyBuffer: Float32Array<ArrayBuffer>;
  isConnected: boolean;
  lastVolume: number;
  lastPan: number;
  lastEQGains: number[];
  lastProcessorSignature: string;
}

export interface MasterAudioRoute {
  inputNode: GainNode;
  gainNode: GainNode;
  analyserNode: AnalyserNode;
  stereoSplitterNode: ChannelSplitterNode;
  leftAnalyserNode: AnalyserNode;
  rightAnalyserNode: AnalyserNode;
  eqFilters: BiquadFilterNode[];
  processorNodes: AudioRouteProcessorNode[];
  meterBuffer: Float32Array<ArrayBuffer>;
  leftMeterBuffer: Float32Array<ArrayBuffer>;
  rightMeterBuffer: Float32Array<ArrayBuffer>;
  frequencyBuffer: Float32Array<ArrayBuffer>;
  lastVolume: number;
  lastEQGains: number[];
  lastProcessorSignature: string;
}

export interface AudioRouteProcessorNode {
  id: string;
  type: LiveAudioRouteProcessor['type'];
  nodes: AudioNode[];
  inputNode?: AudioNode;
  outputNode?: AudioNode;
  panner?: StereoPannerNode;
  filter?: BiquadFilterNode;
  filters?: BiquadFilterNode[];
  compressor?: DynamicsCompressorNode;
  makeupGain?: GainNode;
  scriptProcessor?: ScriptProcessorNode;
  sampleProcessor?: LiveAudioRouteProcessor;
  spectralGateState?: SpectralGateState;
  dynamicEqState?: AudioEqDynamicRuntimeState;
  gainByChannel?: number[];
  envelopeByChannel?: number[];
  gainReductionDb?: number;
  delay?: DelayNode;
  feedbackGain?: GainNode;
  dryGain?: GainNode;
  wetGain?: GainNode;
  toneFilter?: BiquadFilterNode;
  convolver?: ConvolverNode;
  waveShaper?: WaveShaperNode;
  lastReverbSignature?: string;
  lastSaturationSignature?: string;
  lowBandFilter?: BiquadFilterNode;
  highBandFilter?: BiquadFilterNode;
}

export interface AudioRoutingDebugCounters {
  applyEffectsCalls: number;
  routeCreates: number;
  routeProcessorRebuilds: number;
  masterProcessorRebuilds: number;
  reverbImpulseBuilds: number;
  reverbImpulseCacheHits: number;
  reverbImpulseCacheEvictions: number;
  reverbImpulseCacheClears: number;
  reverbImpulseCacheClearedEntries: number;
  reverbImpulseBuildMsTotal: number;
  reverbImpulseBuildMsMax: number;
}

export interface ProcessorNodeUpdateDeps {
  getOrCreateReverbImpulse: (
    ctx: BaseAudioContext,
    roomSize: number,
    decaySeconds: number,
    damping: number,
  ) => AudioBuffer;
}
