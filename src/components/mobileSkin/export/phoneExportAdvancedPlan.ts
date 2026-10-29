// Pure planning for the Advanced export: the person's choices (format, size, frame rate, quality,
// range, sound) plus the project state become one run spec, or a visible reason why not. No
// stores and no browser APIs, so every rule is unit-testable.
import {
  findEditedContentEnd,
  formatPhoneExportDuration,
  formatPhoneExportSummary,
  resolvePhoneExportFps,
  resolvePhoneExportRange,
  type PhoneExportClipInput,
  type PhoneExportCompositionInput,
  type PhoneExportTrackInput,
} from './phoneExportPlan';
import {
  getPhoneExportFormat,
  hasBitrate,
  rendersPictures,
  resolvePhoneFormatAvailability,
  type PhoneExportBrowserCapabilities,
  type PhoneExportFormatId,
  type PhoneExportKind,
  type PhoneVideoCodec,
} from './phoneExportFormats';

export const PHONE_EXPORT_SHORT_SIDES = [2160, 1440, 1080, 720, 480] as const;
export const PHONE_EXPORT_FRAME_RATES = [24, 25, 30, 50, 60] as const;
export const PHONE_EXPORT_QUALITIES = ['low', 'medium', 'high', 'max'] as const;
export const PHONE_EXPORT_IMAGE_FORMATS = ['png', 'jpg', 'webp'] as const;
export const PHONE_EXPORT_PRORES_PROFILES = ['proxy', 'lt', 'standard', 'hq', '4444'] as const;

export const MIN_EXPORT_SIDE = 16;
export const MAX_EXPORT_SIDE = 7680;
const MIN_FPS = 1;
const MAX_FPS = 120;
const MIN_BITRATE = 500_000;
const MAX_BITRATE = 100_000_000;
const QUALITY_BITS_PER_PIXEL: Record<PhoneExportQuality, number> = { low: 0.05, medium: 0.08, high: 0.12, max: 0.2 };

export type PhoneExportQuality = (typeof PHONE_EXPORT_QUALITIES)[number];
export type PhoneExportImageFormat = (typeof PHONE_EXPORT_IMAGE_FORMATS)[number];
export type PhoneExportProResProfile = (typeof PHONE_EXPORT_PRORES_PROFILES)[number];
export type PhoneExportRangeMode = 'content' | 'in-out' | 'selection';

export interface PhoneAdvancedSettings {
  formatId: PhoneExportFormatId;
  /** 'composition' keeps the composition size; a number is the short side; 'custom' uses width/height. */
  resolution: 'composition' | (typeof PHONE_EXPORT_SHORT_SIDES)[number] | 'custom';
  customWidth: number;
  customHeight: number;
  /** 'composition' keeps its frame rate. */
  fps: 'composition' | number;
  quality: PhoneExportQuality | 'custom';
  /** Used when quality is 'custom' (bits per second). */
  customBitrate: number;
  rateControl: 'vbr' | 'cbr';
  range: PhoneExportRangeMode;
  includeAudio: boolean;
  imageFormat: PhoneExportImageFormat;
  proresProfile: PhoneExportProResProfile;
}

export function createDefaultPhoneAdvancedSettings(composition: PhoneExportCompositionInput | null): PhoneAdvancedSettings {
  return {
    formatId: 'mp4-h264',
    resolution: 'composition',
    customWidth: even(composition?.width ?? 1080),
    customHeight: even(composition?.height ?? 1920),
    fps: 'composition',
    quality: 'high',
    customBitrate: 10_000_000,
    rateControl: 'vbr',
    range: 'content',
    includeAudio: true,
    imageFormat: 'png',
    proresProfile: 'hq',
  };
}

export interface PhoneAdvancedContext {
  composition: PhoneExportCompositionInput | null;
  clips: readonly (PhoneExportClipInput & { id: string })[];
  tracks: readonly PhoneExportTrackInput[];
  inPoint: number | null;
  outPoint: number | null;
  selectedClipIds: ReadonlySet<string> | readonly string[];
  playhead: number;
  capabilities: PhoneExportBrowserCapabilities;
  /** What layers render without (adjustment layers, adjustmentLayerExportNotes); notes overlapping the range are shown. */
  layerNotes?: readonly { startTime: number; duration: number; note: string }[];
}

