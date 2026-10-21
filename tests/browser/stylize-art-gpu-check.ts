import common from '../../src/effects/_shared/commonShader';
import { getDefaultParams } from '../../src/effects';
import { sheen } from '../../src/effects/stylize/sheen';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { PixelParticleDisintegrateRenderer } from '../../src/engine/particles/PixelParticleDisintegrateRenderer';
import type { Effect } from '../../src/types/effects';

/**
 * GPU checks of the hand-written Stylize shaders (no graph reference exists for them):
 * Pixel Particle Disintegrate through its real renderer (flat, particle and resolve passes) and
 * Sheen through its registered fragment shader. Every expectation is plain arithmetic on the
 * source texels, not a copy of the shader code.
 */
const ROW_PITCH = 256;
const RENDER = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;

async function readTexture(device: GPUDevice, encoder: GPUCommandEncoder, texture: GPUTexture, width: number, height: number, bytesPerPixel = 4) {
  const bytesPerRow = Math.ceil(width * bytesPerPixel / ROW_PITCH) * ROW_PITCH;
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(buffer.getMappedRange()).slice(); buffer.unmap(); buffer.destroy();
  return { bytes, bytesPerRow };
}

function sourceTexture(device: GPUDevice, width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const pitch = Math.ceil(width * 4 / ROW_PITCH) * ROW_PITCH, data = new Uint8Array(pitch * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), y * pitch + x * 4);
  const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture }, data, { bytesPerRow: pitch }, [width, height]);
  return { texture, data, pitch };
}

/** One particle render (flat + particles + resolve) of `params` over a `width` x `height` source. */
async function renderParticles(device: GPUDevice, renderer: PixelParticleDisintegrateRenderer, source: GPUTexture, width: number, height: number,
  params: Record<string, unknown>) {
  const accumulation = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: RENDER });
  const output = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: RENDER });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const effect = { id: 'particles', type: 'pixel-particle-disintegrate', name: 'Particles', enabled: true,
    params: { ...getDefaultParams('pixel-particle-disintegrate'), ...params } } as unknown as Effect;
  const encoder = device.createCommandEncoder();
  renderer.render({ commandEncoder: encoder, sampler, sourceView: source.createView(), accumulationView: accumulation.createView(), outputView: output.createView(),
    outputWidth: width, outputHeight: height, effect, motionTime: 0, quality: 'export' });
  const result = await readTexture(device, encoder, output, width, height);
  accumulation.destroy(); output.destroy();
  return result;
}

/** Particles that stay exactly on their cell: no flight, no growth, no fade, square shape. */
const STILL = { spread: 0, depth: 0, spin: 0, particleSize: 1, fade: 0, shape: 'square' } as const;

/** Longest straight run of a release-mask border along rows or columns, in cells (1 cell = 1 px here). */
export function longestStraightBorder(mask: (x: number, y: number) => boolean, width: number, height: number): number {
  let longest = 0;
  for (let y = 0; y + 1 < height; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) { run = mask(x, y) !== mask(x, y + 1) ? run + 1 : 0; longest = Math.max(longest, run); }
  }
  for (let x = 0; x + 1 < width; x++) {
    let run = 0;
    for (let y = 0; y < height; y++) { run = mask(x, y) !== mask(x + 1, y) ? run + 1 : 0; longest = Math.max(longest, run); }
  }
  return longest;
}

