import type { SerializableClip, TimelineClip } from '../../types';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import type { FrameContext } from '../layerBuilder/types';
import { Logger } from '../logger';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';
import { renderHostPort } from '../render/renderHostPort';
import { flags } from '../../engine/featureFlags';
import {
  createMediaObjectUrl,
  createPrimaryMediaObjectUrl,
  getLazyMediaElementObjectUrlKey,
  mediaObjectUrlManager,
} from '../project/mediaObjectUrlManager';
import type { RuntimeProviderDemand } from '../../timeline';
import type { HtmlMediaResourceDescriptor, RenderResourceDescriptor } from './runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from './runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';
import { hasNativeDecoderForTimelineClip } from './nativeDecoderRuntimeRegistry';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { getRuntimeTransition, transitionIncludesAudio } from '../../transitions';
import { clipTreeNeedsLiveVideoElement } from './liveInputClipTree';

type LazyMediaKind = 'video' | 'audio';

interface LazyMediaRecord {
  clipId: string;
  trackId: string;
  kind: LazyMediaKind;
  clip: TimelineClip;
  element: HTMLVideoElement | HTMLAudioElement;
  mediaFileId?: string;
  managedObjectUrl?: {
    mediaId: string;
    key: string;
    url: string;
  };
  objectUrl?: string;
  sourceUrl?: string;
  lastDesiredAt: number;
  createdAt: number;
}

const log = Logger.create('LazyMediaElements');

const VIDEO_LOOKBEHIND_SECONDS = 0.35;
const VIDEO_LOOKAHEAD_SECONDS = 2.0;
const AUDIO_LOOKBEHIND_SECONDS = 0.2;
const AUDIO_LOOKAHEAD_SECONDS = 1.25;
const IDLE_RELEASE_MS = 1800;
const MAX_LAZY_MEDIA_ELEMENTS = 24;
const MAX_DESIRED_CLIPS_PER_TRACK = 3;
const NATIVE_FILE_REFERENCE_PREFIX = 'native-helper-file://';

const lazyMediaRecords = new Map<string, LazyMediaRecord>();
const nativeReferenceResolutions = new Map<string, Promise<void>>();

type NativeReferenceClient = {
  parseFileReferenceUrl?: (url: string | undefined) => string | null;
  getReferencedFile?: (url: string, fileName: string) => Promise<File | null>;
};

interface LazyClipCandidate {
  clip: TimelineClip;
  trackKey: string;
  rankStartTime: number;
  rankDuration: number;
}

function getRecordKey(kind: LazyMediaKind, clipId: string): string {
  return `${kind}:${clipId}`;
}

function getResourceId(record: Pick<LazyMediaRecord, 'kind' | 'clipId'>): string {
  return `timeline-lazy-media:${record.kind}:${record.clipId}`;
}

function getSourceKindFromUrl(url: string | undefined): HtmlMediaResourceDescriptor['srcKind'] {
  if (!url) return 'unknown';
  if (url.startsWith('blob:')) return 'blob-url';
  if (url.startsWith('http')) return 'remote-url';
  if (url.startsWith('mediastream:')) return 'media-source';
  return 'unknown';
}

function getUsableFile(file: File | undefined): File | undefined {
  return file && (typeof file.size !== 'number' || file.size > 0) ? file : undefined;
}

function getMediaFileForLazyClip(ctx: FrameContext, clip: TimelineClip) {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (mediaFileId) {
    const mediaFile = ctx.mediaFileById.get(mediaFileId);
    if (mediaFile) return mediaFile;
  }

  return clip.name ? ctx.mediaFileByName.get(clip.name.replace(/ \(Audio\)$/, '')) ?? ctx.mediaFileByName.get(clip.name) : undefined;
}

function parseNativeFileReferenceUrl(url: string | undefined): string | null {
  if (!url?.startsWith(NATIVE_FILE_REFERENCE_PREFIX)) return null;

  const client = NativeHelperClient as NativeReferenceClient;
  return typeof client.parseFileReferenceUrl === 'function'
    ? client.parseFileReferenceUrl(url)
    : null;
}

function getNativeReferencedFile(url: string, fileName: string): Promise<File | null> {
  const client = NativeHelperClient as NativeReferenceClient;
  return typeof client.getReferencedFile === 'function'
    ? client.getReferencedFile(url, fileName)
    : Promise.resolve(null);
}

