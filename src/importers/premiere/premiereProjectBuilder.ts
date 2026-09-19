import type {
  Composition,
  ImportedMediaType,
  MediaFile,
  MediaFolder,
} from '../../stores/mediaStore/types';
import type { SerializableClip, TimelineTrack } from '../../types/timeline';
import type { LinkedMediaSource } from '../../types/mediaMetadata';
import type {
  PremiereExistingMediaDescriptor,
  PremiereMediaRecord,
  PremiereProjectGraph,
  PremiereProjectImportResult,
  PremiereProjectSummary,
  PremiereSequenceRecord,
  PremiereTrackGroupRecord,
  PremiereTrackKind,
} from './premiereProjectTypes';

const PREMIERE_TICKS_PER_SECOND = 254_016_000_000;

interface PremiereTrackPlan {
  uid: string;
  id: string;
  kind: PremiereTrackKind;
  premiereIndex: number;
  itemIds: string[];
  locked: boolean;
  muted: boolean;
}

interface SequencePlan {
  uid: string;
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  videoTracks: PremiereTrackPlan[];
  audioTracks: PremiereTrackPlan[];
}

interface ResolvedClipSource {
  name: string;
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
  mediaUid?: string;
  proxyMediaUid?: string;
  sequenceUid?: string;
}

type ResolvedMedia = Pick<MediaFile, 'id' | 'name' | 'type' | 'duration'>;

export function buildPremiereProjectImportResult(
  graph: PremiereProjectGraph,
  fileName: string,
  existingMedia: readonly PremiereExistingMediaDescriptor[],
  parentId: string | null = null,
  selectedSequenceUids?: readonly string[],
): PremiereProjectImportResult {
  const sequences = selectSequencesWithNestedDependencies(graph, selectedSequenceUids);
  const sequencePlans = sequences.map((sequence) => createSequencePlan(graph, sequence));
  if (sequencePlans.length === 0) throw new Error(`${fileName} contains no Premiere sequences.`);

  const createdAt = Date.now();
  const folder: MediaFolder = {
    id: stableId('folder', sequencePlans[0]!.uid),
    name: fileName.replace(/\.prproj$/i, ''),
    parentId,
    isExpanded: true,
    createdAt,
  };
  const mediaResolver = createMediaResolver(graph, existingMedia, folder.id, createdAt);
  const sequenceByUid = new Map(sequencePlans.map((plan) => [plan.uid, plan]));
  let skippedClipCount = 0;
  let speedAdjustedClipCount = 0;

  const compositions = sequencePlans.map((plan): Composition => {
    const tracks = [...plan.videoTracks.toReversed(), ...plan.audioTracks].map(createTimelineTrack);
    const clips: SerializableClip[] = [];
    for (const track of [...plan.videoTracks, ...plan.audioTracks]) {
      for (const itemId of track.itemIds) {
        const item = graph.trackItemsById.get(itemId);
        const range = item ? getTrackItemRange(item.startTicks, item.endTicks) : null;
        const source = item ? resolveClipSource(graph, item.subClipId) : null;
        if (!item || !range || !source || (track.kind === 'audio' && source.sequenceUid)) {
          skippedClipCount++;
          continue;
        }
        const duration = range.end - range.start;
        if (duration <= 0) {
          skippedClipCount++;
          continue;
        }

        const clipId = stableId('clip', plan.uid, track.uid, item.id);
        if (source.sequenceUid) {
          const nested = sequenceByUid.get(source.sequenceUid);
          if (!nested) {
            skippedClipCount++;
            continue;
          }
          clips.push(createNestedCompositionClip(clipId, track.id, range.start, duration, source, nested));
          continue;
        }
        if (!source.mediaUid) {
          skippedClipCount++;
          continue;
        }

        const media = mediaResolver.resolve(
          source.mediaUid,
          source.proxyMediaUid,
          source.name,
          source.naturalDuration,
          track.kind,
        );
        const sourceDuration = Math.max(0, source.outPoint - source.inPoint);
        const speed = sourceDuration > 0 ? sourceDuration / duration : 1;
        if (Math.abs(speed - 1) > 0.001) speedAdjustedClipCount++;
        clips.push({
          id: clipId,
          trackId: track.id,
          name: source.name,
          mediaFileId: media.id,
          startTime: range.start,
          duration,
          inPoint: source.inPoint,
          outPoint: source.outPoint > source.inPoint ? source.outPoint : source.inPoint + duration,
          sourceType: track.kind === 'audio' ? 'audio' : getVisualSourceType(media.type),
          naturalDuration: media.duration ?? source.naturalDuration,
          transform: readStaticTransform(graph, item.componentChainId, plan.width, plan.height),
          effects: [],
          ...(Math.abs(speed - 1) > 0.001 ? { speed } : {}),
        });
      }
    }

    const firstOccupiedTime = clips.reduce(
      (earliest, clip) => Math.min(earliest, clip.startTime),
      Number.POSITIVE_INFINITY,
    );
    const initialPlayhead = Number.isFinite(firstOccupiedTime) ? firstOccupiedTime : 0;
    const initialScrollX = Math.max(0, (initialPlayhead - 2) * 50);

    return {
      id: plan.id,
      name: plan.name,
      type: 'composition',
      parentId: folder.id,
      createdAt,
      width: plan.width,
      height: plan.height,
      frameRate: plan.frameRate,
      duration: plan.duration,
      backgroundColor: '#000000',
      timelineData: {
        tracks,
        clips,
        playheadPosition: initialPlayhead,
        duration: plan.duration,
        durationLocked: true,
        zoom: 50,
        scrollX: initialScrollX,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      },
    };
  });

  return {
    folder,
    mediaFiles: mediaResolver.missingMedia,
    existingMediaUpdates: [...mediaResolver.existingMediaUpdates.values()],
    compositions,
    reusedMediaCount: mediaResolver.reusedIds.size,
    proxyMediaCount: mediaResolver.proxyMediaIds.size,
    skippedClipCount,
    speedAdjustedClipCount,
  };
}

