import { engine } from '../../../engine/WebGPUEngine';

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

export async function ensureRenderForDiagnostics(): Promise<{
  requested: boolean;
  waitedMs: number;
}> {
  const startedAt = performance.now();
  engine.requestRender();

  // Give the render loop a short window to submit at least one fresh frame.
  await Promise.race([
    (async () => {
      await nextAnimationFrame();
      await nextAnimationFrame();
    })(),
    new Promise((resolve) => window.setTimeout(resolve, 80)),
  ]);

  return {
    requested: true,
    waitedMs: Math.round(performance.now() - startedAt),
  };
}
