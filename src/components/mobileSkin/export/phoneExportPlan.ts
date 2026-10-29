// Pure planning for the phone export: output size, frame rate, the edited-content range, and the
// codec/container choice from probed capabilities. No stores and no browser APIs, so the rules
// (portrait 1080p, no upscaling, even sizes, no 60 s padding) stay unit-testable.

/** Short side of the exported picture; compositions smaller than this are not upscaled. */
export const PHONE_EXPORT_SHORT_SIDE = 1080;

const DEFAULT_FPS = 30;
const MIN_VIDEO_BITRATE = 4_000_000;
const MAX_VIDEO_BITRATE = 16_000_000;
const BITRATE_STEP = 500_000;
const BITS_PER_PIXEL = 0.12;
const AUDIO_BITRATE = 192_000;
const AUDIO_SAMPLE_RATE = 48_000;

export interface PhoneExportCompositionInput {
  width: number;
  height: number;
  frameRate: number;
}

export interface PhoneExportClipInput {
  trackId: string;
  startTime: number;
  duration: number;
}

export interface PhoneExportTrackInput {
  id: string;
  type: string;
  visible: boolean;
  muted: boolean;
}

/** What the browser can encode, probed for the exact size and fps by the caller. */
export interface PhoneExportCapabilities {
  /** FrameExporter.isSupported(): VideoEncoder and VideoFrame exist. */
  exporterSupported: boolean;
  /** FrameExporter.checkCodecSupport('h264', width, height, fps). */
  h264: boolean;
  /** Optional WebM fallback when H.264 is missing. */
  vp9?: boolean;
  /** AudioEncoderWrapper.detectSupportedCodec(): null when no audio encoding exists. */
  audioCodec: 'aac' | 'opus' | null;
}

export interface PhoneExportPlanInput {
  composition: PhoneExportCompositionInput | null;
  clips: readonly PhoneExportClipInput[];
  tracks: readonly PhoneExportTrackInput[];
  /** Explicit timeline in/out points (null = not set). */
  inPoint: number | null;
  outPoint: number | null;
  capabilities: PhoneExportCapabilities;
  /** What layers render without (adjustment layers, adjustmentLayerExportNotes); notes overlapping the range are shown. */
  layerNotes?: readonly { startTime: number; duration: number; note: string }[];
}

export interface PhoneExportSize {
  width: number;
  height: number;
  /** True when the composition is larger than 1080 on the short side and gets scaled down. */
  scaledDown: boolean;
}

export interface PhoneExportRange {
  startTime: number;
  endTime: number;
  source: 'content' | 'in-out';
}

export interface PhoneExportPlanReady {
  supported: true;
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  durationSec: number;
  rangeSource: PhoneExportRange['source'];
  videoCodec: 'h264' | 'vp9';
  containerFormat: 'mp4' | 'webm';
  extension: 'mp4' | 'webm';
  bitrate: number;
  includeAudio: boolean;
  audioBitrate: number;
  audioSampleRate: 44100 | 48000;
  /** Visible hint about audio/codec compromises; null when nothing is compromised. */
  notice: string | null;
  summary: string;
}

export interface PhoneExportPlanBlocked {
  supported: false;
  reason: string;
  /** Best-known size, when a composition exists, so the sheet can still describe the target. */
  width: number | null;
  height: number | null;
}

export type PhoneExportPlan = PhoneExportPlanReady | PhoneExportPlanBlocked;

function evenAtLeastTwo(value: number): number {
  const rounded = 2 * Math.round(value / 2);
  return Math.max(2, rounded);
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Composition aspect, short side 1080, never upscaled: a 720x1280 composition keeps 720x1280,
 * a 2160x3840 composition becomes 1080x1920. Both sides are even (H.264 needs it).
 */
export function resolvePhoneExportSize(composition: PhoneExportCompositionInput): PhoneExportSize {
  const width = finitePositive(composition.width) ? composition.width : PHONE_EXPORT_SHORT_SIDE;
  const height = finitePositive(composition.height) ? composition.height : PHONE_EXPORT_SHORT_SIDE;
  const shortSide = Math.min(width, height);
  if (shortSide <= PHONE_EXPORT_SHORT_SIDE) {
    return { width: evenAtLeastTwo(width), height: evenAtLeastTwo(height), scaledDown: false };
  }
  const scale = PHONE_EXPORT_SHORT_SIDE / shortSide;
  // The short side is exactly 1080; the long side follows the aspect ratio.
  return {
    width: width === shortSide ? PHONE_EXPORT_SHORT_SIDE : evenAtLeastTwo(width * scale),
    height: height === shortSide ? PHONE_EXPORT_SHORT_SIDE : evenAtLeastTwo(height * scale),
    scaledDown: true,
  };
}

export function resolvePhoneExportFps(composition: PhoneExportCompositionInput): number {
  return finitePositive(composition.frameRate) ? composition.frameRate : DEFAULT_FPS;
}

/** A clip contributes when its track is shown (picture) or not muted (sound and other lanes). */
function isTrackEnabled(track: PhoneExportTrackInput): boolean {
  return track.type === 'video' ? track.visible !== false : !track.muted;
}

/** End of the last authored clip on an enabled track, or 0 when there is none. */
export function findEditedContentEnd(
  clips: readonly PhoneExportClipInput[],
  tracks: readonly PhoneExportTrackInput[],
): number {
  const enabled = new Set(tracks.filter(isTrackEnabled).map((track) => track.id));
  let end = 0;
  for (const clip of clips) {
    if (!enabled.has(clip.trackId)) continue;
    if (!Number.isFinite(clip.startTime) || !Number.isFinite(clip.duration) || clip.duration <= 0) continue;
    end = Math.max(end, clip.startTime + clip.duration);
  }
  return end;
}

/**
 * Edited-content range [0, end of the last clip]; the timeline's 60 s padded duration is never
 * used. An explicit in/out pair (either side set) wins; an open out point falls back to the
 * content end.
 */
export function resolvePhoneExportRange(
  contentEnd: number,
  inPoint: number | null,
  outPoint: number | null,
): PhoneExportRange {
  const hasIn = typeof inPoint === 'number' && Number.isFinite(inPoint);
  const hasOut = typeof outPoint === 'number' && Number.isFinite(outPoint);
  if (!hasIn && !hasOut) return { startTime: 0, endTime: contentEnd, source: 'content' };
  const startTime = Math.max(0, hasIn ? inPoint : 0);
  const endTime = hasOut ? Math.max(startTime, outPoint) : Math.max(startTime, contentEnd);
  return { startTime, endTime, source: 'in-out' };
}

function recommendedBitrate(width: number, height: number, fps: number): number {
  const raw = width * height * fps * BITS_PER_PIXEL;
  const stepped = Math.round(raw / BITRATE_STEP) * BITRATE_STEP;
  return Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, stepped));
}

