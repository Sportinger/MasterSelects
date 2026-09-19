import { SaxesParser, type SaxesTagPlain } from 'saxes';
import type {
  PremiereClipRecord,
  PremiereComponentChainRecord,
  PremiereComponentRecord,
  PremiereMediaRecord,
  PremiereParamRecord,
  PremiereProjectGraph,
  PremiereSequenceRecord,
  PremiereSourceRecord,
  PremiereSubClipRecord,
  PremiereTrackGroupRecord,
  PremiereTrackItemRecord,
  PremiereTrackRecord,
} from './premiereProjectTypes';

type RootCapture =
  | { kind: 'sequence'; value: PremiereSequenceRecord }
  | { kind: 'track-group'; value: PremiereTrackGroupRecord }
  | { kind: 'track'; value: PremiereTrackRecord }
  | { kind: 'track-item'; value: PremiereTrackItemRecord }
  | { kind: 'sub-clip'; value: PremiereSubClipRecord }
  | { kind: 'clip'; value: PremiereClipRecord }
  | { kind: 'source'; value: PremiereSourceRecord }
  | { kind: 'media'; value: PremiereMediaRecord }
  | { kind: 'component-chain'; value: PremiereComponentChainRecord }
  | { kind: 'component'; value: PremiereComponentRecord }
  | { kind: 'param'; value: PremiereParamRecord };

const RELEVANT_COMPONENTS = new Set(['AE.ADBE Motion', 'AE.ADBE Opacity']);
const RELEVANT_PARAMS = new Set([
  'Opacity',
  'Position',
  'Scale',
  'Uniform Scale',
  'Scale Width',
  'Rotation',
]);

export interface PremiereProjectStreamParser {
  write(chunk: string): void;
  close(): PremiereProjectGraph;
}

export function createPremiereProjectStreamParser(): PremiereProjectStreamParser {
  const graph = createEmptyGraph();
  const parser = new SaxesParser({ xmlns: false, position: true });
  const stack: string[] = [];
  let capture: RootCapture | null = null;
  let textCapture: { depth: number; field: string; value: string } | null = null;
  let seenRoot = false;
  let closedRoot = false;

  parser.on('opentag', (tag) => {
    stack.push(tag.name);
    if (stack.length === 1) {
      if (tag.name !== 'PremiereData') throw new Error('Premiere project root must be PremiereData.');
      seenRoot = true;
      return;
    }
    if (stack.length === 2) {
      capture = beginCapture(tag);
      return;
    }
    if (!capture) return;
    captureAttributes(capture, tag, stack);
    if (shouldCaptureText(capture.kind, tag.name)) {
      textCapture = { depth: stack.length, field: tag.name, value: '' };
    }
  });

  parser.on('text', (text) => {
    if (textCapture) textCapture.value += text;
  });
  parser.on('cdata', (text) => {
    if (textCapture) textCapture.value += text;
  });

  parser.on('closetag', () => {
    if (textCapture?.depth === stack.length && capture) {
      assignText(capture, textCapture.field, textCapture.value.trim());
      textCapture = null;
    }
    if (stack.length === 2 && capture) {
      finishCapture(graph, capture);
      capture = null;
    } else if (stack.length === 1) {
      closedRoot = true;
    }
    stack.pop();
  });

  return {
    write(chunk) {
      parser.write(chunk);
    },
    close() {
      parser.close();
      if (!seenRoot || !closedRoot || stack.length !== 0) {
        throw new Error('Premiere project XML ended before PremiereData was complete.');
      }
      pruneTransformGraph(graph);
      return graph;
    },
  };
}

function createEmptyGraph(): PremiereProjectGraph {
  return {
    sequences: [],
    trackGroupsById: new Map(),
    tracksByUid: new Map(),
    trackItemsById: new Map(),
    subClipsById: new Map(),
    clipsById: new Map(),
    sourcesById: new Map(),
    mediaByUid: new Map(),
    componentChainsById: new Map(),
    componentsById: new Map(),
    paramsById: new Map(),
  };
}

