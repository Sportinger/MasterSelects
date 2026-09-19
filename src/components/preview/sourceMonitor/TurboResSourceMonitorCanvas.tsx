import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TurboResProResFourCC } from '../../../services/mediaRuntime/prores/turboResCodecIdentity';
import type { HapVideoFourCC } from '../../../services/hap/hapCodecIdentity';
import {
  bindSourceRuntimeForOwner,
  releaseClipSourceRuntime,
} from '../../../services/mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from '../../../services/mediaRuntime/registry';
import { ensureRuntimeFrameProvider } from '../../../services/mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../../../services/mediaRuntime/types';

export interface TurboResSourceMonitorHandle {
  seek(timeSeconds: number): void;
  play(startSeconds: number, endSeconds: number): void;
  pause(): void;
}

interface TurboResSourceMonitorCanvasProps {
  file: MediaFile;
  sourceFile: File;
  /** Session-provider codec identity: classic ProRes or HAP. */
  fourCC: TurboResProResFourCC | HapVideoFourCC;
  style?: CSSProperties;
  onTimeChange(timeSeconds: number): void;
  onPlayingChange(playing: boolean): void;
  onTogglePlayback(): void;
}

function getCanvasSize(file: MediaFile): { width: number; height: number } {
  const sourceWidth = Math.max(1, file.width ?? 1920);
  const sourceHeight = Math.max(1, file.height ?? 1080);
  const scale = Math.min(1, 1920 / sourceWidth, 1080 / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export const TurboResSourceMonitorCanvas = forwardRef<
  TurboResSourceMonitorHandle,
  TurboResSourceMonitorCanvasProps
>(function TurboResSourceMonitorCanvas(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const providerRef = useRef<RuntimeFrameProvider | null>(null);
  const currentTimeRef = useRef(0);
  const playbackEndRef = useRef(0);
  const playbackAnchorRef = useRef({ clockMs: 0, sourceTime: 0 });
  const playingRef = useRef(false);
  const frameRequestRef = useRef(0);
  const callbacksRef = useRef({
    onPlayingChange: props.onPlayingChange,
    onTimeChange: props.onTimeChange,
  });
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    callbacksRef.current = {
      onPlayingChange: props.onPlayingChange,
      onTimeChange: props.onTimeChange,
    };
  }, [props.onPlayingChange, props.onTimeChange]);

  const drawCurrentFrame = () => {
    const frame = providerRef.current?.getCurrentFrame();
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    try {
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
    } catch (drawError) {
      setError(drawError instanceof Error ? drawError.message : String(drawError));
    }
  };

  const pause = () => {
    playingRef.current = false;
    providerRef.current?.pause();
    if (frameRequestRef.current) {
      cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = 0;
    }
    callbacksRef.current.onPlayingChange(false);
  };

  const tick = (clockMs: number) => {
    if (!playingRef.current) return;
    const anchor = playbackAnchorRef.current;
    const nextTime = anchor.sourceTime + Math.max(0, clockMs - anchor.clockMs) / 1000;
    if (nextTime >= playbackEndRef.current) {
      currentTimeRef.current = playbackEndRef.current;
      providerRef.current?.seek(playbackEndRef.current);
      callbacksRef.current.onTimeChange(playbackEndRef.current);
      pause();
      return;
    }
    currentTimeRef.current = nextTime;
    providerRef.current?.advanceToTime?.(nextTime);
    callbacksRef.current.onTimeChange(nextTime);
    frameRequestRef.current = requestAnimationFrame(tick);
  };

  useImperativeHandle(ref, () => ({
    seek(timeSeconds) {
      const safeTime = Math.max(0, timeSeconds);
      currentTimeRef.current = safeTime;
      playbackAnchorRef.current = { clockMs: performance.now(), sourceTime: safeTime };
      providerRef.current?.scrubSeek?.(safeTime);
    },
    play(startSeconds, endSeconds) {
      const safeStart = Math.max(0, startSeconds);
      const safeEnd = Math.max(safeStart, endSeconds);
      if (currentTimeRef.current < safeStart || currentTimeRef.current >= safeEnd) {
        currentTimeRef.current = safeStart;
        providerRef.current?.seek(safeStart);
        callbacksRef.current.onTimeChange(safeStart);
      }
      playbackEndRef.current = safeEnd;
      playbackAnchorRef.current = {
        clockMs: performance.now(),
        sourceTime: currentTimeRef.current,
      };
      if (!playingRef.current) {
        playingRef.current = true;
        callbacksRef.current.onPlayingChange(true);
        frameRequestRef.current = requestAnimationFrame(tick);
      }
    },
    pause,
  }));

  useEffect(() => {
    let disposed = false;
    const size = getCanvasSize(props.file);
    if (canvasRef.current) {
      canvasRef.current.width = size.width;
      canvasRef.current.height = size.height;
    }
    queueMicrotask(() => {
      if (!disposed) setError(null);
    });
    const ownerId = `source-monitor:${props.file.id}`;
    const source = bindSourceRuntimeForOwner({
      ownerId,
      source: {
        type: 'video',
        naturalDuration: props.file.duration,
        mediaFileId: props.file.id,
      },
      file: props.sourceFile,
      mediaFileId: props.file.id,
      sessionOwnerId: ownerId,
    });
    if (!source?.runtimeSourceId) {
      queueMicrotask(() => {
        if (!disposed) setError('Die Quelle konnte nicht an die MediaRuntime gebunden werden.');
      });
      return undefined;
    }
    mediaRuntimeRegistry.getRuntime(source.runtimeSourceId)?.updateMetadata({
      videoCodecId: props.fourCC,
    });

    void ensureRuntimeFrameProvider(source, 'interactive', currentTimeRef.current, {
      onFrame: drawCurrentFrame,
      onError: (providerError) => {
        if (!disposed) setError(providerError.message);
      },
    }).then((provider) => {
      if (disposed) {
        return;
      }
      if (!provider) {
        setError('Der Codec-Provider konnte diese Datei nicht öffnen.');
        return;
      }
      providerRef.current = provider;
      provider.seek(currentTimeRef.current);
    });

    return () => {
      disposed = true;
      pause();
      providerRef.current = null;
      releaseClipSourceRuntime({ id: ownerId, source });
    };
  }, [props.file, props.sourceFile, props.fourCC]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="source-monitor-video source-monitor-turbores-canvas"
        style={props.style}
        onClick={props.onTogglePlayback}
        aria-label={`ProRes source preview: ${props.file.name}`}
      />
      {error && <div className="source-monitor-provider-error" role="status">{error}</div>}
    </>
  );
});
