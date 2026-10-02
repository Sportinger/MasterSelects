import { LibRaw } from '@colorhythm/libraw-wasm';
import wasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url';
import { encodeRawImagePng } from '../services/rawImage/rawImagePixels';

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  let decoder: LibRaw | undefined;
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`RAW decoder download failed (${response.status})`);
    await LibRaw.initialize(await response.arrayBuffer());
    decoder = new LibRaw();
    await decoder.waitUntilReady();
    decoder.open(event.data);
    const camera = decoder.getIParams();
    const lens = decoder.getLensInfo();
    const exposure = decoder.getImgOther();
    decoder.setUseCameraWb(1);
    decoder.setOutputColor(1); // sRGB, using the camera matrix and as-shot white balance.
    decoder.setOutputBps(8);
    decoder.setHalfSize(0);
    decoder.unpack();
    decoder.dcrawProcess();
    const image = decoder.dcrawMakeMemImage();
    if (image.type_ !== 'LIBRAW_IMAGE_BITMAP' || image.bits !== 8) throw new Error('RAW decoder returned an unsupported pixel format');
    const png = encodeRawImagePng(image.width, image.height, image.colors, image.data);
    const metadata = { camera: camera.model, lens: lens.Lens, focalLength: exposure.focal_len,
      aperture: exposure.aperture, width: image.width, height: image.height };
    self.postMessage({ png: png.buffer, metadata }, { transfer: [png.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    decoder?.dispose();
  }
};