function ensureNativeReferenceResolved(mediaFile: MediaFile, sourceUrl: string): void {
  const nativePath = parseNativeFileReferenceUrl(sourceUrl);
  if (!nativePath) return;

  const resolutionKey = `${mediaFile.id}:${sourceUrl}`;
  if (nativeReferenceResolutions.has(resolutionKey)) return;

  const resolution = getNativeReferencedFile(sourceUrl, mediaFile.name)
    .then((file) => {
      if (!file) return;

      const url = createPrimaryMediaObjectUrl(mediaFile.id, file);
      useMediaStore.setState((state) => ({
        files: state.files.map((entry) => (
          entry.id === mediaFile.id
            ? {
                ...entry,
                file,
                url,
                hasFileHandle: true,
                absolutePath: entry.absolutePath ?? nativePath,
              }
            : entry
        )),
      }));
      renderHostPort.requestNewFrameRender();
    })
    .catch((error) => {
      log.warn('Could not resolve native lazy media reference', {
        mediaFileId: mediaFile.id,
        name: mediaFile.name,
        error,
      });
    })
    .finally(() => {
      nativeReferenceResolutions.delete(resolutionKey);
    });

  nativeReferenceResolutions.set(resolutionKey, resolution);
}

function getLazySource(ctx: FrameContext, clip: TimelineClip, kind: LazyMediaKind): {
  url: string;
  objectUrl?: string;
  managedObjectUrl?: LazyMediaRecord['managedObjectUrl'];
} | null {
  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  const mediaUrl = mediaFile?.url;
  const nativeReferenceUrl = mediaUrl && parseNativeFileReferenceUrl(mediaUrl)
    ? mediaUrl
    : null;

  if (mediaUrl && !nativeReferenceUrl) {
    return { url: mediaUrl };
  }

  const file = getUsableFile(clip.file) ?? getUsableFile(clip.source?.file) ?? getUsableFile(mediaFile?.file);
  const mediaId = mediaFile?.id ?? clip.source?.mediaFileId ?? clip.mediaFileId;
  if (file && mediaId) {
    const key = getLazyMediaElementObjectUrlKey(kind, clip.id);
    const existingUrl = mediaObjectUrlManager.get(mediaId, key);
    const url = existingUrl ?? createMediaObjectUrl(mediaId, key, file);
    return {
      url,
      managedObjectUrl: {
        mediaId,
        key,
        url,
      },
    };
  }

  if (file) {
    const objectUrl = URL.createObjectURL(file);
    return { url: objectUrl, objectUrl };
  }

  if (nativeReferenceUrl && mediaFile) {
    ensureNativeReferenceResolved(mediaFile, nativeReferenceUrl);
  }

  return null;
}

function updateNaturalDuration(
  clip: TimelineClip,
  element: HTMLMediaElement,
  ctx: FrameContext,
): void {
  if (!Number.isFinite(element.duration) || element.duration <= 0) return;
  if (!clip.source) return;

  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  const importedDuration = mediaFile?.duration;
  const naturalDuration = importedDuration !== undefined && Number.isFinite(importedDuration) && importedDuration > 0
    ? importedDuration
    : element.duration;
  clip.source.naturalDuration = naturalDuration;
  if (!Number.isFinite(mediaFile?.duration) && naturalDuration > 0) {
    // Media store duration updates are handled by project/import code. This keeps
    // the active runtime clip accurate without forcing a broad store write.
    clip.duration = clip.duration || naturalDuration;
    clip.outPoint = clip.outPoint || naturalDuration;
  }
}

function createVideoElement(url: string, preload: HTMLMediaElement['preload']): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = url;
  video.preload = preload;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  return video;
}

function createAudioElement(url: string, preload: HTMLMediaElement['preload']): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.src = url;
  audio.preload = preload;
  return audio;
}

function createLazyMediaDemand(params: {
  clip: TimelineClip;
  kind: LazyMediaKind;
  trackId: string;
  mediaFileId?: string;
}): RuntimeProviderDemand {
  const owner: RuntimeProviderDemand['owner'] = {
    ownerId: params.clip.id,
    ownerType: 'clip',
    clipId: params.clip.id,
    trackId: params.trackId,
  };
  const source: RuntimeProviderDemand['source'] = {
    clipId: params.clip.id,
    trackId: params.trackId,
  };
  if (params.mediaFileId) {
    owner.mediaFileId = params.mediaFileId;
    source.mediaFileId = params.mediaFileId;
  }

  return {
    id: getResourceId({ kind: params.kind, clipId: params.clip.id }),
    facetId: `lazy-media:${params.kind}:${params.clip.id}`,
    resourceKind: 'html-media',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner,
    source,
    dimensions: {
      durationSeconds: params.clip.source?.naturalDuration ?? params.clip.duration,
    },
    priority: 'visible',
    tags: ['primary-lazy-media', params.kind],
  };
}