export function formatPhoneExportDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function formatFps(fps: number): string {
  return `${Number.isInteger(fps) ? fps : Number(fps.toFixed(2))} fps`;
}

export function formatPhoneExportSummary(
  width: number,
  height: number,
  fps: number,
  durationSec: number,
  extension: string,
): string {
  return [
    `${width} × ${height}`,
    formatFps(fps),
    formatPhoneExportDuration(durationSec),
    extension.toUpperCase(),
  ].join(' · ');
}

function blocked(reason: string, size: PhoneExportSize | null): PhoneExportPlanBlocked {
  return { supported: false, reason, width: size?.width ?? null, height: size?.height ?? null };
}

export function buildPhoneExportPlan(input: PhoneExportPlanInput): PhoneExportPlan {
  const { composition, capabilities } = input;
  if (!composition) return blocked('Open a project with a composition before exporting.', null);

  const size = resolvePhoneExportSize(composition);
  const fps = resolvePhoneExportFps(composition);

  if (!capabilities.exporterSupported) {
    return blocked(
      'This browser cannot encode video (WebCodecs is missing). Try a current Chrome, Edge or Safari.',
      size,
    );
  }

  const contentEnd = findEditedContentEnd(input.clips, input.tracks);
  const range = resolvePhoneExportRange(contentEnd, input.inPoint, input.outPoint);
  const durationSec = range.endTime - range.startTime;
  if (!(durationSec > 0)) {
    const reason = range.source === 'in-out'
      ? 'The in/out range is empty. Move the out point after the in point.'
      : 'Nothing to export yet. Add a visible clip to the timeline first.';
    return blocked(reason, size);
  }

  let videoCodec: 'h264' | 'vp9';
  let containerFormat: 'mp4' | 'webm';
  const notes: string[] = [];
  if (capabilities.h264) {
    videoCodec = 'h264';
    containerFormat = 'mp4';
  } else if (capabilities.vp9) {
    videoCodec = 'vp9';
    containerFormat = 'webm';
    notes.push(`H.264 at ${size.width} × ${size.height} is not available here; exporting WebM (VP9), which some apps cannot open.`);
  } else {
    return blocked(
      `This browser cannot encode H.264 at ${size.width} × ${size.height} and ${formatFps(fps)}.`,
      size,
    );
  }

  const includeAudio = capabilities.audioCodec !== null;
  if (!includeAudio) {
    notes.push('This browser cannot encode audio. The file will have no sound.');
  } else if (capabilities.audioCodec === 'opus' && containerFormat === 'mp4') {
    notes.push('AAC is not available here; the sound is encoded as Opus, which some players cannot play.');
  }

  if (size.scaledDown) {
    notes.push(`Scaled down from ${Math.round(composition.width)} × ${Math.round(composition.height)}.`);
  }
  if (range.source === 'in-out') {
    notes.push('Exporting the in/out range set on the timeline.');
  }
  for (const layer of input.layerNotes ?? []) {
    if (layer.startTime < range.endTime && layer.startTime + layer.duration > range.startTime) notes.push(layer.note);
  }

  return {
    supported: true,
    width: size.width,
    height: size.height,
    fps,
    startTime: range.startTime,
    endTime: range.endTime,
    durationSec,
    rangeSource: range.source,
    videoCodec,
    containerFormat,
    extension: containerFormat,
    bitrate: recommendedBitrate(size.width, size.height, fps),
    includeAudio,
    audioBitrate: AUDIO_BITRATE,
    audioSampleRate: AUDIO_SAMPLE_RATE,
    notice: notes.length > 0 ? notes.join(' ') : null,
    summary: formatPhoneExportSummary(size.width, size.height, fps, durationSec, containerFormat),
  };
}
