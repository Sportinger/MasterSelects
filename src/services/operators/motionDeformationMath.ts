/** Forward source velocity and a backwards-looking delay map induce J = I +
 * velocity * gradient(delay)^T. Inverse singular values measure output stretch.
 * UV velocities are converted to pixels before combining with seconds/pixel. */
export function temporalDeformation(motion: readonly number[], gradient: readonly number[], resolution: readonly number[]): [number, number, number, number] {
  if (![...motion, ...gradient, ...resolution].every(Number.isFinite) || motion[3] <= 0 || motion[2] <= 0) return [1, 1, 0, 1];
  const vx = motion[0] * resolution[0], vy = motion[1] * resolution[1];
  const a = 1 + vx * gradient[0], b = vx * gradient[1], c = vy * gradient[0], d = 1 + vy * gradient[1];
  const det = a * d - b * c, trace = a * a + b * b + c * c + d * d;
  const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det * det));
  const large = Math.sqrt(Math.max(0, (trace + disc) / 2));
  // det/sigmaMax avoids cancellation near a fold.
  const small = Math.abs(det) / Math.max(large, 1e-6);
  return [Math.min(64, 1 / Math.max(small, 1 / 64)), Math.min(64, 1 / Math.max(large, 1 / 64)), Math.max(0, Math.min(1, motion[2])), det];
}