function createLazyMediaDescriptor(params: {
  clip: TimelineClip;
  kind: LazyMediaKind;
  trackId: string;
  mediaFileId?: string;
  sourceUrl?: string;
  plannedSrcKind?: HtmlMediaResourceDescriptor['srcKind'];
  element?: HTMLVideoElement | HTMLAudioElement;
}): RenderResourceDescriptor & { kind: 'html-media' } {
  const demand = createLazyMediaDemand(params);
  const element = params.element;
  const providerKind = params.kind === 'video' ? 'html-video' : 'html-audio';
  const status = element?.error ? 'warning' : 'unknown';
  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'html-media',
    mediaElementKind: params.kind,
    elementId: getRecordKey(params.kind, params.clip.id),
    srcKind: params.plannedSrcKind ?? getSourceKindFromUrl(params.sourceUrl),
    diagnostics: {
      status,
      provider: {
        providerId: getRecordKey(params.kind, params.clip.id),
        providerKind,
        status,
        isReady: element ? element.readyState >= HTMLMediaElement.HAVE_METADATA : false,
        isPlaying: element ? !element.paused : false,
        isSeeking: element?.seeking ?? false,
        currentTimeSeconds: element?.currentTime,
        readyState: element?.readyState,
        networkState: element?.networkState,
        errorCode: element?.error ? String(element.error.code) : undefined,
      },
    },
    label: `Lazy ${params.kind} element`,
  }) as RenderResourceDescriptor & { kind: 'html-media' };
}

function classifyLazySource(record: LazyMediaRecord): RenderResourceDescriptor & { kind: 'html-media' } {
  return createLazyMediaDescriptor({
    clip: record.clip,
    kind: record.kind,
    trackId: record.trackId,
    mediaFileId: record.mediaFileId,
    sourceUrl: record.sourceUrl,
    plannedSrcKind: record.objectUrl ? 'blob-url' : undefined,
    element: record.element,
  });
}

function getPlannedLazySourceKind(ctx: FrameContext, clip: TimelineClip): {
  mediaFileId?: string;
  srcKind: HtmlMediaResourceDescriptor['srcKind'];
} {
  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id;
  if (mediaFile?.url) {
    return { mediaFileId, srcKind: getSourceKindFromUrl(mediaFile.url) };
  }

  const file = getUsableFile(clip.file) ?? getUsableFile(clip.source?.file) ?? getUsableFile(mediaFile?.file);
  if (file) {
    return { mediaFileId, srcKind: 'blob-url' };
  }

  return { mediaFileId, srcKind: 'unknown' };
}

function canAttachLazyMedia(ctx: FrameContext, clip: TimelineClip, kind: LazyMediaKind): boolean {
  const planned = getPlannedLazySourceKind(ctx, clip);
  const admission = timelineRuntimeCoordinator.canRetainResource(createLazyMediaDescriptor({
    clip,
    kind,
    trackId: clip.trackId,
    mediaFileId: planned.mediaFileId,
    plannedSrcKind: planned.srcKind,
  }));
  if (!admission.admitted) {
    log.debug('Lazy media element skipped by runtime admission', {
      clipId: clip.id,
      kind,
      reason: admission.reason,
      rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
    });
  }
  return admission.admitted;
}

function revokeManagedObjectUrl(managedObjectUrl: LazyMediaRecord['managedObjectUrl']): void {
  if (!managedObjectUrl) return;
  const currentManagedUrl = mediaObjectUrlManager.get(managedObjectUrl.mediaId, managedObjectUrl.key);
  if (currentManagedUrl === managedObjectUrl.url) {
    mediaObjectUrlManager.revoke(managedObjectUrl.mediaId, managedObjectUrl.key);
    return;
  }
  URL.revokeObjectURL(managedObjectUrl.url);
}

function reportLazyMediaRecord(record: LazyMediaRecord): void {
  timelineRuntimeCoordinator.retainResource(classifyLazySource(record));
}

