export interface RotoMemoryFrame { index: number; tokens: Float32Array; positions: Float32Array; pointer: Float32Array }
/** Fixed export contract: seven spatial memories, then sixteen 256-d object pointers. */
export function assembleRotoMemory(seed: RotoMemoryFrame, recent: RotoMemoryFrame[], index: number,
  temporal: number[][], pointerPositions: Float32Array) {
  const block = 4096 * 64, size = 7 * block + 16 * 256;
  const memory = new Float32Array(size), positions = new Float32Array(size);
  const latest = recent.at(-1) ?? seed;
  const blocks = [seed, ...Array.from({ length: 6 }, (_, i) => recent.find(f => f.index === index - (6 - i)) ?? latest)];
  blocks.forEach((frame, i) => {
    if (frame.tokens.length !== block || frame.positions.length !== block) throw new Error('Invalid SAM spatial memory shape.');
    memory.set(frame.tokens, i * block);
    const row = temporal[i === 0 ? 6 : 6 - i];
    for (let j = 0; j < block; j++) positions[i * block + j] = frame.positions[j] + row[j % 64];
  });
  const pointers = [seed, ...recent.toReversed().filter(f => f.index !== seed.index)].slice(0, 16);
  while (pointers.length < 16) pointers.push(pointers.at(-1)!);
  pointers.forEach((frame, i) => {
    memory.set(frame.pointer, 7 * block + i * 256);
    for (let part = 0; part < 4; part++) positions.set(pointerPositions.subarray(i * 64, (i + 1) * 64), 7 * block + i * 256 + part * 64);
  });
  return { memory, positions };
}
export function rotoPointerDiffs(seed: RotoMemoryFrame, recent: RotoMemoryFrame[], index: number, totalFrames: number) {
  const pointers = [seed, ...recent.toReversed().filter(f => f.index !== seed.index)].slice(0, 16);
  while (pointers.length < 16) pointers.push(pointers.at(-1)!);
  const denominator = Math.max(1, Math.min(totalFrames, 16) - 1);
  return Float32Array.from(pointers, f => (index - f.index) / denominator);
}
export function channelsToTokens(data: Float32Array, channels: number, pixels: number) {
  const output = new Float32Array(data.length);
  for (let c = 0; c < channels; c++) for (let p = 0; p < pixels; p++) output[p * channels + c] = data[c * pixels + p];
  return output;
}
