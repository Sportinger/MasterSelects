import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type {
  ClipAudioEditOperation,
  MediaFileAudioAnalysisRefs,
  SpectralImageLayer,
  SpectralImageLayerKeyframe,
  TimelineClip,
} from '../../../types';
import { buildAudioRepairSuggestionsFromRefs } from '../../../services/audio/audioRepairSuggestions';
import type { AudioRepairSuggestion } from '../../../services/audio/audioRepairSuggestions';
import { audioEditPreviewService } from '../../../services/audio/AudioEditPreviewService';
import type { AudioEditPreviewPhase } from '../../../services/audio/AudioEditPreviewService';
import { audioRepairPreviewService } from '../../../services/audio/AudioRepairPreviewService';
import type { AudioRepairPreviewPhase } from '../../../services/audio/AudioRepairPreviewService';
import type { AudioSilenceRange } from '../../../services/audio/audioSilenceDetection';
import type { AudioTransientRange } from '../../../services/audio/audioTransientDetection';

const OPERATION_LABELS: Record<ClipAudioEditOperation['type'], string> = {
  trim: 'Trim',
  cut: 'Cut',
  gain: 'Gain',
  silence: 'Silence',
  copy: 'Copy',
  paste: 'Paste',
  'insert-silence': 'Insert Silence',
  'delete-silence': 'Delete Silence',
  reverse: 'Reverse',
  'invert-polarity': 'Invert Polarity',
  'swap-channels': 'Swap Channels',
  'mono-sum': 'Mono Sum',
  'split-stereo': 'Split Stereo',
  repair: 'Repair',
  effect: 'Region FX',
  'room-tone-fill': 'Room Tone Fill',
  'spectral-mask': 'Spectral Mask',
  'spectral-resynthesis': 'Spectral Resynthesis',
};

function formatSeconds(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute - minutes * 60;
  return `${sign}${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

function formatValue(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

function getOperationLabel(operation: ClipAudioEditOperation): string {
  const label = operation.params?.label;
  if (typeof label === 'string' && label.trim()) return label;
  return OPERATION_LABELS[operation.type] ?? operation.type;
}

function getOperationRange(operation: ClipAudioEditOperation): string {
  if (!operation.timeRange) return '-';
  return `${formatSeconds(operation.timeRange.start)} - ${formatSeconds(operation.timeRange.end)}`;
}

function getTimelineRange(operation: ClipAudioEditOperation): string {
  const start = operation.params?.timelineStart;
  const end = operation.params?.timelineEnd;
  if (typeof start !== 'number' || typeof end !== 'number') return '-';
  return `${formatSeconds(start)} - ${formatSeconds(end)}`;
}

function firstNonEmptyRefs<T>(preferred: T[] | undefined, fallback: T[] | undefined): T[] | undefined {
  return preferred && preferred.length > 0 ? preferred : fallback;
}

function getEffectiveAudioAnalysisRefs(clip: TimelineClip | undefined): MediaFileAudioAnalysisRefs | undefined {
  const source = clip?.audioState?.sourceAnalysisRefs;
  const processed = clip?.audioState?.processedAnalysisRefs;
  if (!source && !processed) {
    return undefined;
  }

  return {
    waveformPyramidId: processed?.processedWaveformPyramidId ??
      processed?.waveformPyramidId ??
      source?.waveformPyramidId,
    processedWaveformPyramidId: processed?.processedWaveformPyramidId ?? source?.processedWaveformPyramidId,
    spectrogramTileSetIds: firstNonEmptyRefs(processed?.spectrogramTileSetIds, source?.spectrogramTileSetIds),
    loudnessEnvelopeId: processed?.loudnessEnvelopeId ?? source?.loudnessEnvelopeId,
    beatGridId: processed?.beatGridId ?? source?.beatGridId,
    onsetMapId: processed?.onsetMapId ?? source?.onsetMapId,
    phaseCorrelationId: processed?.phaseCorrelationId ?? source?.phaseCorrelationId,
    transcriptTimingId: processed?.transcriptTimingId ?? source?.transcriptTimingId,
    frequencySummaryId: processed?.frequencySummaryId ?? source?.frequencySummaryId,
  };
}

function formatFrequency(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

const SPECTRAL_LAYER_BLEND_MODES: SpectralImageLayer['blendMode'][] = [
  'attenuate',
  'boost',
  'gate',
  'sidechain-mask',
  'replace',
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function createSpectralLayerKeyframeId(layerId: string): string {
  return `${layerId}-kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function timelineTimeToClipSourceTime(clip: TimelineClip, timelineTime: number): number {
  const clipDuration = Math.max(0.001, clip.duration);
  const timelineRatio = clamp((timelineTime - clip.startTime) / clipDuration, 0, 1);
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart + 0.001, clip.outPoint ?? sourceStart + clipDuration);
  const sourceSpan = sourceEnd - sourceStart;
  return clip.reversed
    ? sourceEnd - timelineRatio * sourceSpan
    : sourceStart + timelineRatio * sourceSpan;
}