function releaseLazyMediaRecord(record: Pick<LazyMediaRecord, 'kind' | 'clipId'>): void {
  timelineRuntimeCoordinator.releaseResource(getResourceId(record));
}

function replaceLazyRecord(key: string, record: LazyMediaRecord, ctx: FrameContext): void {
  const existing = lazyMediaRecords.get(key);
  if (existing && existing.element !== record.element) {
    detachRecord(existing, ctx);
  }
  lazyMediaRecords.set(key, record);
  reportLazyMediaRecord(record);
}

function attachVideoElement(ctx: FrameContext, clip: TimelineClip, now: number): void {
  if (
    !clip.source ||
    clip.source.type !== 'video' ||
    clip.source.videoElement ||
    (hasNativeDecoderForTimelineClip(clip) && !clip.freeRun)
  ) return;
  if (!canAttachLazyMedia(ctx, clip, 'video')) return;

  const source = getLazySource(ctx, clip, 'video');
  if (!source) return;

  const video = createVideoElement(source.url, ctx.isPlaying ? 'auto' : 'metadata');
  const key = getRecordKey('video', clip.id);
  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  const record: LazyMediaRecord = {
    clipId: clip.id,
    trackId: clip.trackId,
    kind: 'video',
    clip,
    element: video,
    mediaFileId: clip.source.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id,
    managedObjectUrl: source.managedObjectUrl,
    objectUrl: source.objectUrl,
    sourceUrl: source.url,
    lastDesiredAt: now,
    createdAt: now,
  };
  replaceLazyRecord(key, record, ctx);

  clip.source = {
    ...clip.source,
    videoElement: video,
    mediaFileId: clip.source.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id,
    naturalDuration: clip.source.naturalDuration ?? mediaFile?.duration ?? clip.duration,
  };
  clip.isLoading = false;
  clip.needsReload = false;

  video.addEventListener('loadedmetadata', () => {
    updateNaturalDuration(clip, video, ctx);
  }, { once: true });
  video.load();
}

function attachAudioElement(ctx: FrameContext, clip: TimelineClip, now: number): void {
  if (!clip.source || clip.source.type !== 'audio' || clip.source.audioElement) return;
  if (!canAttachLazyMedia(ctx, clip, 'audio')) return;

  const source = getLazySource(ctx, clip, 'audio');
  if (!source) return;

  const audio = createAudioElement(source.url, ctx.isPlaying ? 'auto' : 'metadata');
  const key = getRecordKey('audio', clip.id);
  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  const record: LazyMediaRecord = {
    clipId: clip.id,
    trackId: clip.trackId,
    kind: 'audio',
    clip,
    element: audio,
    mediaFileId: clip.source.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id,
    managedObjectUrl: source.managedObjectUrl,
    objectUrl: source.objectUrl,
    sourceUrl: source.url,
    lastDesiredAt: now,
    createdAt: now,
  };
  replaceLazyRecord(key, record, ctx);

  clip.source = {
    ...clip.source,
    audioElement: audio,
    mediaFileId: clip.source.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id,
    naturalDuration: clip.source.naturalDuration ?? mediaFile?.duration ?? clip.duration,
  };
  clip.isLoading = false;
  clip.needsReload = false;

  audio.addEventListener('loadedmetadata', () => updateNaturalDuration(clip, audio, ctx), { once: true });
  audio.load();
}

function findClipById(clips: readonly TimelineClip[], clipId: string): TimelineClip | undefined {
  for (const clip of clips) {
    if (clip.id === clipId) return clip;
    const nestedClip = clip.nestedClips ? findClipById(clip.nestedClips, clipId) : undefined;
    if (nestedClip) return nestedClip;
  }

  return undefined;
}

function detachRecord(record: LazyMediaRecord, ctx?: Pick<FrameContext, 'clips'>): void {
  const clip = ctx ? findClipById(ctx.clips, record.clipId) ?? record.clip : record.clip;
  const element = record.element;
  releaseLazyMediaRecord(record);

  element.pause();
  if (record.kind === 'video') {
    renderHostPort.cleanupVideo(element as HTMLVideoElement);
  }
  element.removeAttribute('src');
  try {
    element.load();
  } catch {
    // Some browsers throw if load() runs during teardown; src removal is enough.
  }

  if (record.managedObjectUrl) {
    revokeManagedObjectUrl(record.managedObjectUrl);
  } else if (record.objectUrl) {
    URL.revokeObjectURL(record.objectUrl);
  }
  if (clip?.source) {
    if (record.kind === 'video' && clip.source.videoElement === element) {
      const nextSource = { ...clip.source };
      delete nextSource.videoElement;
      clip.source = nextSource;
    } else if (record.kind === 'audio' && clip.source.audioElement === element) {
      const nextSource = { ...clip.source };
      delete nextSource.audioElement;
      clip.source = nextSource;
    }
  }
}

