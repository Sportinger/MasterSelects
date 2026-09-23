import { lazy, Suspense } from 'react';
import type { ClipAnalysis, SceneDescriptionStatus, SceneSegment, TranscriptStatus, TranscriptWord } from '../../../types/clipMetadata';
import type { Text3DProperties } from '../../../types/text';
import type { TimelineClip } from '../../../types/timeline';
import type { ClipTransform } from '../../../types/timelineCore';
import type { SceneCameraSettings } from '../../../stores/mediaStore/types';
import { TextTab } from '../TextTab';
import { PropertiesTabStrip } from './PropertiesTabStrip';
import { EffectsTab } from './EffectsTab';
import type { ClipPropertiesPresentation, PropertiesTab } from './propertiesPanelTypes';

const TransformTab = lazy(() => import('./TransformTab').then(m => ({ default: m.TransformTab })));
const ColorTab = lazy(() => import('./ColorTab').then(m => ({ default: m.ColorTab })));
const AudioEditStackTab = lazy(() => import('./AudioEditStackTab').then(m => ({ default: m.AudioEditStackTab })));
const MasksTab = lazy(() => import('./MasksTab').then(m => ({ default: m.MasksTab })));
const SurfaceTrackingTab = lazy(() => import('./surfaceTracking/SurfaceTrackingTab').then(m => ({ default: m.SurfaceTrackingTab })));
const AnalysisTab = lazy(() => import('./AnalysisTab').then(m => ({ default: m.AnalysisTab })));
const BlendshapesTab = lazy(() => import('./BlendshapesTab').then(m => ({ default: m.BlendshapesTab })));
const GaussianSplatTab = lazy(() => import('./GaussianSplatTab').then(m => ({ default: m.GaussianSplatTab })));
const LightTab = lazy(() => import('./LightTab').then(m => ({ default: m.LightTab })));
const Model3DTab = lazy(() => import('./Model3DTab').then(m => ({ default: m.Model3DTab })));
const SplatEffectorTab = lazy(() => import('./SplatEffectorTab').then(m => ({ default: m.SplatEffectorTab })));
const ThreeDTextTab = lazy(() => import('./ThreeDTextTab').then(m => ({ default: m.ThreeDTextTab })));
const CaptionTab = lazy(() => import('./CaptionTab').then(m => ({ default: m.CaptionTab })));
const LottieTab = lazy(() => import('./LottieTab').then(m => ({ default: m.LottieTab })));
const MathSceneTab = lazy(() => import('./MathSceneTab').then(m => ({ default: m.MathSceneTab })));
const MotionShapeTab = lazy(() => import('./MotionShapeTab').then(m => ({ default: m.MotionShapeTab })));
const FlockTab = lazy(() => import('./flock/FlockTab').then(m => ({ default: m.FlockTab })));
const MotionAdjustmentTab = lazy(() => import('./MotionAdjustmentTab').then(m => ({ default: m.MotionAdjustmentTab })));
const LiveInputTab = lazy(() => import('./LiveInputTab').then(m => ({ default: m.LiveInputTab })));
const HookTab = lazy(() => import('./HookTab').then(m => ({ default: m.HookTab })));
const StoryboardPropertiesPanel = lazy(() =>
  import('../../properties/storyboard').then(m => ({ default: m.StoryboardPropertiesPanel })),
);

interface ClipAnalysisPresentation {
  analysis: ClipAnalysis | undefined;
  analysisStatus: 'none' | 'analyzing' | 'ready' | 'error';
  analysisProgress: number;
  sceneDescriptions?: SceneSegment[];
  sceneDescriptionStatus?: SceneDescriptionStatus;
  sceneDescriptionProgress?: number;
  sceneDescriptionMessage?: string;
  transcriptStatus?: TranscriptStatus;
  transcriptProgress?: number;
  transcript: readonly TranscriptWord[];
}

interface PropertiesClipTabContentProps {
  activeTab: PropertiesTab;
  selectedClip: TimelineClip;
  presentation: ClipPropertiesPresentation;
  selectedHookId: string | null;
  selectedText3DProperties?: Text3DProperties;
  transform: ClipTransform;
  interpolatedSpeed: number;
  hasKeyframes: boolean;
  cameraSettings?: SceneCameraSettings;
  analysis: ClipAnalysisPresentation;
}

export function PropertiesTabLoading() {
  return <div className="properties-tab-loading">Loading...</div>;
}

export function PropertiesReconnectLiveInput({ reconnectRequiredCount }: { reconnectRequiredCount: number }) {
  return (
    <div className="properties-panel">
      <PropertiesTabStrip>
        <button className="tab-btn active" type="button">
          Live <span className="badge">{reconnectRequiredCount}</span>
        </button>
      </PropertiesTabStrip>
      <div className="properties-content">
        <Suspense fallback={<PropertiesTabLoading />}><LiveInputTab /></Suspense>
      </div>
    </div>
  );
}

