// The phone's main preview: the editor's real engine output, registered as an ordinary
// activeComp render target. PhoneRuntimeHost owns the single useEngine() call; this component
// owns its canvas, its registration, its fit / actual-pixels sizing and the overlays laid over the
// picture (clip handles, mask pen, shape path, rulers and guides, compare line, view button).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePreviewRenderTargetRegistration } from '../../preview/usePreviewRenderTargetRegistration';
import { PreviewRulers } from '../../preview/PreviewRulers';
import { resolvePreviewRenderQuality } from '../../../hooks/engine/useEngineResolutionSync';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { useEngineStore } from '../../../stores/engineStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { RenderSource } from '../../../types/renderTarget';
import { PHONE_TEST_IDS } from '../contracts';
import { PhoneShapePathOverlay } from '../animation/PhoneShapePathOverlay';
import { usePhoneShapePathStore } from '../animation/phoneShapePathStore';
import { PhoneMaskPenOverlay } from '../mask/PhoneMaskPenOverlay';
import { usePhonePenStore } from '../mask/phonePenStore';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneTouchDisplay } from './PhoneTouchDisplay';
import { PhoneFullscreenControls } from './PhoneFullscreenControls';
import { PhonePreviewPanSurface } from './PhonePreviewPanSurface';
import { PhoneSplitCompareHandle } from './PhoneSplitCompareHandle';
import { PhoneTransformGizmo } from './PhoneTransformGizmo';
import { clampPhonePan, phoneCanvasRect, type PhoneSize } from './phonePreviewGeometry';
import { PHONE_PREVIEW_VIEW_TEST_IDS as VIEW_IDS } from './phonePreviewViewIds';
import { usePhonePreviewViewStore } from './phonePreviewViewStore';
import { usePhoneFullscreen } from './usePhoneFullscreen';
import './PhonePreview.css';
import './PhonePreviewOverlays.css';

export const PHONE_PREVIEW_TARGET_ID = 'phone-main-preview';
/** Free space (CSS px) beside or above the picture the View button needs. */
const VIEW_BUTTON_ROOM = 72;

function useCompositionResolution(): PhoneSize & { id: string | null } {
  const comp = useMediaStore((state) => state.compositions.find((c) => c.id === state.activeCompositionId));
  const output = useSettingsStore((state) => state.outputResolution);
  const width = comp?.width ?? output.width;
  const height = comp?.height ?? output.height;
  const id = comp?.id ?? null;
  return useMemo(() => ({
    id,
    width: width > 0 ? width : 1920,
    height: height > 0 ? height : 1080,
  }), [id, width, height]);
}