function isTimeSpanInWindow(startTime: number, duration: number, start: number, end: number): boolean {
  return startTime < end && startTime + duration > start;
}

function markDesired(desired: Set<string>, kind: LazyMediaKind, clip: TimelineClip, now: number): void {
  const key = getRecordKey(kind, clip.id);
  desired.add(key);
  const record = lazyMediaRecords.get(key);
  if (record) {
    record.lastDesiredAt = now;
    reportLazyMediaRecord(record);
  }
}

function pruneLazyRecords(ctx: FrameContext, desired: Set<string>): void {
  const now = ctx.now;

  for (const [key, record] of lazyMediaRecords) {
    if (desired.has(key)) continue;
    if (now - record.lastDesiredAt < IDLE_RELEASE_MS) continue;
    detachRecord(record, ctx);
    lazyMediaRecords.delete(key);
  }

  if (lazyMediaRecords.size <= MAX_LAZY_MEDIA_ELEMENTS) return;

  const releasable = Array.from(lazyMediaRecords.entries())
    .filter(([key]) => !desired.has(key))
    .sort(([, a], [, b]) => a.lastDesiredAt - b.lastDesiredAt);

  for (const [key, record] of releasable) {
    if (lazyMediaRecords.size <= MAX_LAZY_MEDIA_ELEMENTS) break;
    detachRecord(record, ctx);
    lazyMediaRecords.delete(key);
  }
}

function getClipWindowRank(candidate: LazyClipCandidate, playheadPosition: number): number {
  const clipEnd = candidate.rankStartTime + candidate.rankDuration;
  if (candidate.rankStartTime <= playheadPosition && clipEnd > playheadPosition) {
    return Math.abs((candidate.rankStartTime + clipEnd) / 2 - playheadPosition) * 0.001;
  }
  if (candidate.rankStartTime > playheadPosition) {
    return 1 + candidate.rankStartTime - playheadPosition;
  }
  return 2 + playheadPosition - clipEnd;
}

function addCandidate(
  byTrack: Map<string, LazyClipCandidate[]>,
  candidate: LazyClipCandidate,
): void {
  const trackClips = byTrack.get(candidate.trackKey);
  if (trackClips) {
    trackClips.push(candidate);
  } else {
    byTrack.set(candidate.trackKey, [candidate]);
  }
}

function nestedTrackAllowsKind(
  parentClip: TimelineClip,
  clip: TimelineClip,
  kind: LazyMediaKind,
): boolean {
  const track = parentClip.nestedTracks?.find(candidate => candidate.id === clip.trackId);
  if (!track) return true;
  if (kind === 'video') return track.visible !== false;
  return track.muted !== true;
}

function transitionCompTrackAllowsKind(
  clip: SerializableClip,
  ctx: FrameContext,
  kind: LazyMediaKind,
  compositionId: string,
): boolean {
  const composition = ctx.compositionById.get(compositionId);
  const track = composition?.timelineData?.tracks.find(candidate => candidate.id === clip.trackId);
  if (!track) return true;
  if (kind === 'video') return track.visible !== false;
  return track.muted !== true;
}

function matchesTransitionLinkedClipId(clipId: string, baseId: string | undefined): boolean {
  return Boolean(baseId) && (clipId === baseId || clipId.startsWith(`${baseId}:`));
}

function getTransitionRuntimeClip(
  clip: SerializableClip,
  compositionId: string,
  ctx: FrameContext,
  outgoingClip: TimelineClip,
  incomingClip: TimelineClip,
): TimelineClip | null {
  const link = ctx.compositionById.get(compositionId)?.transitionComp;
  if (link?.kind === 'transition-comp') {
    if (matchesTransitionLinkedClipId(clip.id, link.linkedOutgoingClipId)) return outgoingClip;
    if (matchesTransitionLinkedClipId(clip.id, link.linkedIncomingClipId)) return incomingClip;
  }

  if (clip.mediaFileId && (outgoingClip.mediaFileId === clip.mediaFileId || outgoingClip.source?.mediaFileId === clip.mediaFileId)) {
    return outgoingClip;
  }
  if (clip.mediaFileId && (incomingClip.mediaFileId === clip.mediaFileId || incomingClip.source?.mediaFileId === clip.mediaFileId)) {
    return incomingClip;
  }
  return null;
}

