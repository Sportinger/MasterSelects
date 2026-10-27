// The phone's main preview: the editor's real engine output, registered as an ordinary
// activeComp render target. PhoneRuntimeHost owns the single useEngine() call; this component
// only owns its canvas, its registration and its aspect-fit sizing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePreviewRenderTargetRegistration } from '../../preview/usePreviewRenderTargetRegistration';
import { resolvePreviewRenderQuality } from '../../../hooks/engine/useEngineResolutionSync';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { useEngineStore } from '../../../stores/engineStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { RenderSource } from '../../../types/renderTarget';
import { PHONE_TEST_IDS } from '../contracts';
import './PhonePreview.css';

export const PHONE_PREVIEW_TARGET_ID = 'phone-main-preview';

interface Size {
  width: number;
  height: number;
}

function fitSize(container: Size, aspect: number): Size {
  if (container.width <= 0 || container.height <= 0 || !(aspect > 0)) return { width: 0, height: 0 };
  if (container.width / container.height > aspect) {
    return { width: Math.floor(container.height * aspect), height: Math.floor(container.height) };
  }
  return { width: Math.floor(container.width), height: Math.floor(container.width / aspect) };
}

function useCompositionResolution(): Size {
  const comp = useMediaStore((state) => state.compositions.find((c) => c.id === state.activeCompositionId));
  const output = useSettingsStore((state) => state.outputResolution);
  const width = comp?.width ?? output.width;
  const height = comp?.height ?? output.height;
  return useMemo(() => ({
    width: width > 0 ? width : 1920,
    height: height > 0 ? height : 1080,
  }), [width, height]);
}

export function PhonePreview() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });

  const isEngineReady = useEngineStore((state) => state.isEngineReady);
  const engineInitFailed = useEngineStore((state) => state.engineInitFailed);
  const engineInitError = useEngineStore((state) => state.engineInitError);
  const engineSetupAdvice = useEngineStore((state) => state.engineInitSetupAdvice);
  const previewQuality = useSettingsStore((state) => state.previewQuality);
  const inMotion = useTimelineStore((state) => state.isPlaying || state.isDraggingPlayhead);
  const resolution = useCompositionResolution();

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

  const displaySize = fitSize(containerSize, resolution.width / resolution.height);
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

  return (
    <div
      ref={containerRef}
      className="phone-preview"
      role="region"
      aria-label="Preview"
      data-testid={PHONE_TEST_IDS.previewRegion}
      data-phone-preview="main"
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
          style={{ width: displaySize.width || '100%', height: displaySize.height || '100%' }}
        />
      )}
    </div>
  );
}