export function PhonePreview() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerSize, setContainerSize] = useState<PhoneSize>({ width: 0, height: 0 });

  const isEngineReady = useEngineStore((state) => state.isEngineReady);
  const engineInitFailed = useEngineStore((state) => state.engineInitFailed);
  const engineInitError = useEngineStore((state) => state.engineInitError);
  const engineSetupAdvice = useEngineStore((state) => state.engineInitSetupAdvice);
  const previewQuality = useSettingsStore((state) => state.previewQuality);
  const inMotion = useTimelineStore((state) => state.isPlaying || state.isDraggingPlayhead);
  const resolution = useCompositionResolution();
  const fullscreen = usePhoneFullscreen(containerRef, resolution.width > resolution.height);
  const sheetOpen = usePhoneUiStore((state) => state.activeSheet !== null);
  const openSheet = usePhoneUiStore((state) => state.openSheet);
  const penActive = usePhonePenStore((state) => state.active);
  const shapePathActive = usePhoneShapePathStore((state) => state.active);
  const handlesOn = usePhonePreviewViewStore((state) => state.handles);
  const rulersOn = usePhonePreviewViewStore((state) => state.rulers);
  const zoom = usePhonePreviewViewStore((state) => state.zoom);
  const pan = usePhonePreviewViewStore((state) => state.pan);

  const stableRenderSource = useMemo<RenderSource>(() => ({ type: 'activeComp' }), []);
  const setCompReady = useCallback((_ready: boolean) => {}, []);

  usePreviewRenderTargetRegistration({
    canvasRef,
    isEngineReady,
    panelId: PHONE_PREVIEW_TARGET_ID,
    setCompReady,
    showTransparencyGrid: false,
    stableRenderSource,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      setContainerSize((previous) => (
        previous.width === width && previous.height === height ? previous : { width, height }
      ));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Drawing on the picture (mask pen, shape path) needs the whole frame: those modes show it fitted.
  const actual = zoom === 'actual' && !fullscreen && !penActive && !shapePathActive;
  const rect = phoneCanvasRect(containerSize, resolution, actual, pan);
  const offset = actual ? clampPhonePan(pan, rect, containerSize) : { x: 0, y: 0 };
  const clampPan = (next: { x: number; y: number }) => clampPhonePan(next, rect, containerSize);
  // Same backing policy as the desktop preview: the output pass scales to any canvas size, so
  // back the canvas at render resolution. Worker hosts own a transferred canvas.
  const backing = renderHostPort.getTelemetry().mode === 'main'
    ? (() => {
        const quality = resolvePreviewRenderQuality(resolution.width, resolution.height, previewQuality, inMotion);
        return {
          width: Math.max(1, Math.round(resolution.width * quality)),
          height: Math.max(1, Math.round(resolution.height * quality)),
        };
      })()
    : resolution;
  const live = isEngineReady && !engineInitFailed;
  const showGizmo = live && !fullscreen && !sheetOpen && !actual && handlesOn;
  // The View button sits beside or above the picture, never on it (All tools → Preview view always
  // reaches the same sheet). In actual-pixels view it is the way back, so it always shows there.
  const viewButtonFits = actual || containerSize.width - (rect.x + rect.width) >= VIEW_BUTTON_ROOM || rect.y >= VIEW_BUTTON_ROOM;

  return (
    <div
      ref={containerRef}
      className="phone-preview"
      role="region"
      aria-label="Preview"
      data-testid={PHONE_TEST_IDS.previewRegion}
      data-phone-preview="main"
      data-fullscreen={fullscreen ? 'true' : 'false'}
      data-zoom={actual ? 'actual' : 'fit'}
    >
      {engineInitFailed ? (
        <div className="phone-preview__notice phone-preview__notice--error" role="alert" aria-live="assertive">
          <strong className="phone-preview__notice-title">Preview unavailable</strong>
          <span>{engineInitError || 'The WebGPU preview renderer could not be initialized.'}</span>
          {engineSetupAdvice && (
            <span className="phone-preview__notice-help">
              Check that hardware acceleration is enabled in your browser.
            </span>
          )}
        </div>
      ) : !isEngineReady ? (
        <div className="phone-preview__notice" role="status" aria-live="polite">
          <span className="phone-preview__spinner" aria-hidden="true" />
          <span>Starting preview…</span>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="phone-preview__canvas"
          data-testid={PHONE_TEST_IDS.previewCanvas}
          role="img"
          aria-label="Composition preview"
          width={backing.width}
          height={backing.height}
          style={actual
            ? { width: rect.width, height: rect.height, maxWidth: 'none', maxHeight: 'none', flex: 'none', transform: `translate(${offset.x}px, ${offset.y}px)` }
            : { width: rect.width || '100%', height: rect.height || '100%' }}
        />
      )}
      {live && actual ? <PhonePreviewPanSurface clampPan={clampPan} /> : null}
      {showGizmo ? <PhoneTransformGizmo rect={rect} compWidth={resolution.width} compHeight={resolution.height} /> : null}
      {live && !fullscreen ? (
        <PhoneMaskPenOverlay width={rect.width} height={rect.height} compWidth={resolution.width} compHeight={resolution.height} />
      ) : null}
      {live && !fullscreen ? <PhoneShapePathOverlay rect={rect} compWidth={resolution.width} compHeight={resolution.height} /> : null}
      {live && !fullscreen ? <PhoneSplitCompareHandle rect={rect} /> : null}
      {live && !fullscreen && rulersOn && rect.width > 0 ? (
        <div className="phone-preview-rulers" data-testid={VIEW_IDS.rulersHost}>
          <PreviewRulers
            canvasInContainer={rect}
            containerSize={containerSize}
            compositionWidth={resolution.width}
            compositionHeight={resolution.height}
            compositionId={resolution.id}
          />
        </div>
      ) : null}
      {live && !fullscreen && !sheetOpen && viewButtonFits ? (
        <button
          type="button"
          className="phone-preview-view-button"
          data-testid={VIEW_IDS.viewButton}
          aria-label="Preview view: handles, rulers, guides, 1:1 and compare"
          data-rulers={rulersOn ? 'true' : undefined}
          onPointerUp={(event) => event.currentTarget.blur()}
          onClick={() => openSheet('preview-view')}
        >
          {actual ? '1:1' : 'View'}
        </button>
      ) : null}
      {fullscreen ? <PhoneFullscreenControls /> : null}
      <PhoneTouchDisplay />
    </div>
  );
}