function createLazySerializableClip(clip: SerializableClip): TimelineClip {
  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    file: new File([], clip.name || 'transition-source'),
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    source: {
      type: clip.sourceType,
      mediaFileId: clip.mediaFileId,
      naturalDuration: clip.naturalDuration ?? clip.duration,
    },
    mediaFileId: clip.mediaFileId,
    transform: clip.transform,
    effects: clip.effects ?? [],
    isLoading: false,
  };
}

function collectNestedDesiredClips(
  byTrack: Map<string, LazyClipCandidate[]>,
  ctx: FrameContext,
  parentClip: TimelineClip,
  kind: LazyMediaKind,
  windowStart: number,
  windowEnd: number,
  parentAbsoluteStart: number,
  parentSourceInPoint: number,
  trackPath: string,
): void {
  if (!parentClip.nestedClips?.length) return;

  for (const nestedClip of parentClip.nestedClips) {
    const nestedAbsoluteStart = parentAbsoluteStart + nestedClip.startTime - parentSourceInPoint;
    const nestedDuration = nestedClip.duration;
    const nestedTrackKey = `${trackPath}:${nestedClip.trackId}`;

    if (
      nestedClip.source?.type === kind &&
      nestedTrackAllowsKind(parentClip, nestedClip, kind) &&
      isTimeSpanInWindow(nestedAbsoluteStart, nestedDuration, windowStart, windowEnd)
    ) {
      addCandidate(byTrack, {
        clip: nestedClip,
        trackKey: nestedTrackKey,
        rankStartTime: nestedAbsoluteStart,
        rankDuration: nestedDuration,
      });
    }

    if (
      nestedClip.isComposition &&
      nestedClip.nestedClips?.length &&
      isTimeSpanInWindow(nestedAbsoluteStart, nestedDuration, windowStart, windowEnd)
    ) {
      collectNestedDesiredClips(
        byTrack,
        ctx,
        nestedClip,
        kind,
        windowStart,
        windowEnd,
        nestedAbsoluteStart,
        nestedClip.inPoint || 0,
        nestedTrackKey,
      );
    }

    const transition = nestedClip.transitionOut;
    if (!transition) continue;

    const incomingClip = parentClip.nestedClips.find(candidate => candidate.id === transition.linkedClipId);
    if (!incomingClip) continue;

    const plan = planTransition({
      outgoingClip: nestedClip,
      incomingClip,
      transitionType: transition.type,
      requestedDuration: transition.duration,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime: nestedClip.startTime + nestedClip.duration,
      bodyOffset: transition.offset ?? 0,
      getMediaDuration: (mediaFileId) => ctx.mediaFileById.get(mediaFileId)?.duration,
    });
    if (!plan) continue;

    const absoluteBodyStart = parentAbsoluteStart + plan.bodyStart - parentSourceInPoint;
    const bodyDuration = plan.bodyEnd - plan.bodyStart;
    if (!isTimeSpanInWindow(absoluteBodyStart, bodyDuration, windowStart, windowEnd)) {
      continue;
    }

    if (nestedClip.source?.type === kind && nestedTrackAllowsKind(parentClip, nestedClip, kind)) {
      addCandidate(byTrack, {
        clip: nestedClip,
        trackKey: nestedTrackKey,
        rankStartTime: absoluteBodyStart,
        rankDuration: bodyDuration,
      });
    }
    if (incomingClip.source?.type === kind && nestedTrackAllowsKind(parentClip, incomingClip, kind)) {
      addCandidate(byTrack, {
        clip: incomingClip,
        trackKey: `${trackPath}:${incomingClip.trackId}`,
        rankStartTime: absoluteBodyStart,
        rankDuration: bodyDuration,
      });
    }
    collectTransitionCompositionDesiredClips({
      byTrack,
      ctx,
      kind,
      windowStart,
      windowEnd,
      outgoingClip: nestedClip,
      incomingClip,
      trackKey: nestedTrackKey,
      compositionId: transition.compositionId,
      transitionBodyStart: absoluteBodyStart,
    });
  }
}