function beginCapture(tag: SaxesTagPlain): RootCapture | null {
  const id = tag.attributes.ObjectID ?? '';
  const uid = tag.attributes.ObjectUID ?? '';
  switch (tag.name) {
    case 'Sequence':
      return uid ? { kind: 'sequence', value: { uid, name: '', trackGroupRefs: [] } } : null;
    case 'VideoTrackGroup':
      return id ? { kind: 'track-group', value: { id, kind: 'video', trackUids: [] } } : null;
    case 'AudioTrackGroup':
      return id ? { kind: 'track-group', value: { id, kind: 'audio', trackUids: [] } } : null;
    case 'VideoClipTrack':
      return uid ? { kind: 'track', value: { uid, kind: 'video', itemIds: [], locked: false, muted: false } } : null;
    case 'AudioClipTrack':
      return uid ? { kind: 'track', value: { uid, kind: 'audio', itemIds: [], locked: false, muted: false } } : null;
    case 'VideoClipTrackItem':
      return id ? { kind: 'track-item', value: { id, kind: 'video' } } : null;
    case 'AudioClipTrackItem':
      return id ? { kind: 'track-item', value: { id, kind: 'audio' } } : null;
    case 'SubClip':
      return id ? { kind: 'sub-clip', value: { id, name: '' } } : null;
    case 'VideoClip':
    case 'AudioClip':
      return id ? { kind: 'clip', value: { id } } : null;
    case 'Media':
      return uid ? { kind: 'media', value: { uid, title: '' } } : null;
    default:
      if (tag.name.endsWith('MediaSource') || tag.name.endsWith('SequenceSource')) {
        return id ? { kind: 'source', value: { id } } : null;
      }
      if (tag.name.endsWith('ComponentChain')) {
        return id ? { kind: 'component-chain', value: { id, componentIds: [] } } : null;
      }
      if (tag.name.endsWith('FilterComponent')) {
        return id ? { kind: 'component', value: { id, matchName: '', paramIds: [] } } : null;
      }
      if (tag.name.endsWith('ComponentParam')) {
        return id ? { kind: 'param', value: { id, name: '' } } : null;
      }
      return null;
  }
}

function captureAttributes(capture: RootCapture, tag: SaxesTagPlain, stack: readonly string[]): void {
  const objectRef = tag.attributes.ObjectRef;
  const objectURef = tag.attributes.ObjectURef;
  switch (capture.kind) {
    case 'sequence':
      if (tag.name === 'Second' && objectRef && stack.includes('TrackGroups')) capture.value.trackGroupRefs.push(objectRef);
      break;
    case 'track-group':
      if (tag.name === 'Track' && objectURef && stack.includes('Tracks')) capture.value.trackUids.push(objectURef);
      break;
    case 'track':
      if (tag.name === 'TrackItem' && objectRef && stack.includes('TrackItems')) capture.value.itemIds.push(objectRef);
      break;
    case 'track-item':
      if (tag.name === 'Components' && objectRef) capture.value.componentChainId = objectRef;
      if (tag.name === 'SubClip' && objectRef) capture.value.subClipId = objectRef;
      break;
    case 'sub-clip':
      if (tag.name === 'Clip' && objectRef) capture.value.clipId = objectRef;
      break;
    case 'clip':
      if (tag.name === 'Source' && objectRef) capture.value.sourceId = objectRef;
      break;
    case 'source':
      if (tag.name === 'Sequence' && objectURef) capture.value.sequenceUid = objectURef;
      if (tag.name === 'Media' && objectURef) capture.value.mediaUid = objectURef;
      if (tag.name === 'ProxyMedia' && objectURef) capture.value.proxyMediaUid = objectURef;
      break;
    case 'component-chain':
      if (tag.name === 'Component' && objectRef) capture.value.componentIds.push(objectRef);
      break;
    case 'component':
      if (tag.name === 'Param' && objectRef) capture.value.paramIds.push(objectRef);
      break;
    case 'media':
    case 'param':
      break;
  }
}

function shouldCaptureText(kind: RootCapture['kind'], field: string): boolean {
  switch (kind) {
    case 'sequence': return field === 'Name';
    case 'track-group': return field === 'FrameRect' || field === 'FrameRate';
    case 'track': return field === 'IsLocked' || field === 'IsMuted';
    case 'track-item': return field === 'Start' || field === 'End';
    case 'sub-clip': return field === 'Name';
    case 'clip': return field === 'InPoint' || field === 'OutPoint';
    case 'source': return field === 'OriginalDuration';
    case 'media': return ['Title', 'ActualMediaFilePath', 'FilePath', 'RelativePath', 'FileKey', 'IsProxy'].includes(field);
    case 'component': return field === 'MatchName';
    case 'param': return field === 'Name' || field === 'CurrentValue' || field === 'StartKeyframe';
    case 'component-chain': return false;
  }
}

