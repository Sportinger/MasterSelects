import { nativeSceneFixture } from '../fixtures/workerNativeScene';
import { presentGpuFrameStack, releaseWorkerGpuVideoFrameCompositorResources } from '../../src/services/render/workerGpuVideoFrameCompositor';
import type { WorkerGpuTargetSurface } from '../../src/services/render/workerGpuTargetSurface';
import type { WorkerGpuNativeSceneLayer, WorkerGpuNativeScenePayload } from '../../src/services/render/workerGpuNativeSceneContract';
import { assertWorkerGpuPresentFrameStackCommand, type WorkerGpuPresentFrameStackCommand } from '../../src/services/render/workerGpuRuntimeCommands';
import { projectNativeSceneLayers } from '../../src/services/render/workerGpuNativeSceneProjection';
import { buildWorkerGpuFrameStackProjectionRequest } from '../../src/services/render/workerGpuFrameStackHostProjection';
import { projectWorkerGpuFrameStack } from '../../src/services/render/workerGpuFrameStackProjector';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import type { Layer } from '../../src/types/layers';
import type { WorkerGpuNativeAudioInput } from '../../src/services/render/workerGpuNativeAudioContract';

function hostLayers(payload: WorkerGpuNativeScenePayload): Layer[] {
  const layers = [...payload.layers].reverse().map((layer): Layer => {
    const matrix = layer.worldMatrix;
    let source: Layer['source'];
    if (layer.kind === 'primitive') source = { type: 'model', meshType: layer.meshType };
    else if (layer.kind === 'light') source = { type: 'light', lightSettings: { ...layer.lightSettings } };
    else {
      const compiled = compileFlockDefinition(layer.definition);
      if (!compiled.ok) throw new Error('Invalid probe graph');
      source = { type: 'flock', flock: { clipId: layer.clipId, definition: layer.definition, program: compiled.program,
        diagnostics: [], keyframes: layer.keyframes, sourceTime: layer.sourceTime, consumer: 'preview' } };
    }
    return { id: layer.layerId, sourceClipId: layer.clipId, name: layer.layerId, visible: true, opacity: layer.opacity,
      blendMode: 'normal', source, is3D: true, effects: [], rotation: 0,
      position: { x: matrix[12], y: matrix[13], z: matrix[14] }, scale: { x: matrix[0], y: matrix[5], z: matrix[10] } };
  });
  layers.push({ id: 'background', sourceClipId: 'background', name: 'background', visible: true, opacity: 1,
    blendMode: 'normal', source: { type: 'solid', color: '#1020a0' }, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, effects: [] });
  return layers;
}

