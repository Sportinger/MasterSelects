/** Homogeneous least-squares fit of a common vanishing point to scene lines. */
export function fitVanishingPoint(lines: number[][]): number[] {
  const normalized = lines.map(line => {
    const length = Math.hypot(line[0], line[1]);
    return line.map(value => value / length);
  });
  const covariance = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, col) =>
    normalized.reduce((sum, line) => sum + line[row] * line[col], 0)));
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iteration = 0; iteration < 40; iteration++) {
    let p = 0, q = 1;
    for (const [a, b] of [[0, 2], [1, 2]]) {
      if (Math.abs(covariance[a][b]) > Math.abs(covariance[p][q])) { p = a; q = b; }
    }
    if (Math.abs(covariance[p][q]) < 1e-12) break;
    const angle = Math.atan2(2 * covariance[p][q], covariance[q][q] - covariance[p][p]) / 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    const pp = covariance[p][p], qq = covariance[q][q], pq = covariance[p][q];
    covariance[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    covariance[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    covariance[p][q] = covariance[q][p] = 0;
    for (let r = 0; r < 3; r++) {
      if (r !== p && r !== q) {
        const rp = covariance[r][p], rq = covariance[r][q];
        covariance[r][p] = covariance[p][r] = c * rp - s * rq;
        covariance[r][q] = covariance[q][r] = s * rp + c * rq;
      }
      const vp = vectors[r][p], vq = vectors[r][q];
      vectors[r][p] = c * vp - s * vq; vectors[r][q] = s * vp + c * vq;
    }
  }
  const minimum = [0, 1, 2].reduce((best, next) => covariance[next][next] < covariance[best][best] ? next : best);
  return vectors.map(row => row[minimum]);
}
