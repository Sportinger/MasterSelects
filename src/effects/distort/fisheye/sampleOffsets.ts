/**
 * Sub-pixel offsets of Edge Sampling, in pixels, in reading order: the graph, the shader and the
 * software path read the first `samples` of them. Opposite offsets follow each other, so every even
 * count is centred on the pixel and every count from 1 to 8 adds samples (one sample reads the centre).
 */
export const FISHEYE_SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [-.375, -.125], [.375, .125], [.125, -.375], [-.125, .375],
  [-.4375, .3125], [.4375, -.3125], [-.3125, -.4375], [.3125, .4375],
];
