import type React from 'react';
import { useSyncExternalStore } from 'react';
import { rotoPreview } from '../../services/roto/rotoPreview';
import { RotoPreviewOverlay } from './RotoPreviewOverlay';
import type { createTextBoundsNumericProperty } from '../../types/animationProperties';
import type { Layer } from '../../types/layers';
import type { MaskVertex, TextBoundsPath } from '../../types/masks';
import type { TextClipProperties } from '../../types/text';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { useEngineStore, type GaussianSplatLoadProgressEntry } from '../../stores/engineStore';
import type { MediaFile } from '../../stores/mediaStore';
import type { PreviewQuality } from '../../stores/settingsStore';
import type { SceneCameraConfig, SceneViewport } from '../../engine/scene/types';
import { MaskOverlay } from './MaskOverlay';
import { FaceAnalysisOverlay } from './FaceAnalysisOverlay';
import { PreciseFaceOverlay } from './PreciseFaceOverlay';
import { PreviewBottomControls } from './PreviewBottomControls';
import { SAM2Overlay } from './SAM2Overlay';
import { SceneObjectOverlay } from './SceneObjectOverlay';
import { SourceMonitor } from './SourceMonitor';
import { StatsOverlay } from './StatsOverlay';
import { TextPreviewEditor } from './TextPreviewEditor';
import { CaptionWordPreviewEditor } from './CaptionWordPreviewEditor';
import {
  PreviewEditHints,
  PreviewPlaybackWaiter,
  PreviewSplatProgressOverlay,
} from './PreviewStatusOverlays';
import { StoryboardAnimaticPreviewOverlay } from './storyboard/StoryboardAnimaticPreviewOverlay';
import { MotionPathOverlay, type MotionPathOverlayProps } from './MotionPathOverlay';
import { PreviewEngineFailureNotice } from './PreviewEngineFailureNotice';
import {
  MotionNullViewportOverlay,
  type MotionNullViewportOverlayProps,
} from './MotionNullViewportOverlay';
import { useTouchMouseBridge } from './useTouchMouseBridge';
import { NativeLiveInputPreview } from './NativeLiveInputPreview';
import { TrackingPreviewOverlay } from './tracking/TrackingPreviewOverlay';
import { usePreview3DMediaDrop } from './usePreview3DMediaDrop';
import { FlockGuidanceOverlay } from './flock/FlockGuidanceOverlay';

