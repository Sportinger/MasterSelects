import { OutputPipeline } from '../../src/engine/pipeline/OutputPipeline';
import { opaqueExportPixels } from '../../src/engine/export/opaqueExportPixels';

/** Still pixels only: exercise browser bitmap/VideoFrame presentation without an encoder. */
export async function probeExportOutputParity(device: GPUDevice) {
  const width = 64, height = 64;
  const source = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < source.length; i += 4) {
    const x = (i / 4) % width, y = Math.floor(i / 4 / width);
    // Faint soft particles, brighter thin fibers and opaque highlights.
    const value = x < 48 ? Math.round(28 * Math.exp(-((x - 24) ** 2 + (y - 32) ** 2) / 250)) : 220;
    source.set([value, Math.round(value * .9), Math.round(value * .8), x < 48 ? 64 : 255], i);
  }
  const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
  device.queue.writeTexture({ texture }, source, { bytesPerRow: width * 4 }, [width, height]);
  const format = navigator.gpu.getPreferredCanvasFormat();
  const target = device.createTexture({ size: [width, height], format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: source.length, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const output = new OutputPipeline(device);
  try {
    await output.createPipeline(); output.updateResolution(width, height);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(output.getOutputPipeline()!);
    pass.setBindGroup(0, output.createOutputBindGroup(device.createSampler(), texture.createView(), 'normal'));
    pass.draw(3); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: width * 4 }, [width, height]);
    device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
    const reference = new Uint8ClampedArray(readback.getMappedRange().slice(0));
    readback.unmap();
    if (format === 'bgra8unorm') for (let i = 0; i < reference.length; i += 4) {
      [reference[i], reference[i + 2]] = [reference[i + 2], reference[i]];
    }
    const present = async (pixels: Uint8ClampedArray<ArrayBuffer>, video = false) => {
      const frame = video ? new VideoFrame(pixels, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: 0 }) : null;
      const bitmap = await createImageBitmap(frame ?? new ImageData(pixels, width, height));
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.drawImage(bitmap, 0, 0); bitmap.close(); frame?.close();
      return ctx.getImageData(0, 0, width, height).data;
    };
    const before = await present(source), fixed = opaqueExportPixels(source);
    const bitmap = await present(fixed), frame = await present(fixed, true);
    let legacyLoss = 0, bitmapMaxError = 0, frameMaxError = 0;
    for (let i = 0; i < source.length; i++) {
      if (i % 4 === 3) continue;
      legacyLoss += reference[i] - before[i];
      bitmapMaxError = Math.max(bitmapMaxError, Math.abs(reference[i] - bitmap[i]));
      frameMaxError = Math.max(frameMaxError, Math.abs(reference[i] - frame[i]));
    }
    if (legacyLoss < 1000 || bitmapMaxError > 1 || frameMaxError > 1 || source[3] !== 64)
      throw new Error(`Opaque output mismatch: ${JSON.stringify({ legacyLoss, bitmapMaxError, frameMaxError })}`);
    return { legacyLoss, bitmapMaxError, frameMaxError, encoded: false };
  } finally {
    output.destroy(); texture.destroy(); target.destroy(); readback.destroy();
  }
}
