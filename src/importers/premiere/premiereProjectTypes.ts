import type {
  Composition,
  ImportedMediaType,
  MediaFile,
  MediaFolder,
} from '../../stores/mediaStore/types';
import type { LinkedMediaSource, MediaSourceSelection } from '../../types/mediaMetadata';

export type PremiereTrackKind = 'video' | 'audio';

export interface PremiereSequenceRecord {
  uid: string;
  name: string;
  trackGroupRefs: string[];
}

export interface PremiereTrackGroupRecord {
  id: string;
  kind: PremiereTrackKind;
  trackUids: string[];
  frameRect?: string;
  frameRateTicks?: string;
}

export interface PremiereTrackRecord {
  uid: string;
  kind: PremiereTrackKind;
  itemIds: string[];
  locked: boolean;
  muted: boolean;
}

export interface PremiereTrackItemRecord {
  id: string;
  kind: PremiereTrackKind;
  startTicks?: string;
  endTicks?: string;
  subClipId?: string;
  componentChainId?: string;
}

export interface PremiereSubClipRecord {
  id: string;
  clipId?: string;
  name: string;
}

export interface PremiereClipRecord {
  id: string;
  sourceId?: string;
  inPointTicks?: string;
  outPointTicks?: string;
}

export interface PremiereSourceRecord {
  id: string;
  mediaUid?: string;
  proxyMediaUid?: string;
  sequenceUid?: string;
  originalDurationTicks?: string;
}

export interface PremiereMediaRecord {
  uid: string;
  title: string;
  actualMediaFilePath?: string;
  filePath?: string;
  relativePath?: string;
  fileKey?: string;
  isProxy?: boolean;
}

export interface PremiereComponentChainRecord {
  id: string;
  componentIds: string[];
}

export interface PremiereComponentRecord {
  id: string;
  matchName: string;
  paramIds: string[];
}

export interface PremiereParamRecord {
  id: string;
  name: string;
  currentValue?: string;
  startKeyframe?: string;
}

export interface PremiereProjectGraph {
  sequences: PremiereSequenceRecord[];
  trackGroupsById: Map<string, PremiereTrackGroupRecord>;
  tracksByUid: Map<string, PremiereTrackRecord>;
  trackItemsById: Map<string, PremiereTrackItemRecord>;
  subClipsById: Map<string, PremiereSubClipRecord>;
  clipsById: Map<string, PremiereClipRecord>;
  sourcesById: Map<string, PremiereSourceRecord>;
  mediaByUid: Map<string, PremiereMediaRecord>;
  componentChainsById: Map<string, PremiereComponentChainRecord>;
  componentsById: Map<string, PremiereComponentRecord>;
  paramsById: Map<string, PremiereParamRecord>;
}

export interface PremiereExistingMediaDescriptor {
  id: string;
  name: string;
  type: ImportedMediaType;
  duration?: number;
  fileName?: string;
  filePath?: string;
  absolutePath?: string;
  projectPath?: string;
  linkedSources?: LinkedMediaSource[];
  sourceSelection?: MediaSourceSelection;
}

export interface PremiereExistingMediaUpdate {
  id: string;
  linkedSources: LinkedMediaSource[];
  sourceSelection: MediaSourceSelection;
}

export interface PremiereProjectImportResult {
  folder: MediaFolder;
  mediaFiles: MediaFile[];
  existingMediaUpdates: PremiereExistingMediaUpdate[];
  compositions: Composition[];
  reusedMediaCount: number;
  proxyMediaCount: number;
  skippedClipCount: number;
  speedAdjustedClipCount: number;
}

export interface PremiereProjectImportProgress {
  phase: 'reading' | 'parsing' | 'building' | 'complete';
  percent: number;
  detail: string;
}

export interface PremiereProjectImportOptions {
  selectedSequenceUids?: readonly string[];
  signal?: AbortSignal;
  onProgress?: (progress: PremiereProjectImportProgress) => void;
  selectSequences?: (summary: PremiereProjectSummary) => Promise<readonly string[] | null>;
}

export interface PremiereProjectSequenceSummary {
  uid: string;
  name: string;
  videoTrackCount: number;
  audioTrackCount: number;
  clipCount: number;
}

export interface PremiereProjectSummary {
  sequences: PremiereProjectSequenceSummary[];
  mediaCount: number;
}