export function summarizePremiereProject(graph: PremiereProjectGraph): PremiereProjectSummary {
  return {
    sequences: graph.sequences.map((sequence) => {
      const videoTracks = createTrackPlans(graph, sequence, 'video');
      const audioTracks = createTrackPlans(graph, sequence, 'audio');
      return {
        uid: sequence.uid,
        name: sequence.name || 'Premiere Sequence',
        videoTrackCount: videoTracks.length,
        audioTrackCount: audioTracks.length,
        clipCount: [...videoTracks, ...audioTracks].reduce((sum, track) => sum + track.itemIds.length, 0),
      };
    }),
    mediaCount: graph.mediaByUid.size,
  };
}

function selectSequencesWithNestedDependencies(
  graph: PremiereProjectGraph,
  selectedSequenceUids?: readonly string[],
): PremiereSequenceRecord[] {
  if (!selectedSequenceUids) return graph.sequences;
  const selected = new Set(selectedSequenceUids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const sequence of graph.sequences) {
      if (!selected.has(sequence.uid)) continue;
      for (const track of [...createTrackPlans(graph, sequence, 'video'), ...createTrackPlans(graph, sequence, 'audio')]) {
        for (const itemId of track.itemIds) {
          const item = graph.trackItemsById.get(itemId);
          const source = item ? resolveClipSource(graph, item.subClipId) : null;
          if (source?.sequenceUid && !selected.has(source.sequenceUid)) {
            selected.add(source.sequenceUid);
            changed = true;
          }
        }
      }
    }
  }
  return graph.sequences.filter((sequence) => selected.has(sequence.uid));
}

function createSequencePlan(graph: PremiereProjectGraph, sequence: PremiereSequenceRecord): SequencePlan {
  const videoGroup = getTrackGroup(graph, sequence, 'video');
  const videoTracks = createTrackPlans(graph, sequence, 'video');
  const audioTracks = createTrackPlans(graph, sequence, 'audio');
  const frameRect = videoGroup?.frameRect?.split(',').map(Number) ?? [];
  const frameTicks = Number(videoGroup?.frameRateTicks);
  const duration = Math.max(1, ...[...videoTracks, ...audioTracks].flatMap((track) =>
    track.itemIds.map((id) => ticksToSeconds(graph.trackItemsById.get(id)?.endTicks)).filter(Number.isFinite),
  ));
  return {
    uid: sequence.uid,
    id: stableId('composition', sequence.uid),
    name: sequence.name || 'Premiere Sequence',
    width: Math.max(1, frameRect[2] || 1920),
    height: Math.max(1, frameRect[3] || 1080),
    frameRate: frameTicks > 0 ? PREMIERE_TICKS_PER_SECOND / frameTicks : 30,
    duration,
    videoTracks,
    audioTracks,
  };
}