export interface PhoneExportRunSpec {
  kind: Exclude<PhoneExportKind, 'desktop-only'>;
  formatId: PhoneExportFormatId;
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  durationSec: number;
  /** Still frame: the time that is rendered. */
  exportTime: number;
  videoCodec: PhoneVideoCodec;
  container: 'mp4' | 'webm';
  bitrate: number;
  rateControl: 'vbr' | 'cbr';
  includeAudio: boolean;
  audioFormat: 'wav' | 'mp3' | 'browser';
  audioSampleRate: 44100 | 48000;
  audioBitrate: number;
  imageFormat: PhoneExportImageFormat;
  ffmpegCodec: 'prores' | 'dnxhd';
  proresProfile: PhoneExportProResProfile;
  extension: string;
  summary: string;
  notice: string | null;
}

export type PhoneAdvancedPlan =
  | { supported: true; spec: PhoneExportRunSpec }
  | { supported: false; reason: string; size: { width: number; height: number } | null };

function even(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Clamped to the editor's limits and made even; `clamped` says when the value had to change. */
export function clampExportSide(value: number): { value: number; clamped: boolean } {
  const safe = finitePositive(value) ? value : MIN_EXPORT_SIDE;
  const bounded = Math.min(MAX_EXPORT_SIDE, Math.max(MIN_EXPORT_SIDE, safe));
  const result = even(bounded);
  return { value: result, clamped: result !== Math.round(value) };
}

export function resolveAdvancedSize(
  settings: Pick<PhoneAdvancedSettings, 'resolution' | 'customWidth' | 'customHeight'>,
  composition: PhoneExportCompositionInput,
): { width: number; height: number; notes: string[] } {
  const compWidth = finitePositive(composition.width) ? composition.width : 1080;
  const compHeight = finitePositive(composition.height) ? composition.height : 1920;
  const notes: string[] = [];
  if (settings.resolution === 'composition') return { width: even(compWidth), height: even(compHeight), notes };
  if (settings.resolution === 'custom') {
    const width = clampExportSide(settings.customWidth);
    const height = clampExportSide(settings.customHeight);
    if (width.clamped || height.clamped) {
      notes.push(`Size adjusted to ${width.value} × ${height.value} (even numbers between ${MIN_EXPORT_SIDE} and ${MAX_EXPORT_SIDE}).`);
    }
    return { width: width.value, height: height.value, notes };
  }
  const shortSide = Math.min(compWidth, compHeight);
  const scale = settings.resolution / shortSide;
  const width = compWidth === shortSide ? settings.resolution : even(compWidth * scale);
  const height = compHeight === shortSide ? settings.resolution : even(compHeight * scale);
  if (scale > 1) notes.push(`Upscaled from ${Math.round(compWidth)} × ${Math.round(compHeight)}.`);
  return { width, height, notes };
}

export function resolveAdvancedFps(settings: Pick<PhoneAdvancedSettings, 'fps'>, composition: PhoneExportCompositionInput): number {
  if (settings.fps === 'composition') return resolvePhoneExportFps(composition);
  if (!finitePositive(settings.fps)) return resolvePhoneExportFps(composition);
  return Math.min(MAX_FPS, Math.max(MIN_FPS, settings.fps));
}

export function resolveAdvancedBitrate(
  settings: Pick<PhoneAdvancedSettings, 'quality' | 'customBitrate'>,
  width: number,
  height: number,
  fps: number,
): number {
  const raw = settings.quality === 'custom'
    ? settings.customBitrate
    : width * height * fps * QUALITY_BITS_PER_PIXEL[settings.quality];
  const stepped = Math.round((finitePositive(raw) ? raw : MIN_BITRATE) / 100_000) * 100_000;
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, stepped));
}

/** Start/end of the selected clips, null when nothing is selected. */
export function resolveSelectionRange(
  clips: readonly (PhoneExportClipInput & { id: string })[],
  selected: ReadonlySet<string> | readonly string[],
): { startTime: number; endTime: number } | null {
  const ids = selected instanceof Set ? selected : new Set(selected as readonly string[]);
  const chosen = clips.filter((clip) => ids.has(clip.id) && Number.isFinite(clip.startTime) && clip.duration > 0);
  if (chosen.length === 0) return null;
  return {
    startTime: Math.max(0, Math.min(...chosen.map((clip) => clip.startTime))),
    endTime: Math.max(...chosen.map((clip) => clip.startTime + clip.duration)),
  };
}

export function hasInOutPoints(inPoint: number | null, outPoint: number | null): boolean {
  return Number.isFinite(inPoint ?? NaN) || Number.isFinite(outPoint ?? NaN);
}

