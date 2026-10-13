import { useEffect, useRef, useState } from 'react';
import type { MediaFile } from '../../../stores/mediaStore';
import { getCodecProviderDescriptor, type CodecRuntimeFrameProvider } from '../../../services/mediaRuntime/codec/codecProviderDescriptors';
import { drawCodecFrame } from '../../../services/mediaRuntime/codec/drawCodecFrame';
import { isCodecProviderPlan, selectRuntimeFrameProviderPlan } from '../../../services/mediaRuntime/providerSelection';
import { flags } from '../../../engine/featureFlags';

/** Dieselbe Decoder-Auswahl wie im großen Quellmonitor; Hover bleibt stumm. */
export function CodecHoverPreview({ file }: { file: MediaFile }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const plan = selectRuntimeFrameProviderPlan({ videoCodecId: file.videoCodecId, turboResEnabled: flags.turboResProRes });
    if (!isCodecProviderPlan(plan) || !file.file) return;
    let disposed = false;
    let provider: CodecRuntimeFrameProvider | null = null;
    let request = 0;
    let anchor = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const frame = provider?.getCurrentFrame();
      if (!canvas || !frame || disposed) return;
      const ctx = canvas.getContext('2d');
      if (ctx) drawCodecFrame(ctx, frame, canvas.width, canvas.height, provider?.getSourceRotationDegrees?.() ?? 0);
    };
    const tick = (now: number) => {
      if (disposed) return;
      if (!anchor) anchor = now;
      provider?.advanceToTime?.(((now - anchor) / 1000) % Math.max(0.01, file.duration ?? 1));
      request = requestAnimationFrame(tick);
    };
    void getCodecProviderDescriptor(plan.backend).create({
      sourceId: `hover:${file.id}`, file: file.file, plan, policy: 'background', outputProfile: 'sdr',
      onFrame: draw, onError: err => { if (!disposed) setError(err.message); },
    }).then(async value => {
      if (disposed) { await value?.destroyAsync(); return; }
      provider = value;
      if (!provider) { setError('Video konnte nicht geöffnet werden.'); return; }
      await provider.seekExact(0);
      if (!disposed) { draw(); request = requestAnimationFrame(tick); }
    }).catch(err => { if (!disposed) setError(String(err)); });
    return () => { disposed = true; cancelAnimationFrame(request); void provider?.destroyAsync(); };
  }, [file.id, file.file, file.videoCodecId, file.duration]);
  const scale = Math.min(1, 240 / (file.width || 1920), 170 / (file.height || 1080));
  return error ? <span role="status">{error}</span> : <canvas ref={canvasRef}
    width={Math.max(1, Math.round((file.width || 1920) * scale))}
    height={Math.max(1, Math.round((file.height || 1080) * scale))} />;
}
