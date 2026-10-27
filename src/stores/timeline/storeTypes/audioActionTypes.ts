import type {
  ClipAudioRegionGainPreview,
  ClipAudioStemState,
  SpectralImageLayer,
} from '../../../types';
import type {
  AudioSilenceDetectionOptions,
  AudioSilenceRange,
} from '../../../services/audio/audioSilenceDetection';
import type {
  AudioTransientDetectionOptions,
  AudioTransientRange,
} from '../../../services/audio/audioTransientDetection';
import type {
  AddClipSpectralImageLayerInput,
  ApplyAudioRegionEditOptions,
  ApplyAudioRegionGainEditOptions,
  ApplyAudioRepairSuggestionInput,
  ApplyDetectedSilenceRemovalOptions,
  ApplyDetectedTransientSofteningOptions,
  ApplyRoomToneFillOptions,
  ApplySpectralRegionEditOptions,
  SetClipAudioEditOperationRangeOptions,
  TimelineAudioRegionEditType,
  TimelineAudioRegionSelection,
  TimelineSpectralRegionEditType,
} from './regionTypes';
import type {
  StartClipStemSeparationOptions,
} from './stemJobTypes';

export interface AudioEditActions {
  applyAudioRegionEdit: (type: TimelineAudioRegionEditType, options?: ApplyAudioRegionEditOptions) => string | null;
  setAudioRegionGainPreview: (preview: ClipAudioRegionGainPreview | null) => void;
  clearAudioRegionGainPreview: () => void;
  setAudioRegionGainEdit: (options: ApplyAudioRegionGainEditOptions) => string | null;
  setClipAudioEditOperationRange: (
    clipId: string,
    operationIds: string[],
    selection: TimelineAudioRegionSelection,
    options?: SetClipAudioEditOperationRangeOptions,
  ) => void;
  applyAudioRepairSuggestion: (clipId: string, suggestion: ApplyAudioRepairSuggestionInput) => string | null;
  detectClipSilenceRanges: (clipId: string, options?: AudioSilenceDetectionOptions) => Promise<AudioSilenceRange[]>;
  applyDetectedSilenceRemoval: (clipId: string, options?: ApplyDetectedSilenceRemovalOptions) => Promise<string[]>;
  applyRoomToneFill: (clipId: string, options?: ApplyRoomToneFillOptions) => Promise<string | null>;
  detectClipTransientRanges: (clipId: string, options?: AudioTransientDetectionOptions) => Promise<AudioTransientRange[]>;
  applyDetectedTransientSoftening: (clipId: string, options?: ApplyDetectedTransientSofteningOptions) => Promise<string[]>;
  copySelectedAudioRegion: () => boolean;
  pasteAudioRegionToSelection: () => string | null;
  setClipAudioEditOperationEnabled: (clipId: string, operationId: string, enabled: boolean) => void;
  /** Silences a clip in playback and export without touching its level (`audioState.muted`). */
  setClipAudioMuted: (clipId: string, muted: boolean) => void;
  removeClipAudioEditOperation: (clipId: string, operationId: string) => void;
  clearClipAudioEditStack: (clipId: string) => void;
  bakeClipAudioEditStack: (clipId: string) => Promise<string | null>;
  unbakeClipAudioEditStack: (clipId: string) => boolean;
  applySpectralRegionEdit: (type: TimelineSpectralRegionEditType, options?: ApplySpectralRegionEditOptions) => string | null;
  addClipSpectralImageLayer: (clipId: string, layer: AddClipSpectralImageLayerInput) => string | null;
  updateClipSpectralImageLayer: (clipId: string, layerId: string, patch: Partial<SpectralImageLayer>) => void;
  removeClipSpectralImageLayer: (clipId: string, layerId: string) => void;
}

export interface StemSeparationActions {
  startClipStemSeparation: (
    clipId: string,
    options?: StartClipStemSeparationOptions,
  ) => Promise<string | null>;
  cancelClipStemSeparation: (clipId: string) => void;
  setClipStemMixMode: (clipId: string, mixMode: ClipAudioStemState['mixMode']) => void;
  setClipStemSourceGain: (clipId: string, gainDb: number) => void;
  setClipStemSolo: (clipId: string, stemId: string | null) => void;
  setClipStemEnabled: (clipId: string, stemId: string, enabled: boolean) => void;
  setClipStemGain: (clipId: string, stemId: string, gainDb: number) => void;
  prewarmStemSourceMediaFiles: (stemMediaFileIds: readonly string[]) => number;
  setClipSourceToStem: (clipId: string, stemMediaFileId: string) => boolean;
  relinkClipStemSeparationJobsFromMediaLibrary: () => number;
  syncClipStemSeparationCopies: (clipId: string) => number;
  clearClipStemSeparation: (clipId: string) => void;
}