function createSpectralLayerKeyframe(
  layer: SpectralImageLayer,
  clip: TimelineClip,
  playheadPosition: number,
): SpectralImageLayerKeyframe {
  const sourceTime = timelineTimeToClipSourceTime(clip, playheadPosition);
  return {
    id: createSpectralLayerKeyframeId(layer.id),
    time: clamp(sourceTime - layer.timeStart, 0, Math.max(0.001, layer.duration)),
    opacity: layer.opacity,
    gainDb: layer.gainDb,
    frequencyMin: layer.frequencyMin,
    frequencyMax: layer.frequencyMax,
  };
}

function replaceSpectralLayerKeyframe(
  layer: SpectralImageLayer,
  keyframeId: string,
  patch: Partial<SpectralImageLayerKeyframe>,
): SpectralImageLayerKeyframe[] {
  return (layer.keyframes ?? [])
    .map(keyframe => keyframe.id === keyframeId ? { ...keyframe, ...patch } : keyframe)
    .toSorted((a, b) => a.time - b.time);
}

function formatSuggestionEvidence(suggestion: AudioRepairSuggestion): string {
  return Object.entries(suggestion.evidence)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(' | ');
}

function isSuggestionApplied(editStack: ClipAudioEditOperation[], suggestion: AudioRepairSuggestion): boolean {
  return editStack.some(operation =>
    operation.enabled !== false &&
    operation.params?.repairSuggestionId === suggestion.id
  );
}

function getPreviewButtonLabel(previewing: boolean, phase: AudioEditPreviewPhase | AudioRepairPreviewPhase | undefined, idleLabel = 'Preview'): string {
  if (!previewing) return idleLabel;
  if (phase === 'rendering') return 'Rendering';
  if (phase === 'error') return 'Dismiss';
  return 'Stop';
}

interface AudioEditStackTabProps {
  clipId: string;
}

interface RepairPreviewUiState {
  suggestionId: string;
  phase: AudioRepairPreviewPhase;
  message?: string;
}

interface EditPreviewUiState {
  previewId: string;
  phase: AudioEditPreviewPhase;
  message?: string;
}

interface SilenceCleanupUiState {
  phase: 'idle' | 'analyzing' | 'ready' | 'applying' | 'error';
  ranges: AudioSilenceRange[];
  message?: string;
}

interface TransientCleanupUiState {
  phase: 'idle' | 'analyzing' | 'ready' | 'applying' | 'error';
  ranges: AudioTransientRange[];
  message?: string;
}

