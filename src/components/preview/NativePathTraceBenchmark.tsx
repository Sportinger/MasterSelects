import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getNativeSceneRenderer } from '../../engine/native3d/NativeSceneRenderer';
import { NativeHelperClient } from '../../services/nativeHelper/NativeHelperClient';
import type { OptixMetrics } from '../../services/nativeHelper/nativeHelperOptixCommands';
import type { PtBenchmarkImage } from '../../engine/native3d/pathtrace/native/ptReferenceBenchmark';
import { comparePtImages } from '../../engine/native3d/pathtrace/native/ptImageComparison';
import './NativePathTraceBenchmark.css';

type Result = { reference: PtBenchmarkImage; native: Float32Array; metrics: OptixMetrics; exposure: number; transferMs: number;
  difference: ReturnType<typeof comparePtImages> };
function BenchmarkCanvas({ pixels, width, height, exposure, label }: { pixels: Float32Array; width: number; height: number; exposure: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d'); if (!context) return;
    const image = context.createImageData(width, height);
    const srgb = (value: number) => value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055;
    for (let i = 0; i < pixels.length; i += 4) {
      const coverage = pixels[i + 3];
      for (let channel = 0; channel < 3; channel++) {
        const linear = Math.max(0, pixels[i + channel] / Math.max(coverage, 1e-8) * exposure);
        image.data[i + channel] = Math.round(Math.min(1, srgb(linear)) * 255);
      }
      image.data[i + 3] = Math.round(Math.max(0, Math.min(1, coverage)) * 255);
    }
    context.putImageData(image, 0, 0);
  }, [pixels, width, height, exposure]);
  return <figure><figcaption>{label}</figcaption><canvas ref={canvas} width={width} height={height} aria-label={label} /></figure>;
}
const ms = (value: number | null) => value === null ? 'unavailable' : `${value.toFixed(1)} ms`;

export function NativePathTraceBenchmark() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [phase, setPhase] = useState('');
  const [error, setError] = useState(''), [result, setResult] = useState<Result | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), running = useRef(false);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const run = async (samples: number) => {
    if (running.current) return; running.current = true; setBusy(true); setOpen(true); setResult(null); setError('');
    let capture: Awaited<ReturnType<ReturnType<typeof getNativeSceneRenderer>['beginNativeBenchmark']>> | undefined;
    let jobId: string | undefined;
    try {
      setPhase('Connecting to native helper…');
      if (!await NativeHelperClient.connect()) throw new Error('Start the native helper with the optional OptiX worker installed.');
      const job = await NativeHelperClient.optix.begin(); jobId = job.jobId;
      setPhase('Capturing the paused fiber scene…'); const transferStart = performance.now();
      capture = await getNativeSceneRenderer().beginNativeBenchmark();
      if (!await NativeHelperClient.writeFileBinary(job.inputPath, capture.snapshot)) throw new Error('Scene upload failed');
      const transferMs = performance.now() - transferStart;
      setPhase('OptiX: building the scene and rendering…'); const native = await NativeHelperClient.optix.render(jobId, samples);
      const reference = await capture.reference(samples, setPhase);
      const difference = comparePtImages(reference.pixels, native.pixels);
      if (difference.nonFinite) throw new Error('Non-finite pixels in the renderer comparison');
      setResult({ reference, native: native.pixels, metrics: native.metrics, exposure: capture.exposure, transferMs, difference });
      setPhase('Comparison complete');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPhase('Comparison stopped'); }
    finally {
      capture?.release();
      if (jobId) await NativeHelperClient.optix.discard(jobId).catch(() => undefined);
      running.current = false; setBusy(false);
    }
  };
  return <>
    <button type="button" className="preview-edit-btn" onPointerUp={event => event.currentTarget.blur()}
      title="Experimental native OptiX comparison: paused fiber scenes, 1 sample, identical camera and lighting"
      onClick={() => void run(1)}>OptiX test</button>
    {open && createPortal(<dialog ref={dialog} className="native-pt-benchmark" aria-label="Native path tracing comparison"
      onCancel={event => { if (busy) event.preventDefault(); else setOpen(false); }}>
      <div className="native-pt-benchmark-heading"><strong>Native path tracing comparison</strong>
        <button type="button" disabled={busy} onPointerUp={event => event.currentTarget.blur()} onClick={() => { dialog.current?.close(); setOpen(false); }}>Close</button></div>
      <p role="status">{phase}</p>{error && <p role="alert">{error}</p>}
      {result && <>
        <p>{result.metrics.gpu} · {result.metrics.segments.toLocaleString()} fibers · {result.metrics.width} × {result.metrics.height} · {result.metrics.samples} spp · no denoising</p>
        <div className="native-pt-benchmark-images">
          <BenchmarkCanvas pixels={result.reference.pixels} width={result.reference.width} height={result.reference.height} exposure={result.exposure} label="WebGPU reference" />
          <BenchmarkCanvas pixels={result.native} width={result.metrics.width} height={result.metrics.height} exposure={result.exposure} label="Native OptiX" />
        </div>
        <table><thead><tr><th>Measured stage</th><th>WebGPU</th><th>OptiX</th></tr></thead><tbody>
          <tr><td>GPU rendering</td><td>{ms(result.reference.gpuMs)}</td><td>{ms(result.metrics.gpuMs)}</td></tr>
          <tr><td>Rendering including desktop pauses</td><td>{ms(result.reference.wallMs)}</td><td>{ms(result.metrics.renderWallMs)}</td></tr>
          <tr><td>Native initialization</td><td>—</td><td>{ms(result.metrics.initializationMs)}</td></tr>
          <tr><td>Acceleration structure build</td><td>existing preview BVH</td><td>{ms(result.metrics.buildMs)}</td></tr>
          <tr><td>Browser capture and transfer</td><td>—</td><td>{ms(result.transferMs)}</td></tr>
          <tr><td>Native process total</td><td>—</td><td>{ms(result.metrics.totalMs)}</td></tr>
        </tbody></table>
        <p>Linear RGB relative RMSE: {(result.difference.relativeRmse * 100).toFixed(3)}% · Coverage mean error: {(result.difference.coverageMae * 100).toFixed(4)}%</p>
        <p>Mean coverage (WebGPU / OptiX): {result.difference.meanCoverage?.map(value => `${(value * 100).toFixed(3)}%`).join(' / ')} · Mean linear luminance: {result.difference.meanLuminance?.map(value => value.toFixed(5)).join(' / ')}</p>
        <p>Both render the captured fibers with the same camera, hair material, lights and sample sequence. The prototype supports fiber geometry and constant environments.</p>
      </>}
      {!busy && <button type="button" onPointerUp={event => event.currentTarget.blur()} onClick={() => void run(4)}>Compare 4 samples</button>}
      {!busy && <button type="button" onPointerUp={event => event.currentTarget.blur()} onClick={() => void run(16)}>Compare 16 samples</button>}
    </dialog>, document.body)}
  </>;
}
