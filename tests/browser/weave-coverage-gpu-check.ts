import { StrandCoverageTargets } from '../../src/engine/native3d/passes/StrandCoverageTargets';
import strandShader from '../../src/engine/native3d/shaders/StrandScene.wgsl?raw';
import type { SceneCamera, SceneStrandLayer } from '../../src/engine/scene/types';

/** Exact GPU checks of depth seeding, coverage resolve, opacity and resource reuse. */
async function check() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const strandModule = device.createShaderModule({ code: strandShader });
  const diagnostics = await strandModule.getCompilationInfo();
  const shaderErrors = diagnostics.messages.filter(message => message.type === 'error');
  if (shaderErrors.length) throw new Error(shaderErrors.map(message => message.message).join('\n'));
  const coverage = new StrandCoverageTargets();
  const module = device.createShaderModule({ code: `
    struct Settings { color: vec4f, depth: vec4f };
    @group(0) @binding(0) var<uniform> settings: Settings;
    @vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
      var p = array<vec2f, 3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
      return vec4f(p[index],settings.depth.x,1.0);
    }
    @fragment fn fragment() -> @location(0) vec4f { return settings.color; }
  ` });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
  ] });
  const pipeline = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba8unorm' }] },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
    multisample: { count: 4, alphaToCoverageEnabled: true } });
  const settings = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: settings } }] });
  const depthModule = device.createShaderModule({ code: `
    @group(0) @binding(0) var depth: texture_depth_2d;
    @vertex fn vertex(@builtin(vertex_index) index:u32) -> @builtin(position) vec4f {
      var p=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
      return vec4f(p[index],0.0,1.0);
    }
    @fragment fn fragment(@builtin(position) p:vec4f) -> @location(0) f32 { return textureLoad(depth,vec2i(p.xy),0); }
  ` });
  const depthLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'depth' } }] });
  const depthPipeline = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [depthLayout] }),
    vertex: { module: depthModule, entryPoint: 'vertex' },
    fragment: { module: depthModule, entryPoint: 'fragment', targets: [{ format: 'r32float' }] } });

  async function render(alpha: number, incomingDepth = 1, background = [0, 0, 0, 0], width = 64, height = 32) {
    device.pushErrorScope('validation');
    const texture = (format: GPUTextureFormat) => device.createTexture({ size: [width, height], format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    const color = texture('rgba8unorm'), depth = texture('depth24plus'), depthCopy = texture('r32float');
    const stride = Math.ceil(width * 4 / 256) * 256;
    const pixels = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const depths = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    device.queue.writeBuffer(settings, 0, Float32Array.from([1, 0, 0, alpha, 0.25, 0, 0, 0]));
    const encoder = device.createCommandEncoder();
    const clear = encoder.beginRenderPass({ colorAttachments: [{ view: color.createView(),
      clearValue: { r: background[0], g: background[1], b: background[2], a: background[3] }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: incomingDepth, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    clear.end();
    coverage.render(device, encoder, color.createView(), depth.createView(), width, height, pass => {
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3);
    });
    const depthPass = encoder.beginRenderPass({ colorAttachments: [{ view: depthCopy.createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 0, b: 0, a: 0 } }] });
    depthPass.setPipeline(depthPipeline);
    depthPass.setBindGroup(0, device.createBindGroup({ layout: depthLayout, entries: [{ binding: 0, resource: depth.createView() }] }));
    depthPass.draw(3); depthPass.end();
    encoder.copyTextureToBuffer({ texture: color }, { buffer: pixels, bytesPerRow: stride }, [width, height]);
    encoder.copyTextureToBuffer({ texture: depthCopy }, { buffer: depths, bytesPerRow: stride }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await Promise.all([pixels.mapAsync(GPUMapMode.READ), depths.mapAsync(GPUMapMode.READ)]);
    const rgba = new Uint8Array(width * height * 4), z = new Float32Array(width * height);
    const raw = new Uint8Array(pixels.getMappedRange()), rawZ = new Float32Array(depths.getMappedRange());
    for (let y = 0; y < height; y++) {
      rgba.set(raw.subarray(y * stride, y * stride + width * 4), y * width * 4);
      z.set(rawZ.subarray(y * stride / 4, y * stride / 4 + width), y * width);
    }
    pixels.unmap(); depths.unmap();
    const error = await device.popErrorScope();
    [color, depth, depthCopy].forEach(value => value.destroy());
    [pixels, depths].forEach(value => value.destroy());
    if (error) throw new Error(error.message);
    return { rgba, z, width, height };
  }

  const results: Record<string, unknown>[] = [];
  try {
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      const image = await render(alpha);
      let sum = 0;
      for (let p = 0; p < image.z.length; p++) {
        const value = image.rgba[p * 4 + 3];
        if (Math.abs(image.rgba[p * 4] - value) > 1) throw new Error('Coverage was applied twice');
        const expectedDepth = value >= 127 ? 0.25 : 1;
        if (Math.abs(image.z[p] - expectedDepth) > 1e-5) throw new Error('Resolved depth disagrees with coverage');
        sum += value;
      }
      const averageAlpha = sum / image.z.length / 255;
      if (Math.abs(averageAlpha - alpha) > 0.13) throw new Error(`Coverage ${alpha} became ${averageAlpha}`);
      const repeated = await render(alpha);
      if (repeated.rgba.some((value, index) => value !== image.rgba[index])) throw new Error('Repeated frame changed pixels');
      results.push({ alpha, averageAlpha, deterministic: true });
    }
    const hidden = await render(1, 0.1, [0, 0, 1, 1]);
    if (hidden.rgba.some((value, index) => value !== (index % 4 >= 2 ? 255 : 0))) throw new Error('Foreground scene did not hide strands');
    if (hidden.z.some(value => Math.abs(value - 0.1) > 1e-5)) throw new Error('Foreground depth changed');
    const opaque = await render(0.5, 1, [1, 1, 1, 1]);
    for (let p = 0; p < opaque.z.length; p++) {
      if (opaque.rgba[p * 4] !== 255 || opaque.rgba[p * 4 + 3] !== 255) throw new Error('Opaque background lost color or alpha');
    }
    results.push({ opaqueForegroundOccludes: true, opaqueBackgroundPreserved: true });
    await render(0.5, 1, [0, 0, 0, 0], 128, 64);
    const actual = await checkStrands(device);
    if (errors.length) throw new Error(errors.join('\n'));
    return { pass: true, shaderCompilation: 'passed', resized: true, actualStrands: actual, results };
  } finally {
    await device.queue.onSubmittedWorkDone();
    coverage.dispose(); settings.destroy(); device.destroy();
  }
}

/** Exercise the production strand pass, rather than only synthetic coverage. */
async function checkStrands(device: GPUDevice) {
  const { StrandPass } = await import('../../src/engine/native3d/passes/StrandPass');
  const renderer = new StrandPass(), width = 128, height = 64;
  const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const camera: SceneCamera = { viewMatrix: Float32Array.from(identity), projectionMatrix: Float32Array.from(identity),
    cameraPosition: { x: 0, y: 0, z: 2 }, cameraTarget: { x: 0, y: 0, z: 0 }, cameraUp: { x: 0, y: 1, z: 0 },
    viewport: { width, height }, projection: 'orthographic', fov: 60, near: 0.1, far: 10 };
  camera.viewMatrix[14] = -2;
  camera.projectionMatrix[10] = -0.1;
  const layer: SceneStrandLayer = { kind: 'strands', layerId: 'gpu-weave', clipId: 'gpu-weave', opacity: 1,
    blendMode: 'normal', sourceWidth: width, sourceHeight: height, worldMatrix: identity,
    strands: { clipId: 'gpu-weave', effectId: 'weave', program: {
      stages: [{ kind: 'curve-line', nodeId: 'line', points: 64, length: 1.6, axis: 0 },
        { kind: 'strand-array', nodeId: 'array', count: 5, spacing: 0.25, axis: 1 }], pointCount: 320, strandCount: 5,
      render: { nodeId: 'render', width: 0.025, color: '#dedbcf', antialiasing: 'coverage4x',
        profile: { plies: 3, fibers: 5, radius: 0.055, plyTwist: 3, fiberTwist: -7 },
        flyaways: { density: 4, length: 0.12, lift: 2, hair: 0.4, seed: 3 } },
    } } };
  const color = device.createTexture({ size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const depth = device.createTexture({ size: [width, height], format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const readback = device.createBuffer({ size: width * height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  async function frame(hidden: boolean, quality: boolean) {
    const render = layer.strands.program.render!;
    if (quality) render.antialiasing = 'coverage4x'; else delete render.antialiasing;
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder(), temporary: GPUBuffer[] = [];
    const clear = encoder.beginRenderPass({ colorAttachments: [{ view: color.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: hidden ? 0.01 : 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    clear.end();
    const prepared = renderer.prepare(device, [layer], temporary);
    if (!renderer.render(device, encoder, color.createView(), depth.createView(), prepared, camera, temporary)) {
      throw new Error('Strand pass refused the frame');
    }
    encoder.copyTextureToBuffer({ texture: color }, { buffer: readback, bytesPerRow: width * 4 }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const rgba = Uint8Array.from(new Uint8Array(readback.getMappedRange()));
    readback.unmap();
    temporary.forEach(buffer => buffer.destroy());
    const error = await device.popErrorScope();
    if (error) throw new Error(error.message);
    return rgba;
  }
  try {
    const hashed = await frame(false, false), quality = await frame(false, true), repeated = await frame(false, true);
    const covered = (rgba: Uint8Array) => rgba.filter((value, index) => index % 4 === 3 && value > 0).length;
    if (!covered(hashed) || !covered(quality)) throw new Error('Actual strands did not draw');
    if (quality.some((value, index) => value !== repeated[index])) throw new Error('Actual strand frame changed on repeat');
    const hidden = await frame(true, true);
    if (covered(hidden)) throw new Error('Opaque foreground did not hide actual strands');
    layer.opacity = 0;
    if (covered(await frame(false, true))) throw new Error('Zero-opacity strands drew pixels');
    layer.opacity = 1;
    layer.strands.program.render!.width = 0;
    if (covered(await frame(false, true))) throw new Error('Zero-width strands drew pixels');
    const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
    canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(quality), width, height), 0, 0);
    return { hashedPixels: covered(hashed), qualityPixels: covered(quality), deterministic: true,
      foregroundOcclusion: true, zeroOpacity: true, zeroWidth: true, flyaways: true };
  } finally {
    await device.queue.onSubmittedWorkDone();
    renderer.dispose(); color.destroy(); depth.destroy(); readback.destroy();
  }
}

check().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2); })
  .catch(error => { document.querySelector('#result')!.textContent = `FAIL: ${error.stack ?? error}`; });
