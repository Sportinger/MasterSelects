export function rotateImageCoordinate(value: readonly number[], angle: number): [number, number] {
  const sine = Math.sin(angle), cosine = Math.cos(angle);
  return [value[0] * cosine - value[1] * sine, value[0] * sine + value[1] * cosine];
}

export function projectImageRadius(theta: number, maxTheta: number, model: number): number {
  if (model < .5) return theta / Math.max(maxTheta, .0001);
  if (model < 1.5) return Math.sin(theta * .5) / Math.max(Math.sin(maxTheta * .5), .0001);
  if (model < 2.5) return Math.tan(theta * .5) / Math.max(Math.tan(maxTheta * .5), .0001);
  return Math.sin(theta) / Math.max(Math.sin(maxTheta), .0001);
}

export function unprojectImageRadius(radius: number, maxTheta: number, model: number): number {
  if (model < .5) return radius * maxTheta;
  if (model < 1.5) return 2 * Math.asin(Math.max(-1, Math.min(1, radius * Math.sin(maxTheta * .5))));
  if (model < 2.5) return 2 * Math.atan(radius * Math.tan(maxTheta * .5));
  return Math.asin(Math.max(-1, Math.min(1, radius * Math.sin(maxTheta))));
}