function getTrackGroup(
  graph: PremiereProjectGraph,
  sequence: PremiereSequenceRecord,
  kind: PremiereTrackKind,
): PremiereTrackGroupRecord | undefined {
  return sequence.trackGroupRefs
    .map((id) => graph.trackGroupsById.get(id))
    .find((group) => group?.kind === kind);
}

function createTrackPlans(
  graph: PremiereProjectGraph,
  sequence: PremiereSequenceRecord,
  kind: PremiereTrackKind,
): PremiereTrackPlan[] {
  const group = getTrackGroup(graph, sequence, kind);
  return (group?.trackUids ?? []).flatMap((uid, premiereIndex) => {
    const track = graph.tracksByUid.get(uid);
    if (!track || track.kind !== kind) return [];
    return [{
      uid,
      id: stableId('track', sequence.uid, uid),
      kind,
      premiereIndex,
      itemIds: track.itemIds,
      locked: track.locked,
      muted: track.muted,
    }];
  });
}

function createTimelineTrack(track: PremiereTrackPlan): TimelineTrack {
  return {
    id: track.id,
    name: `${track.kind === 'video' ? 'Video' : 'Audio'} ${track.premiereIndex + 1}`,
    type: track.kind,
    height: track.kind === 'video' ? 60 : 40,
    muted: track.muted,
    visible: track.kind === 'audio' || !track.muted,
    solo: false,
    locked: track.locked,
  };
}

function getTrackItemRange(startTicks?: string, endTicks?: string): { start: number; end: number } | null {
  const start = ticksToSeconds(startTicks);
  const end = ticksToSeconds(endTicks);
  return Number.isFinite(start) && Number.isFinite(end)
    ? { start: Math.max(0, start), end: Math.max(0, end) }
    : null;
}

function resolveClipSource(graph: PremiereProjectGraph, subClipId?: string): ResolvedClipSource | null {
  const subClip = subClipId ? graph.subClipsById.get(subClipId) : undefined;
  const clip = subClip?.clipId ? graph.clipsById.get(subClip.clipId) : undefined;
  const source = clip?.sourceId ? graph.sourcesById.get(clip.sourceId) : undefined;
  if (!subClip || !clip || !source) return null;
  const inPoint = Math.max(0, ticksToSeconds(clip.inPointTicks));
  const rawOutPoint = ticksToSeconds(clip.outPointTicks);
  return {
    name: subClip.name || 'Premiere Clip',
    inPoint,
    outPoint: rawOutPoint > inPoint ? rawOutPoint : inPoint,
    naturalDuration: Math.max(0, ticksToSeconds(source.originalDurationTicks)),
    mediaUid: source.mediaUid,
    proxyMediaUid: source.proxyMediaUid,
    sequenceUid: source.sequenceUid,
  };
}

function createNestedCompositionClip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  source: ResolvedClipSource,
  nested: SequencePlan,
): SerializableClip {
  return {
    id,
    trackId,
    name: source.name || nested.name,
    mediaFileId: '',
    startTime,
    duration,
    inPoint: source.inPoint,
    outPoint: source.outPoint > source.inPoint ? source.outPoint : source.inPoint + duration,
    sourceType: 'video',
    naturalDuration: nested.duration,
    transform: defaultTransform(),
    effects: [],
    isComposition: true,
    compositionId: nested.id,
  };
}

