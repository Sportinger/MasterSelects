// MasterSelects Live — shared contracts for the wave-1 streaming stack.
// This file is the orchestrator-owned boundary between the program tap
// (programTap.ts / masterTap.ts), the stream session + sinks
// (streamSession.ts, whipSink.ts, rtmpSink.ts, helperStreamClient.ts), the
// stream store (src/stores/streamStore.ts), and the Go-Live panel UI.
// Keep it free of runtime handles and side effects: types, constants, and
// pure factory functions only.

export type StreamTransport = 'rtmp' | 'whip';
export type StreamResolutionPreset = '720p' | '1080p';
export type StreamFps = 30 | 60;

/**
 * How RTMP frames leave the browser: 'helper' relays through the local Native
 * Helper, 'cloud' through the same-origin Cloudflare relay at
 * CLOUD_STREAM_RELAY_PATH, 'auto' prefers the helper when it is reachable and
 * falls back to the cloud relay.
 */
export type RtmpRelayMode = 'auto' | 'helper' | 'cloud';

/** Same-origin WebSocket path of the cloud RTMP relay (Pages Function). */
export const CLOUD_STREAM_RELAY_PATH = '/api/stream/rtmp';

export type StreamChatPlatform = 'twitch' | 'youtube';

export type LiveStreamPhase = 'idle' | 'starting' | 'live' | 'stopping' | 'error';

export interface LiveStreamConfig {
  transport: StreamTransport;
  /**
   * RTMP relay selection. Older persisted configs may lack this field —
   * consumers must treat undefined as 'auto'.
   */
  rtmpRelay: RtmpRelayMode;
  /** RTMP ingest URL without the stream key, e.g. rtmp://live.twitch.tv/app */
  rtmpUrl: string;
  /** Secret. Never log, never render un-masked. */
  rtmpStreamKey: string;
  /** WHIP endpoint URL (POST target). */
  whipUrl: string;
  /** Secret bearer token for the WHIP endpoint. Never log. */
  whipBearerToken: string;
  resolution: StreamResolutionPreset;
  fps: StreamFps;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  /** Mix the timeline/program master bus into the stream audio. */
  includeMasterAudio: boolean;
  includeMicrophone: boolean;
  microphoneDeviceId?: string;
  /** Record the program locally while streaming and import it afterwards. */
  recordLocally: boolean;
  /**
   * Chat embed shown in the Stream Chat panel. Older persisted configs may
   * lack both fields — treat undefined as 'twitch' / ''.
   */
  chatPlatform: StreamChatPlatform;
  /** Twitch channel name, or the YouTube live video id, for the chat embed. */
  chatChannel: string;
}

/** One 1 Hz health sample collected while a stream session is live. */
export interface StreamHealthSample {
  atMs: number;
  bitrateKbps: number;
  /** Cumulative dropped frames at sample time. */
  droppedFrames: number;
  queuedBytes: number;
  encodeQueueSize: number;
  audioProgram: number;
  audioMicrophone: number;
}

/** Persisted summary of one finished stream session (newest first). */
export interface StreamSessionLogEntry {
  startedAtMs: number;
  durationSeconds: number;
  transport: StreamTransport;
  relay: 'helper' | 'cloud' | null;
  avgBitrateKbps: number;
  droppedFrames: number;
  endReason: 'ended' | 'error';
  errorMessage?: string;
}

export interface LiveStreamStats {
  uptimeSeconds: number;
  droppedFrames: number;
  encodeQueueSize: number;
  bytesSent: number;
  /** Relay-side queued bytes (RTMP backpressure); 0 for WHIP. */
  queuedBytes: number;
  bitrateKbpsEstimate: number;
  audioLevels: { program: number; microphone: number };
}

export interface LiveStreamStatus {
  phase: LiveStreamPhase;
  transport: StreamTransport | null;
  /** Which RTMP relay the live session actually uses; null while not live. */
  activeRtmpRelay: 'helper' | 'cloud' | null;
  startedAtMs: number | null;
  lastError: string | null;
  /** Native Helper reachable (enables the local RTMP relay). */
  helperAvailable: boolean;
  recording: boolean;
  stats: LiveStreamStats;
}