function collectTransitionCompositionDesiredClips(params: {
  byTrack: Map<string, LazyClipCandidate[]>;
  ctx: FrameContext;
  kind: LazyMediaKind;
  windowStart: number;
  windowEnd: number;
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  trackKey: string;
  compositionId: string | undefined;
  transitionBodyStart: number;
}): void {
  const {
    byTrack,
    ctx,
    kind,
    windowStart,
    windowEnd,
    outgoingClip,
    incomingClip,
    trackKey,
    compositionId,
    transitionBodyStart,
  } = params;
  if (!compositionId) return;

  const composition = ctx.compositionById.get(compositionId);
  if (composition?.transitionComp?.kind !== 'transition-comp') return;

  for (const clip of composition.timelineData?.clips ?? []) {
    if (clip.sourceType !== kind || !transitionCompTrackAllowsKind(clip, ctx, kind, compositionId)) {
      continue;
    }

    const absoluteStart = transitionBodyStart + clip.startTime;
    if (!isTimeSpanInWindow(absoluteStart, clip.duration, windowStart, windowEnd)) {
      continue;
    }

    addCandidate(byTrack, {
      clip: getTransitionRuntimeClip(clip, compositionId, ctx, outgoingClip, incomingClip)
        ?? createLazySerializableClip(clip),
      trackKey: `${trackKey}:transition:${compositionId}:${clip.trackId}`,
      rankStartTime: absoluteStart,
      rankDuration: clip.duration,
    });
  }
}

function collectDesiredClips(
  ctx: FrameContext,
  kind: LazyMediaKind,
  trackIds: Set<string>,
  start: number,
  end: number,
): TimelineClip[] {
  const byTrack = new Map<string, LazyClipCandidate[]>();
  const getMediaDuration = (mediaFileId: string) => ctx.mediaFileById.get(mediaFileId)?.duration;

  const addTransitionCandidates = (
    outgoingClip: TimelineClip,
    incomingClip: TimelineClip,
    trackKey: string,
    transitionType: string,
    duration: number,
    junctionTime: number,
    offset: number | undefined,
    compositionId?: string,
  ): void => {
    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType,
      requestedDuration: duration,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime,
      bodyOffset: offset ?? 0,
      getMediaDuration,
    });
    const transitionInWindow = plan
      ? isTimeSpanInWindow(plan.bodyStart, plan.bodyEnd - plan.bodyStart, start, end)
      : false;
    if (!plan || !transitionInWindow) return;

    if (outgoingClip.source?.type === kind) {
      addCandidate(byTrack, {
        clip: outgoingClip,
        trackKey,
        rankStartTime: plan.bodyStart,
        rankDuration: plan.bodyEnd - plan.bodyStart,
      });
    }
    if (incomingClip.source?.type === kind) {
      addCandidate(byTrack, {
        clip: incomingClip,
        trackKey,
        rankStartTime: plan.bodyStart,
        rankDuration: plan.bodyEnd - plan.bodyStart,
      });
    }
    collectTransitionCompositionDesiredClips({
      byTrack,
      ctx,
      kind,
      windowStart: start,
      windowEnd: end,
      outgoingClip,
      incomingClip,
      trackKey,
      compositionId,
      transitionBodyStart: plan.bodyStart,
    });
  };

  for (const clip of ctx.clips) {
    const topLevelTrackAllowed = trackIds.has(clip.trackId);
    const topLevelInWindow = isTimeSpanInWindow(clip.startTime, clip.duration, start, end);

    if (clip.source?.type === kind && topLevelTrackAllowed && topLevelInWindow) {
      addCandidate(byTrack, {
        clip,
        trackKey: clip.trackId,
        rankStartTime: clip.startTime,
        rankDuration: clip.duration,
      });
    }

    if (topLevelTrackAllowed && topLevelInWindow && clip.isComposition && clip.nestedClips?.length) {
      collectNestedDesiredClips(
        byTrack,
        ctx,
        clip,
        kind,
        start,
        end,
        clip.startTime,
        clip.inPoint || 0,
        clip.trackId,
      );
    }

    const transition = clip.transitionOut;
    if (transition && topLevelTrackAllowed) {
      const incomingClip = ctx.clips.find(candidate => candidate.id === transition.linkedClipId);
      if (incomingClip && trackIds.has(incomingClip.trackId)) {
        addTransitionCandidates(
          clip,
          incomingClip,
          clip.trackId,
          transition.type,
          transition.duration,
          clip.startTime + clip.duration,
          transition.offset,
          transition.compositionId,
        );
      }
    }

    if (kind === 'audio' && transition?.type === 'crossfade') {
      const definition = getRuntimeTransition(transition.type);
      if (!transitionIncludesAudio(transition, definition)) continue;

      const incomingVideo = ctx.clips.find(candidate => candidate.id === transition.linkedClipId);
      const outgoingAudio = clip.linkedClipId
        ? ctx.clips.find(candidate => candidate.id === clip.linkedClipId && candidate.source?.type === 'audio')
        : undefined;
      const incomingAudio = incomingVideo?.linkedClipId
        ? ctx.clips.find(candidate => candidate.id === incomingVideo.linkedClipId && candidate.source?.type === 'audio')
        : undefined;
      if (!outgoingAudio || !incomingAudio || !trackIds.has(outgoingAudio.trackId) || outgoingAudio.trackId !== incomingAudio.trackId) {
        continue;
      }

      addTransitionCandidates(
        outgoingAudio,
        incomingAudio,
        outgoingAudio.trackId,
        'crossfade',
        transition.duration,
        clip.startTime + clip.duration,
        transition.offset,
      );
    }
  }

  const selected: TimelineClip[] = [];
  for (const trackClips of byTrack.values()) {
    trackClips.sort((left, right) => {
      const rankDiff = getClipWindowRank(left, ctx.playheadPosition) - getClipWindowRank(right, ctx.playheadPosition);
      if (rankDiff !== 0) return rankDiff;
      return left.rankStartTime - right.rankStartTime;
    });
    selected.push(...trackClips.slice(0, MAX_DESIRED_CLIPS_PER_TRACK).map(candidate => candidate.clip));
  }

  return selected;
}

