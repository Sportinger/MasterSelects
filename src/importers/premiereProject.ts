import type {
  Composition,
  ImportedMediaType,
  MediaFile,
  MediaFolder,
} from '../stores/mediaStore/types';
import type { SerializableClip, TimelineTrack } from '../types/timeline';
import { detectMediaType } from '../stores/timeline/helpers/mediaTypeHelpers';

const PREMIERE_TICKS_PER_SECOND = 254_016_000_000;

type PremiereTrackKind = 'video' | 'audio';

interface PremiereGraph {
  root: Element;
  elements: Element[];
  byId: Map<string, Element>;
  byUid: Map<string, Element>;
}

interface SequencePlan {
  uid: string;
  id: string;
  element: Element;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  videoTracks: PremiereTrackPlan[];
  audioTracks: PremiereTrackPlan[];
}

interface PremiereTrackPlan {
  uid: string;
  element: Element;
  id: string;
  kind: PremiereTrackKind;
  premiereIndex: number;
}

interface ResolvedClipSource {
  name: string;
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
  mediaUid?: string;
  sequenceUid?: string;
}

export interface PremiereProjectImportResult {
  folder: MediaFolder;
  mediaFiles: MediaFile[];
  compositions: Composition[];
  reusedMediaCount: number;
  skippedClipCount: number;
  speedAdjustedClipCount: number;
}

export function isPremiereProjectFile(file: Pick<File, 'name'>): boolean {
  return file.name.toLowerCase().endsWith('.prproj');
}

export async function readPremiereProjectXml(file: File): Promise<string> {
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (header[0] !== 0x1f || header[1] !== 0x8b) return file.text();
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress Premiere project files.');
  }
  return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

export async function importPremiereProject(
  file: File,
  existingMedia: readonly MediaFile[],
  parentId: string | null = null,
): Promise<PremiereProjectImportResult> {
  return parsePremiereProjectXml(await readPremiereProjectXml(file), file.name, existingMedia, parentId);
}

export function parsePremiereProjectXml(
  xmlText: string,
  fileName: string,
  existingMedia: readonly MediaFile[],
  parentId: string | null = null,
): PremiereProjectImportResult {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'PremiereData') {
    throw new Error(`${fileName} is not a valid Premiere Pro project.`);
  }

  const graph = createGraph(document.documentElement);
  const sequencePlans = createSequencePlans(graph);
  if (sequencePlans.length === 0) throw new Error(`${fileName} contains no Premiere sequences.`);

  const projectKey = sequencePlans[0]!.uid;
  const folder: MediaFolder = {
    id: stableId('folder', projectKey),
    name: fileName.replace(/\.prproj$/i, ''),
    parentId,
    isExpanded: true,
    createdAt: Date.now(),
  };
  const mediaResolver = createMediaResolver(graph, existingMedia, folder.id);
  let skippedClipCount = 0;
  let speedAdjustedClipCount = 0;

  const sequenceByUid = new Map(sequencePlans.map((plan) => [plan.uid, plan]));
  const compositions = sequencePlans.map((plan): Composition => {
    const tracks = [
      ...plan.videoTracks.toReversed(),
      ...plan.audioTracks,
    ].map(createTimelineTrack);
    const clips: SerializableClip[] = [];

    for (const track of [...plan.videoTracks, ...plan.audioTracks]) {
      for (const item of getTrackItems(graph, track.element)) {
        const range = getTrackItemRange(item);
        const source = resolveClipSource(graph, item);
        if (!range || !source || (track.kind === 'audio' && source.sequenceUid)) {
          skippedClipCount++;
          continue;
        }

        const duration = range.end - range.start;
        if (duration <= 0) {
          skippedClipCount++;
          continue;
        }

        const clipId = stableId('clip', plan.uid, track.uid, item.getAttribute('ObjectID') ?? String(clips.length));
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
        const media = mediaResolver.resolve(source.mediaUid, source.name, source.naturalDuration, track.kind);
        const sourceType = track.kind === 'audio' ? 'audio' : getVisualSourceType(media.type);
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
          sourceType,
          naturalDuration: media.duration ?? source.naturalDuration,
          transform: readStaticTransform(graph, item, plan.width, plan.height),
          effects: [],
          ...(Math.abs(speed - 1) > 0.001 ? { speed } : {}),
        });
      }
    }

    return {
      id: plan.id,
      name: plan.name,
      type: 'composition',
      parentId: folder.id,
      createdAt: Date.now(),
      width: plan.width,
      height: plan.height,
      frameRate: plan.frameRate,
      duration: plan.duration,
      backgroundColor: '#000000',
      timelineData: {
        tracks,
        clips,
        playheadPosition: 0,
        duration: plan.duration,
        durationLocked: true,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      },
    };
  });

  return {
    folder,
    mediaFiles: mediaResolver.missingMedia,
    compositions,
    reusedMediaCount: mediaResolver.reusedIds.size,
    skippedClipCount,
    speedAdjustedClipCount,
  };
}

