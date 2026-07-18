// Properties Panel - Main container with lazy-loaded tabs
import { useState, useEffect, useCallback, useRef, useSyncExternalStore, Suspense, lazy } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useEngineStore } from '../../../stores/engineStore';
import { DEFAULT_TEXT_3D_PROPERTIES } from '../../../stores/timeline/constants';
import { isAudioEffect } from '../../../types';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import { TextTab } from '../TextTab';
import {
  AudioTrackControlsTab,
  AudioTrackEffectsTab,
  AudioTrackSendsTab,
  MasterAudioControlsTab,
  MasterAudioEffectsTab,
} from './AudioBusPropertiesTabs';
import { MidiInstrumentTab } from './MidiInstrumentTab';
import { DEFAULT_MASTER_AUDIO_STATE } from './audioBusDefaults';
import { liveInputRuntime } from '../../../services/mediaRuntime/liveInputRuntime';
import './PropertiesPanel.css';
import './EffectsTab.css';
import './AnalysisTranscriptTabs.css';
import './TextTab.css';
import './VolumeBlendshapeTabs.css';

// Tab type
type PropertiesTab = 'transform' | 'color' | 'effects' | 'audio-edits' | 'masks' | 'transcript' | 'analysis' | 'text' | '3d-text' | 'model-3d' | 'math' | 'motion' | 'blendshapes' | 'gaussian-splat' | 'camera' | 'light' | 'splat-effector' | 'lottie' | 'live' | 'slot-clip' | 'transition' | 'track-controls' | 'track-effects' | 'track-sends' | 'track-instrument' | 'master-controls' | 'master-effects';

// Lazy load tab components for code splitting
const TransformTab = lazy(() => import('./TransformTab').then(m => ({ default: m.TransformTab })));
const ColorTab = lazy(() => import('./ColorTab').then(m => ({ default: m.ColorTab })));
const EffectsTab = lazy(() => import('./EffectsTab').then(m => ({ default: m.EffectsTab })));
const AudioEditStackTab = lazy(() => import('./AudioEditStackTab').then(m => ({ default: m.AudioEditStackTab })));
const MasksTab = lazy(() => import('./MasksTab').then(m => ({ default: m.MasksTab })));
const TranscriptTab = lazy(() => import('./TranscriptTab').then(m => ({ default: m.TranscriptTab })));
const AnalysisTab = lazy(() => import('./AnalysisTab').then(m => ({ default: m.AnalysisTab })));
const BlendshapesTab = lazy(() => import('./BlendshapesTab').then(m => ({ default: m.BlendshapesTab })));
const GaussianSplatTab = lazy(() => import('./GaussianSplatTab').then(m => ({ default: m.GaussianSplatTab })));
const LightTab = lazy(() => import('./LightTab').then(m => ({ default: m.LightTab })));
const Model3DTab = lazy(() => import('./Model3DTab').then(m => ({ default: m.Model3DTab })));
const SplatEffectorTab = lazy(() => import('./SplatEffectorTab').then(m => ({ default: m.SplatEffectorTab })));
const ThreeDTextTab = lazy(() => import('./ThreeDTextTab').then(m => ({ default: m.ThreeDTextTab })));
const LottieTab = lazy(() => import('./LottieTab').then(m => ({ default: m.LottieTab })));
const SlotClipTab = lazy(() => import('./SlotClipTab').then(m => ({ default: m.SlotClipTab })));
const MathSceneTab = lazy(() => import('./MathSceneTab').then(m => ({ default: m.MathSceneTab })));
const MotionShapeTab = lazy(() => import('./MotionShapeTab').then(m => ({ default: m.MotionShapeTab })));
const TransitionTab = lazy(() => import('./TransitionTab').then(m => ({ default: m.TransitionTab })));
const LiveInputTab = lazy(() => import('./LiveInputTab').then(m => ({ default: m.LiveInputTab })));