export function hydrateTimelineMediaWindow(ctx: FrameContext): void {
  if (typeof document === 'undefined') return;

  const now = ctx.now;
  const desired = new Set<string>();
  const hydrateVideo = renderHostPort.getTelemetry().mode !== 'worker-gpu-only' ||
    !flags.useFullWebCodecsPlayback ||
    ctx.clipsAtTime.some((clip) => ctx.visibleVideoTrackIds.has(clip.trackId) && clipTreeNeedsLiveVideoElement(clip));
  const videoStart = ctx.playheadPosition - VIDEO_LOOKBEHIND_SECONDS;
  const videoEnd = ctx.playheadPosition + (ctx.isPlaying ? VIDEO_LOOKAHEAD_SECONDS : 0.8);
  const audioStart = ctx.playheadPosition - AUDIO_LOOKBEHIND_SECONDS;
  const audioEnd = ctx.playheadPosition + (ctx.isPlaying ? AUDIO_LOOKAHEAD_SECONDS : 0.4);

  if (hydrateVideo) {
    for (const clip of collectDesiredClips(ctx, 'video', ctx.visibleVideoTrackIds, videoStart, videoEnd)) {
      markDesired(desired, 'video', clip, now);
      attachVideoElement(ctx, clip, now);
    }
  }

  for (const clip of collectDesiredClips(ctx, 'audio', ctx.unmutedAudioTrackIds, audioStart, audioEnd)) {
    markDesired(desired, 'audio', clip, now);
    attachAudioElement(ctx, clip, now);
  }

  pruneLazyRecords(ctx, desired);
}

export function getLazyTimelineMediaElementCount(): number {
  return lazyMediaRecords.size;
}

export function getLazyTimelineAudioElementForClip(clip: TimelineClip): HTMLAudioElement | null {
  const record = lazyMediaRecords.get(getRecordKey('audio', clip.id));
  return record?.element instanceof HTMLAudioElement ? record.element : null;
}

export function getLazyTimelineVideoElementForClip(clip: TimelineClip): HTMLVideoElement | null {
  const record = lazyMediaRecords.get(getRecordKey('video', clip.id));
  return record?.element instanceof HTMLVideoElement ? record.element : null;
}

export function releaseAllLazyTimelineMediaElements(): void {
  for (const record of lazyMediaRecords.values()) {
    try {
      detachRecord(record);
    } catch (error) {
      log.warn('Failed to detach lazy media element', error);
    }
  }
  lazyMediaRecords.clear();
}