export const STREAM_RESOLUTION_PRESETS: Record<StreamResolutionPreset, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export function createDefaultLiveStreamConfig(): LiveStreamConfig {
  return {
    transport: 'rtmp',
    rtmpRelay: 'auto',
    rtmpUrl: 'rtmp://live.twitch.tv/app',
    rtmpStreamKey: '',
    whipUrl: '',
    whipBearerToken: '',
    resolution: '1080p',
    fps: 30,
    videoBitrateKbps: 4500,
    audioBitrateKbps: 160,
    includeMasterAudio: true,
    includeMicrophone: true,
    microphoneDeviceId: undefined,
    recordLocally: false,
    chatPlatform: 'twitch',
    chatChannel: '',
  };
}

export function createIdleLiveStreamStats(): LiveStreamStats {
  return {
    uptimeSeconds: 0,
    droppedFrames: 0,
    encodeQueueSize: 0,
    bytesSent: 0,
    queuedBytes: 0,
    bitrateKbpsEstimate: 0,
    audioLevels: { program: 0, microphone: 0 },
  };
}

export function createIdleLiveStreamStatus(): LiveStreamStatus {
  return {
    phase: 'idle',
    transport: null,
    activeRtmpRelay: null,
    startedAtMs: null,
    lastError: null,
    helperAvailable: false,
    recording: false,
    stats: createIdleLiveStreamStats(),
  };
}

// ---------------------------------------------------------------------------
// Program tap (Lane A)
// ---------------------------------------------------------------------------

export interface ProgramTapOptions {
  width: number;
  height: number;
  fps: StreamFps;
  /** Attach the master-bus audio tap track when true. */
  includeMasterAudio: boolean;
}

export interface ProgramTapHandle {
  /**
   * Program video track (fixed-size letterboxed canvas capture) plus, when
   * available and requested, one audio track carrying the master-bus mix.
   */
  stream: MediaStream;
  width: number;
  height: number;
  fps: StreamFps;
  hasProgramAudio: boolean;
  /** Idempotent. Stops the tick loop, releases canvas + audio tap refs. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Sinks (Lane B)
// ---------------------------------------------------------------------------

export interface SinkStats {
  droppedFrames?: number;
  encodeQueueSize?: number;
  bytesSent?: number;
  queuedBytes?: number;
}

export interface ActiveStreamSink {
  stop(): Promise<void>;
  getStats(): SinkStats;
}

export interface StreamSinkCallbacks {
  /** Fatal transport/encoder failure — session must end the stream. */
  onFatalError(error: Error): void;
  /** Human-readable relay/connection state updates for the status line. */
  onStatusMessage?(message: string): void;
}

// ---------------------------------------------------------------------------
// Helper stream wire protocol (Lane B browser side / Lane C helper side)
// ---------------------------------------------------------------------------

/** Little-endian binary frame header size in bytes. */
export const HELPER_STREAM_FRAME_HEADER_BYTES = 12;

/** u8 kind at offset 0. */
export const HELPER_STREAM_FRAME_KIND = {
  videoConfig: 1,
  audioConfig: 2,
  video: 3,
  audio: 4,
} as const;

/** u8 flags at offset 1. */
export const HELPER_STREAM_FLAG_KEYFRAME = 0b0000_0001;

/** Offsets: kind u8 @0, flags u8 @1, reserved u16 @2, timestampUs u64le @4. */
export function encodeHelperStreamFrame(
  kind: (typeof HELPER_STREAM_FRAME_KIND)[keyof typeof HELPER_STREAM_FRAME_KIND],
  flags: number,
  timestampUs: number,
  payload: Uint8Array,
): Uint8Array {
  const frame = new Uint8Array(HELPER_STREAM_FRAME_HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, kind);
  view.setUint8(1, flags);
  view.setUint16(2, 0, true);
  view.setBigUint64(4, BigInt(Math.max(0, Math.round(timestampUs))), true);
  frame.set(payload, HELPER_STREAM_FRAME_HEADER_BYTES);
  return frame;
}

// ---------------------------------------------------------------------------
// Stream store (Lane B implements, Lane D consumes)
// ---------------------------------------------------------------------------

export interface StreamStoreApi {
  config: LiveStreamConfig;
  status: LiveStreamStatus;
  /** Persisted summaries of finished sessions, newest first, capped at 50. */
  sessionLog: StreamSessionLogEntry[];
  updateConfig(patch: Partial<LiveStreamConfig>): void;
  goLive(): Promise<void>;
  endStream(): Promise<void>;
  refreshHelperAvailability(): Promise<void>;
  clearSessionLog(): void;
}