function createGraph(root: Element): PremiereGraph {
  const elements: Element[] = [];
  const byId = new Map<string, Element>();
  const byUid = new Map<string, Element>();
  for (let element = root.firstElementChild; element; element = element.nextElementSibling) {
    elements.push(element);
    const id = element.getAttribute('ObjectID');
    const uid = element.getAttribute('ObjectUID');
    if (id) byId.set(id, element);
    if (uid) byUid.set(uid, element);
  }
  return { root, elements, byId, byUid };
}

function createSequencePlans(graph: PremiereGraph): SequencePlan[] {
  return graph.elements
    .filter((element) => element.localName === 'Sequence' && element.hasAttribute('ObjectUID'))
    .map((element): SequencePlan => {
      const uid = element.getAttribute('ObjectUID')!;
      const videoGroup = getSequenceTrackGroup(graph, element, 'VideoTrackGroup');
      const audioGroup = getSequenceTrackGroup(graph, element, 'AudioTrackGroup');
      const videoTracks = createTrackPlans(graph, uid, videoGroup, 'video');
      const audioTracks = createTrackPlans(graph, uid, audioGroup, 'audio');
      const frameRect = directText(videoGroup, 'FrameRect')?.split(',').map(Number) ?? [];
      const frameTicks = numberText(firstDescendant(videoGroup, 'FrameRate'));
      const duration = Math.max(
        1,
        ...[...videoTracks, ...audioTracks].flatMap((track) =>
          getTrackItems(graph, track.element).map((item) => getTrackItemRange(item)?.end ?? 0),
        ),
      );
      return {
        uid,
        id: stableId('composition', uid),
        element,
        name: directText(element, 'Name') || 'Premiere Sequence',
        width: Math.max(1, frameRect[2] || 1920),
        height: Math.max(1, frameRect[3] || 1080),
        frameRate: frameTicks > 0 ? PREMIERE_TICKS_PER_SECOND / frameTicks : 30,
        duration,
        videoTracks,
        audioTracks,
      };
    });
}

function getSequenceTrackGroup(graph: PremiereGraph, sequence: Element, expectedName: string): Element | null {
  const groups = directChild(sequence, 'TrackGroups');
  for (const entry of directChildren(groups, 'TrackGroup')) {
    const ref = directChild(entry, 'Second')?.getAttribute('ObjectRef');
    const group = ref ? graph.byId.get(ref) : undefined;
    if (group?.localName === expectedName) return group;
  }
  return null;
}

function createTrackPlans(
  graph: PremiereGraph,
  sequenceUid: string,
  group: Element | null,
  kind: PremiereTrackKind,
): PremiereTrackPlan[] {
  const tracksNode = directChild(directChild(group, 'TrackGroup'), 'Tracks');
  return directChildren(tracksNode, 'Track').flatMap((ref, premiereIndex) => {
    const uid = ref.getAttribute('ObjectURef');
    const element = uid ? graph.byUid.get(uid) : undefined;
    if (!uid || !element) return [];
    return [{ uid, element, id: stableId('track', sequenceUid, uid), kind, premiereIndex }];
  });
}