function assignText(capture: RootCapture, field: string, text: string): void {
  if (!text) return;
  switch (capture.kind) {
    case 'sequence': if (field === 'Name') capture.value.name = text; break;
    case 'track-group':
      if (field === 'FrameRect') capture.value.frameRect = text;
      if (field === 'FrameRate') capture.value.frameRateTicks = text;
      break;
    case 'track':
      if (field === 'IsLocked') capture.value.locked = text === 'true';
      if (field === 'IsMuted') capture.value.muted = text === 'true';
      break;
    case 'track-item':
      if (field === 'Start') capture.value.startTicks = text;
      if (field === 'End') capture.value.endTicks = text;
      break;
    case 'sub-clip': if (field === 'Name') capture.value.name = text; break;
    case 'clip':
      if (field === 'InPoint') capture.value.inPointTicks = text;
      if (field === 'OutPoint') capture.value.outPointTicks = text;
      break;
    case 'source': if (field === 'OriginalDuration') capture.value.originalDurationTicks = text; break;
    case 'media':
      if (field === 'Title') capture.value.title = text;
      if (field === 'ActualMediaFilePath') capture.value.actualMediaFilePath = text;
      if (field === 'FilePath') capture.value.filePath = text;
      if (field === 'RelativePath') capture.value.relativePath = text;
      if (field === 'FileKey') capture.value.fileKey = text;
      if (field === 'IsProxy') capture.value.isProxy = text === 'true';
      break;
    case 'component': if (field === 'MatchName') capture.value.matchName = text; break;
    case 'param':
      if (field === 'Name') capture.value.name = text;
      if (field === 'CurrentValue') capture.value.currentValue = text;
      if (field === 'StartKeyframe') capture.value.startKeyframe = text;
      break;
    case 'component-chain': break;
  }
}

function finishCapture(graph: PremiereProjectGraph, capture: RootCapture): void {
  switch (capture.kind) {
    case 'sequence': graph.sequences.push(capture.value); break;
    case 'track-group': graph.trackGroupsById.set(capture.value.id, capture.value); break;
    case 'track': graph.tracksByUid.set(capture.value.uid, capture.value); break;
    case 'track-item': graph.trackItemsById.set(capture.value.id, capture.value); break;
    case 'sub-clip': graph.subClipsById.set(capture.value.id, capture.value); break;
    case 'clip': graph.clipsById.set(capture.value.id, capture.value); break;
    case 'source': graph.sourcesById.set(capture.value.id, capture.value); break;
    case 'media': graph.mediaByUid.set(capture.value.uid, capture.value); break;
    case 'component-chain': graph.componentChainsById.set(capture.value.id, capture.value); break;
    case 'component':
      if (RELEVANT_COMPONENTS.has(capture.value.matchName)) {
        graph.componentsById.set(capture.value.id, capture.value);
      }
      break;
    case 'param':
      if (RELEVANT_PARAMS.has(capture.value.name)) graph.paramsById.set(capture.value.id, capture.value);
      break;
  }
}

function pruneTransformGraph(graph: PremiereProjectGraph): void {
  const usedChainIds = new Set(Array.from(graph.trackItemsById.values()).flatMap((item) => item.componentChainId ? [item.componentChainId] : []));
  const usedComponentIds = new Set<string>();
  for (const [id, chain] of graph.componentChainsById) {
    if (!usedChainIds.has(id)) {
      graph.componentChainsById.delete(id);
      continue;
    }
    for (const componentId of chain.componentIds) usedComponentIds.add(componentId);
  }
  const usedParamIds = new Set<string>();
  for (const [id, component] of graph.componentsById) {
    if (!usedComponentIds.has(id)) {
      graph.componentsById.delete(id);
      continue;
    }
    for (const paramId of component.paramIds) usedParamIds.add(paramId);
  }
  for (const id of graph.paramsById.keys()) {
    if (!usedParamIds.has(id)) graph.paramsById.delete(id);
  }
}