/** Production frame-stack compositor, persistent scene owner and exact readback. */
export async function renderNativeFrameStackProbe(surface: WorkerGpuTargetSurface, assetUrls: string[], audioCurves: NonNullable<WorkerGpuNativeAudioInput['curve']>[]): Promise<Uint8Array[]> {
  const images: Uint8Array[] = [];
  try {
    for (let frame = 0; frame < 19; frame++) {
      const time = frame === 3 ? 0.05 : 0.2;
      const mode = frame >= 7 && frame < 9 ? 'model' : frame >= 5 && frame < 7 ? 'image' : undefined;
      const fixture = nativeSceneFixture(time, Date.now(), `native-frame-${frame}`, mode, frame >= 9 && frame < 13);
      const { payload, admission } = fixture;
      if (frame >= 9 && frame < 13) Object.assign(payload.layers[0], { audioInputs: [{ clipId: 'music', sourceOffset: 0,
        curve: frame === 12 ? null : audioCurves[frame === 10 ? 1 : 0] }] });
      if (mode) Object.assign(payload, { assets: [{ kind: mode, id: `stack-${mode}`, url: assetUrls[frame - 5], fileName: mode === 'model' ? 'probe.obj' : 'probe.png' }] });
      if (frame > 0 && frame < 5) (payload.layers as WorkerGpuNativeSceneLayer[]).push({ kind: 'primitive', layerId: 'cube', clipId: 'cube',
        meshType: 'cube', opacity: 1, worldMatrix: [4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0.1, 0, 0, 0, frame === 1 ? 0.12 : 0.85, 1] });
      if (frame >= 13) Object.assign(payload, { layers: [
        { kind: 'primitive', layerId: 'cube', clipId: 'cube', meshType: 'cube', opacity: 1,
          worldMatrix: [4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0.1, 0, 0, 0, 0.5, 1] },
        { kind: 'light', layerId: 'light', clipId: 'light', opacity: 1,
          // Identity projection sees the near (-Z) cube face; aim the panel toward +Z.
          worldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, -2, 1],
          lightSettings: { kind: frame === 16 ? 'point' : frame === 17 ? 'panel' : 'environment',
            color: frame === 14 || frame === 18 ? '#ff2020' : '#2020ff', intensity: frame === 13 ? 0 : 2,
            diameter: 2, castsShadows: false, shadowStrength: 0.5 } },
      ] });
      const request = buildWorkerGpuFrameStackProjectionRequest({ layers: hostLayers(payload), width: 256, height: 256,
        frame: fixture.stack.frame, occurrenceNamespace: fixture.stack.occurrenceNamespace, intent: 'preview', surface: 'preview',
        nowMs: admission.nowMs, resolveVideoSource: () => null, projectNativeScene: input => {
          const projection = projectNativeSceneLayers(input, { ...payload.camera,
            viewMatrix: new Float32Array(payload.camera.viewMatrix), projectionMatrix: new Float32Array(payload.camera.projectionMatrix) })!;
          return { ...projection, source: { ...projection.source, payload: { ...projection.source.payload,
            layers: projection.source.payload.layers.map(layer => {
              if (layer.kind !== 'flock') return layer;
              const original = payload.layers.find(candidate => candidate.clipId === layer.clipId);
              return { ...layer, audioInputs: original?.kind === 'flock' ? original.audioInputs ?? [] : [] };
            }),
            assets: payload.assets ?? [] } } };
        } });
      const stack = await projectWorkerGpuFrameStack(request);
      const command: WorkerGpuPresentFrameStackCommand = { type: 'gpu.presentFrameStack', commandId: stack.frame.requestId, admission, stack,
          readback: { readbackId: `native-readback-${frame}`, targetId: stack.frame.targetId, compositionId: stack.frame.compositionId,
            timelineTime: time, frameIndex: stack.frame.frameIndex, width: 256, height: 256, format: 'rgba8unorm', colorSpace: 'srgb' } };
      assertWorkerGpuPresentFrameStackCommand(command);
      const result = await presentGpuFrameStack(surface, { clock: Date.now, webCodecsFrames: new Map(), command });
      if (!result.ok || !result.readback) throw new Error(`Native frame-stack failed: ${JSON.stringify(result.diagnostics)}`);
      const statuses = result.flockStatus?.occurrences[0]?.statuses;
      if (!statuses || result.flockStatus?.compositionId !== stack.frame.compositionId) throw new Error('Missing Worker Flock status snapshot');
      if (frame < 13 && (statuses.length !== 1 || statuses[0].state !== 'ready'
        || statuses[0].step !== statuses[0].targetStep || statuses[0].simulatedCount !== 512
        || Math.abs(statuses[0].sourceTime - time) > 1e-6 || !result.flockStatus.capabilities?.gpuCompute)) {
        throw new Error(`Worker Flock status does not match presented frame: ${JSON.stringify(statuses)}`);
      }
      if (frame >= 13 && statuses.length !== 0) throw new Error('Removed Flock clip retained Worker status');
      images.push(new Uint8Array(result.readback.pixels));
    }
    const green = images.slice(0, 3).map(pixels => {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > 20 && pixels[i + 1] > pixels[i] * 2 && pixels[i + 1] > pixels[i + 2] * 2) count++;
      return count;
    });
    if (green[0] < 100 || green[1] !== 0 || green[2] !== green[0]) throw new Error(`Frame-stack shared depth failed: ${green}`);
    if (images[0][2] < 100 || images[0][2] <= images[0][1] * 2) throw new Error('Native scene did not composite over the solid source');
    if (images[2].some((value, i) => value !== images[4][i])) throw new Error('Persistent frame-stack seek/replay changed pixels');
    const dominant = (pixels: Uint8Array, channel: number) => {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + channel] > 40 && pixels[i + channel] > pixels[i + 1 - channel] * 2 && pixels[i + channel] > pixels[i + 2] * 2) count++;
      return count;
    };
    if (dominant(images[5], 1) < 100 || dominant(images[6], 0) < 100 || dominant(images[6], 1) !== 0) throw new Error('Pigment URL replacement did not change sampled colors');
    if (dominant(images[7], 0) < 100 || dominant(images[8], 0) < 100
      || !images[7].some((value, i) => value !== images[8][i])) throw new Error('Model URL replacement did not change instance geometry');
    if (!images[9].some((value, i) => value !== images[10][i])) throw new Error('Audio did not drive particle simulation');
    for (const frame of [11, 12]) if (images[9].some((value, i) => value !== images[frame][i])) throw new Error('Audio change did not reset and replay simulation deterministically');
    for (const frame of [14, 15, 16, 17]) if (!images[13].some((value, i) => value !== images[frame][i])) throw new Error(`Light did not affect scene pixels: ${frame}`);
    if (!images[14].some((value, i) => value !== images[15][i])) throw new Error('Light color change did not affect scene pixels');
    if (images[14].some((value, i) => value !== images[18][i])) throw new Error('Light replay retained stale settings');
    return images;
  } finally { releaseWorkerGpuVideoFrameCompositorResources(surface); }
}
