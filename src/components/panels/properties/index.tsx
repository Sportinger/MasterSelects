// Properties Panel - Main container with lazy-loaded tabs
import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { DEFAULT_TEXT_3D_PROPERTIES } from '../../../stores/timeline/constants';
import { TextTab } from '../TextTab';

// Tab type
type PropertiesTab = 'transform' | 'effects' | 'masks' | 'transcript' | 'analysis' | 'text' | '3d-text' | 'blendshapes' | 'gaussian-splat' | 'camera' | 'splat-effector' | 'lottie' | 'slot-clip';

// Lazy load tab components for code splitting
const TransformTab = lazy(() => import('./TransformTab').then(m => ({ default: m.TransformTab })));
const EffectsTab = lazy(() => import('./EffectsTab').then(m => ({ default: m.EffectsTab })));
const MasksTab = lazy(() => import('./MasksTab').then(m => ({ default: m.MasksTab })));
const TranscriptTab = lazy(() => import('./TranscriptTab').then(m => ({ default: m.TranscriptTab })));
const AnalysisTab = lazy(() => import('./AnalysisTab').then(m => ({ default: m.AnalysisTab })));
const BlendshapesTab = lazy(() => import('./BlendshapesTab').then(m => ({ default: m.BlendshapesTab })));
const GaussianSplatTab = lazy(() => import('./GaussianSplatTab').then(m => ({ default: m.GaussianSplatTab })));
const CameraTab = lazy(() => import('./CameraTab').then(m => ({ default: m.CameraTab })));
const SplatEffectorTab = lazy(() => import('./SplatEffectorTab').then(m => ({ default: m.SplatEffectorTab })));
const ThreeDTextTab = lazy(() => import('./ThreeDTextTab').then(m => ({ default: m.ThreeDTextTab })));
const LottieTab = lazy(() => import('./LottieTab').then(m => ({ default: m.LottieTab })));
const SlotClipTab = lazy(() => import('./SlotClipTab').then(m => ({ default: m.SlotClipTab })));

// Tab loading fallback
function TabLoading() {
  return <div className="properties-tab-loading">Loading...</div>;
}

