import type { MediaFile } from '../../stores/mediaStore';
import type { SeedancePlanningDocument, SeedanceProjectSourceEntry } from './contracts';

export const SEEDANCE_SOURCE_BUNDLE_MAX_ENTRIES = 512;
const MAX_ENTRY_CHARACTERS = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_OTHER_CONTENT_BYTES = 4 * 1024 * 1024;

export interface SeedanceSourceBundleSnapshot {
  schemaVersion: 1;
  entries: SeedanceProjectSourceEntry[];
  fingerprint: string;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maximumBytes: number): { text: string; truncated: boolean } {
  if (value.length <= MAX_ENTRY_CHARACTERS && utf8Length(value) <= maximumBytes) {
    return { text: value, truncated: false };
  }
  let low = 0;
  let high = Math.min(value.length, MAX_ENTRY_CHARACTERS);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8Length(value.slice(0, middle)) <= maximumBytes) low = middle;
    else high = middle - 1;
  }
  return { text: value.slice(0, low), truncated: low < value.length };
}

function boundedName(value: string): string {
  const name = value.trim().slice(0, 300);
  return name || 'Untitled source';
}

function sampleUniformly<T>(values: readonly T[], maximum: number): T[] {
  if (values.length <= maximum) return [...values];
  if (maximum <= 1) return values.length === 0 ? [] : [values[0]!];
  return Array.from({ length: maximum }, (_, index) => (
    values[Math.round(index * (values.length - 1) / (maximum - 1))]!
  ));
}

function boundedArrayJson(input: {
  arrayKey: string;
  base: Record<string, unknown>;
  maximumBytes?: number;
  mode: 'prefix' | 'uniform';
  values: readonly unknown[];
}): { content: string; truncated: boolean } | undefined {
  const maximumBytes = Math.min(input.maximumBytes ?? MAX_ENTRY_CHARACTERS, MAX_ENTRY_CHARACTERS);
  const serialize = (values: readonly unknown[], truncated: boolean) => JSON.stringify({
    ...input.base,
    [input.arrayKey]: values,
    sourceItemCount: input.values.length,
    truncated,
  });
  const full = serialize(input.values, false);
  if (full.length <= MAX_ENTRY_CHARACTERS && utf8Length(full) <= maximumBytes) {
    return { content: full, truncated: false };
  }
  let low = 0;
  let high = input.values.length;
  let best = serialize([], input.values.length > 0);
  if (utf8Length(best) > maximumBytes) return undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const selected = input.mode === 'uniform'
      ? sampleUniformly(input.values, middle)
      : input.values.slice(0, middle);
    const serialized = serialize(selected, middle < input.values.length);
    if (serialized.length <= MAX_ENTRY_CHARACTERS && utf8Length(serialized) <= maximumBytes) {
      best = serialized;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { content: best, truncated: true };
}

function analysisContent(file: MediaFile): { content: string; truncated: boolean } | undefined {
  const analysis = file.analysis;
  if (!analysis) return undefined;
  const { frames, faceAnalysis: _faceAnalysis, ...summary } = analysis;
  const sanitizedFrames = frames.map((frame) => {
    const {
      faceCount: _faceCount,
      faces: _faces,
      faceModelVersion: _faceModelVersion,
      ...visualMetrics
    } = frame;
    return visualMetrics;
  });
  return boundedArrayJson({
    arrayKey: 'frames',
    base: {
      schemaVersion: 1,
      mediaFileId: file.id,
      ...summary,
    },
    mode: 'uniform',
    values: sanitizedFrames,
  });
}

function transcriptContent(
  file: MediaFile,
  maximumBytes: number,
): { content: string; truncated: boolean } | undefined {
  const words = file.transcript ?? [];
  if (words.length === 0 && file.transcriptStatus !== 'ready') return undefined;
  return boundedArrayJson({
    arrayKey: 'words',
    base: { schemaVersion: 1, mediaFileId: file.id },
    maximumBytes,
    mode: 'prefix',
    values: words,
  });
}

function hasTranscriptSource(file: MediaFile): boolean {
  return (file.transcript?.length ?? 0) > 0 || file.transcriptStatus === 'ready';
}

function sceneDescriptionContent(file: MediaFile): { content: string; truncated: boolean } | undefined {
  const scenes = file.sceneDescriptions ?? [];
  if (scenes.length === 0) return undefined;
  return boundedArrayJson({
    arrayKey: 'scenes',
    base: { schemaVersion: 1, mediaFileId: file.id },
    mode: 'prefix',
    values: scenes,
  });
}

function metadataContent(file: MediaFile): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: file.id,
    name: file.name,
    type: file.type,
    duration: file.duration,
    width: file.width,
    height: file.height,
    fps: file.fps,
    codec: file.codec,
    audioCodec: file.audioCodec,
    container: file.container,
    fileSize: file.fileSize,
    hasAudio: file.hasAudio,
    transcriptStatus: file.transcriptStatus,
    analysisStatus: file.analysisStatus,
    sceneDescriptionStatus: file.sceneDescriptionStatus,
  });
}

function visualSourceFingerprint(file: MediaFile): string | undefined {
  return typeof file.fileHash === 'string' && /^[a-f0-9]{64}$/u.test(file.fileHash)
    ? file.fileHash
    : undefined;
}