async function checkParticles(device: GPUDevice): Promise<{ comparisons: number; longest: number }> {
  const renderer = new PixelParticleDisintegrateRenderer(device);
  let comparisons = 0;
  try {
    // (a)+(b) 64 x 48 with 8 x 8 px cells (Cell Size counts 1080p px: 8 * 1080 / 48 = 180), alpha 128..255.
    const width = 64, height = 48, cell = 8 * 1080 / height;
    const { texture, data, pitch } = sourceTexture(device, width, height, (x, y) => [(x * 37 + y * 11) % 256, (x * 5 + y * 71) % 256, (x * y) % 256, 128 + ((x * 13 + y * 7) % 128)]);
    for (const [name, progress] of [['progress 0', 0], ['progress 0.5', 0.5]] as const) {
      const { bytes, bytesPerRow } = await renderParticles(device, renderer, texture, width, height, { ...STILL, cellSize: cell, progress });
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const s = y * pitch + x * 4, o = y * bytesPerRow + x * 4, alpha = data[s + 3] / 255;
        // Premultiplied rgba8 accumulation rounds colour by up to 0.5 / alpha levels.
        const tolerance = Math.ceil(0.5 / alpha) + 1;
        if (Math.abs(bytes[o + 3] - data[s + 3]) > 1) throw new Error(`particles ${name}: alpha ${bytes[o + 3]} at ${x},${y}, source ${data[s + 3]} (hole or double draw)`);
        for (let c = 0; c < 3; c++) if (Math.abs(bytes[o + c] - data[s + c]) > tolerance) {
          throw new Error(`particles ${name}: channel ${c} = ${bytes[o + c]} at ${x},${y}, source ${data[s + c]}`);
        }
      }
      comparisons++;
    }
    texture.destroy();

    // (c) Opaque red inside a transparent border, particles in flight: no darkened or tinted edge.
    const red = sourceTexture(device, 96, 64, (x, y) => x >= 16 && x < 80 && y >= 12 && y < 52 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
    for (const shape of ['soft-circle', 'square', 'shard']) {
      const { bytes, bytesPerRow } = await renderParticles(device, renderer, red.texture, 96, 64, { progress: 0.55, cellSize: 4 * 1080 / 64, shape, softness: 0 });
      for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
        const o = y * bytesPerRow + x * 4;
        if (bytes[o + 3] >= 8 && (bytes[o] < 250 || bytes[o + 1] > 4 || bytes[o + 2] > 4)) {
          throw new Error(`particles ${shape}: dark or tinted fringe at ${x},${y}: ${[...bytes.slice(o, o + 4)].join(',')}`);
        }
      }
      comparisons++;
    }
    red.texture.destroy();

    // (d) Release mask without straight lattice borders: a 240 x 135 grid of 2 px cells; with the
    // shortest Tail a released particle is at once shrunk to nothing (its centre sits between pixel
    // centres, so it covers none), so the alpha is the mask of cells still in place. Wind Sweep 0
    // leaves only the gust and detail fields.
    const mw = 480, mh = 270, white = sourceTexture(device, mw, mh, () => [255, 255, 255, 255]);
    let longest = 0;
    for (const seed of [1, 7, 23]) for (const progress of [0.5, 0.6, 0.7]) {
      const { bytes, bytesPerRow } = await renderParticles(device, renderer, white.texture, mw, mh,
        { ...STILL, particleSize: 0.01, tail: 0.02, stagger: 0.95, windSweep: 0, cellSize: 8, progress, seed });
      const mask = (x: number, y: number) => bytes[y * 2 * bytesPerRow + x * 2 * 4 + 3] > 127;
      let inPlace = 0;
      for (let y = 0; y < mh / 2; y++) for (let x = 0; x < mw / 2; x++) if (mask(x, y)) inPlace++;
      // A useful mask has both released cells and cells in place.
      if (inPlace < 0.05 * 240 * 135 || inPlace > 0.95 * 240 * 135) throw new Error(`particle release mask at progress ${progress}: ${inPlace} of ${240 * 135} cells in place`);
      longest = Math.max(longest, longestStraightBorder(mask, mw / 2, mh / 2));
      comparisons++;
    }
    white.texture.destroy();
    if (longest > PARTICLE_STRAIGHT_BORDER_LIMIT) throw new Error(`particle release mask has a straight border of ${longest} cells (limit ${PARTICLE_STRAIGHT_BORDER_LIMIT})`);
    return { comparisons, longest };
  } finally { renderer.destroy(); }
}
/** Longest straight release border allowed, in cells (gradient noise: 11; the former value-noise field: 25). */
export const PARTICLE_STRAIGHT_BORDER_LIMIT = 14;

async function renderSheen(device: GPUDevice, source: GPUTexture, width: number, height: number, params: Record<string, unknown>) {
  const definition = sheen as FullscreenEffectDefinition;
  const module = device.createShaderModule({ code: `${common}\n${definition.shader}` });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: definition.entryPoint, targets: [{ format: 'rgba32float' }] } });
  const packed = definition.packUniforms({ ...getDefaultParams('sheen'), ...params } as never, width, height, 0)!;
  const uniform = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, packed.buffer, packed.byteOffset, packed.byteLength);
  const sampler = device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: sampler }, { binding: 1, resource: source.createView() }, { binding: 2, resource: { buffer: uniform } }] });
  const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: RENDER });
  const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
  const { bytes, bytesPerRow } = await readTexture(device, encoder, target, width, height, 16);
  target.destroy(); uniform.destroy();
  const floats = new Float32Array(bytes.buffer);
  return (x: number, y: number, c: number) => floats[(y * bytesPerRow) / 4 + x * 4 + c];
}

