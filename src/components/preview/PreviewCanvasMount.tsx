import type React from 'react';
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
import { PreviewBottomControls } from './PreviewBottomControls';
import { SAM2Overlay } from './SAM2Overlay';
import { SceneObjectOverlay } from './SceneObjectOverlay';
import { SourceMonitor } from './SourceMonitor';
import { StatsOverlay } from './StatsOverlay';
import { TextPreviewEditor } from './TextPreviewEditor';
import {
  PreviewEditHints,
  PreviewPlaybackWaiter,
  PreviewSplatProgressOverlay,
} from './PreviewStatusOverlays';

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
  effectiveSceneNavFpsMode: boolean;
  engineInitError: string | null;
  engineInitFailed: boolean;
  exportPreviewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  exportPreviewDisplaySize: { width: number; height: number };
  exportPreviewFrame: ImageBitmap | null;
  focusEditCameraOnSceneObject: (object: { clipId: string; kind: string; worldPosition: { x: number; y: number; z: number } }) => boolean;
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
  maskEditMode: string;
  maskNavigationMode: boolean;
  maskPanelActive: boolean;
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
  setSceneGizmoToolbarTarget: (target: HTMLDivElement | null) => void;
  setTextTyping: (typing: boolean) => void;
  showPlaybackWaiter: boolean;
  showSceneObjectOverlay: boolean;
  showTransparencyGrid: boolean;
  sourceMonitorActive: boolean;
  sourceMonitorFile: MediaFile | null;
  sourceMonitorPlaybackRequestId: number;
  statsExpanded: boolean;
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
  onToggleStats: () => void;
}

function PreviewStatsOverlay({
  expanded,
  onToggle,
  resolution,
}: {
  expanded: boolean;
  onToggle: () => void;
  resolution: SceneViewport;
}) {
  const engineStats = useEngineStore((state) => state.engineStats);
  return (
    <StatsOverlay
      stats={engineStats}
      resolution={resolution}
      expanded={expanded}
      onToggle={onToggle}
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
  effectiveSceneNavFpsMode,
  engineInitError,
  engineInitFailed,
  exportPreviewCanvasRef,
  exportPreviewDisplaySize,
  exportPreviewFrame,
  focusEditCameraOnSceneObject,
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
  maskEditMode,
  maskNavigationMode,
  maskPanelActive,
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
  setSceneGizmoToolbarTarget,
  setTextTyping,
  showPlaybackWaiter,
  showSceneObjectOverlay,
  showTransparencyGrid,
  sourceMonitorActive,
  sourceMonitorFile,
  sourceMonitorPlaybackRequestId,
  statsExpanded,
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
  onToggleStats,
}: PreviewCanvasMountProps) {
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
        <div className="preview-top-right-overlays">
          <div
            ref={setSceneGizmoToolbarTarget}
            className="preview-scene-gizmo-toolbar-slot"
          />
          <PreviewStatsOverlay
            resolution={effectiveResolution}
            expanded={statsExpanded}
            onToggle={onToggleStats}
          />
        </div>

        <div
          ref={canvasWrapperRef}
          className={`preview-canvas-wrapper ${showTransparencyGrid ? 'show-transparency-grid' : ''}`}
          style={viewTransform}
        >
          {engineInitFailed ? (
            <div className="loading">
              <p style={{ color: '#ff6b6b', fontWeight: 'bold', marginBottom: 8 }}>WebGPU Initialization Failed</p>
              <p style={{ fontSize: '0.85em', opacity: 0.8, maxWidth: 400, textAlign: 'center', lineHeight: 1.5 }}>
                {engineInitError || 'Unknown error'}
              </p>
              <p style={{ fontSize: '0.75em', opacity: 0.5, marginTop: 12 }}>
                {'Try: chrome://flags \u2192 #enable-unsafe-webgpu \u2192 Enabled'}
              </p>
            </div>
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
                style={{
                  width: canvasSize.width,
                  height: canvasSize.height,
                }}
              />
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
                  canSetObjectOrbitPivot={editCameraModeActive}
                  onSetObjectOrbitPivot={focusEditCameraOnSceneObject}
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

        {layerTransformMode && isEngineReady && (
          <canvas
            ref={overlayRef}
            width={containerSize.width || 100}
            height={containerSize.height || 100}
            className="preview-overlay-fullscreen"
            onMouseDown={handleOverlayMouseDown}
            onMouseMove={handleOverlayMouseMove}
            onMouseUp={handleOverlayMouseUp}
            onMouseLeave={handleOverlayMouseUp}
            onDoubleClick={textClipEditMode ? () => setTextTyping(true) : undefined}
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

        <PreviewEditHints
          editCameraOrthoHint={editCameraOrthoHint}
          effectiveSceneNavFpsMode={effectiveSceneNavFpsMode}
          isEditableSource={isEditableSource}
          layerTransformMode={layerTransformMode}
          maskNavigationMode={maskNavigationMode}
          sceneNavEnabled={sceneNavEnabled}
          textClipEditMode={textClipEditMode}
          textTypingActive={textTypingActive}
        />

        <PreviewBottomControls
          showTransparencyGrid={showTransparencyGrid}
          onToggleTransparency={toggleTransparency}
          previewQuality={previewQuality}
          setPreviewQuality={setPreviewQuality}
          qualityOpen={qualityOpen}
          setQualityOpen={setQualityOpen}
          qualityDropdownRef={qualityDropdownRef}
        />
      </div>
    </>
  );
}
