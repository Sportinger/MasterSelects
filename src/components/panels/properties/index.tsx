// Properties Panel - Main container with lazy-loaded tabs
import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore, Suspense, lazy } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { selectIsSlotGridPanelActive, useSlotGridPanelStore } from '../../../stores/slotGridPanelStore';
import { useEngineStore } from '../../../stores/engineStore';
import { DEFAULT_TEXT_3D_PROPERTIES } from '../../../stores/timeline/constants';
import { isAudioEffect } from '../../../types';
import type { TranscriptStatus } from '../../../types/clipMetadata';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import {
  AudioTrackControlsTab,
  AudioTrackEffectsTab,
  AudioTrackSendsTab,
  MasterAudioControlsTab,
  MasterAudioEffectsTab,
} from './AudioBusPropertiesTabs';
import { MidiInstrumentTab } from './MidiInstrumentTab';
import { DEFAULT_MASTER_AUDIO_STATE } from './audioBusDefaults';
import { PropertiesTabStrip } from './PropertiesTabStrip';
import { PropertiesClipTabStrip } from './PropertiesClipTabStrip';
import {
  PropertiesClipTabContent,
  PropertiesReconnectLiveInput,
  PropertiesTabLoading,
} from './PropertiesClipTabContent';
import type { PropertiesTab } from './propertiesPanelTypes';
import { useTrackingEditorStore } from '../../../stores/trackingEditorStore';
import { liveInputRuntime } from '../../../services/mediaRuntime/liveInputRuntime';
import { resolveClipTranscriptWords } from '../../../services/transcription/clipTranscriptResolver';
import { getClipMediaFileId } from '../../../services/mediaArtifacts/mediaSourceArtifacts';
import { resolveEditableHookLayerMetadata } from '../../../services/aiTools/editableHookIdentity';
import { trackEditorSurfaceViewed } from '../../../services/productAnalytics';
import './PropertiesPanel.css';
import './EffectsTab.css';
import './AnalysisTranscriptTabs.css';
import './TextTab.css';
import './HookTab.css';
import './VolumeBlendshapeTabs.css';
import './resolveInspector/ResolveInspector.css';
import './resolveInspector/ResolveInspectorNarrow.css';
import './resolveInspector/ResolveInspectorTabs.css';

// Lazy load tab components for code splitting
const SlotClipTab = lazy(() => import('./SlotClipTab').then(m => ({ default: m.SlotClipTab })));
const TransitionTab = lazy(() => import('./TransitionTab').then(m => ({ default: m.TransitionTab })));
const TrackingAssetTab = lazy(() => import('./surfaceTracking/SurfaceTrackingTab').then(m => ({default:m.SurfaceTrackingTab})));

function getSelectionKey(
  selection: ReturnType<typeof useTimelineStore.getState>['propertiesSelection'],
  fallbackClipId: string | null,
): string | null {
  if (selection?.kind === 'clip') return `clip:${selection.clipId}`;
  if (selection?.kind === 'transition') return `transition:${selection.clipId}:${selection.edge}:${selection.transitionId}`;
  if (selection?.kind === 'track') return `track:${selection.trackId}`;
  if (selection?.kind === 'master') return 'master';
  return fallbackClipId ? `clip:${fallbackClipId}` : null;
}

