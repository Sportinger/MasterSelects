// Single import point for the audio-intelligence artifact contract shared by
// the extraction layer (writers) and the agent-timeline/UI surface (readers).

export type {
  AudioSpan,
  AudioSpanListPayload,
  VoiceActivityConfig,
  VoiceActivityManifest,
  VoiceActivitySummary,
} from '../voiceActivityManifest';
export {
  decodeAudioSpanListPayload,
  encodeAudioSpanListPayload,
  float32ToSpans,
  spansToFloat32,
} from '../voiceActivityManifest';

export type {
  SpeechMarker,
  SpeechMarkerCounts,
  SpeechMarkerEvidence,
  SpeechMarkersManifest,
  SpeechMarkersPayload,
  SpeechMarkerType,
} from '../speechMarkersManifest';
export {
  countSpeechMarkers,
  decodeSpeechMarkersPayload,
  encodeSpeechMarkersPayload,
} from '../speechMarkersManifest';

export type {
  ProsodyContourManifest,
  ProsodyCurveRef,
  ProsodyMetric,
  ProsodySummary,
} from '../prosodyContourManifest';

export type {
  RoomToneCandidate,
  RoomToneNoiseFloor,
  RoomToneProfileManifest,
} from '../roomToneProfileManifest';

export type {
  AlignedWordTiming,
  TranscriptTimingManifest,
  TranscriptTimingPayload,
} from '../transcriptTimingManifest';
export {
  computeTranscriptWordsHash,
  createTranscriptTimingFingerprint,
  decodeTranscriptTimingPayload,
  encodeTranscriptTimingPayload,
  payloadToTimings,
  timingsToPayload,
} from '../transcriptTimingManifest';

export type { DenseCurvePayload, DenseCurvePayloadHeader } from '../denseCurvePayload';
export { decodeDenseCurvePayload, encodeDenseCurvePayload } from '../denseCurvePayload';