export function AudioEditStackTab({ clipId }: AudioEditStackTabProps) {
  const clip = useTimelineStore(state => state.clips.find(currentClip => currentClip.id === clipId));
  const setClipAudioEditOperationEnabled = useTimelineStore(state => state.setClipAudioEditOperationEnabled);
  const removeClipAudioEditOperation = useTimelineStore(state => state.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(state => state.clearClipAudioEditStack);
  const applyAudioRepairSuggestion = useTimelineStore(state => state.applyAudioRepairSuggestion);
  const detectClipSilenceRanges = useTimelineStore(state => state.detectClipSilenceRanges);
  const applyDetectedSilenceRemoval = useTimelineStore(state => state.applyDetectedSilenceRemoval);
  const applyRoomToneFill = useTimelineStore(state => state.applyRoomToneFill);
  const detectClipTransientRanges = useTimelineStore(state => state.detectClipTransientRanges);
  const applyDetectedTransientSoftening = useTimelineStore(state => state.applyDetectedTransientSoftening);
  const bakeClipAudioEditStack = useTimelineStore(state => state.bakeClipAudioEditStack);
  const unbakeClipAudioEditStack = useTimelineStore(state => state.unbakeClipAudioEditStack);
  const updateClipSpectralImageLayer = useTimelineStore(state => state.updateClipSpectralImageLayer);
  const removeClipSpectralImageLayer = useTimelineStore(state => state.removeClipSpectralImageLayer);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const audioRegionSelection = useTimelineStore(state => state.audioRegionSelection);
  const mediaFiles = useMediaStore(state => state.files);
  const imageFilesById = useMemo(() => new Map(
    mediaFiles
      .filter(file => file.type === 'image')
      .map(file => [file.id, file] as const)
  ), [mediaFiles]);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [baking, setBaking] = useState(false);
  const [repairPreview, setRepairPreview] = useState<RepairPreviewUiState | null>(null);
  const [editPreview, setEditPreview] = useState<EditPreviewUiState | null>(null);
  const [silenceThresholdDb, setSilenceThresholdDb] = useState(-50);
  const [silenceMinSeconds, setSilenceMinSeconds] = useState(0.32);
  const [silenceRippleTimeline, setSilenceRippleTimeline] = useState(false);
  const [transientCrestDb, setTransientCrestDb] = useState(18);
  const [transientMinPeakDb, setTransientMinPeakDb] = useState(-8);
  const [transientGainDb, setTransientGainDb] = useState(-6);
  const [silenceCleanup, setSilenceCleanup] = useState<SilenceCleanupUiState>({
    phase: 'idle',
    ranges: [],
  });
  const [transientCleanup, setTransientCleanup] = useState<TransientCleanupUiState>({
    phase: 'idle',
    ranges: [],
  });

  const editStack = useMemo(() => clip?.audioState?.editStack ?? [], [clip?.audioState?.editStack]);
  const effectiveAudioAnalysisRefs = useMemo(() => getEffectiveAudioAnalysisRefs(clip), [clip]);
  const repairSuggestions = useMemo(
    () => buildAudioRepairSuggestionsFromRefs(effectiveAudioAnalysisRefs),
    [effectiveAudioAnalysisRefs],
  );
  const spectralLayers = clip?.audioState?.spectralLayers ?? [];
  const bakeHistory = clip?.audioState?.bakeHistory ?? [];
  const canUnbake = Boolean(bakeHistory.at(-1)?.restore);
  const activeOperationCount = editStack.filter(operation => operation.enabled !== false).length;
  const activeSpectralLayerCount = spectralLayers.filter(layer => layer.enabled !== false).length;
  const selectedOperation = editStack.find(operation => operation.id === selectedOperationId) ?? editStack[0] ?? null;
  const hasSelectedAudioRegion = Boolean(
    audioRegionSelection &&
      audioRegionSelection.clipId === clip?.id &&
      Math.abs(audioRegionSelection.sourceOutPoint - audioRegionSelection.sourceInPoint) > 0.0005,
  );

  useEffect(() => {
    if (selectedOperationId && editStack.some(operation => operation.id === selectedOperationId)) return;
    setSelectedOperationId(editStack[0]?.id ?? null);
  }, [editStack, selectedOperationId]);

  useEffect(() => {
    setSilenceCleanup({ phase: 'idle', ranges: [] });
    setTransientCleanup({ phase: 'idle', ranges: [] });
  }, [clipId]);

  useEffect(() => () => {
    audioEditPreviewService.stop();
    audioRepairPreviewService.stop();
  }, []);

  useEffect(() => {
    if (!editPreview) return;
    if (editPreview.previewId === 'stack' && activeOperationCount > 0) return;
    if (editPreview.previewId.startsWith('operation:')) {
      const operationId = editPreview.previewId.slice('operation:'.length);
      if (editStack.some(operation => operation.id === operationId)) return;
    }
    audioEditPreviewService.stop();
    setEditPreview(null);
  }, [activeOperationCount, editPreview, editStack]);

  useEffect(() => {
    if (!repairPreview) return;
    if (repairSuggestions.some(suggestion => suggestion.id === repairPreview.suggestionId)) return;
    audioRepairPreviewService.stop();
    setRepairPreview(null);
  }, [repairPreview, repairSuggestions]);

  const stopRepairPreview = useCallback(() => {
    audioRepairPreviewService.stop();
    setRepairPreview(null);
  }, []);

  const stopEditPreview = useCallback(() => {
    audioEditPreviewService.stop();
    setEditPreview(null);
  }, []);

  const previewRepairSuggestion = useCallback(async (suggestion: AudioRepairSuggestion) => {
    if (!clip) return;
    if (repairPreview?.suggestionId === suggestion.id) {
      stopRepairPreview();
      return;
    }

    stopEditPreview();
    setRepairPreview({
      suggestionId: suggestion.id,
      phase: 'rendering',
      message: 'Rendering preview',
    });

    try {
      await audioRepairPreviewService.preview({
        clip,
        suggestion,
        timelineTime: playheadPosition,
        maxDurationSeconds: 8,
        onStatus: status => {
          setRepairPreview(current => {
            if (!current || current.suggestionId !== status.suggestionId) return current;
            if (status.phase === 'stopped') return null;
            return {
              suggestionId: status.suggestionId,
              phase: status.phase,
              message: status.message ?? status.progress?.message,
            };
          });
        },
      });
    } catch (error) {
      setRepairPreview(current => current?.suggestionId === suggestion.id
        ? {
            suggestionId: suggestion.id,
            phase: 'error',
            message: error instanceof Error ? error.message : 'Preview failed',
          }
        : current);
    }
  }, [clip, playheadPosition, repairPreview?.suggestionId, stopEditPreview, stopRepairPreview]);

  const previewEditStack = useCallback(async () => {
    if (!clip || activeOperationCount === 0) return;
    const previewId = 'stack';
    if (editPreview?.previewId === previewId) {
      stopEditPreview();
      return;
    }

    stopRepairPreview();
    setEditPreview({
      previewId,
      phase: 'rendering',
      message: 'Rendering stack preview',
    });

    try {
      await audioEditPreviewService.preview({
        clip,
        operations: editStack,
        mode: 'stack',
        previewId,
        timelineTime: playheadPosition,
        maxDurationSeconds: 8,
        includeSpectralLayers: true,
        onStatus: status => {
          setEditPreview(current => {
            if (!current || current.previewId !== status.previewId) return current;
            if (status.phase === 'stopped') return null;
            return {
              previewId: status.previewId,
              phase: status.phase,
              message: status.message ?? status.progress?.message,
            };
          });
        },
      });
    } catch (error) {
      setEditPreview(current => current?.previewId === previewId
        ? {
            previewId,
            phase: 'error',
            message: error instanceof Error ? error.message : 'Preview failed',
          }
        : current);
    }
  }, [activeOperationCount, clip, editPreview?.previewId, editStack, playheadPosition, stopEditPreview, stopRepairPreview]);

  const previewSourceAudio = useCallback(async () => {
    if (!clip) return;
    const previewId = 'source';
    if (editPreview?.previewId === previewId) {
      stopEditPreview();
      return;
    }

    stopRepairPreview();
    setEditPreview({
      previewId,
      phase: 'rendering',
      message: 'Rendering source preview',
    });

    try {
      await audioEditPreviewService.preview({
        clip,
        operations: [],
        mode: 'source',
        previewId,
        timelineTime: playheadPosition,
        maxDurationSeconds: 8,
        includeSpectralLayers: false,
        onStatus: status => {
          setEditPreview(current => {
            if (!current || current.previewId !== status.previewId) return current;
            if (status.phase === 'stopped') return null;
            return {
              previewId: status.previewId,
              phase: status.phase,
              message: status.message ?? status.progress?.message,
            };
          });
        },
      });
    } catch (error) {
      setEditPreview(current => current?.previewId === previewId
        ? {
            previewId,
            phase: 'error',
            message: error instanceof Error ? error.message : 'Preview failed',
          }
        : current);
    }
  }, [clip, editPreview?.previewId, playheadPosition, stopEditPreview, stopRepairPreview]);

  const previewEditOperation = useCallback(async (operation: ClipAudioEditOperation) => {
    if (!clip || operation.enabled === false) return;
    const previewId = `operation:${operation.id}`;
    if (editPreview?.previewId === previewId) {
      stopEditPreview();
      return;
    }

    stopRepairPreview();
    setEditPreview({
      previewId,
      phase: 'rendering',
      message: 'Rendering operation preview',
    });

    try {
      await audioEditPreviewService.preview({
        clip,
        operations: [operation],
        mode: 'operation',
        previewId,
        timelineTime: playheadPosition,
        maxDurationSeconds: 8,
        includeSpectralLayers: false,
        onStatus: status => {
          setEditPreview(current => {
            if (!current || current.previewId !== status.previewId) return current;
            if (status.phase === 'stopped') return null;
            return {
              previewId: status.previewId,
              phase: status.phase,
              message: status.message ?? status.progress?.message,
            };
          });
        },
      });
    } catch (error) {
      setEditPreview(current => current?.previewId === previewId
        ? {
            previewId,
            phase: 'error',
            message: error instanceof Error ? error.message : 'Preview failed',
          }
        : current);
    }
  }, [clip, editPreview?.previewId, playheadPosition, stopEditPreview, stopRepairPreview]);

  if (!clip) {
    return (
      <div className="properties-tab-content audio-edit-stack-tab">
        <div className="panel-empty"><p>Select an audio clip</p></div>
      </div>
    );
  }

  const handleBake = async () => {
    if (baking || activeOperationCount === 0) return;
    stopEditPreview();
    stopRepairPreview();
    setBaking(true);
    try {
      await bakeClipAudioEditStack(clip.id);
    } finally {
      setBaking(false);
    }
  };

  const handleUnbake = () => {
    if (baking || !canUnbake) return;
    stopEditPreview();
    stopRepairPreview();
    unbakeClipAudioEditStack(clip.id);
  };

  const handleApplyRepairSuggestion = (suggestion: AudioRepairSuggestion) => {
    if (repairPreview?.suggestionId === suggestion.id) {
      stopRepairPreview();
    }
    stopEditPreview();
    applyAudioRepairSuggestion(clip.id, suggestion);
  };

  const handleClearEditStack = () => {
    stopEditPreview();
    clearClipAudioEditStack(clip.id);
  };

  const handleToggleSelectedOperation = () => {
    if (!selectedOperation) return;
    stopEditPreview();
    setClipAudioEditOperationEnabled(clip.id, selectedOperation.id, selectedOperation.enabled === false);
  };

  const handleRemoveSelectedOperation = () => {
    if (!selectedOperation) return;
    stopEditPreview();
    removeClipAudioEditOperation(clip.id, selectedOperation.id);
  };

  const handleAnalyzeSilence = async () => {
    setSilenceCleanup({ phase: 'analyzing', ranges: [], message: 'Analyzing' });
    try {
      const ranges = await detectClipSilenceRanges(clip.id, {
        thresholdDb: silenceThresholdDb,
        minSilenceSeconds: silenceMinSeconds,
      });
      setSilenceCleanup({
        phase: 'ready',
        ranges,
        message: ranges.length ? `${ranges.length} ranges` : 'No silence found',
      });
    } catch (error) {
      setSilenceCleanup({
        phase: 'error',
        ranges: [],
        message: error instanceof Error ? error.message : 'Silence analysis failed',
      });
    }
  };

  const handleApplySilenceRemoval = async () => {
    if (silenceCleanup.ranges.length === 0) return;
    stopEditPreview();
    setSilenceCleanup(current => ({ ...current, phase: 'applying', message: 'Applying' }));
    try {
      const operationIds = await applyDetectedSilenceRemoval(clip.id, {
        ranges: silenceCleanup.ranges,
        detection: {
          thresholdDb: silenceThresholdDb,
          minSilenceSeconds: silenceMinSeconds,
        },
        rippleTimeline: silenceRippleTimeline,
      });
      setSilenceCleanup({
        phase: 'ready',
        ranges: [],
        message: operationIds.length ? `${operationIds.length} edits added` : 'No silence removed',
      });
    } catch (error) {
      setSilenceCleanup(current => ({
        ...current,
        phase: 'error',
        message: error instanceof Error ? error.message : 'Silence removal failed',
      }));
    }
  };

  const handleApplyRoomToneFill = async () => {
    if (!hasSelectedAudioRegion) {
      setSilenceCleanup(current => ({
        ...current,
        phase: 'error',
        message: 'Select an audio region first',
      }));
      return;
    }

    stopEditPreview();
    setSilenceCleanup(current => ({ ...current, phase: 'applying', message: 'Filling room tone' }));
    try {
      const operationId = await applyRoomToneFill(clip.id, {
        sourceRanges: silenceCleanup.ranges,
        detection: {
          thresholdDb: silenceThresholdDb,
          minSilenceSeconds: silenceMinSeconds,
        },
      });
      setSilenceCleanup(current => ({
        ...current,
        phase: operationId ? 'ready' : 'error',
        message: operationId ? 'Room tone edit added' : 'Room tone fill needs a selected range',
      }));
    } catch (error) {
      setSilenceCleanup(current => ({
        ...current,
        phase: 'error',
        message: error instanceof Error ? error.message : 'Room tone fill failed',
      }));
    }
  };

  const handleAnalyzeTransients = async () => {
    setTransientCleanup({ phase: 'analyzing', ranges: [], message: 'Analyzing' });
    try {
      const ranges = await detectClipTransientRanges(clip.id, {
        crestThresholdDb: transientCrestDb,
        minPeakDb: transientMinPeakDb,
      });
      setTransientCleanup({
        phase: 'ready',
        ranges,
        message: ranges.length ? `${ranges.length} transients` : 'No strong transients found',
      });
    } catch (error) {
      setTransientCleanup({
        phase: 'error',
        ranges: [],
        message: error instanceof Error ? error.message : 'Transient analysis failed',
      });
    }
  };

  const handleApplyTransientSoftening = async () => {
    if (transientCleanup.ranges.length === 0) return;
    stopEditPreview();
    setTransientCleanup(current => ({ ...current, phase: 'applying', message: 'Applying' }));
    try {
      const operationIds = await applyDetectedTransientSoftening(clip.id, {
        ranges: transientCleanup.ranges,
        detection: {
          crestThresholdDb: transientCrestDb,
          minPeakDb: transientMinPeakDb,
        },
        gainDb: transientGainDb,
      });
      setTransientCleanup({
        phase: 'ready',
        ranges: [],
        message: operationIds.length ? `${operationIds.length} edits added` : 'No transients softened',
      });
    } catch (error) {
      setTransientCleanup(current => ({
        ...current,
        phase: 'error',
        message: error instanceof Error ? error.message : 'Transient softening failed',
      }));
    }
  };

  const addSpectralLayerKeyframe = (layer: SpectralImageLayer) => {
    const keyframe = createSpectralLayerKeyframe(layer, clip, playheadPosition);
    updateClipSpectralImageLayer(clip.id, layer.id, {
      keyframes: [
        ...(layer.keyframes ?? []),
        keyframe,
      ].toSorted((a, b) => a.time - b.time),
    });
  };

  const updateSpectralLayerKeyframe = (
    layer: SpectralImageLayer,
    keyframeId: string,
    patch: Partial<SpectralImageLayerKeyframe>,
  ) => {
    updateClipSpectralImageLayer(clip.id, layer.id, {
      keyframes: replaceSpectralLayerKeyframe(layer, keyframeId, patch),
    });
  };

  const removeSpectralLayerKeyframe = (layer: SpectralImageLayer, keyframeId: string) => {
    updateClipSpectralImageLayer(clip.id, layer.id, {
      keyframes: (layer.keyframes ?? []).filter(keyframe => keyframe.id !== keyframeId),
    });
  };

  return (
    <div className="properties-tab-content audio-edit-stack-tab">
      <div className="audio-edit-stack-header">
        <div className="audio-edit-stack-title">
          <span>{activeOperationCount} active</span>
          <span>{editStack.length} total</span>
          <span>{activeSpectralLayerCount}/{spectralLayers.length} image layers</span>
        </div>
        <div className="audio-edit-stack-actions">
          <button
            className="btn btn-sm"
            onClick={previewSourceAudio}
          >
            {getPreviewButtonLabel(editPreview?.previewId === 'source', editPreview?.phase, 'Preview Source')}
          </button>
          <button
            className="btn btn-sm"
            onClick={previewEditStack}
            disabled={activeOperationCount === 0}
          >
            {getPreviewButtonLabel(editPreview?.previewId === 'stack', editPreview?.phase, 'Preview Stack')}
          </button>
          <button className="btn btn-sm" onClick={handleBake} disabled={baking || activeOperationCount === 0}>
            {baking ? 'Baking...' : 'Bake'}
          </button>
          <button className="btn btn-sm" onClick={handleUnbake} disabled={baking || !canUnbake}>
            Unbake
          </button>
          <button className="btn btn-sm" onClick={handleClearEditStack} disabled={editStack.length === 0}>
            Clear
          </button>
        </div>
      </div>
      {editPreview?.previewId === 'stack' && editPreview.message && (
        <span className={`audio-edit-preview-status phase-${editPreview.phase}`}>
          {editPreview.message}
        </span>
      )}
      {editPreview?.previewId === 'source' && editPreview.message && (
        <span className={`audio-edit-preview-status phase-${editPreview.phase}`}>
          {editPreview.message}
        </span>
      )}

      <div className="audio-repair-suggestion-section">
        <div className="audio-repair-suggestion-header">
          <div>
            <h4>Repair Suggestions</h4>
            <span>{repairSuggestions.length ? `${repairSuggestions.length} available` : 'Run loudness, frequency, and phase analysis to populate suggestions'}</span>
          </div>
        </div>
        {repairSuggestions.length > 0 ? (
          <div className="audio-repair-suggestion-list">
            {repairSuggestions.map((suggestion) => {
              const applied = isSuggestionApplied(editStack, suggestion);
              const previewing = repairPreview?.suggestionId === suggestion.id;
              return (
                <div key={suggestion.id} className={`audio-repair-suggestion-card severity-${suggestion.severity} ${previewing ? 'previewing' : ''}`}>
                  <div className="audio-repair-suggestion-main">
                    <div className="audio-repair-suggestion-title">
                      <strong>{suggestion.label}</strong>
                      <span>{suggestion.severity} | {Math.round(suggestion.confidence * 100)}%</span>
                    </div>
                    <p>{suggestion.reason}</p>
                    {formatSuggestionEvidence(suggestion) && (
                      <span className="audio-repair-suggestion-evidence">{formatSuggestionEvidence(suggestion)}</span>
                    )}
                    {previewing && repairPreview?.message && (
                      <span className={`audio-repair-suggestion-preview phase-${repairPreview.phase}`}>
                        {repairPreview.message}
                      </span>
                    )}
                  </div>
                  <div className="audio-repair-suggestion-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => previewRepairSuggestion(suggestion)}
                    >
                      {getPreviewButtonLabel(previewing, repairPreview?.phase)}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={applied}
                      onClick={() => handleApplyRepairSuggestion(suggestion)}
                    >
                      {applied ? 'Applied' : 'Apply'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="audio-repair-suggestion-empty">
            No repair suggestions from the current cached analysis.
          </div>
        )}
      </div>

      <div className="audio-silence-cleanup-section">
        <div className="audio-silence-cleanup-header">
          <div>
            <h4>Silence Cleanup</h4>
            <span>{silenceCleanup.message ?? 'Detect quiet ranges and compact the clip'}</span>
          </div>
          <div className="audio-silence-cleanup-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleAnalyzeSilence}
              disabled={silenceCleanup.phase === 'analyzing' || silenceCleanup.phase === 'applying'}
            >
              {silenceCleanup.phase === 'analyzing' ? 'Analyzing' : 'Analyze'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleApplySilenceRemoval}
              disabled={silenceCleanup.ranges.length === 0 || silenceCleanup.phase === 'applying'}
            >
              {silenceCleanup.phase === 'applying' ? 'Removing' : 'Remove'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleApplyRoomToneFill}
              disabled={!hasSelectedAudioRegion || silenceCleanup.phase === 'analyzing' || silenceCleanup.phase === 'applying'}
              title={hasSelectedAudioRegion ? 'Fill the selected audio region with room tone' : 'Select an audio region to fill'}
            >
              Fill Tone
            </button>
          </div>
        </div>
        <div className="audio-silence-cleanup-controls">
          <label>
            <span>Threshold</span>
            <input
              type="number"
              min="-100"
              max="-12"
              step="1"
              value={silenceThresholdDb}
              onChange={(event) => setSilenceThresholdDb(Number(event.currentTarget.value))}
            />
            <strong>dB</strong>
          </label>
          <label>
            <span>Min</span>
            <input
              type="number"
              min="0.05"
              max="30"
              step="0.01"
              value={silenceMinSeconds}
              onChange={(event) => setSilenceMinSeconds(Number(event.currentTarget.value))}
            />
            <strong>s</strong>
          </label>
          <label className="audio-silence-ripple-toggle">
            <input
              type="checkbox"
              checked={silenceRippleTimeline}
              onChange={(event) => setSilenceRippleTimeline(event.currentTarget.checked)}
            />
            <span>Ripple later clips</span>
          </label>
        </div>
        {silenceCleanup.ranges.length > 0 && (
          <div className="audio-silence-range-list">
            {silenceCleanup.ranges.slice(0, 5).map((range) => (
              <div key={`${range.start}-${range.end}`} className="audio-silence-range-row">
                <span>{formatSeconds(range.start)} - {formatSeconds(range.end)}</span>
                <strong>{range.duration.toFixed(2)}s | {range.rmsDb.toFixed(1)} dB</strong>
              </div>
            ))}
            {silenceCleanup.ranges.length > 5 && (
              <div className="audio-silence-range-more">+{silenceCleanup.ranges.length - 5} more</div>
            )}
          </div>
        )}
      </div>

      <div className="audio-silence-cleanup-section audio-transient-cleanup-section">
        <div className="audio-silence-cleanup-header">
          <div>
            <h4>Transient Cleanup</h4>
            <span>{transientCleanup.message ?? 'Detect sharp peaks and soften them non-destructively'}</span>
          </div>
          <div className="audio-silence-cleanup-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleAnalyzeTransients}
              disabled={transientCleanup.phase === 'analyzing' || transientCleanup.phase === 'applying'}
            >
              {transientCleanup.phase === 'analyzing' ? 'Analyzing' : 'Analyze'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleApplyTransientSoftening}
              disabled={transientCleanup.ranges.length === 0 || transientCleanup.phase === 'applying'}
            >
              {transientCleanup.phase === 'applying' ? 'Softening' : 'Soften'}
            </button>
          </div>
        </div>
        <div className="audio-silence-cleanup-controls">
          <label>
            <span>Crest</span>
            <input
              type="number"
              min="6"
              max="60"
              step="1"
              value={transientCrestDb}
              onChange={(event) => setTransientCrestDb(Number(event.currentTarget.value))}
            />
            <strong>dB</strong>
          </label>
          <label>
            <span>Peak</span>
            <input
              type="number"
              min="-60"
              max="0"
              step="1"
              value={transientMinPeakDb}
              onChange={(event) => setTransientMinPeakDb(Number(event.currentTarget.value))}
            />
            <strong>dB</strong>
          </label>
          <label>
            <span>Gain</span>
            <input
              type="number"
              min="-36"
              max="0"
              step="0.5"
              value={transientGainDb}
              onChange={(event) => setTransientGainDb(Number(event.currentTarget.value))}
            />
            <strong>dB</strong>
          </label>
        </div>
        {transientCleanup.ranges.length > 0 && (
          <div className="audio-silence-range-list">
            {transientCleanup.ranges.slice(0, 5).map((range) => (
              <div key={`${range.start}-${range.end}`} className="audio-silence-range-row">
                <span>{formatSeconds(range.start)} - {formatSeconds(range.end)}</span>
                <strong>{range.crestDb.toFixed(1)} dB crest | {range.peakDb.toFixed(1)} dB peak</strong>
              </div>
            ))}
            {transientCleanup.ranges.length > 5 && (
              <div className="audio-silence-range-more">+{transientCleanup.ranges.length - 5} more</div>
            )}
          </div>
        )}
      </div>

      {editStack.length === 0 ? (
        <div className="panel-empty"><p>No audio edits applied</p></div>
      ) : (
        <div className="audio-edit-stack-layout">
          <div className="audio-edit-operation-list">
            {editStack.map((operation, index) => {
              const enabled = operation.enabled !== false;
              const selected = selectedOperation?.id === operation.id;
              return (
                <button
                  type="button"
                  key={operation.id}
                  className={`audio-edit-operation-row ${selected ? 'selected' : ''} ${enabled ? '' : 'bypassed'}`}
                  onClick={() => setSelectedOperationId(operation.id)}
                >
                  <span className="audio-edit-operation-index">{index + 1}</span>
                  <span className="audio-edit-operation-main">
                    <span className="audio-edit-operation-name">{getOperationLabel(operation)}</span>
                    <span className="audio-edit-operation-range">{getOperationRange(operation)}</span>
                  </span>
                  <span className="audio-edit-operation-state">{enabled ? 'On' : 'Off'}</span>
                </button>
              );
            })}
          </div>

          {selectedOperation && (
            <div className="audio-edit-operation-detail">
              <div className="audio-edit-detail-header">
                <div>
                  <h4>{getOperationLabel(selectedOperation)}</h4>
                  <span>{selectedOperation.type}</span>
                </div>
                <div className="audio-edit-detail-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => previewEditOperation(selectedOperation)}
                    disabled={selectedOperation.enabled === false}
                  >
                    {getPreviewButtonLabel(
                      editPreview?.previewId === `operation:${selectedOperation.id}`,
                      editPreview?.phase,
                    )}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={handleToggleSelectedOperation}
                  >
                    {selectedOperation.enabled === false ? 'Enable' : 'Bypass'}
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={handleRemoveSelectedOperation}>
                    Remove
                  </button>
                </div>
              </div>
              {editPreview?.previewId === `operation:${selectedOperation.id}` && editPreview.message && (
                <span className={`audio-edit-preview-status phase-${editPreview.phase}`}>
                  {editPreview.message}
                </span>
              )}

              <div className="audio-edit-detail-grid">
                <span>Source</span>
                <strong>{getOperationRange(selectedOperation)}</strong>
                <span>Timeline</span>
                <strong>{getTimelineRange(selectedOperation)}</strong>
                <span>Channels</span>
                <strong>{selectedOperation.channelMask?.length ? selectedOperation.channelMask.join(', ') : 'All'}</strong>
                <span>Created</span>
                <strong>{new Date(selectedOperation.createdAt).toLocaleString()}</strong>
              </div>

              <div className="audio-edit-param-list">
                {Object.entries(selectedOperation.params ?? {}).map(([key, value]) => (
                  <div key={key} className="audio-edit-param-row">
                    <span>{key}</span>
                    <strong>{formatValue(value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {spectralLayers.length > 0 && (
        <div className="audio-spectral-layer-section">
          <div className="audio-spectral-layer-section-header">
            <h4>Image-In-Spectrum Layers</h4>
            <span>{activeSpectralLayerCount} active</span>
          </div>
          <div className="audio-spectral-layer-list">
            {spectralLayers.map((layer) => {
              const imageFile = imageFilesById.get(layer.imageMediaFileId);
              return (
                <div key={layer.id} className={`audio-spectral-layer-card ${layer.enabled === false ? 'bypassed' : ''}`}>
                  <div className="audio-spectral-layer-preview">
                    {imageFile?.thumbnailUrl || imageFile?.url ? (
                      <img src={imageFile.thumbnailUrl || imageFile.url} alt="" />
                    ) : (
                      <span>IMG</span>
                    )}
                  </div>
                  <div className="audio-spectral-layer-main">
                    <div className="audio-spectral-layer-title">
                      <strong>{imageFile?.name ?? layer.imageMediaFileId}</strong>
                      <span>{formatSeconds(layer.timeStart)} + {formatSeconds(layer.duration)}</span>
                    </div>
                    <div className="audio-spectral-layer-meta">
                      {formatFrequency(layer.frequencyMin)} - {formatFrequency(layer.frequencyMax)}
                      {layer.keyframes?.length ? ` | ${layer.keyframes.length} keyframes` : ''}
                    </div>
                    <div className="audio-spectral-layer-controls">
                      <label>
                        <span>Mode</span>
                        <select
                          value={layer.blendMode}
                          onChange={(event) => updateClipSpectralImageLayer(clip.id, layer.id, {
                            blendMode: event.currentTarget.value as SpectralImageLayer['blendMode'],
                          })}
                        >
                          {SPECTRAL_LAYER_BLEND_MODES.map(mode => (
                            <option key={mode} value={mode}>{mode}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Opacity</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={layer.opacity}
                          onChange={(event) => updateClipSpectralImageLayer(clip.id, layer.id, { opacity: Number(event.currentTarget.value) })}
                        />
                      </label>
                      <label>
                        <span>Gain</span>
                        <input
                          type="number"
                          min="-60"
                          max="24"
                          step="0.5"
                          value={layer.gainDb}
                          onChange={(event) => updateClipSpectralImageLayer(clip.id, layer.id, { gainDb: Number(event.currentTarget.value) })}
                        />
                      </label>
                    </div>
                    <div className="audio-spectral-layer-keyframes">
                      <div className="audio-spectral-layer-keyframe-header">
                        <span>Layer Keyframes</span>
                        <button className="btn btn-sm" onClick={() => addSpectralLayerKeyframe(layer)}>
                          Add at Playhead
                        </button>
                      </div>
                      {layer.keyframes?.length ? (
                        <div className="audio-spectral-layer-keyframe-list">
                          {layer.keyframes.map(keyframe => (
                            <div key={keyframe.id} className="audio-spectral-layer-keyframe-row">
                              <label>
                                <span>Time</span>
                                <input
                                  type="number"
                                  min="0"
                                  max={layer.duration}
                                  step="0.01"
                                  value={keyframe.time}
                                  onChange={(event) => updateSpectralLayerKeyframe(layer, keyframe.id, {
                                    time: Number(event.currentTarget.value),
                                  })}
                                />
                              </label>
                              <label>
                                <span>Opacity</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="1"
                                  step="0.01"
                                  value={keyframe.opacity ?? layer.opacity}
                                  onChange={(event) => updateSpectralLayerKeyframe(layer, keyframe.id, {
                                    opacity: Number(event.currentTarget.value),
                                  })}
                                />
                              </label>
                              <label>
                                <span>Gain</span>
                                <input
                                  type="number"
                                  min="-60"
                                  max="24"
                                  step="0.5"
                                  value={keyframe.gainDb ?? layer.gainDb}
                                  onChange={(event) => updateSpectralLayerKeyframe(layer, keyframe.id, {
                                    gainDb: Number(event.currentTarget.value),
                                  })}
                                />
                              </label>
                              <label>
                                <span>Min Hz</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="10"
                                  value={keyframe.frequencyMin ?? layer.frequencyMin}
                                  onChange={(event) => updateSpectralLayerKeyframe(layer, keyframe.id, {
                                    frequencyMin: Number(event.currentTarget.value),
                                  })}
                                />
                              </label>
                              <label>
                                <span>Max Hz</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="10"
                                  value={keyframe.frequencyMax ?? layer.frequencyMax}
                                  onChange={(event) => updateSpectralLayerKeyframe(layer, keyframe.id, {
                                    frequencyMax: Number(event.currentTarget.value),
                                  })}
                                />
                              </label>
                              <button className="btn btn-sm btn-danger" onClick={() => removeSpectralLayerKeyframe(layer, keyframe.id)}>
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="audio-spectral-layer-keyframe-empty">No layer automation</span>
                      )}
                    </div>
                  </div>
                  <div className="audio-spectral-layer-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => updateClipSpectralImageLayer(clip.id, layer.id, { enabled: layer.enabled === false })}
                    >
                      {layer.enabled === false ? 'Enable' : 'Bypass'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => removeClipSpectralImageLayer(clip.id, layer.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bakeHistory.length > 0 && (
        <div className="audio-edit-bake-history">
          <h4>Bakes</h4>
          {bakeHistory.slice().reverse().map((entry) => (
            <div key={entry.id} className="audio-edit-bake-row">
              <span>{new Date(entry.createdAt).toLocaleString()}</span>
              <strong>{entry.operationIds.length} ops</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