export function PropertiesPanel() {
  const openedTrackingAssetId = useTrackingEditorStore(s => s.openedAssetId);
  // Reactive data - subscribe to specific values only
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore(state => state.primarySelectedClipId);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes);
  const slotGridActive = useSlotGridPanelStore(selectIsSlotGridPanelActive);
  const masterAudioState = useTimelineStore(state => state.masterAudioState);
  const effectOrbitTarget = useEngineStore(state => state.effectOrbitTarget);
  const sceneNavClipId = useEngineStore(state => state.sceneNavClipId);
  const setEffectOrbitTarget = useEngineStore(state => state.setEffectOrbitTarget);
  const setSceneNavClipId = useEngineStore(state => state.setSceneNavClipId);
  const compositions = useMediaStore(state => state.compositions);
  const slotAssignments = useMediaStore(state => state.slotAssignments);
  const selectedSlotCompositionId = useMediaStore(state => state.selectedSlotCompositionId);
  const selectSlotComposition = useMediaStore(state => state.selectSlotComposition) as (compositionId: string | null) => void;
  const ensureSlotClipSettings = useMediaStore(state => state.ensureSlotClipSettings) as (compositionId: string, duration: number) => void;
  // Actions from getState() - stable, no subscription needed
  const { getInterpolatedTransform, getInterpolatedCameraSettings, getInterpolatedSpeed } = useTimelineStore.getState();
  const [activeTab, setActiveTab] = useState<PropertiesTab>('transform');
  const [lastSelectionKey, setLastSelectionKey] = useState<string | null>(null);
  const pendingTabRef = useRef<PropertiesTab | null>(null);

  useEffect(() => {
    trackEditorSurfaceViewed(activeTab);
  }, [activeTab]);

  // Use the primary (clicked) clip for properties, fall back to first selected
  const fallbackSelectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
  const selectedClipId = propertiesSelection?.kind === 'clip'
    ? propertiesSelection.clipId
    : propertiesSelection ? null : fallbackSelectedClipId;
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const selectedMediaArtifacts = useMediaStore(state => {
    const mediaFileId = selectedClip ? getClipMediaFileId(selectedClip) : undefined;
    return mediaFileId ? state.files.find(file => file.id === mediaFileId) : undefined;
  });
  useSyncExternalStore(
    (listener) => liveInputRuntime.subscribe(listener),
    () => liveInputRuntime.getRevision(),
    () => 0,
  );
  const reconnectRequiredCount = liveInputRuntime.getReconnectRequiredIds().length;
  const selectedPropertiesTrack = propertiesSelection?.kind === 'track'
    ? tracks.find(track => track.id === propertiesSelection.trackId) ?? null
    : null;
  const selectedTransitionSelection = propertiesSelection?.kind === 'transition'
    ? propertiesSelection
    : null;
  const selectedTransitionClip = selectedTransitionSelection
    ? clips.find(c => c.id === selectedTransitionSelection.clipId) ?? null
    : null;
  const isMasterPropertiesSelected = propertiesSelection?.kind === 'master';
  const masterAudio = masterAudioState ?? DEFAULT_MASTER_AUDIO_STATE;
  const selectionKey = getSelectionKey(propertiesSelection, fallbackSelectedClipId);
  const selectedSlotComposition = selectedSlotCompositionId
    ? compositions.find(c => c.id === selectedSlotCompositionId) ?? null
    : null;
  const selectedSlotIndex = selectedSlotComposition ? slotAssignments[selectedSlotComposition.id] : undefined;
  const isSlotMode = slotGridActive && !!selectedSlotComposition && selectedSlotIndex !== undefined;

  // Check if it's an audio clip
  const selectedTrack = selectedClip ? tracks.find(t => t.id === selectedClip.trackId) : null;
  const isAudioClip = selectedTrack?.type === 'audio';
  const isStoryboardClip =
    selectedClip?.source?.type === 'storyboard' &&
    Boolean(selectedClip.storyboardProperties);
  const selectedClipAudioEditCount = selectedClip?.audioState?.editStack?.length ?? 0;

  // Check if it's a text clip
  const isCaptionClip = Boolean(
    selectedClip?.captionProperties,
  );
  const isTextClip = selectedClip?.source?.type === 'text' && !isCaptionClip;
  const selectedHookId = useMemo(() => {
    if (!selectedClip) return null;
    return resolveEditableHookLayerMetadata(clips, tracks).get(selectedClip.id)?.id ?? null;
  }, [clips, selectedClip, tracks]);
  const isEditableHookClip = selectedHookId !== null;

  // Check if it's a solid clip
  const isSolidClip = selectedClip?.source?.type === 'solid';
  const isMathSceneClip = selectedClip?.source?.type === 'math-scene';
  const isFlockClip = selectedClip?.source?.type === 'flock';
  const isMotionShapeClip = selectedClip?.source?.type === 'motion-shape';
  const isMotionAdjustmentClip = selectedClip?.source?.type === 'motion-adjustment';
  const isVectorAnimationClip = isVectorAnimationSourceType(selectedClip?.source?.type);
  const vectorAnimationTabLabel = selectedClip?.source?.type === 'rive' ? 'Rive' : 'Lottie';
  const selectedMeshType = selectedClip?.meshType ?? selectedClip?.source?.meshType;
  const isModelClip = selectedClip?.source?.type === 'model' && !selectedMeshType;
  const is3DTextClip = selectedClip?.source?.type === 'model' && selectedMeshType === 'text3d';
  const selectedText3DProperties = is3DTextClip
    ? (selectedClip?.text3DProperties ?? selectedClip?.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES)
    : undefined;

  // Check if it's a gaussian avatar clip
  const isGaussianAvatar = selectedClip?.source?.type === 'gaussian-avatar';
  const isGaussianSplat = selectedClip?.source?.type === 'gaussian-splat';
  const isCameraClip = selectedClip?.source?.type === 'camera';
  const isLightClip = selectedClip?.source?.type === 'light';
  const isSplatEffectorClip = selectedClip?.source?.type === 'splat-effector';
  const isLiveInputClip = Boolean(selectedClip?.source?.liveInputId);
  useEffect(() => {
    if (selectedSlotCompositionId && !selectedSlotComposition) {
      selectSlotComposition(null);
    }
  }, [selectedSlotComposition, selectedSlotCompositionId, selectSlotComposition]);

  useEffect(() => {
    if (!selectedSlotComposition || selectedSlotIndex === undefined) {
      return;
    }

    ensureSlotClipSettings(selectedSlotComposition.id, selectedSlotComposition.duration);
  }, [ensureSlotClipSettings, selectedSlotComposition, selectedSlotIndex]);

  useEffect(() => {
    const nextSceneNavClipId = selectedClip?.source?.type === 'camera'
      ? selectedClip.id
      : null;
    if (sceneNavClipId !== nextSceneNavClipId) {
      setSceneNavClipId(nextSceneNavClipId);
    }
  }, [sceneNavClipId, selectedClip?.id, selectedClip?.source?.type, setSceneNavClipId]);

  useEffect(() => {
    if (!effectOrbitTarget) return;

    const targetEffect = selectedClip?.id === effectOrbitTarget.clipId
      ? selectedClip.effects.find(effect => effect.id === effectOrbitTarget.effectId)
      : undefined;
    if (
      selectedClipId !== effectOrbitTarget.clipId
      || !selectedClip
      || !targetEffect
      || targetEffect.enabled === false
      || selectedClip.is3D
    ) {
      setEffectOrbitTarget(null);
    }
  }, [effectOrbitTarget, selectedClip, selectedClipId, setEffectOrbitTarget]);

  useEffect(() => {
    if (isSlotMode && activeTab !== 'slot-clip') {
      setActiveTab('slot-clip');
    }
  }, [activeTab, isSlotMode]);

  useEffect(() => {
    if (isCameraClip && activeTab === 'camera') {
      setActiveTab('transform');
    }
  }, [activeTab, isCameraClip]);

  useEffect(() => {
    if (isCaptionClip && activeTab === 'text') {
      setActiveTab('captions');
    }
  }, [activeTab, isCaptionClip]);

  useEffect(() => {
    if (reconnectRequiredCount > 0 && !selectionKey) setActiveTab('live');
  }, [reconnectRequiredCount, selectionKey]);

  // Reset tab when switching between clip, track, and master targets.
  useEffect(() => {
    if (isSlotMode) {
      return;
    }

    if (selectionKey && selectionKey !== lastSelectionKey) {
      setLastSelectionKey(selectionKey);

      // If a pending tab was requested (e.g. from badge click), apply it
      if (pendingTabRef.current) {
        setActiveTab(pendingTabRef.current);
        pendingTabRef.current = null;
        return;
      }

      if (selectedTransitionSelection) {
        setActiveTab('transition');
        return;
      }

      if (selectedPropertiesTrack) {
        // MIDI tracks open on Instrument; audio tracks on Effects.
        if (selectedPropertiesTrack.type === 'midi') {
          setActiveTab('track-instrument');
        } else {
          setActiveTab(selectedPropertiesTrack.type === 'audio' ? 'track-effects' : 'track-controls');
        }
        return;
      }

      if (isMasterPropertiesSelected) {
        setActiveTab('master-effects');
        return;
      }

      // Set appropriate default tab based on clip type
      if (isStoryboardClip) {
        setActiveTab('storyboard');
      } else if (isLiveInputClip && activeTab === 'live') {
        setActiveTab('transform');
      } else if (isGaussianAvatar) {
        setActiveTab('blendshapes');
      } else if (isVectorAnimationClip) {
        setActiveTab('lottie');
      } else if (isFlockClip) {
        setActiveTab('flock');
      } else if (isCameraClip) {
        setActiveTab('transform');
      } else if (isLightClip) {
        setActiveTab('transform');
      } else if (isSplatEffectorClip) {
        setActiveTab('transform');
      } else if (isGaussianSplat) {
        setActiveTab('transform');
      } else if (isMotionAdjustmentClip) {
        setActiveTab('adjustment');
      } else if (isEditableHookClip) {
        setActiveTab('hook');
      } else if (isMotionShapeClip) {
        setActiveTab('motion');
      } else if (isMathSceneClip) {
        setActiveTab('math');
      } else if (isSolidClip) {
        setActiveTab('transform');
      } else if (is3DTextClip) {
        setActiveTab('3d-text');
      } else if (isCaptionClip) {
        setActiveTab('captions');
      } else if (isTextClip) {
        setActiveTab('text');
      } else if (isAudioClip && (activeTab === 'transform' || activeTab === 'color' || activeTab === 'masks' || activeTab === 'tracking' || activeTab === 'hook' || activeTab === 'text' || activeTab === 'captions' || activeTab === '3d-text' || activeTab === 'blendshapes')) {
        setActiveTab(selectedClipAudioEditCount > 0 ? 'audio-edits' : 'effects');
      } else if (
        !isAudioClip &&
        !isStoryboardClip &&
        !isCaptionClip &&
        !isTextClip &&
        !is3DTextClip &&
        (
          activeTab === 'hook' ||
          activeTab === 'text' ||
          activeTab === 'captions' ||
          activeTab === '3d-text' ||
          (!isMathSceneClip && activeTab === 'math') ||
          (!isFlockClip && activeTab === 'flock') ||
          (!isMotionShapeClip && activeTab === 'motion') ||
          (!isModelClip && activeTab === 'model-3d') ||
          (!isGaussianAvatar && activeTab === 'blendshapes') ||
          (!isGaussianSplat && activeTab === 'gaussian-splat') ||
          (!isCameraClip && activeTab === 'camera') ||
          (!isLightClip && activeTab === 'light') ||
          (!isSplatEffectorClip && activeTab === 'splat-effector') ||
          (!isVectorAnimationClip && activeTab === 'lottie') ||
          activeTab === 'live'
        )
      ) {
        setActiveTab('transform');
      }
    }
  }, [selectionKey, selectedTransitionSelection, selectedPropertiesTrack, isMasterPropertiesSelected, isAudioClip, isStoryboardClip, selectedClipAudioEditCount, isCaptionClip, isTextClip, isEditableHookClip, is3DTextClip, isModelClip, isMathSceneClip, isFlockClip, isMotionShapeClip, isMotionAdjustmentClip, isSolidClip, isVectorAnimationClip, isGaussianAvatar, isGaussianSplat, isCameraClip, isLightClip, isSplatEffectorClip, isLiveInputClip, isSlotMode, lastSelectionKey, activeTab]);

  // Listen for external tab navigation requests (e.g. badge clicks in MediaPanel)
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab as PropertiesTab;
      if (!tab) return;
      const requestedTab = tab === 'camera' || tab === 'live'
        ? 'transform'
        : tab === 'transcript'
          ? 'analysis'
          : tab;
      // Store as pending so clip-switch effect doesn't override it
      pendingTabRef.current = requestedTab;
      setActiveTab(requestedTab);
    };
    window.addEventListener('openPropertiesTab', handler);
    return () => window.removeEventListener('openPropertiesTab', handler);
  }, []);

  const handleSolidColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedClipId) return;
    useTimelineStore.getState().updateSolidColor(selectedClipId, e.target.value);
  }, [selectedClipId]);

  if (openedTrackingAssetId) return <div className="properties-panel">
    <div className="panel-header"><h3>Tracking</h3><button onPointerUp={e=>e.currentTarget.blur()} onClick={()=>useTrackingEditorStore.getState().setEditor({openedAssetId:null})}>Back to clip</button></div>
    <div className="properties-content"><Suspense fallback={<PropertiesTabLoading/>}><TrackingAssetTab assetId={openedTrackingAssetId}/></Suspense></div>
  </div>;

  if (slotGridActive && !selectedSlotComposition) {
    return (
      <div className="properties-panel">
        <div className="panel-header"><h3>Properties</h3></div>
        <div className="panel-empty"><p>Select a slot to edit slot clip settings</p></div>
      </div>
    );
  }

  if (isSlotMode && selectedSlotComposition && selectedSlotIndex !== undefined) {
    return (
      <div className="properties-panel">
        <PropertiesTabStrip>
          <button className="tab-btn active" onClick={() => setActiveTab('slot-clip')}>
            Slot Clip
          </button>
        </PropertiesTabStrip>

        <div className="properties-content">
          <Suspense fallback={<PropertiesTabLoading />}>
            <SlotClipTab
              composition={selectedSlotComposition}
              slotIndex={selectedSlotIndex}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  if (selectedTransitionSelection) {
    return (
      <div className="properties-panel">
        <PropertiesTabStrip>
          <button className="tab-btn active" onClick={() => setActiveTab('transition')}>
            TRANSITION Parameters
          </button>
        </PropertiesTabStrip>

        <div className="properties-content">
          <Suspense fallback={<PropertiesTabLoading />}>
            {selectedTransitionClip ? (
              <TransitionTab
                clip={selectedTransitionClip}
                edge={selectedTransitionSelection.edge}
                transitionId={selectedTransitionSelection.transitionId}
              />
            ) : (
              <div className="panel-empty"><p>Select an active transition to edit its parameters.</p></div>
            )}
          </Suspense>
        </div>
      </div>
    );
  }

  if (selectedPropertiesTrack) {
    const trackEffectCount = selectedPropertiesTrack.audioState?.effectStack?.length ?? 0;
    const trackSendCount = selectedPropertiesTrack.audioState?.sends?.length ?? 0;
    const isAudioTrack = selectedPropertiesTrack.type === 'audio';
    const isMidiTrack = selectedPropertiesTrack.type === 'midi';
    // Audio + MIDI tracks share the full bus controls (volume/pan/mute/solo/meter,
    // EQ, the effect stack and sends); MIDI tracks additionally expose Instrument.
    const hasBusControls = isAudioTrack || isMidiTrack;

    return (
      <div className="properties-panel">
        <PropertiesTabStrip>
          {hasBusControls && (
            <button
              className={`tab-btn ${activeTab === 'track-controls' ? 'active' : ''}`}
              onClick={() => setActiveTab('track-controls')}
            >
              Controls
            </button>
          )}
          {isMidiTrack && (
            <button
              className={`tab-btn ${activeTab === 'track-instrument' ? 'active' : ''}`}
              onClick={() => setActiveTab('track-instrument')}
            >
              Instrument
            </button>
          )}
          {hasBusControls && (
            <>
              <button
                className={`tab-btn ${activeTab === 'track-effects' ? 'active' : ''}`}
                onClick={() => setActiveTab('track-effects')}
              >
                Effects {trackEffectCount > 0 && <span className="badge">{trackEffectCount}</span>}
              </button>
              <button
                className={`tab-btn ${activeTab === 'track-sends' ? 'active' : ''}`}
                onClick={() => setActiveTab('track-sends')}
              >
                Sends {trackSendCount > 0 && <span className="badge">{trackSendCount}</span>}
              </button>
            </>
          )}
        </PropertiesTabStrip>

        <div className="properties-content">
          {hasBusControls ? (
            <>
              {activeTab === 'track-controls' && <AudioTrackControlsTab track={selectedPropertiesTrack} />}
              {isMidiTrack && activeTab === 'track-instrument' && <MidiInstrumentTab track={selectedPropertiesTrack} />}
              {hasBusControls && activeTab === 'track-effects' && <AudioTrackEffectsTab track={selectedPropertiesTrack} />}
              {hasBusControls && activeTab === 'track-sends' && <AudioTrackSendsTab track={selectedPropertiesTrack} />}
            </>
          ) : (
            <div className="panel-empty"><p>Track properties are available for audio and MIDI tracks.</p></div>
          )}
        </div>
      </div>
    );
  }

  if (isMasterPropertiesSelected) {
    const masterEffectCount = masterAudio.effectStack?.length ?? 0;

    return (
      <div className="properties-panel">
        <PropertiesTabStrip>
          <button
            className={`tab-btn ${activeTab === 'master-controls' ? 'active' : ''}`}
            onClick={() => setActiveTab('master-controls')}
          >
            Controls
          </button>
          <button
            className={`tab-btn ${activeTab === 'master-effects' ? 'active' : ''}`}
            onClick={() => setActiveTab('master-effects')}
          >
            Effects {masterEffectCount > 0 && <span className="badge">{masterEffectCount}</span>}
          </button>
        </PropertiesTabStrip>

        <div className="properties-content">
          {activeTab === 'master-controls' && <MasterAudioControlsTab masterAudio={masterAudio} />}
          {activeTab === 'master-effects' && <MasterAudioEffectsTab masterAudio={masterAudio} />}
        </div>
      </div>
    );
  }

  if (!selectedClip) {
    if (reconnectRequiredCount > 0) {
      return <PropertiesReconnectLiveInput reconnectRequiredCount={reconnectRequiredCount} />;
    }
    return (
      <div className="properties-panel">
        <div className="panel-header"><h3>Properties</h3></div>
        <div className="panel-empty"><p>Select a clip to edit properties</p></div>
      </div>
    );
  }

  const clipLocalTime = playheadPosition - selectedClip.startTime;
  // clipKeyframes subscription triggers re-render when keyframes change,
  // ensuring getInterpolatedTransform returns fresh values
  const hasKeyframes = clipKeyframes.has(selectedClip.id);
  const transform = getInterpolatedTransform(selectedClip.id, clipLocalTime);
  const cameraSettings = isCameraClip
    ? getInterpolatedCameraSettings(selectedClip.id, clipLocalTime)
    : undefined;
  const interpolatedSpeed = getInterpolatedSpeed(selectedClip.id, clipLocalTime);

  // Count non-audio effects for badge
  const visualEffects = (selectedClip.effects || []).filter(e => !isAudioEffect(e.type));
  const audioEditCount = selectedClipAudioEditCount;
  const linkedTranscriptClip = selectedClip.linkedClipId
    ? clips.find(c => c.id === selectedClip.linkedClipId)
    : clips.find(c => c.linkedClipId === selectedClip.id);
  const selectedClipHasTranscriptState = (selectedClip.transcript?.length ?? 0) > 0
    || (selectedClip.transcriptStatus !== undefined && selectedClip.transcriptStatus !== 'none');
  const transcriptSourceClip = selectedClipHasTranscriptState
    ? selectedClip
    : linkedTranscriptClip;
  // Transcripts anchor to the media file; the clip-level copy can be missing
  // after moves, undo/redo, or re-adds, so fall back to the media store words.
  const transcriptWords = transcriptSourceClip?.transcript?.length
    ? transcriptSourceClip.transcript
    : resolveClipTranscriptWords(selectedClip) ?? [];
  const clipLevelTranscriptStatus = transcriptSourceClip?.transcriptStatus;
  const transcriptStatus: TranscriptStatus = clipLevelTranscriptStatus && clipLevelTranscriptStatus !== 'none'
    ? clipLevelTranscriptStatus
    : transcriptWords.length > 0 ? 'ready' : 'none';
  const transcriptProgress = transcriptSourceClip?.transcriptProgress || 0;
  const sourceAnalysis = selectedClip.analysis ?? selectedMediaArtifacts?.analysis;
  const sourceAnalysisStatus = selectedClip.analysisStatus && selectedClip.analysisStatus !== 'none'
    ? selectedClip.analysisStatus
    : selectedMediaArtifacts?.analysisStatus ?? 'none';
  const sourceAnalysisProgress = selectedClip.analysisProgress
    ?? selectedMediaArtifacts?.analysisProgress
    ?? 0;
  const sourceSceneDescriptions = selectedClip.sceneDescriptions?.length
    ? selectedClip.sceneDescriptions
    : selectedMediaArtifacts?.sceneDescriptions;
  const sourceSceneDescriptionStatus = selectedClip.sceneDescriptionStatus
    && selectedClip.sceneDescriptionStatus !== 'none'
    ? selectedClip.sceneDescriptionStatus
    : selectedMediaArtifacts?.sceneDescriptionStatus;
  const sourceSceneDescriptionProgress = selectedClip.sceneDescriptionProgress
    ?? selectedMediaArtifacts?.sceneDescriptionProgress;
  const sourceSceneDescriptionMessage = selectedClip.sceneDescriptionMessage
    ?? selectedMediaArtifacts?.sceneDescriptionMessage;

  const clipPresentation = {
    isStoryboardClip,
    isAudioClip,
    isCameraClip,
    isMathSceneClip,
    isFlockClip,
    isMotionAdjustmentClip,
    isMotionShapeClip,
    isEditableHookClip,
    isCaptionClip,
    isTextClip,
    is3DTextClip,
    isLiveInputClip,
    isVectorAnimationClip,
    vectorAnimationTabLabel,
    isModelClip,
    isGaussianAvatar,
    isGaussianSplat,
    isLightClip,
    isSplatEffectorClip,
    isSolidClip,
  };
  const clipAnalysis = {
    analysis: sourceAnalysis,
    analysisStatus: sourceAnalysisStatus,
    analysisProgress: sourceAnalysisProgress,
    sceneDescriptions: sourceSceneDescriptions,
    sceneDescriptionStatus: sourceSceneDescriptionStatus,
    sceneDescriptionProgress: sourceSceneDescriptionProgress,
    sceneDescriptionMessage: sourceSceneDescriptionMessage,
    transcriptStatus,
    transcriptProgress,
    transcript: transcriptWords,
  };

  return (
    <div className="properties-panel">
      {/* Solid color picker — always visible at top when a solid clip is selected */}
      {isSolidClip && (
        <div className="solid-color-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px' }}>
            <input
              type="color"
              value={selectedClip.solidColor || '#ffffff'}
              onChange={handleSolidColorChange}
              style={{ width: '28px', height: '22px', padding: '0', border: '1px solid #3a3a3a', borderRadius: '3px', cursor: 'pointer', background: 'transparent' }}
            />
            <span style={{ fontSize: '11px', color: '#aaa', fontFamily: 'monospace' }}>
              {selectedClip.solidColor || '#ffffff'}
            </span>
          </div>
        </div>
      )}

      <PropertiesClipTabStrip
        activeTab={activeTab}
        onTabChange={setActiveTab}
        presentation={clipPresentation}
        visualEffectCount={visualEffects.length}
        audioEditCount={audioEditCount}
        maskCount={selectedClip.masks?.length ?? 0}
        sourceAnalysisReady={sourceAnalysisStatus === 'ready'}
      />

      <PropertiesClipTabContent
        activeTab={activeTab}
        selectedClip={selectedClip}
        presentation={clipPresentation}
        selectedHookId={selectedHookId}
        selectedText3DProperties={selectedText3DProperties}
        transform={transform}
        interpolatedSpeed={interpolatedSpeed}
        hasKeyframes={hasKeyframes}
        cameraSettings={cameraSettings}
        analysis={clipAnalysis}
      />
    </div>
  );
}
