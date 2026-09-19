import { ExportCanvasManager } from '../../src/engine/managers/ExportCanvasManager';

const output = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
button.onclick = async () => {
  button.disabled = true;
  output.textContent = 'Läuft …';
  let device: GPUDevice | undefined;
  const manager = new ExportCanvasManager();
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    device = await adapter.requestDevice();
    const gpuErrors: string[] = [];
    device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
    const width = 1920;
    const height = 1080;
    const count = 60;
    const runs = [];
    for (const mode of ['immediate', 'waited', 'manager'] as const) {
      manager.initExportCanvas(device, width, height);
      const frames: VideoFrame[] = [];
      let captureMs = 0;
      const start = performance.now();
      try {
        for (let i = 0; i < count; i++) {
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({ colorAttachments: [{
            view: manager.getExportCanvasContext()!.getCurrentTexture().createView(),
            clearValue: i % 2 ? { r: 0, g: 1, b: 0, a: 1 } : { r: 1, g: 0, b: 0, a: 1 },
            loadOp: 'clear', storeOp: 'store',
          }] });
          pass.end();
          device.queue.submit([encoder.finish()]);
          const captureStart = performance.now();
          if (mode === 'waited') await device.queue.onSubmittedWorkDone();
          const frame = mode === 'manager'
            ? await manager.createVideoFrameFromExport(device, i * 33_333, 33_333)
            : new VideoFrame(manager.getExportCanvas()!, { timestamp: i * 33_333, duration: 33_333, alpha: 'discard' });
          captureMs += performance.now() - captureStart;
          if (!frame) throw new Error(`${mode}: no frame ${i}`);
          frames.push(frame);
        }
        await device.queue.onSubmittedWorkDone();
        const pipelineMs = performance.now() - start;
        let pixelFailures = 0;
        for (let i = 0; i < frames.length; i++) {
          const pixels = new Uint8Array(4);
          await frames[i].copyTo(pixels, { format: 'RGBA', rect: { x: 20, y: 20, width: 1, height: 1 } });
          const expected = i % 2 ? [0, 255, 0, 255] : [255, 0, 0, 255];
          if (pixels.some((value, channel) => Math.abs(value - expected[channel]) > 2)) pixelFailures++;
        }
        let encodedChunks = 0;
        let encodedBytes = 0;
        const encodeErrors: string[] = [];
        const videoEncoder = new VideoEncoder({
          output: chunk => { encodedChunks++; encodedBytes += chunk.byteLength; },
          error: error => encodeErrors.push(error.message),
        });
        try {
          videoEncoder.configure({ codec: 'avc1.640028', width, height, bitrate: 8_000_000, framerate: 30 });
          for (const frame of frames) videoEncoder.encode(frame);
          await videoEncoder.flush();
        } finally { videoEncoder.close(); }
        runs.push({ mode, frames: frames.length, pixelFailures, captureMs: Math.round(captureMs), pipelineMs: Math.round(pipelineMs), encodedChunks, encodedBytes, encodeErrors });
      } finally { frames.forEach(frame => frame.close()); manager.cleanupExportCanvas(); }
    }
    // Reproduce the former nullable-field access after a yield, then exercise
    // the actual manager with the same cleanup timing. No user project is used.
    manager.initExportCanvas(device, 16, 16);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: manager.getExportCanvasContext()!.getCurrentTexture().createView(),
      clearValue: { r: 1, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
    }] });
    pass.end();
    device.queue.submit([encoder.finish()]);
    const fixedCapture = manager.createVideoFrameFromExport(device, 0, 33_333);
    const oldCompletion = device.queue.onSubmittedWorkDone();
    manager.cleanupExportCanvas();
    await oldCompletion;
    let legacyCleanupError: string | null = null;
    try { new VideoFrame(manager.getExportCanvas()!, { timestamp: 0 }).close(); }
    catch (error) { legacyCleanupError = String(error); }
    const retained = await fixedCapture;
    let retainedPixel: number[] | null = null;
    if (retained) {
      try {
        const pixel = new Uint8Array(4);
        await retained.copyTo(pixel, { format: 'RGBA', rect: { x: 0, y: 0, width: 1, height: 1 } });
        retainedPixel = [...pixel];
      } finally { retained.close(); }
    }
    output.textContent = JSON.stringify({ browser: navigator.userAgent, runs, legacyCleanupError, retainedPixel, gpuErrors }, null, 2);
  } catch (error) {
    output.textContent = String(error);
  } finally { manager.cleanupExportCanvas(); device?.destroy(); button.disabled = false; }
};