export function PropertiesPanel() {
  // Reactive data - subscribe to specific values only
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore(state => state.primarySelectedClipId);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes);
  const slotGridProgress = useTimelineStore(state => state.slotGridProgress);
  const compositions = useMediaStore(state => state.compositions);
  const slotAssignments = useMediaStore(state => state.slotAssignments);
  const selectedSlotCompositionId = useMediaStore(state => state.selectedSlotCompositionId);
  const selectSlotComposition = useMediaStore(state => state.selectSlotComposition) as (compositionId: string | null) => void;
  const ensureSlotClipSettings = useMediaStore(state => state.ensureSlotClipSettings) as (compositionId: string, duration: number) => void;
  // Actions from getState() - stable, no subscription needed
  const { getInterpolatedTransform, getInterpolatedSpeed } = useTimelineStore.getState();
  const [activeTab, setActiveTab] = useState<PropertiesTab>('transform');
  const [lastClipId, setLastClipId] = useState<string | null>(null);
  const pendingTabRef = useRef<PropertiesTab | null>(null);

  // Use the primary (clicked) clip for properties, fall back to first selected
  const selectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const selectedSlotComposition = selectedSlotCompositionId
    ? compositions.find(c => c.id === selectedSlotCompositionId) ?? null
    : null;
  const selectedSlotIndex = selectedSlotComposition ? slotAssignments[selectedSlotComposition.id] : undefined;
  const isSlotMode = slotGridProgress > 0.5 && !!selectedSlotComposition && selectedSlotIndex !== undefined;

  // Check if it's an audio clip
  const selectedTrack = selectedClip ? tracks.find(t => t.id === selectedClip.trackId) : null;
  const isAudioClip = selectedTrack?.type === 'audio';

  // Check if it's a text clip
  const isTextClip = selectedClip?.source?.type === 'text';

  // Check if it's a solid clip
  const isSolidClip = selectedClip?.source?.type === 'solid';
  const isLottieClip = selectedClip?.source?.type === 'lottie';
  const selectedMeshType = selectedClip?.meshType ?? selectedClip?.source?.meshType;
  const is3DTextClip = selectedClip?.source?.type === 'model' && selectedMeshType === 'text3d';
  const selectedText3DProperties = is3DTextClip
    ? (selectedClip?.text3DProperties ?? selectedClip?.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES)
    : undefined;

  // Check if it's a gaussian avatar clip
  const isGaussianAvatar = selectedClip?.source?.type === 'gaussian-avatar';
  const isGaussianSplat = selectedClip?.source?.type === 'gaussian-splat';
  const isCameraClip = selectedClip?.source?.type === 'camera';
  const isSplatEffectorClip = selectedClip?.source?.type === 'splat-effector';

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
    if (isSlotMode && activeTab !== 'slot-clip') {
      setActiveTab('slot-clip');
    }
  }, [activeTab, isSlotMode]);

  // Reset tab when switching between audio/video/text/solid clips
  useEffect(() => {
    if (isSlotMode) {
      return;
    }

    if (selectedClipId && selectedClipId !== lastClipId) {
      setLastClipId(selectedClipId);

      // If a pending tab was requested (e.g. from badge click), apply it
      if (pendingTabRef.current) {
        setActiveTab(pendingTabRef.current);
        pendingTabRef.current = null;
        return;
      }

      // Set appropriate default tab based on clip type
      if (isGaussianAvatar) {
        setActiveTab('blendshapes');
      } else if (isLottieClip) {
        setActiveTab('lottie');
      } else if (isCameraClip) {
        setActiveTab('transform');
      } else if (isSplatEffectorClip) {
        setActiveTab('transform');
      } else if (isGaussianSplat) {
        setActiveTab('transform');
      } else if (isSolidClip) {
        setActiveTab('transform');
      } else if (is3DTextClip) {
        setActiveTab('3d-text');
      } else if (isTextClip) {
        setActiveTab('text');
      } else if (isAudioClip && (activeTab === 'transform' || activeTab === 'masks' || activeTab === 'text' || activeTab === '3d-text' || activeTab === 'blendshapes')) {
        setActiveTab('effects');
      } else if (
        !isAudioClip &&
        !isTextClip &&
        !is3DTextClip &&
        (
          activeTab === 'text' ||
          activeTab === '3d-text' ||
          (!isGaussianAvatar && activeTab === 'blendshapes') ||
          (!isGaussianSplat && activeTab === 'gaussian-splat') ||
          (!isCameraClip && activeTab === 'camera') ||
          (!isSplatEffectorClip && activeTab === 'splat-effector') ||
          (!isLottieClip && activeTab === 'lottie')
        )
      ) {
        setActiveTab('transform');
      }
    }
  }, [selectedClipId, isAudioClip, isTextClip, is3DTextClip, isSolidClip, isLottieClip, isGaussianAvatar, isGaussianSplat, isCameraClip, isSplatEffectorClip, isSlotMode, lastClipId, activeTab]);

  // Listen for external tab navigation requests (e.g. badge clicks in MediaPanel)
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab as PropertiesTab;
      if (!tab) return;
      // Store as pending so clip-switch effect doesn't override it
      pendingTabRef.current = tab;
      setActiveTab(tab);
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

  if (!selectedClip) {
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
  const interpolatedSpeed = getInterpolatedSpeed(selectedClip.id, clipLocalTime);

  // Count non-audio effects for badge
  const visualEffects = (selectedClip.effects || []).filter(e => e.type !== 'audio-volume' && e.type !== 'audio-eq');

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
              Effects {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>
              Transcript {selectedClip.transcript && selectedClip.transcript.length > 0 && <span className="badge">{selectedClip.transcript.length}</span>}
            </button>
          </>
        ) : isCameraClip ? (
          <>
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => setActiveTab('transform')}>Transform</button>
            <button className={`tab-btn ${activeTab === 'camera' ? 'active' : ''}`} onClick={() => setActiveTab('camera')}>Camera</button>
          </>
        ) : isTextClip ? (
          <>
            <button className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`} onClick={() => setActiveTab('text')}>Text</button>
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => setActiveTab('transform')}>Transform</button>
            <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
              Effects {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} onClick={() => setActiveTab('masks')}>
              Masks {selectedClip.masks && selectedClip.masks.length > 0 && <span className="badge">{selectedClip.masks.length}</span>}
            </button>
          </>
        ) : is3DTextClip ? (
          <>
            <button className={`tab-btn ${activeTab === '3d-text' ? 'active' : ''}`} onClick={() => setActiveTab('3d-text')}>3D Text</button>
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => setActiveTab('transform')}>Transform</button>
            <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
              Effects {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} onClick={() => setActiveTab('masks')}>
              Masks {selectedClip.masks && selectedClip.masks.length > 0 && <span className="badge">{selectedClip.masks.length}</span>}
            </button>
          </>
        ) : (
          <>
            {isLottieClip && (
              <button className={`tab-btn ${activeTab === 'lottie' ? 'active' : ''}`} onClick={() => setActiveTab('lottie')}>
                Lottie
              </button>
            )}
            <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => setActiveTab('transform')}>Transform</button>
            {isGaussianAvatar && (
              <button className={`tab-btn ${activeTab === 'blendshapes' ? 'active' : ''}`} onClick={() => setActiveTab('blendshapes')}>
                Blendshapes
              </button>
            )}
            {isGaussianSplat && (
              <button className={`tab-btn ${activeTab === 'gaussian-splat' ? 'active' : ''}`} onClick={() => setActiveTab('gaussian-splat')}>
                Gaussian
              </button>
            )}
            {isSplatEffectorClip && (
              <button className={`tab-btn ${activeTab === 'splat-effector' ? 'active' : ''}`} onClick={() => setActiveTab('splat-effector')}>
                Effector
              </button>
            )}
            <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveTab('effects')}>
              Effects {visualEffects.length > 0 && <span className="badge">{visualEffects.length}</span>}
            </button>
            <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} onClick={() => setActiveTab('masks')}>
              Masks {selectedClip.masks && selectedClip.masks.length > 0 && <span className="badge">{selectedClip.masks.length}</span>}
            </button>
            {!isSolidClip && !isLottieClip && (
              <>
                <button className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>
                  Transcript {selectedClip.transcript && selectedClip.transcript.length > 0 && <span className="badge">{selectedClip.transcript.length}</span>}
                </button>
                <button className={`tab-btn ${activeTab === 'analysis' ? 'active' : ''}`} onClick={() => setActiveTab('analysis')}>
                  Analysis {selectedClip.analysisStatus === 'ready' && <span className="badge">✓</span>}
                </button>
              </>
            )}
          </>
        )}
      </div>

      <div className="properties-content">
        <Suspense fallback={<TabLoading />}>
          {activeTab === 'text' && isTextClip && selectedClip.textProperties && (
            <TextTab clipId={selectedClip.id} textProperties={selectedClip.textProperties} />
          )}
          {activeTab === '3d-text' && is3DTextClip && selectedText3DProperties && (
            <ThreeDTextTab clipId={selectedClip.id} text3DProperties={selectedText3DProperties} />
          )}
          {activeTab === 'lottie' && isLottieClip && (
            <LottieTab clipId={selectedClip.id} />
          )}
          {activeTab === 'transform' && !isAudioClip && <TransformTab clipId={selectedClip.id} transform={transform} speed={interpolatedSpeed} is3D={selectedClip.is3D} hasKeyframes={hasKeyframes} />}
          {activeTab === 'camera' && isCameraClip && <CameraTab clipId={selectedClip.id} />}
          {activeTab === 'blendshapes' && isGaussianAvatar && <BlendshapesTab clipId={selectedClip.id} />}
          {activeTab === 'gaussian-splat' && isGaussianSplat && <GaussianSplatTab clipId={selectedClip.id} />}
          {activeTab === 'splat-effector' && isSplatEffectorClip && <SplatEffectorTab clipId={selectedClip.id} />}
          {activeTab === 'effects' && <EffectsTab clipId={selectedClip.id} effects={selectedClip.effects || []} isAudioClip={isAudioClip} />}
          {activeTab === 'masks' && !isAudioClip && <MasksTab clipId={selectedClip.id} masks={selectedClip.masks} />}
          {activeTab === 'transcript' && (
            <TranscriptTab
              clipId={selectedClip.id}
              transcript={selectedClip.transcript || []}
              transcriptStatus={selectedClip.transcriptStatus || 'none'}
              transcriptProgress={selectedClip.transcriptProgress || 0}
              clipStartTime={selectedClip.startTime}
              inPoint={selectedClip.inPoint}
              outPoint={selectedClip.outPoint}
            />
          )}
          {activeTab === 'analysis' && !isAudioClip && (
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
