const BAYER_4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
] as const;

export function evaluateImageBayer4(value: readonly number[]): number {
  // Match finite f32 -> u32 saturation: https://www.w3.org/TR/WGSL/#floating-point-conversion
  const index = (coordinate: number) => Math.min(4_294_967_040, Math.max(0, Math.floor(Math.fround(coordinate)))) % 4;
  const x = index(value[0]), y = index(value[1]);
  return (BAYER_4[y * 4 + x] + 0.5) / 16;
}

export const IMAGE_BAYER_4_WGSL = `
fn imageGraphBayer4(pixel: vec2f) -> f32 {
  let table = array<f32, 16>(
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  let x = u32(max(0.0, floor(pixel.x))) % 4u;
  let y = u32(max(0.0, floor(pixel.y))) % 4u;
  return (table[y * 4u + x] + 0.5) / 16.0;
}`;