export function PropertiesClipTabContent({
  activeTab,
  selectedClip,
  presentation,
  selectedHookId,
  selectedText3DProperties,
  transform,
  interpolatedSpeed,
  hasKeyframes,
  cameraSettings,
  analysis,
}: PropertiesClipTabContentProps) {
  const {
    isStoryboardClip,
    isAudioClip,
    isCameraClip,
    isMathSceneClip,
    isFlockClip,
    isMotionAdjustmentClip,
    isMotionShapeClip,
    isCaptionClip,
    isTextClip,
    is3DTextClip,
    isVectorAnimationClip,
    isModelClip,
    isGaussianAvatar,
    isGaussianSplat,
    isLightClip,
    isSplatEffectorClip,
  } = presentation;

  return (
    <div className={`properties-content ${activeTab === 'transcript' ? 'properties-content--transcript' : activeTab === 'analysis' ? 'properties-content--analysis' : ''}`}>
      <Suspense fallback={<PropertiesTabLoading />}>
        {activeTab === 'storyboard' && isStoryboardClip && <StoryboardPropertiesPanel clipId={selectedClip.id} />}
        {activeTab === 'hook' && selectedHookId && <HookTab hookId={selectedHookId} />}
        {activeTab === 'text' && isTextClip && selectedClip.source?.type === 'text' && selectedClip.textProperties && (
          <TextTab
            clipId={selectedClip.id}
            textProperties={selectedClip.textProperties}
            compact
            selectionPills
            canvasSize={{
              width: selectedClip.source?.textCanvas?.width ?? 1920,
              height: selectedClip.source?.textCanvas?.height ?? 1080,
            }}
          />
        )}
        {activeTab === 'captions' && isCaptionClip && selectedClip.captionProperties && (
          <CaptionTab clipId={selectedClip.id} properties={selectedClip.captionProperties} />
        )}
        {activeTab === '3d-text' && is3DTextClip && selectedText3DProperties && (
          <ThreeDTextTab clipId={selectedClip.id} text3DProperties={selectedText3DProperties} />
        )}
        {activeTab === 'lottie' && isVectorAnimationClip && <LottieTab clipId={selectedClip.id} />}
        {activeTab === 'math' && isMathSceneClip && selectedClip.mathScene && (
          <MathSceneTab clipId={selectedClip.id} mathScene={selectedClip.mathScene} />
        )}
        {activeTab === 'motion' && isMotionShapeClip && <MotionShapeTab clipId={selectedClip.id} />}
        {activeTab === 'flock' && isFlockClip && <FlockTab clipId={selectedClip.id} />}
        {activeTab === 'adjustment' && isMotionAdjustmentClip && (
          <MotionAdjustmentTab clipId={selectedClip.id} opacity={transform.opacity} blendMode={transform.blendMode} />
        )}
        {activeTab === 'transform' && !isAudioClip && !isMotionAdjustmentClip && (
          <TransformTab
            clipId={selectedClip.id}
            transform={transform}
            speed={interpolatedSpeed}
            is3D={selectedClip.is3D}
            hasKeyframes={hasKeyframes}
            cameraSettings={cameraSettings}
          />
        )}
        {activeTab === 'model-3d' && isModelClip && <Model3DTab clipId={selectedClip.id} />}
        {activeTab === 'color' && !isAudioClip && !isCameraClip && !isLightClip && !isSplatEffectorClip && !isMotionAdjustmentClip && !isFlockClip && <ColorTab clipId={selectedClip.id} />}
        {activeTab === 'blendshapes' && isGaussianAvatar && <BlendshapesTab clipId={selectedClip.id} />}
        {activeTab === 'gaussian-splat' && isGaussianSplat && <GaussianSplatTab clipId={selectedClip.id} />}
        {activeTab === 'light' && isLightClip && <LightTab clipId={selectedClip.id} />}
        {activeTab === 'splat-effector' && isSplatEffectorClip && <SplatEffectorTab clipId={selectedClip.id} />}
        {activeTab === 'effects' && !isLightClip && !isFlockClip && <EffectsTab key={selectedClip.id} clipId={selectedClip.id} effects={selectedClip.effects || []} isAudioClip={isAudioClip} />}
        {activeTab === 'tracking' && !isFlockClip && <SurfaceTrackingTab key={selectedClip.id} clipId={selectedClip.id} />}
        {activeTab === 'audio-edits' && isAudioClip && <AudioEditStackTab clipId={selectedClip.id} />}
        {activeTab === 'masks' && !isAudioClip && !isLightClip && !isFlockClip && <MasksTab clipId={selectedClip.id} masks={selectedClip.masks} />}
        {activeTab === 'analysis' && !isLightClip && !isFlockClip && (
          <AnalysisTab
            clipId={selectedClip.id}
            analysis={analysis.analysis}
            analysisStatus={analysis.analysisStatus}
            analysisProgress={analysis.analysisProgress}
            clipStartTime={selectedClip.startTime}
            inPoint={selectedClip.inPoint}
            outPoint={selectedClip.outPoint}
            sceneDescriptions={analysis.sceneDescriptions}
            sceneDescriptionStatus={analysis.sceneDescriptionStatus}
            sceneDescriptionProgress={analysis.sceneDescriptionProgress}
            sceneDescriptionMessage={analysis.sceneDescriptionMessage}
            transcriptStatus={analysis.transcriptStatus}
            transcriptProgress={analysis.transcriptProgress}
            transcript={analysis.transcript}
          />
        )}
      </Suspense>
    </div>
  );
}
