/** CPU reference of hashPcg2d.wgsl: the same u32 arithmetic on the exact f32 bits of both inputs. */
const bits = new Uint32Array(2), floats = new Float32Array(bits.buffer);

export function imageHashPcg2d(value: readonly number[]): number {
  floats[0] = value[0]; floats[1] = value[1];
  let x = bits[0], y = bits[1];
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0; y = Math.imul(y, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0; y = (y ^ (y >>> 15)) >>> 0;
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x >>> 8) / 16777216;
}