function createTimelineTrack(track: PremiereTrackPlan): TimelineTrack {
  const settings = directChild(directChild(track.element, 'ClipTrack'), 'Track');
  const muted = directText(settings, 'IsMuted') === 'true';
  return {
    id: track.id,
    name: `${track.kind === 'video' ? 'Video' : 'Audio'} ${track.premiereIndex + 1}`,
    type: track.kind,
    height: track.kind === 'video' ? 60 : 40,
    muted,
    visible: track.kind === 'audio' || !muted,
    solo: false,
    locked: directText(settings, 'IsLocked') === 'true',
  };
}

function getTrackItems(graph: PremiereGraph, track: Element): Element[] {
  const clipItems = directChild(directChild(track, 'ClipTrack'), 'ClipItems');
  const refs = directChild(clipItems, 'TrackItems');
  return directChildren(refs, 'TrackItem').flatMap((ref) => {
    const id = ref.getAttribute('ObjectRef');
    const item = id ? graph.byId.get(id) : undefined;
    return item ? [item] : [];
  });
}

function getTrackItemRange(item: Element): { start: number; end: number } | null {
  const range = directChild(directChild(item, 'ClipTrackItem'), 'TrackItem');
  const start = ticksToSeconds(directText(range, 'Start'));
  const end = ticksToSeconds(directText(range, 'End'));
  return Number.isFinite(start) && Number.isFinite(end) ? { start: Math.max(0, start), end: Math.max(0, end) } : null;
}