function createMediaResolver(
  graph: PremiereProjectGraph,
  existingMedia: readonly PremiereExistingMediaDescriptor[],
  parentId: string,
  createdAt: number,
) {
  const attachedProxyByMediaUid = new Map<string, string>();
  for (const source of graph.sourcesById.values()) {
    if (source.mediaUid && source.proxyMediaUid) {
      attachedProxyByMediaUid.set(source.mediaUid, source.proxyMediaUid);
    }
  }
  const existingByName = new Map<string, PremiereExistingMediaDescriptor[]>();
  for (const media of existingMedia) {
    for (const value of [media.name, media.fileName, media.filePath, media.absolutePath, media.projectPath]) {
      const name = baseName(value);
      if (!name) continue;
      const key = name.toLowerCase();
      const values = existingByName.get(key) ?? [];
      if (!values.includes(media)) values.push(media);
      existingByName.set(key, values);
    }
  }

  const mediaByUid = new Map<string, ResolvedMedia>();
  const missingMedia: MediaFile[] = [];
  const existingMediaUpdates = new Map<string, {
    id: string;
    linkedSources: LinkedMediaSource[];
    sourceSelection: { mode: 'auto' } | { mode: 'original' } | { mode: 'linked'; sourceId: string };
  }>();
  const reusedIds = new Set<string>();
  const proxyMediaIds = new Set<string>();
  return {
    missingMedia,
    existingMediaUpdates,
    reusedIds,
    proxyMediaIds,
    resolve(
      uid: string,
      proxyUid: string | undefined,
      clipName: string,
      naturalDuration: number,
      trackKind: PremiereTrackKind,
    ): ResolvedMedia {
      const attachedProxyUid = proxyUid ?? attachedProxyByMediaUid.get(uid);
      const proxyDefinition = attachedProxyUid ? graph.mediaByUid.get(attachedProxyUid) : undefined;
      const cached = mediaByUid.get(uid);
      if (cached) return cached;
      const definition = graph.mediaByUid.get(uid);
      const title = definition?.title || clipName;
      const paths = [
        definition?.actualMediaFilePath,
        definition?.filePath,
        definition?.relativePath,
        title,
      ].filter((value): value is string => Boolean(value));
      const lookupName = baseName(title) || baseName(paths[0]) || title;
      const candidates = existingByName.get(lookupName.toLowerCase()) ?? [];
      const existing = candidates.length === 1 ? candidates[0] : findUniquePathMatch(paths, candidates);
      const linkedProxy = createLinkedProxySource(attachedProxyUid, proxyDefinition);
      if (existing) {
        const resolved = { id: existing.id, name: existing.name, type: existing.type, duration: existing.duration };
        mediaByUid.set(uid, resolved);
        reusedIds.add(existing.id);
        if (linkedProxy) {
          proxyMediaIds.add(existing.id);
          const linkedSources = existing.linkedSources?.some((source) => source.id === linkedProxy.id)
            ? existing.linkedSources.map((source) => ({ ...source }))
            : [...(existing.linkedSources ?? []).map((source) => ({ ...source })), linkedProxy];
          existingMediaUpdates.set(existing.id, {
            id: existing.id,
            linkedSources,
            sourceSelection: existing.sourceSelection ?? { mode: 'auto' },
          });
        }
        return resolved;
      }

      const name = baseName(title) || baseName(paths[0]) || clipName;
      const media: MediaFile = {
        id: stableId('media', definition?.fileKey || uid),
        name,
        type: detectImportedMediaType(name, trackKind),
        parentId,
        createdAt,
        url: '',
        duration: naturalDuration || undefined,
        filePath: paths[0] || name,
        hasFileHandle: false,
        ...(linkedProxy ? {
          linkedSources: [linkedProxy],
          sourceSelection: { mode: 'auto' as const },
        } : {}),
      };
      mediaByUid.set(uid, media);
      if (proxyDefinition?.isProxy) proxyMediaIds.add(media.id);
      if (!missingMedia.some((candidate) => candidate.id === media.id)) missingMedia.push(media);
      return media;
    },
  };
}

function createLinkedProxySource(
  proxyUid: string | undefined,
  definition: PremiereMediaRecord | undefined,
): LinkedMediaSource | undefined {
  if (!proxyUid || !definition?.isProxy) return undefined;
  const paths = [
    definition.actualMediaFilePath,
    definition.filePath,
    definition.relativePath,
    definition.title,
  ].filter((value): value is string => Boolean(value));
  const name = baseName(definition.title) || baseName(paths[0]);
  if (!name) return undefined;
  return {
    id: stableId('linked-source', proxyUid),
    name,
    sourcePath: paths[0] || name,
    fileKey: definition.fileKey,
    role: 'proxy',
    origin: 'premiere',
  };
}

