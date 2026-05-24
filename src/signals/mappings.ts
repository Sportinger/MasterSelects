import type { TimelineSourceType } from '../types';
import type { ImportedMediaType, MediaType } from '../stores/mediaStore/types';
import type { ProjectMediaFile } from '../services/project/types/media.types';
import type { NodeGraphSignalType } from '../types/nodeGraph';
import type { SignalKind } from './types';

export const SIGNAL_KIND_BY_NODE_GRAPH_SIGNAL_TYPE: Record<NodeGraphSignalType, SignalKind> = {
  texture: 'texture',
  audio: 'audio',
  geometry: 'geometry',
  'point-cloud': 'point-cloud',
  mesh: 'mesh',
  table: 'table',
  document: 'document',
  vector: 'vector',
  curve: 'curve',
  mask: 'mask',
  text: 'text',
  metadata: 'metadata',
  event: 'event',
  time: 'time',
  scene: 'scene',
  timeline: 'timeline',
  'render-target': 'render-target',
  binary: 'binary',
  number: 'number',
  boolean: 'boolean',
  string: 'string',
};

export function signalKindForNodeGraphSignalType(type: NodeGraphSignalType): SignalKind {
  return SIGNAL_KIND_BY_NODE_GRAPH_SIGNAL_TYPE[type];
}

export function signalKindsForTimelineSourceType(type: TimelineSourceType): SignalKind[] {
  switch (type) {
    case 'video':
      return ['texture', 'audio', 'metadata'];
    case 'audio':
      return ['audio', 'metadata'];
    case 'image':
    case 'solid':
      return ['texture', 'metadata'];
    case 'text':
      return ['text', 'texture', 'metadata'];
    case 'model':
      return ['mesh', 'geometry', 'metadata'];
    case 'gaussian-avatar':
    case 'gaussian-splat':
      return ['point-cloud', 'geometry', 'metadata'];
    case 'camera':
      return ['scene', 'metadata'];
    case 'splat-effector':
      return ['geometry', 'metadata'];
    case 'math-scene':
      return ['scene', 'curve', 'texture', 'metadata'];
    case 'motion-shape':
      return ['vector', 'texture', 'metadata'];
    case 'motion-null':
    case 'motion-adjustment':
      return ['metadata'];
    case 'lottie':
    case 'rive':
      return ['vector', 'texture', 'metadata'];
    default:
      return ['binary', 'metadata'];
  }
}

export function signalKindsForMediaType(type: MediaType | ImportedMediaType | ProjectMediaFile['type']): SignalKind[] {
  switch (type) {
    case 'video':
      return ['texture', 'audio', 'metadata'];
    case 'audio':
      return ['audio', 'metadata'];
    case 'image':
    case 'solid':
      return ['texture', 'metadata'];
    case 'text':
      return ['text', 'texture', 'metadata'];
    case 'model':
      return ['mesh', 'geometry', 'metadata'];
    case 'gaussian-avatar':
    case 'gaussian-splat':
      return ['point-cloud', 'geometry', 'metadata'];
    case 'composition':
      return ['timeline', 'scene', 'metadata'];
    case 'camera':
      return ['scene', 'metadata'];
    case 'math-scene':
      return ['scene', 'curve', 'texture', 'metadata'];
    case 'motion-shape':
      return ['vector', 'texture', 'metadata'];
    case 'splat-effector':
      return ['geometry', 'metadata'];
    case 'lottie':
    case 'rive':
      return ['vector', 'texture', 'metadata'];
    default:
      return ['binary', 'metadata'];
  }
}