function resolveClipSource(graph: PremiereGraph, item: Element): ResolvedClipSource | null {
  const clipTrackItem = directChild(item, 'ClipTrackItem');
  const subClipRef = directChild(clipTrackItem, 'SubClip')?.getAttribute('ObjectRef');
  const subClip = subClipRef ? graph.byId.get(subClipRef) : undefined;
  const clipRef = directChild(subClip, 'Clip')?.getAttribute('ObjectRef');
  const clip = clipRef ? graph.byId.get(clipRef) : undefined;
  const sourceRef = directChild(directChild(clip, 'Clip'), 'Source')?.getAttribute('ObjectRef');
  const source = sourceRef ? graph.byId.get(sourceRef) : undefined;
  if (!subClip || !clip || !source) return null;

  const sequenceUid = firstDescendant(source, 'Sequence')?.getAttribute('ObjectURef') ?? undefined;
  const mediaUid = firstDescendant(source, 'Media')?.getAttribute('ObjectURef') ?? undefined;
  const inPoint = Math.max(0, ticksToSeconds(directText(directChild(clip, 'Clip'), 'InPoint')));
  const rawOutPoint = ticksToSeconds(directText(directChild(clip, 'Clip'), 'OutPoint'));
  const naturalDuration = Math.max(0, ticksToSeconds(directText(source, 'OriginalDuration')));
  return {
    name: directText(subClip, 'Name') || 'Premiere Clip',
    inPoint,
    outPoint: rawOutPoint > inPoint ? rawOutPoint : inPoint,
    naturalDuration,
    mediaUid,
    sequenceUid,
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

function createMediaResolver(graph: PremiereGraph, existingMedia: readonly MediaFile[], parentId: string) {
  const existingByName = new Map<string, MediaFile[]>();
  for (const media of existingMedia) {
    for (const value of [media.name, media.file?.name, media.filePath, media.absolutePath, media.projectPath]) {
      const name = baseName(value);
      if (!name) continue;
      const key = name.toLowerCase();
      const values = existingByName.get(key) ?? [];
      if (!values.includes(media)) values.push(media);
      existingByName.set(key, values);
    }
  }

  const mediaByUid = new Map<string, MediaFile>();
  const missingMedia: MediaFile[] = [];
  const reusedIds = new Set<string>();
  return {
    missingMedia,
    reusedIds,
    resolve(uid: string, clipName: string, naturalDuration: number, trackKind: PremiereTrackKind): MediaFile {
      const cached = mediaByUid.get(uid);
      if (cached) return cached;
      const definition = graph.byUid.get(uid);
      const title = directText(definition, 'Title') || clipName;
      const paths = [
        directText(definition, 'ActualMediaFilePath'),
        directText(definition, 'FilePath'),
        directText(definition, 'RelativePath'),
        title,
      ].filter((value): value is string => Boolean(value));
      const candidates = existingByName.get((baseName(title) || baseName(paths[0]) || title).toLowerCase()) ?? [];
      const existing = candidates.length === 1 ? candidates[0] : findUniquePathMatch(paths, candidates);
      if (existing) {
        mediaByUid.set(uid, existing);
        reusedIds.add(existing.id);
        return existing;
      }

      const name = baseName(title) || baseName(paths[0]) || clipName;
      const detected = detectMediaType(new File([], name));
      const type: ImportedMediaType = detected === 'unknown'
        ? trackKind
        : detected;
      const media: MediaFile = {
        id: stableId('media', directText(definition, 'FileKey') || uid),
        name,
        type,
        parentId,
        createdAt: Date.now(),
        url: '',
        duration: naturalDuration || undefined,
        filePath: paths[0] || name,
        hasFileHandle: false,
      };
      mediaByUid.set(uid, media);
      if (!missingMedia.some((candidate) => candidate.id === media.id)) missingMedia.push(media);
      return media;
    },
  };
}

function findUniquePathMatch(paths: string[], candidates: MediaFile[]): MediaFile | undefined {
  let best: MediaFile | undefined;
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

function readStaticTransform(graph: PremiereGraph, item: Element, width: number, height: number) {
  const transform = defaultTransform();
  const componentsRef = directChild(directChild(directChild(item, 'ClipTrackItem'), 'ComponentOwner'), 'Components')
    ?.getAttribute('ObjectRef');
  const chain = componentsRef ? graph.byId.get(componentsRef) : undefined;
  for (const componentRef of descendantChildren(chain, 'Component')) {
    const component = graph.byId.get(componentRef.getAttribute('ObjectRef') ?? '');
    const matchName = directText(component, 'MatchName');
    const values = new Map<string, string>();
    for (const paramRef of descendantChildren(component, 'Param')) {
      const param = graph.byId.get(paramRef.getAttribute('ObjectRef') ?? '');
      const name = directText(param, 'Name');
      const value = readStaticParamValue(param);
      if (name && value !== undefined) values.set(name, value);
    }
    if (matchName === 'AE.ADBE Opacity') {
      transform.opacity = clamp(numberValue(values.get('Opacity')) / 100, 0, 1, 1);
    } else if (matchName === 'AE.ADBE Motion') {
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

function readStaticParamValue(param: Element | undefined): string | undefined {
  if (!param) return undefined;
  const current = directText(param, 'CurrentValue');
  if (current) return current;
  const start = directText(param, 'StartKeyframe');
  const comma = start?.indexOf(',') ?? -1;
  return comma >= 0 ? start!.slice(comma + 1).split(',')[0] : undefined;
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

function stableId(kind: string, ...parts: string[]): string {
  return `premiere-${kind}-${parts.join('-')}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function ticksToSeconds(value: string | undefined): number {
  const ticks = Number(value);
  return Number.isFinite(ticks) ? ticks / PREMIERE_TICKS_PER_SECOND : Number.NaN;
}

function numberText(element: Element | null): number {
  const value = Number(element?.textContent);
  return Number.isFinite(value) ? value : 0;
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

function directChild(element: Element | null | undefined, name: string): Element | null {
  return directChildren(element, name)[0] ?? null;
}

function directChildren(element: Element | null | undefined, name: string): Element[] {
  return element ? Array.from(element.children).filter((child) => child.localName === name) : [];
}

function descendantChildren(element: Element | null | undefined, name: string): Element[] {
  return element ? Array.from(element.getElementsByTagName(name)) : [];
}

function firstDescendant(element: Element | null | undefined, name: string): Element | null {
  return descendantChildren(element, name)[0] ?? null;
}

function directText(element: Element | null | undefined, name: string): string | undefined {
  return directChild(element, name)?.textContent?.trim() || undefined;
}