function findUniquePathMatch(
  paths: string[],
  candidates: readonly PremiereExistingMediaDescriptor[],
): PremiereExistingMediaDescriptor | undefined {
  let best: PremiereExistingMediaDescriptor | undefined;
  let bestScore = 1;
  let tied = false;
  for (const candidate of candidates) {
    const candidatePaths = [candidate.absolutePath, candidate.filePath, candidate.projectPath, candidate.name]
      .filter((value): value is string => Boolean(value));
    const score = Math.max(...paths.flatMap((path) => candidatePaths.map((candidatePath) => commonSuffix(path, candidatePath))));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  return bestScore >= 2 && !tied ? best : undefined;
}

function readStaticTransform(graph: PremiereProjectGraph, chainId: string | undefined, width: number, height: number) {
  const transform = defaultTransform();
  const chain = chainId ? graph.componentChainsById.get(chainId) : undefined;
  for (const componentId of chain?.componentIds ?? []) {
    const component = graph.componentsById.get(componentId);
    if (!component) continue;
    const values = new Map<string, string>();
    for (const paramId of component.paramIds) {
      const param = graph.paramsById.get(paramId);
      const value = readStaticParamValue(param);
      if (param?.name && value !== undefined) values.set(param.name, value);
    }
    if (component.matchName === 'AE.ADBE Opacity') {
      transform.opacity = clamp(numberValue(values.get('Opacity')) / 100, 0, 1, 1);
    } else if (component.matchName === 'AE.ADBE Motion') {
      const position = pointValue(values.get('Position'));
      if (position) transform.position = { x: (position[0] - 0.5) * width, y: (position[1] - 0.5) * height, z: 0 };
      const scale = clamp(numberValue(values.get('Scale')) / 100, 0, 100, 1);
      const uniform = values.get('Uniform Scale') !== 'false';
      transform.scale = {
        x: uniform ? scale : clamp(numberValue(values.get('Scale Width')) / 100, 0, 100, scale),
        y: scale,
      };
      transform.rotation.z = numberValue(values.get('Rotation')) || 0;
    }
  }
  return transform;
}

function readStaticParamValue(param: { currentValue?: string; startKeyframe?: string } | undefined): string | undefined {
  if (!param) return undefined;
  if (param.currentValue) return param.currentValue;
  const comma = param.startKeyframe?.indexOf(',') ?? -1;
  return comma >= 0 ? param.startKeyframe!.slice(comma + 1).split(',')[0] : undefined;
}

function defaultTransform() {
  return {
    opacity: 1,
    blendMode: 'normal' as const,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function getVisualSourceType(type: ImportedMediaType): SerializableClip['sourceType'] {
  return type === 'audio' ? 'video' : type;
}

function detectImportedMediaType(name: string, fallback: PremiereTrackKind): ImportedMediaType {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'].includes(extension)) return 'audio';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'flv'].includes(extension)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'image';
  if (['obj', 'fbx', 'gltf', 'glb'].includes(extension)) return 'model';
  if (['ply', 'splat', 'ksplat', 'spz', 'sog', 'lcc', 'zip'].includes(extension)) return 'gaussian-splat';
  if (extension === 'lottie') return 'lottie';
  if (extension === 'riv') return 'rive';
  return fallback;
}

function stableId(kind: string, ...parts: string[]): string {
  return `premiere-${kind}-${parts.join('-')}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function ticksToSeconds(value: string | undefined): number {
  const ticks = Number(value);
  return Number.isFinite(ticks) ? ticks / PREMIERE_TICKS_PER_SECOND : Number.NaN;
}

function numberValue(value: string | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pointValue(value: string | undefined): [number, number] | null {
  const [x, y] = value?.split(':').map(Number) ?? [];
  return Number.isFinite(x) && Number.isFinite(y) ? [x!, y!] : null;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function commonSuffix(left: string, right: string): number {
  const a = normalizePath(left).split('/').filter((part) => part && part !== '..');
  const b = normalizePath(right).split('/').filter((part) => part && part !== '..');
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) count++;
  return count;
}

function normalizePath(value: string): string {
  return decodePath(value).toLowerCase();
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value).replace(/\\/g, '/');
  } catch {
    return value.replace(/\\/g, '/');
  }
}

function baseName(value: string | undefined): string {
  return decodePath(value ?? '').split('/').filter(Boolean).at(-1) ?? '';
}