async function checkSheen(device: GPUDevice): Promise<number> {
  // A horizontal sweep (Angle 0) over grey ramps: columns run along the band, rows hold grey levels.
  const width = 128, height = 4, greys = [0, 0.2, 0.4, 0.6];
  const { texture } = sourceTexture(device, width, height, (_x, y) => { const v = Math.round(greys[y] * 255); return [v, v, v, 255]; });
  let comparisons = 0;
  try {
    const base = { angle: 0, position: 0.5, width: 0.3, color: '#ffffff' };
    const input = (y: number) => Math.round(greys[y] * 255) / 255;
    // Light only adds, and more Intensity never darkens.
    let previous: ((x: number, y: number, c: number) => number) | undefined;
    for (const intensity of [0, 0.5, 1.5, 3]) {
      const out = await renderSheen(device, texture, width, height, { ...base, intensity });
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const value = out(x, y, 0);
        if (!Number.isFinite(value) || value < input(y) - 1e-5) throw new Error(`sheen intensity ${intensity}: ${value} below the input ${input(y)} at ${x},${y}`);
        if (value >= 1) throw new Error(`sheen intensity ${intensity}: grey ${input(y)} clipped to ${value} at ${x},${y}`);
        if (previous && value < previous(x, y, 0) - 1e-5) throw new Error(`sheen intensity ${intensity}: darker than the lower intensity at ${x},${y}`);
      }
      previous = out; comparisons++;
    }
    // A faint band is plain addition: c + light (first order of the shoulder) within 1e-3.
    const faint = await renderSheen(device, texture, width, height, { ...base, intensity: 0.02, highlights: 0, softness: 0 });
    for (let y = 0; y < height; y++) {
      const centre = faint(width / 2, y, 0);
      if (Math.abs(centre - (input(y) + 0.02)) > 1e-3) throw new Error(`sheen faint band: ${centre} at grey ${input(y)}, expected ${input(y) + 0.02}`);
    }
    comparisons++;
    // Falloff profile: brightest at the centre, never brighter further out (Softness 1 and default).
    for (const softness of [1, 0.7]) {
      const out = await renderSheen(device, texture, width, height, { ...base, intensity: 1, softness });
      for (let x = width / 2; x + 1 < width; x++) if (out(x + 1, 2, 0) > out(x, 2, 0) + 1e-5) throw new Error(`sheen softness ${softness}: light rises away from the centre at ${x}`);
      if (out(width / 2, 2, 0) - out(width / 2 + 8, 2, 0) < 1e-3) throw new Error(`sheen softness ${softness}: flat top, no falloff from the centre`);
      comparisons++;
    }
    // Highlights: the band adds more light on bright grey than on black.
    const lit = await renderSheen(device, texture, width, height, { ...base, intensity: 0.4, highlights: 1 });
    if (lit(width / 2, 0, 0) - input(0) > 1e-5) throw new Error(`sheen highlights 1: black gained ${lit(width / 2, 0, 0)}`);
    if (lit(width / 2, 3, 0) - input(3) < 0.05) throw new Error('sheen highlights 1: bright grey gained no light');
    comparisons++;
    // Saved plateau profile: flat top over the inner part of the band.
    const plateau = await renderSheen(device, texture, width, height, { ...base, intensity: 1, softness: 0.3, profile: 'plateau', highlights: 0 });
    if (Math.abs(plateau(width / 2, 2, 0) - plateau(width / 2 + 4, 2, 0)) > 1e-5) throw new Error('sheen plateau: top is not flat');
    comparisons++;
    return comparisons;
  } finally { texture.destroy(); }
}

export async function checkStylizeArtGpu(device: GPUDevice): Promise<string> {
  const particles = await checkParticles(device);
  const sheenComparisons = await checkSheen(device);
  return `${particles.comparisons} Pixel Particle Disintegrate (longest straight release border ${particles.longest} cells) and ${sheenComparisons} Sheen checks`;
}
