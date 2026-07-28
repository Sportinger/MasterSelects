import type { TimelineClip } from '../../types';
import type {
  ClipStemSeparationJobState,
  GenerateClipAudioAnalysisOptions,
  TimelineAudioDisplayMode,
} from '../../stores/timeline/types';
import type { ContextMenuState } from './types';

export interface TimelineContextMenuProps {
  contextMenu: ContextMenuState | null;
  setContextMenu: (menu: ContextMenuState | null) => void;
  clipMap: Map<string, TimelineClip>;
  selectedClipIds: Set<string>;
  isClipLocked: (clipId: string) => boolean;
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
  audioDisplayMode: TimelineAudioDisplayMode;
  clipStemSeparationJobs: Record<string, ClipStemSeparationJobState>;
  selectClip: (clipId: string) => void;
  removeClip: (clipId: string) => void;
  splitClipAtPlayhead: () => void;
  rippleDeleteSelection: (clipIds?: string[]) => void;
  deleteClipSelection: (clipIds?: string[]) => void;
  deleteGapAtTime: (time: number) => void;
  toggleClipReverse: (clipId: string) => void;
  unlinkGroup: (clipId: string) => void;
  linkClips: (clipIds: string[]) => void;
  unlinkClips: (clipIds: string[]) => void;
  syncClipsViaAudio: (clipIds: string[], masterClipId?: string) => Promise<unknown>;
  generateWaveformForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => void;
  generateSpectrogramForClip: (clipId: string, options?: GenerateClipAudioAnalysisOptions) => void;
  startClipStemSeparation: (clipId: string, options?: { force?: boolean }) => Promise<string | null>;
  toggleThumbnailsEnabled: () => void;
  toggleWaveformsEnabled: () => void;
  setAudioDisplayMode: (mode: TimelineAudioDisplayMode) => void;
  convertSolidToMotionShape: (clipId: string) => string | null;
  createSubcompositionFromSelection: (clipId: string) => void;
  copyClipEffects: (clipId: string) => void;
  pasteClipEffects: (targetClipIds?: string[]) => void;
  hasClipboardEffects: () => boolean;
  copyClipColor: (clipId: string) => void;
  pasteClipColor: (targetClipIds?: string[]) => void;
  hasClipboardColor: () => boolean;
  setMulticamDialogOpen: (open: boolean) => void;
  showInExplorer: (
    type: 'raw' | 'proxy',
    fileId: string,
  ) => Promise<{ success: boolean; message: string }>;
}