function visualFrameManifestContent(file: MediaFile): string | undefined {
  const durationSeconds = file.duration;
  if (file.type !== 'video' || typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
  const frameCount = Math.ceil(durationSeconds);
  return JSON.stringify({
    schemaVersion: 1,
    mediaFileId: file.id.slice(0, 200),
    ...(visualSourceFingerprint(file) === undefined
      ? {}
      : { sourceFingerprint: visualSourceFingerprint(file) }),
    durationSeconds,
    intervalSeconds: 1,
    frameCount,
    contactSheetFrameCount: 16,
    contactSheetCount: Math.ceil(frameCount / 16),
    frameWidth: 320,
    frameHeight: 180,
    contactSheetWidth: 640,
    contactSheetHeight: 432,
  });
}

function canonicalSourceBundleJson(entries: readonly SeedanceProjectSourceEntry[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    entries: entries.map((entry) => ({
      schemaVersion: 1,
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      mimeType: entry.mimeType,
      content: entry.content,
      truncated: entry.truncated,
      ...(entry.sourceMediaId === undefined ? {} : { sourceMediaId: entry.sourceMediaId }),
    })),
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSeedanceSourceBundleSnapshot(input: {
  documents: readonly SeedancePlanningDocument[];
  mediaFiles: readonly MediaFile[];
}): Promise<SeedanceSourceBundleSnapshot> {
  const entries: SeedanceProjectSourceEntry[] = [];
  let remainingTranscriptBytes = MAX_TRANSCRIPT_CONTENT_BYTES;
  let remainingOtherBytes = MAX_OTHER_CONTENT_BYTES;
  const append = (
    candidate: SeedanceProjectSourceEntry,
    budget: 'transcript' | 'other' = 'other',
  ): void => {
    const remainingBytes = budget === 'transcript'
      ? remainingTranscriptBytes
      : remainingOtherBytes;
    if (entries.length >= SEEDANCE_SOURCE_BUNDLE_MAX_ENTRIES || remainingBytes <= 0) return;
    const bounded = truncateUtf8(candidate.content, Math.min(remainingBytes, MAX_ENTRY_CHARACTERS));
    if (!bounded.text.trim()) return;
    entries.push({
      ...candidate,
      content: bounded.text,
      truncated: candidate.truncated || bounded.truncated,
    });
    if (budget === 'transcript') remainingTranscriptBytes -= utf8Length(bounded.text);
    else remainingOtherBytes -= utf8Length(bounded.text);
  };

  // Transcripts have a dedicated aggregate 2 MiB budget so documents and
  // metadata cannot silently squeeze them out of the creative-root context.
  const transcriptFiles = input.mediaFiles.filter(hasTranscriptSource);
  for (const [index, file] of transcriptFiles.entries()) {
    const sourcesRemaining = transcriptFiles.length - index;
    const fairMaximum = Math.floor(remainingTranscriptBytes / sourcesRemaining);
    const transcript = transcriptContent(file, fairMaximum);
    if (!transcript) continue;
    append({
      schemaVersion: 1,
      id: `media:${file.id}:transcript`.slice(0, 200),
      kind: 'transcript',
      name: boundedName(`${file.name} transcript`),
      mimeType: 'application/json',
      content: transcript.content,
      truncated: transcript.truncated,
      sourceMediaId: file.id.slice(0, 200),
    }, 'transcript');
  }

  for (const document of input.documents) {
    append({
      schemaVersion: 1,
      id: `document:${document.id}`.slice(0, 200),
      kind: 'document',
      name: boundedName(document.name),
      mimeType: boundedName(document.mimeType).slice(0, 120),
      content: document.text,
      truncated: document.truncated,
    });
  }

  for (const file of input.mediaFiles) {
    const sourceMediaId = file.id.slice(0, 200);
    const visualFrameManifest = visualFrameManifestContent(file);
    if (visualFrameManifest) append({
      schemaVersion: 1,
      id: `media:${file.id}:visual-frames`.slice(0, 200),
      kind: 'visual-frame-manifest',
      name: boundedName(`${file.name} visual frames`),
      mimeType: 'application/json',
      content: visualFrameManifest,
      truncated: false,
      sourceMediaId,
    });
    append({
      schemaVersion: 1,
      id: `media:${file.id}:metadata`.slice(0, 200),
      kind: 'media-metadata',
      name: boundedName(`${file.name} metadata`),
      mimeType: 'application/json',
      content: metadataContent(file),
      truncated: false,
      sourceMediaId,
    });
    const analysis = analysisContent(file);
    if (analysis) append({
      schemaVersion: 1,
      id: `media:${file.id}:analysis`.slice(0, 200),
      kind: 'analysis',
      name: boundedName(`${file.name} analysis`),
      mimeType: 'application/json',
      content: analysis.content,
      truncated: analysis.truncated,
      sourceMediaId,
    });
    const scenes = sceneDescriptionContent(file);
    if (scenes) append({
      schemaVersion: 1,
      id: `media:${file.id}:scenes`.slice(0, 200),
      kind: 'scene-descriptions',
      name: boundedName(`${file.name} scene descriptions`),
      mimeType: 'application/json',
      content: scenes.content,
      truncated: scenes.truncated,
      sourceMediaId,
    });
  }

  return {
    schemaVersion: 1,
    entries,
    fingerprint: await sha256(canonicalSourceBundleJson(entries)),
  };
}
