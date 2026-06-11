import type {
  AudioEffectInstance,
  AudioExportPreflightState,
  AudioMeterSnapshot,
  AudioSendState,
  MasterAudioState,
  TimelineTrack,
  TrackAudioState,
} from '../../../types';
import type { MidiInstrument } from '../../../types/midiClip';
import type { LabelColor } from '../../mediaStore/types';

export interface TrackActions {
  addTrack: (type: 'video' | 'audio' | 'midi') => string;
  removeTrack: (id: string) => void;
  reorderTrack: (trackId: string, targetTrackId: string, placeBelow: boolean) => void;
  renameTrack: (id: string, name: string) => void;
  setTrackLabelColor: (id: string, labelColor: LabelColor) => void;
  setTrackMuted: (id: string, muted: boolean) => void;
  setTrackVisible: (id: string, visible: boolean) => void;
  setTrackSolo: (id: string, solo: boolean) => void;
  updateTrackAudioState: (id: string, patch: Partial<TrackAudioState>) => void;
  setTrackAudioVolumeDb: (id: string, volumeDb: number) => void;
  setTrackAudioPan: (id: string, pan: number) => void;
  addTrackAudioSend: (trackId: string, targetBusId?: string) => string | null;
  updateTrackAudioSend: (trackId: string, sendId: string, patch: Partial<AudioSendState>) => void;
  removeTrackAudioSend: (trackId: string, sendId: string) => void;
  addTrackAudioEffectInstance: (trackId: string, descriptorId: string) => string | null;
  removeTrackAudioEffectInstance: (trackId: string, effectId: string) => void;
  updateTrackAudioEffectInstance: (trackId: string, effectId: string, params: Partial<AudioEffectInstance['params']>) => void;
  setTrackAudioEffectInstanceEnabled: (trackId: string, effectId: string, enabled: boolean) => void;
  reorderTrackAudioEffectInstance: (trackId: string, effectId: string, newIndex: number) => void;
  updateMasterAudioState: (patch: Partial<MasterAudioState>) => void;
  setMasterAudioVolumeDb: (volumeDb: number) => void;
  setMasterLimiterEnabled: (enabled: boolean) => void;
  setMasterTruePeakCeilingDb: (truePeakCeilingDb: number) => void;
  setMasterTargetLufs: (targetLufs: number | undefined) => void;
  runAudioExportPreflight: (startTime?: number, endTime?: number, renderedBuffer?: AudioBuffer | null) => AudioExportPreflightState;
  addMasterAudioEffectInstance: (descriptorId: string) => string | null;
  removeMasterAudioEffectInstance: (effectId: string) => void;
  updateMasterAudioEffectInstance: (effectId: string, params: Partial<AudioEffectInstance['params']>) => void;
  setMasterAudioEffectInstanceEnabled: (effectId: string, enabled: boolean) => void;
  reorderMasterAudioEffectInstance: (effectId: string, newIndex: number) => void;
  updateRuntimeAudioMeter: (trackId: string, snapshot: AudioMeterSnapshot, masterSnapshot?: AudioMeterSnapshot) => void;
  updateRuntimeAudioMeters: (
    entries: readonly { trackId: string; snapshot: AudioMeterSnapshot }[],
    masterSnapshot?: AudioMeterSnapshot,
  ) => void;
  clearStaleRuntimeAudioMeters: (maxAgeMs?: number, now?: number) => void;
  setTrackLocked: (id: string, locked: boolean) => void;
  setTrackHeight: (id: string, height: number) => void;
  scaleTracksOfType: (type: 'video' | 'audio' | 'midi', delta: number, baselineHeight?: number) => void;
  setTargetTrack: (trackId: string | null) => void;
  clearTargetTracks: () => void;
  setTrackParent: (trackId: string, parentTrackId: string | null) => void;
  getTrackChildren: (trackId: string) => TimelineTrack[];
  setTrackMidiInstrument: (trackId: string, patch: Partial<MidiInstrument>) => void;
}
