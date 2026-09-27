import { renderFlockProbe, type FlockWorkerProbeInput } from './flock-worker-render-probe';

self.onmessage = async (event: MessageEvent<FlockWorkerProbeInput>) => {
  try {
    const result = await renderFlockProbe(event.data);
    self.postMessage({ success: true, result }, { transfer: [...result.images.map(image => image.buffer), result.particles.buffer] });
  } catch (error) { self.postMessage({ success: false, error: String(error) }); }
};