// Tab loading fallback
function TabLoading() {
  return <div className="properties-tab-loading">Loading...</div>;
}

function getGuidedPropertiesTabAttributes(tab: PropertiesTab) {
  return {
    'data-guided-properties-tab': tab,
    'data-guided-target': `properties-tab:${tab}`,
  };
}

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

function scopedTabLabel(scope: 'CLIP' | 'TRACK' | 'MASTER', label: string): string {
  return `${scope} ${label}`;
}

export function PropertiesPanel() {
  // Reactive data - subscribe to specific values only
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore(state => state.primarySelectedClipId);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes);
  const slotGridProgress = useTimelineStore(state => state.slotGridProgress);
  const masterAudioState = useTimelineStore(state => state.masterAudioState);
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

  // Use the primary (clicked) clip for properties, fall back to first selected
  const fallbackSelectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
  const selectedClipId = propertiesSelection?.kind === 'clip'
    ? propertiesSelection.clipId
    : propertiesSelection ? null : fallbackSelectedClipId;
  const selectedClip = clips.find(c => c.id === selectedClipId);
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
  const isSlotMode = slotGridProgress > 0.5 && !!selectedSlotComposition && selectedSlotIndex !== undefined;

  // Check if it's an audio clip
  const selectedTrack = selectedClip ? tracks.find(t => t.id === selectedClip.trackId) : null;
  const isAudioClip = selectedTrack?.type === 'audio';
  const selectedClipAudioEditCount = selectedClip?.audioState?.editStack?.length ?? 0;

  // Check if it's a text clip
  const isTextClip = selectedClip?.source?.type === 'text';

  // Check if it's a solid clip
  const isSolidClip = selectedClip?.source?.type === 'solid';
  const isMathSceneClip = selectedClip?.source?.type === 'math-scene';
  const isMotionShapeClip = selectedClip?.source?.type === 'motion-shape';
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
    const engineState = useEngineStore.getState();
    if (engineState.sceneNavClipId !== nextSceneNavClipId) {
      engineState.setSceneNavClipId(nextSceneNavClipId);
    }
  }, [selectedClip?.id, selectedClip?.source?.type]);

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
        setActiveTab(selectedPropertiesTrack.type === 'audio' ? 'track-effects' : 'track-controls');
        return;
      }

      if (isMasterPropertiesSelected) {
        setActiveTab('master-effects');
        return;
      }

      // Set appropriate default tab based on clip type
      if (isLiveInputClip) {
        setActiveTab('live');
      } else if (isGaussianAvatar) {
        setActiveTab('blendshapes');
      } else if (isVectorAnimationClip) {
        setActiveTab('lottie');
      } else if (isCameraClip) {
        setActiveTab('transform');
      } else if (isLightClip) {
        setActiveTab('transform');
      } else if (isSplatEffectorClip) {
        setActiveTab('transform');
      } else if (isGaussianSplat) {
        setActiveTab('transform');
      } else if (isMotionShapeClip) {
        setActiveTab('motion');
      } else if (isMathSceneClip) {
        setActiveTab('math');
      } else if (isSolidClip) {
        setActiveTab('transform');
      } else if (is3DTextClip) {
        setActiveTab('3d-text');
      } else if (isTextClip) {
        setActiveTab('text');
      } else if (isAudioClip && (activeTab === 'transform' || activeTab === 'color' || activeTab === 'masks' || activeTab === 'text' || activeTab === '3d-text' || activeTab === 'blendshapes')) {
        setActiveTab(selectedClipAudioEditCount > 0 ? 'audio-edits' : 'effects');
      } else if (
        !isAudioClip &&
        !isTextClip &&
        !is3DTextClip &&
        (
          activeTab === 'text' ||
          activeTab === '3d-text' ||
          (!isMathSceneClip && activeTab === 'math') ||
          (!isMotionShapeClip && activeTab === 'motion') ||
          (!isModelClip && activeTab === 'model-3d') ||
          (!isGaussianAvatar && activeTab === 'blendshapes') ||
          (!isGaussianSplat && activeTab === 'gaussian-splat') ||
          (!isCameraClip && activeTab === 'camera') ||
          (!isLightClip && activeTab === 'light') ||
          (!isSplatEffectorClip && activeTab === 'splat-effector') ||
          (!isVectorAnimationClip && activeTab === 'lottie') ||
          (!isLiveInputClip && activeTab === 'live')
        )
      ) {
        setActiveTab('transform');
      }
    }
  }, [selectionKey, selectedTransitionSelection, selectedPropertiesTrack, isMasterPropertiesSelected, isAudioClip, selectedClipAudioEditCount, isTextClip, is3DTextClip, isModelClip, isMathSceneClip, isMotionShapeClip, isSolidClip, isVectorAnimationClip, isGaussianAvatar, isGaussianSplat, isCameraClip, isLightClip, isSplatEffectorClip, isLiveInputClip, isSlotMode, lastSelectionKey, activeTab]);

  // Listen for external tab navigation requests (e.g. badge clicks in MediaPanel)
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab as PropertiesTab;
      if (!tab) return;
      const requestedTab = tab === 'camera' ? 'transform' : tab;
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

  if (slotGridProgress > 0.5 && !selectedSlotComposition) {
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
        <div className="properties-tabs">
          <button className="tab-btn active" onClick={() => setActiveTab('slot-clip')}>
            Slot Clip
          </button>
        </div>

        <div className="properties-content">
          <Suspense fallback={<TabLoading />}>
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
        <div className="properties-tabs">
          <button className="tab-btn active" onClick={() => setActiveTab('transition')}>
            TRANSITION Parameters
          </button>
        </div>

        <div className="properties-content">
          <Suspense fallback={<TabLoading />}>
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
        <div className="properties-tabs">
          {hasBusControls && (
            <button
              className={`tab-btn ${activeTab === 'track-controls' ? 'active' : ''}`}
              onClick={() => setActiveTab('track-controls')}
            >
              {scopedTabLabel('TRACK', 'Controls')}
            </button>
          )}
          {isMidiTrack && (
            <button
              className={`tab-btn ${activeTab === 'track-instrument' ? 'active' : ''}`}
              onClick={() => setActiveTab('track-instrument')}
            >
              {scopedTabLabel('TRACK', 'Instrument')}
            </button>
          )}
          {hasBusControls && (
            <>
              <button
                className={`tab-btn ${activeTab === 'track-effects' ? 'active' : ''}`}
                onClick={() => setActiveTab('track-effects')}
              >
                {scopedTabLabel('TRACK', 'Effects')} {trackEffectCount > 0 && <span className="badge">{trackEffectCount}</span>}
              </button>
              <button
                className={`tab-btn ${activeTab === 'track-sends' ? 'active' : ''}`}
                onClick={() => setActiveTab('track-sends')}
              >
                {scopedTabLabel('TRACK', 'Sends')} {trackSendCount > 0 && <span className="badge">{trackSendCount}</span>}
              </button>
            </>
          )}
        </div>

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
        <div className="properties-tabs">
          <button
            className={`tab-btn ${activeTab === 'master-controls' ? 'active' : ''}`}
            onClick={() => setActiveTab('master-controls')}
          >
            {scopedTabLabel('MASTER', 'Controls')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'master-effects' ? 'active' : ''}`}
            onClick={() => setActiveTab('master-effects')}
          >
            {scopedTabLabel('MASTER', 'Effects')} {masterEffectCount > 0 && <span className="badge">{masterEffectCount}</span>}
          </button>
        </div>

        <div className="properties-content">
          {activeTab === 'master-controls' && <MasterAudioControlsTab masterAudio={masterAudio} />}
          {activeTab === 'master-effects' && <MasterAudioEffectsTab masterAudio={masterAudio} />}
        </div>
      </div>
    );
  }

  if (!selectedClip) {
    if (reconnectRequiredCount > 0) {
      return (
        <div className="properties-panel">
          <div className="properties-tabs">
            <button className="tab-btn active" type="button">
              {scopedTabLabel('CLIP', 'Live')} <span className="badge">{reconnectRequiredCount}</span>
            </button>
          </div>
          <div className="properties-content">
            <Suspense fallback={<TabLoading />}><LiveInputTab /></Suspense>
          </div>
        </div>
      );
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
  const transcriptWords = transcriptSourceClip?.transcript || [];
  const transcriptStatus = transcriptSourceClip?.transcriptStatus || 'none';
  const transcriptProgress = transcriptSourceClip?.transcriptProgress || 0;

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

      <div className="properties-tabs">
        {isAudioClip ? (
          <>
            <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
              {scopedTabLabel('CLIP', 'Effects')} {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'audio-edits' ? 'active' : ''}`} onClick={() => setActiveTab('audio-edits')}>
              {scopedTabLabel('CLIP', 'Audio Edits')} {audioEditCount > 0 && <span className="badge">{audioEditCount}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>
              {scopedTabLabel('CLIP', 'Transcript')} {transcriptWords.length > 0 && <span className="badge">{transcriptWords.length}</span>}
            </button>
          </>
        ) : isCameraClip ? (
          <>
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} {...getGuidedPropertiesTabAttributes('transform')} onClick={() => setActiveTab('transform')}>{scopedTabLabel('CLIP', 'Transform')}</button>
          </>
        ) : isMathSceneClip ? (
          <>
            <button className={`tab-btn ${activeTab === 'math' ? 'active' : ''}`} onClick={() => setActiveTab('math')}>{scopedTabLabel('CLIP', 'Math')}</button>
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} {...getGuidedPropertiesTabAttributes('transform')} onClick={() => setActiveTab('transform')}>{scopedTabLabel('CLIP', 'Transform')}</button>
            <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => setActiveTab('color')}>{scopedTabLabel('CLIP', 'Color')}</button>
            <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
              {scopedTabLabel('CLIP', 'Effects')} {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} {...getGuidedPropertiesTabAttributes('masks')} onClick={() => setActiveTab('masks')}>
              {scopedTabLabel('CLIP', 'Masks')} {selectedClip.masks && selectedClip.masks.length > 0 && <span className="badge">{selectedClip.masks.length}</span>}
            </button>
          </>
        ) : isMotionShapeClip ? (
          <>
            <button className={`tab-btn ${activeTab === 'motion' ? 'active' : ''}`} onClick={() => setActiveTab('motion')}>{scopedTabLabel('CLIP', 'Motion')}</button>
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => setActiveTab('transform')}>{scopedTabLabel('CLIP', 'Transform')}</button>
            <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => setActiveTab('color')}>{scopedTabLabel('CLIP', 'Color')}</button>
            <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
              {scopedTabLabel('CLIP', 'Effects')} {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} {...getGuidedPropertiesTabAttributes('masks')} onClick={() => setActiveTab('masks')}>
              {scopedTabLabel('CLIP', 'Masks')} {selectedClip.masks && selectedClip.masks.length > 0 && <span className="badge">{selectedClip.masks.length}</span>}
            </button>
          </>
        ) : isTextClip ? (
          <>
            <button className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`} onClick={() => setActiveTab('text')}>{scopedTabLabel('CLIP', 'Text')}</button>
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => setActiveTab('transform')}>{scopedTabLabel('CLIP', 'Transform')}</button>
            <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => setActiveTab('color')}>{scopedTabLabel('CLIP', 'Color')}</button>
            <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
              {scopedTabLabel('CLIP', 'Effects')} {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} onClick={() => setActiveTab('masks')}>
              {scopedTabLabel('CLIP', 'Masks')} {selectedClip.masks && selectedClip.masks.length > 0 && <span className="badge">{selectedClip.masks.length}</span>}
            </button>
          </>
        ) : is3DTextClip ? (
          <>
            <button className={`tab-btn ${activeTab === '3d-text' ? 'active' : ''}`} onClick={() => setActiveTab('3d-text')}>{scopedTabLabel('CLIP', '3D Text')}</button>
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => setActiveTab('transform')}>{scopedTabLabel('CLIP', 'Transform')}</button>
            <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => setActiveTab('color')}>{scopedTabLabel('CLIP', 'Color')}</button>
            <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
              {scopedTabLabel('CLIP', 'Effects')} {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} onClick={() => setActiveTab('masks')}>
              {scopedTabLabel('CLIP', 'Masks')} {selectedClip.masks && selectedClip.masks.length > 0 && <span className="badge">{selectedClip.masks.length}</span>}
            </button>
          </>
        ) : (
          <>
            {isLiveInputClip && (
              <button className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
                {scopedTabLabel('CLIP', 'Live')}
              </button>
            )}
            {isVectorAnimationClip && (
              <button className={`tab-btn ${activeTab === 'lottie' ? 'active' : ''}`} onClick={() => setActiveTab('lottie')}>
                {scopedTabLabel('CLIP', vectorAnimationTabLabel)}
              </button>
            )}
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} {...getGuidedPropertiesTabAttributes('transform')} onClick={() => setActiveTab('transform')}>{scopedTabLabel('CLIP', 'Transform')}</button>
            {isModelClip && (
              <button className={`tab-btn ${activeTab === 'model-3d' ? 'active' : ''}`} onClick={() => setActiveTab('model-3d')}>{scopedTabLabel('CLIP', '3D')}</button>
            )}
            {!isSplatEffectorClip && (
              <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => setActiveTab('color')}>{scopedTabLabel('CLIP', 'Color')}</button>
            )}
            {isGaussianAvatar && (
              <button className={`tab-btn ${activeTab === 'blendshapes' ? 'active' : ''}`} onClick={() => setActiveTab('blendshapes')}>
                {scopedTabLabel('CLIP', 'Blendshapes')}
              </button>
            )}
            {isGaussianSplat && (
              <button className={`tab-btn ${activeTab === 'gaussian-splat' ? 'active' : ''}`} onClick={() => setActiveTab('gaussian-splat')}>
                {scopedTabLabel('CLIP', 'Gaussian')}
              </button>
            )}
            {isLightClip && (
              <button className={`tab-btn ${activeTab === 'light' ? 'active' : ''}`} onClick={() => setActiveTab('light')}>
                {scopedTabLabel('CLIP', 'Light')}
              </button>
            )}
            {isSplatEffectorClip && (
              <button className={`tab-btn ${activeTab === 'splat-effector' ? 'active' : ''}`} onClick={() => setActiveTab('splat-effector')}>
                {scopedTabLabel('CLIP', 'Effector')}
              </button>
            )}
            {!isLightClip && (
              <>
                <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
                  {scopedTabLabel('CLIP', 'Effects')} {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
                </button>
                <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} {...getGuidedPropertiesTabAttributes('masks')} onClick={() => setActiveTab('masks')}>
                  {scopedTabLabel('CLIP', 'Masks')} {selectedClip.masks && selectedClip.masks.length > 0 && <span className="badge">{selectedClip.masks.length}</span>}
                </button>
              </>
            )}
            {!isSolidClip && !isVectorAnimationClip && !isLightClip && (
              <>
                <button className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>
                  {scopedTabLabel('CLIP', 'Transcript')} {transcriptWords.length > 0 && <span className="badge">{transcriptWords.length}</span>}
                </button>
                <button className={`tab-btn ${activeTab === 'analysis' ? 'active' : ''}`} onClick={() => setActiveTab('analysis')}>
                  {scopedTabLabel('CLIP', 'Analysis')} {selectedClip.analysisStatus === 'ready' && <span className="badge">✓</span>}
                </button>
              </>
            )}
          </>
        )}
      </div>

      <div className="properties-content">
        <Suspense fallback={<TabLoading />}>
          {activeTab === 'live' && isLiveInputClip && <LiveInputTab clipId={selectedClip.id} />}
          {activeTab === 'text' && isTextClip && selectedClip.textProperties && (
            <TextTab
              clipId={selectedClip.id}
              textProperties={selectedClip.textProperties}
              canvasSize={{
                width: selectedClip.source?.textCanvas?.width ?? 1920,
                height: selectedClip.source?.textCanvas?.height ?? 1080,
              }}
            />
          )}
          {activeTab === '3d-text' && is3DTextClip && selectedText3DProperties && (
            <ThreeDTextTab clipId={selectedClip.id} text3DProperties={selectedText3DProperties} />
          )}
          {activeTab === 'lottie' && isVectorAnimationClip && (
            <LottieTab clipId={selectedClip.id} />
          )}
          {activeTab === 'math' && isMathSceneClip && selectedClip.mathScene && (
            <MathSceneTab clipId={selectedClip.id} mathScene={selectedClip.mathScene} />
          )}
          {activeTab === 'motion' && isMotionShapeClip && (
            <MotionShapeTab clipId={selectedClip.id} />
          )}
          {activeTab === 'transform' && !isAudioClip && <TransformTab clipId={selectedClip.id} transform={transform} speed={interpolatedSpeed} is3D={selectedClip.is3D} hasKeyframes={hasKeyframes} cameraSettings={cameraSettings} />}
          {activeTab === 'model-3d' && isModelClip && <Model3DTab clipId={selectedClip.id} />}
          {activeTab === 'color' && !isAudioClip && !isCameraClip && !isLightClip && !isSplatEffectorClip && <ColorTab clipId={selectedClip.id} />}
          {activeTab === 'blendshapes' && isGaussianAvatar && <BlendshapesTab clipId={selectedClip.id} />}
          {activeTab === 'gaussian-splat' && isGaussianSplat && <GaussianSplatTab clipId={selectedClip.id} />}
          {activeTab === 'light' && isLightClip && <LightTab clipId={selectedClip.id} />}
          {activeTab === 'splat-effector' && isSplatEffectorClip && <SplatEffectorTab clipId={selectedClip.id} />}
          {activeTab === 'effects' && !isLightClip && <EffectsTab clipId={selectedClip.id} effects={selectedClip.effects || []} isAudioClip={isAudioClip} />}
          {activeTab === 'audio-edits' && isAudioClip && <AudioEditStackTab clipId={selectedClip.id} />}
          {activeTab === 'masks' && !isAudioClip && !isLightClip && <MasksTab clipId={selectedClip.id} masks={selectedClip.masks} />}
          {activeTab === 'transcript' && !isLightClip && (
            <TranscriptTab
              clipId={selectedClip.id}
              transcript={transcriptWords}
              transcriptStatus={transcriptStatus}
              transcriptProgress={transcriptProgress}
              clipStartTime={selectedClip.startTime}
              inPoint={selectedClip.inPoint}
              outPoint={selectedClip.outPoint}
            />
          )}
          {activeTab === 'analysis' && !isAudioClip && !isLightClip && (
            <AnalysisTab
              clipId={selectedClip.id}
              analysis={selectedClip.analysis}
              analysisStatus={selectedClip.analysisStatus || 'none'}
              analysisProgress={selectedClip.analysisProgress || 0}
              clipStartTime={selectedClip.startTime}
              inPoint={selectedClip.inPoint}
              outPoint={selectedClip.outPoint}
              sceneDescriptions={selectedClip.sceneDescriptions}
              sceneDescriptionStatus={selectedClip.sceneDescriptionStatus}
              sceneDescriptionProgress={selectedClip.sceneDescriptionProgress}
              sceneDescriptionMessage={selectedClip.sceneDescriptionMessage}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}
