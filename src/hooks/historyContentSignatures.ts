import { terrainMeshHistoryToken } from '../services/planarTracking/immutableTerrainMesh';
import type { Composition, MediaFile } from '../stores/mediaStore/types';
import type { TimelineClip } from '../types/timeline';

function normalizeCompositionTimelineForHistory(timelineData: Composition['timelineData']) {
  if (!timelineData) return null;

  const {
    playheadPosition: _playheadPosition,
    zoom: _zoom,
    scrollX: _scrollX,
    ...undoableTimelineData
  } = timelineData;

  return undoableTimelineData;
}

function normalizeCompositionForHistory(
  composition: Composition,
  activeCompositionId: string | null
) {
  const { timelineData, ...undoableComposition } = composition;

  return {
    ...undoableComposition,
    timelineData: composition.id === activeCompositionId
      ? null
      : normalizeCompositionTimelineForHistory(timelineData),
  };
}

export function createCompositionHistorySignature(
  compositions: Composition[],
  activeCompositionId: string | null
): string {
  return JSON.stringify(
    compositions.map((composition) => normalizeCompositionForHistory(composition, activeCompositionId)),
    (_key, value) => value && typeof value === 'object' ? terrainMeshHistoryToken(value) ?? value : value,
  );
}

const CLIP_HISTORY_SIGNATURE_SKIP_KEYS = new Set([
  'file',
  'mediaElement',
  'videoElement',
  'audioElement',
  'waveform',
  'waveformChannels',
  'waveformGenerating',
  'waveformProgress',
  'audioAnalysisJob',
  'sourceAnalysisRefs',
  'processedAnalysisRefs',
  'mixdownBuffer',
  'thumbnailUrl',
  'proxyVideoUrl',
]);

const MEDIA_FILE_HISTORY_SIGNATURE_SKIP_KEYS = new Set([
  'file',
  'url',
  'importProgress',
  'thumbnailUrl',
  'proxyVideoUrl',
  'proxyProgress',
  'audioProxyProgress',
  'sceneCutProgress',
  'transcriptFusionProgress',
  'waveform',
  'waveformChannels',
  'waveformProgress',
  'waveformStatus',
  'audioAnalysisRefs',
]);

function isHistorySignatureBinaryPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof AudioBuffer !== 'undefined' && value instanceof AudioBuffer) return true;
  return false;
}

function isHistorySignatureDomPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (typeof Element !== 'undefined' && value instanceof Element) return true;
  if (typeof HTMLMediaElement !== 'undefined' && value instanceof HTMLMediaElement) return true;
  if (typeof File !== 'undefined' && value instanceof File) return true;
  return false;
}

function normalizeValueForHistorySignature(
  value: unknown,
  skipKeys: Set<string>,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;
  const meshToken = terrainMeshHistoryToken(value);
  if (meshToken) return meshToken;
  if (isHistorySignatureBinaryPayload(value) || isHistorySignatureDomPayload(value)) return null;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => normalizeValueForHistorySignature(item, skipKeys, seen));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto && proto !== Object.prototype) return null;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    if (skipKeys.has(key)) continue;
    const nested = normalizeValueForHistorySignature(
      (value as Record<string, unknown>)[key],
      skipKeys,
      seen,
    );
    if (nested !== undefined) {
      normalized[key] = nested;
    }
  }

  return normalized;
}

export function createTimelineClipsHistorySignature(clips: TimelineClip[]): string {
  return JSON.stringify(
    clips.map(clip => normalizeValueForHistorySignature(clip, CLIP_HISTORY_SIGNATURE_SKIP_KEYS))
  );
}

export function createTimelineMasksHistorySignature(clips: TimelineClip[]): string {
  return JSON.stringify(
    clips.map(clip => ({
      id: clip.id,
      masks: normalizeValueForHistorySignature(clip.masks ?? [], CLIP_HISTORY_SIGNATURE_SKIP_KEYS),
    }))
  );
}

export function createMediaFilesHistorySignature(files: MediaFile[]): string {
  return JSON.stringify(
    files.map(file => normalizeValueForHistorySignature(file, MEDIA_FILE_HISTORY_SIGNATURE_SKIP_KEYS))
  );
}