export function buildPhoneAdvancedPlan(settings: PhoneAdvancedSettings, context: PhoneAdvancedContext): PhoneAdvancedPlan {
  const { composition } = context;
  if (!composition) return { supported: false, reason: 'Open a project with a composition before exporting.', size: null };
  const format = getPhoneExportFormat(settings.formatId);
  const pictures = rendersPictures(format);
  const { width, height, notes } = pictures
    ? resolveAdvancedSize(settings, composition)
    : { width: even(composition.width || 1080), height: even(composition.height || 1920), notes: [] as string[] };
  const fps = resolveAdvancedFps(settings, composition);
  const size = { width, height };

  const availability = resolvePhoneFormatAvailability(format, context.capabilities, size);
  if (!availability.available) return { supported: false, reason: availability.reason, size };
  if (availability.notice) notes.push(availability.notice);
  if (format.kind === 'desktop-only') return { supported: false, reason: 'Not in the phone export yet.', size };

  let startTime = 0;
  let endTime = 0;
  const exportTime = Math.max(0, context.playhead);
  if (format.kind !== 'still') {
    const contentEnd = findEditedContentEnd(context.clips, context.tracks);
    if (settings.range === 'selection') {
      const selection = resolveSelectionRange(context.clips, context.selectedClipIds);
      if (!selection) return { supported: false, reason: 'Select one or more clips first, or choose another range.', size };
      ({ startTime, endTime } = selection);
      notes.push('Exporting the time of the selected clips.');
    } else if (settings.range === 'in-out' && hasInOutPoints(context.inPoint, context.outPoint)) {
      ({ startTime, endTime } = resolvePhoneExportRange(contentEnd, context.inPoint, context.outPoint));
      notes.push('Exporting the in/out range.');
    } else {
      if (settings.range === 'in-out') notes.push('No in or out point is set, so the whole edit is exported.');
      endTime = contentEnd;
    }
    if (!(endTime - startTime > 0)) {
      return { supported: false, reason: settings.range === 'content'
        ? 'Nothing to export yet. Add a visible clip to the timeline first.'
        : 'The chosen range is empty.', size };
    }
  }

  if (format.kind !== 'audio') {
    // A still shows the frame at the playhead; a moving export its range.
    const [from, to] = format.kind === 'still' ? [exportTime, exportTime + 1e-6] : [startTime, endTime];
    for (const layer of context.layerNotes ?? []) {
      if (layer.startTime < to && layer.startTime + layer.duration > from) notes.push(layer.note);
    }
  }

  const includeAudio = format.kind === 'audio' || (settings.includeAudio && (format.kind === 'webcodecs' || format.kind === 'ffmpeg'));
  if (format.kind === 'webcodecs' && includeAudio && context.capabilities.audioCodec === null) {
    notes.push('This browser cannot encode audio. The file will have no sound.');
  }
  const extension = format.kind === 'still'
    ? settings.imageFormat
    : format.kind === 'audio' && format.audioFormat === 'browser'
      ? 'aac'
      : format.extension;
  const durationSec = format.kind === 'still' ? 0 : endTime - startTime;
  const summary = format.kind === 'still'
    ? `${width} × ${height} · frame at ${exportTime.toFixed(2)} s · ${extension.toUpperCase()}`
    : format.kind === 'audio'
      ? `Sound only · ${formatPhoneExportDuration(durationSec)} · ${extension.toUpperCase()}`
      : formatPhoneExportSummary(width, height, fps, durationSec, format.kind === 'sequence' ? `${settings.imageFormat} sequence` : extension);

  return {
    supported: true,
    spec: {
      kind: format.kind,
      formatId: format.id,
      width,
      height,
      fps,
      startTime,
      endTime,
      durationSec,
      exportTime,
      videoCodec: format.videoCodec ?? 'h264',
      container: format.container ?? 'mp4',
      bitrate: hasBitrate(format) ? resolveAdvancedBitrate(settings, width, height, fps) : 0,
      rateControl: settings.rateControl,
      includeAudio: format.kind === 'webcodecs' ? includeAudio && context.capabilities.audioCodec !== null : includeAudio,
      audioFormat: format.audioFormat ?? 'browser',
      audioSampleRate: 48000,
      audioBitrate: 192_000,
      imageFormat: settings.imageFormat,
      ffmpegCodec: format.ffmpegCodec ?? 'prores',
      proresProfile: settings.proresProfile,
      extension,
      summary,
      notice: notes.length > 0 ? notes.join(' ') : null,
    },
  };
}