interface PreviewCanvasMountProps {
  activeSharedSceneOverlayContent: boolean;
  activeSplatLoadProgress: GaussianSplatLoadProgressEntry | null;
  canvasInContainer: { x: number; y: number; width: number; height: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  canvasSize: { width: number; height: number };
  canvasWrapperRef: React.RefObject<HTMLDivElement | null>;
  clips: TimelineClip[];
  closeSourceMonitor: () => void;
  containerSize: { width: number; height: number };
  displayedCompId: string | null;
  dragHandle: string | null;
  dragMode: string | null;
  editCameraClip: TimelineClip | null;
  editCameraGizmoTransform: ClipTransform | null;
  editCameraModeActive: boolean;
  editCameraOrthoHint: string | null;
  editMode: boolean;
  effectiveResolution: SceneViewport;
  engineInitError: string | null;
  engineInitFailed: boolean;
  exportPreviewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  exportPreviewDisplaySize: { width: number; height: number };
  exportPreviewFrame: ImageBitmap | null;
  getCursorForHandle: (handle: string | null) => string;
  handleOverlayMouseDown: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  handleOverlayMouseMove: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  handleOverlayMouseUp: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  hoverHandle: string | null;
  isDragging: boolean;
  isEditableSource: boolean;
  isEngineReady: boolean;
  isExporting: boolean;
  layerTransformMode: boolean;
  liveFeedbackCompositionId: string | null;
  maskEditMode: string;
  maskNavigationMode: boolean;
  maskPanelActive: boolean;
  motionPathOverlayProps: Omit<MotionPathOverlayProps, 'width' | 'height'>;
  motionNullViewportOverlayProps: Omit<MotionNullViewportOverlayProps, 'width' | 'height'>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  playbackWaiterVideoCount: number;
  previewCameraOverride: SceneCameraConfig | null;
  previewQuality: PreviewQuality;
  qualityDropdownRef: React.RefObject<HTMLDivElement | null>;
  qualityOpen: boolean;
  sam2Active: boolean;
  sceneGizmoToolbarTarget: HTMLDivElement | null;
  sceneNavClipId: string | null;
  sceneNavEnabled: boolean;
  sceneObjectOverlaySelectedClipId: string | null;
  selectClip: (id: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  selectedClip: TimelineClip | null;
  selectedTextBounds: TextBoundsPath | undefined;
  selectedTextLayer: Layer | null;
  setPropertyValue: (clipId: string, property: ReturnType<typeof createTextBoundsNumericProperty>, value: number) => void;
  setPreviewQuality: (quality: PreviewQuality) => void;
  setQualityOpen: (open: boolean) => void;
  setTextTyping: (typing: boolean) => void;
  showPlaybackWaiter: boolean;
  showBottomControls: boolean;
  sceneObjectOverlayEnabled: boolean;
  showSceneObjectOverlay: boolean;
  showTransparencyGrid: boolean;
  sourceMonitorActive: boolean;
  sourceMonitorFile: MediaFile | null;
  sourceMonitorPlaybackRequestId: number;
  textClipEditMode: boolean;
  textPreviewEditorEnabled: boolean;
  textTypingActive: boolean;
  toggleTransparency: () => void;
  tracks: TimelineTrack[];
  updateTextBoundsVertex: (clipId: string, vertexId: string, updates: Partial<MaskVertex>, recordKeyframe?: boolean) => void;
  updateTextBoundsVertices: (clipId: string, vertexUpdates: Array<{ vertexId: string; updates: Partial<MaskVertex> }>, recordKeyframe?: boolean) => void;
  updateTextProperties: (clipId: string, props: Partial<TextClipProperties>) => void;
  viewTransform: React.CSSProperties;
  viewZoom: number;
  worldGridPlane: 'xy' | 'yz' | 'xz';
  onOpenStats: () => void;
}

function PreviewStatsOverlay({
  onOpen,
  resolution,
}: {
  onOpen: () => void;
  resolution: SceneViewport;
}) {
  const engineStats = useEngineStore((state) => state.engineStats);
  return (
    <StatsOverlay
      stats={engineStats}
      resolution={resolution}
      expanded={false}
      onToggle={onOpen}
    />
  );
}

export function PreviewCanvasMount({
  activeSharedSceneOverlayContent,
  activeSplatLoadProgress,
  canvasInContainer,
  canvasRef,
  canvasSize,
  canvasWrapperRef,
  clips,
  closeSourceMonitor,
  containerSize,
  displayedCompId,
  dragHandle,
  dragMode,
  editCameraClip,
  editCameraGizmoTransform,
  editCameraModeActive,
  editCameraOrthoHint,
  editMode,
  effectiveResolution,
  engineInitError,
  engineInitFailed,
  exportPreviewCanvasRef,
  exportPreviewDisplaySize,
  exportPreviewFrame,
  getCursorForHandle,
  handleOverlayMouseDown,
  handleOverlayMouseMove,
  handleOverlayMouseUp,
  hoverHandle,
  isDragging,
  isEditableSource,
  isEngineReady,
  isExporting,
  layerTransformMode,
  liveFeedbackCompositionId,
  maskEditMode,
  maskNavigationMode,
  maskPanelActive,
  motionPathOverlayProps,
  motionNullViewportOverlayProps,
  overlayRef,
  playbackWaiterVideoCount,
  previewCameraOverride,
  previewQuality,
  qualityDropdownRef,
  qualityOpen,
  sam2Active,
  sceneGizmoToolbarTarget,
  sceneNavClipId,
  sceneNavEnabled,
  sceneObjectOverlaySelectedClipId,
  selectClip,
  selectedClip,
  selectedTextBounds,
  selectedTextLayer,
  setPropertyValue,
  setPreviewQuality,
  setQualityOpen,
  setTextTyping,
  showPlaybackWaiter,
  showBottomControls,
  sceneObjectOverlayEnabled,
  showSceneObjectOverlay,
  showTransparencyGrid,
  sourceMonitorActive,
  sourceMonitorFile,
  sourceMonitorPlaybackRequestId,
  textClipEditMode,
  textPreviewEditorEnabled,
  textTypingActive,
  toggleTransparency,
  tracks,
  updateTextBoundsVertex,
  updateTextBoundsVertices,
  updateTextProperties,
  viewTransform,
  viewZoom,
  worldGridPlane,
  onOpenStats,
}: PreviewCanvasMountProps) {
  const rotoState = useSyncExternalStore(rotoPreview.subscribe, rotoPreview.snapshot);
  const rotoActive = !!rotoState && rotoState.compositionId === displayedCompId && rotoState.clipId === selectedClip?.id;
  const layerEditTouchBridge = useTouchMouseBridge<HTMLCanvasElement>();
  const preview3DMediaDrop = usePreview3DMediaDrop({
    canvasWrapperRef,
    enabled: isEditableSource
      && !isExporting
      && !sourceMonitorActive
      && liveFeedbackCompositionId !== null,
  });
  return (
    <>
      {sourceMonitorActive && sourceMonitorFile && (
        <SourceMonitor
          file={sourceMonitorFile}
          autoplayRequestId={sourceMonitorPlaybackRequestId}
          onClose={closeSourceMonitor}
        />
      )}

      <div style={{ display: sourceMonitorActive ? 'none' : 'contents' }}>
        {sceneObjectOverlayEnabled && (
          <div className="preview-top-right-overlays">
            <PreviewStatsOverlay
              resolution={effectiveResolution}
              onOpen={onOpenStats}
            />
          </div>
        )}

        <div
          ref={canvasWrapperRef}
          className={`preview-canvas-wrapper ${showTransparencyGrid ? 'show-transparency-grid' : ''}${preview3DMediaDrop.dropActive ? ' preview-media-drop-active' : ''}`}
          style={viewTransform}
          onDragLeave={preview3DMediaDrop.handleDragLeave}
          onDragOver={preview3DMediaDrop.handleDragOver}
          onDrop={preview3DMediaDrop.handleDrop}
        >
          {engineInitFailed ? (
            <PreviewEngineFailureNotice error={engineInitError} />
          ) : !isEngineReady ? (
            <div className="loading">
              <div className="loading-spinner" />
              <p>Initializing WebGPU...</p>
            </div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                width={effectiveResolution.width}
                height={effectiveResolution.height}
                className="preview-canvas"
                data-testid="preview-canvas"
                data-live-feedback-composition-id={liveFeedbackCompositionId ?? undefined}
                role="img"
                aria-label="Composition preview"
                style={{
                  width: canvasSize.width,
                  height: canvasSize.height,
                }}
              />
              <NativeLiveInputPreview
                canvasSize={canvasSize}
                clips={clips}
                enabled={isEditableSource
                  && !isExporting
                  && !sourceMonitorActive
                  && !editMode
                  && !layerTransformMode
                  && !maskPanelActive
                  && maskEditMode === 'none'
                  && !sam2Active
                  && !showTransparencyGrid
                  && liveFeedbackCompositionId !== null}
                tracks={tracks}
              />
              <StoryboardAnimaticPreviewOverlay
                displayedCompositionId={displayedCompId}
                width={effectiveResolution.width}
                height={effectiveResolution.height}
                displayWidth={canvasSize.width}
                displayHeight={canvasSize.height}
              />
              {!isExporting && !sourceMonitorActive && <TrackingPreviewOverlay displayedCompId={displayedCompId} width={canvasSize.width} height={canvasSize.height} resolution={effectiveResolution}/>}
              {isExporting && exportPreviewFrame && (
                <canvas
                  ref={exportPreviewCanvasRef}
                  width={exportPreviewFrame.width}
                  height={exportPreviewFrame.height}
                  className="preview-export-frame"
                  style={{
                    width: exportPreviewDisplaySize.width,
                    height: exportPreviewDisplaySize.height,
                  }}
                />
              )}
              {isEditableSource && maskPanelActive && maskEditMode !== 'none' && (
                <MaskOverlay
                  canvasWidth={effectiveResolution.width}
                  canvasHeight={effectiveResolution.height}
                  displayWidth={canvasSize.width}
                  displayHeight={canvasSize.height}
                  viewZoom={maskNavigationMode ? viewZoom : 1}
                />
              )}
              {isEditableSource && sam2Active && (
                <SAM2Overlay
                  canvasWidth={effectiveResolution.width}
                  canvasHeight={effectiveResolution.height}
                />
              )}
              {isEditableSource && !isExporting && !sourceMonitorActive && <RotoPreviewOverlay
                displayedCompId={displayedCompId} width={canvasSize.width} height={canvasSize.height} resolution={effectiveResolution} />}
              {isEditableSource && !isExporting && <PreciseFaceOverlay canvasWidth={effectiveResolution.width} canvasHeight={effectiveResolution.height}
                displayWidth={canvasSize.width} displayHeight={canvasSize.height} />}
              {isEditableSource && selectedClip?.analysis?.faceAnalysis && (
                <FaceAnalysisOverlay
                  canvasWidth={effectiveResolution.width}
                  canvasHeight={effectiveResolution.height}
                />
              )}
              {showSceneObjectOverlay && (
                <SceneObjectOverlay
                  clips={clips}
                  tracks={tracks}
                  selectedClipId={sceneObjectOverlaySelectedClipId}
                  selectClip={selectClip}
                  canvasSize={canvasSize}
                  viewport={effectiveResolution}
                  compositionId={displayedCompId}
                  sceneNavClipId={sceneNavClipId}
                  previewCameraOverride={previewCameraOverride}
                  editCameraClip={editCameraModeActive ? editCameraClip : null}
                  editCameraTransform={editCameraModeActive ? editCameraGizmoTransform : null}
                  showOnlyEditCamera={false}
                  showWorldGrid={editMode && activeSharedSceneOverlayContent}
                  worldGridPlane={worldGridPlane}
                  toolbarPortalTarget={sceneGizmoToolbarTarget}
                  enabled
                />
              )}
            </>
          )}
        </div>

        <PreviewPlaybackWaiter
          pendingVideoCount={playbackWaiterVideoCount}
          show={showPlaybackWaiter}
        />

        {textPreviewEditorEnabled && isEngineReady && (
          <div
            className="preview-text-edit-backdrop"
            style={{
              position: 'absolute',
              left: canvasInContainer.x,
              top: canvasInContainer.y,
              width: canvasInContainer.width,
              height: canvasInContainer.height,
              boxShadow: '0 0 0 9999px var(--preview-pasteboard-bg)',
              pointerEvents: 'none',
            }}
          />
        )}

        {textPreviewEditorEnabled && selectedClip?.textProperties && selectedTextLayer && (
          <TextPreviewEditor
            clip={selectedClip}
            layer={selectedTextLayer}
            effectiveResolution={effectiveResolution}
            canvasSize={canvasSize}
            canvasInContainer={canvasInContainer}
            viewZoom={viewZoom}
            enabled={textPreviewEditorEnabled}
            activeTextBounds={selectedTextBounds}
            updateTextProperties={updateTextProperties}
            updateTextBoundsVertex={updateTextBoundsVertex}
            updateTextBoundsVertices={updateTextBoundsVertices}
            setPropertyValue={setPropertyValue}
          />
        )}

        <PreviewSplatProgressOverlay progress={activeSplatLoadProgress} />

        {layerTransformMode && isEngineReady && !rotoActive && (
          <canvas
            ref={overlayRef}
            width={containerSize.width || 100}
            height={containerSize.height || 100}
            className="preview-overlay-fullscreen"
            {...layerEditTouchBridge}
            onMouseDown={handleOverlayMouseDown}
            onMouseMove={handleOverlayMouseMove}
            onMouseUp={handleOverlayMouseUp}
            onMouseLeave={handleOverlayMouseUp}
            onDoubleClick={textClipEditMode && !selectedClip?.captionProperties
              ? () => setTextTyping(true)
              : undefined}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: containerSize.width || '100%',
              height: containerSize.height || '100%',
              cursor: isDragging
                ? (dragMode === 'scale' ? getCursorForHandle(dragHandle) : 'grabbing')
                : getCursorForHandle(hoverHandle),
              pointerEvents: 'auto',
            }}
          />
        )}

        {isEngineReady && isEditableSource && !isExporting && !sourceMonitorActive
          && !sceneNavEnabled && !maskPanelActive && !textPreviewEditorEnabled && (
          <CaptionWordPreviewEditor
            canvasInContainer={canvasInContainer}
            canvasSize={canvasSize}
            canvasWrapperRef={canvasWrapperRef}
            effectiveResolution={effectiveResolution}
            enabled
            overlayRef={overlayRef}
            viewZoom={viewZoom}
          />
        )}

        {isEngineReady && (
          motionNullViewportOverlayProps.controller
          || motionNullViewportOverlayProps.diagnostics.length > 0
        ) && (
          <div
            className="preview-motion-null-overlay-host"
            style={{
              ...viewTransform,
              position: 'absolute',
              inset: 0,
              zIndex: 20,
              pointerEvents: 'none',
            }}
          >
            <MotionNullViewportOverlay
              width={canvasSize.width}
              height={canvasSize.height}
              {...motionNullViewportOverlayProps}
            />
          </div>
        )}

        {isEngineReady && isEditableSource && !isExporting && !sourceMonitorActive
          && selectedClip?.source?.type === 'flock' && (
          <div
            className="preview-flock-guidance-overlay-host"
            style={{
              ...viewTransform,
              position: 'absolute',
              inset: 0,
              zIndex: 18,
              pointerEvents: 'none',
            }}
          >
            <FlockGuidanceOverlay
              clip={selectedClip}
              canvasSize={canvasSize}
              viewport={effectiveResolution}
              compositionId={displayedCompId}
              sceneNavClipId={sceneNavClipId}
              previewCameraOverride={previewCameraOverride}
              enabled={!maskPanelActive && !sam2Active && !textPreviewEditorEnabled}
            />
          </div>
        )}

        {isEngineReady && motionPathOverlayProps.visible && (
          <div
            className="preview-motion-path-overlay-host"
            style={{
              ...viewTransform,
              position: 'absolute',
              inset: 0,
              zIndex: 19,
              pointerEvents: 'none',
            }}
          >
            <MotionPathOverlay
              width={canvasSize.width}
              height={canvasSize.height}
              {...motionPathOverlayProps}
            />
          </div>
        )}

        <PreviewEditHints
          editCameraOrthoHint={editCameraOrthoHint}
          isEditableSource={isEditableSource}
          layerTransformMode={layerTransformMode}
          maskNavigationMode={maskNavigationMode}
          sceneNavEnabled={sceneNavEnabled}
          textClipEditMode={textClipEditMode}
          textTypingActive={textTypingActive}
        />

        {showBottomControls && sceneObjectOverlayEnabled && (
          <PreviewBottomControls
            showTransparencyGrid={showTransparencyGrid}
            onToggleTransparency={toggleTransparency}
            previewQuality={previewQuality}
            setPreviewQuality={setPreviewQuality}
            qualityOpen={qualityOpen}
            setQualityOpen={setQualityOpen}
            qualityDropdownRef={qualityDropdownRef}
          />
        )}

      </div>
    </>
  );
}
