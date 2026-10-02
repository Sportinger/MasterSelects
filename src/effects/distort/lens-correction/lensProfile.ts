import calibration from './canonEf24_105.json';

export const CANON_24_105_PROFILE = 'canon-ef-24-105-f4l-is-usm';
export const LENS_PROFILE_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: CANON_24_105_PROFILE, label: calibration.model },
];

/** Interpolate measured coefficients, clamping at the calibrated endpoints. */
function interpolate(rows: number[][], value: number): number[] {
  const ordered = rows.toSorted((a, b) => a[0] - b[0]);
  const upper = ordered.findIndex(row => row[0] >= value);
  if (upper <= 0) return (upper === 0 ? ordered[0] : ordered[ordered.length - 1]).slice(1);
  const a = ordered[upper - 1], b = ordered[upper];
  const mix = (value - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((coefficient, i) => coefficient + (b[i + 1] - coefficient) * mix);
}

function vignetteCoefficients(focal: number, aperture: number, distance: number): number[] {
  const focals = [...new Set(calibration.vignetting.map(row => row[0]))];
  return interpolate(focals.map(f => {
    const focalRows = calibration.vignetting.filter(row => row[0] === f);
    const apertures = [...new Set(focalRows.map(row => row[1]))];
    const terms = interpolate(apertures.map(a => [a, ...interpolate(
      focalRows.filter(row => row[1] === a).map(row => [1 / row[2], ...row.slice(3)]), 1 / distance,
    )]), aperture);
    return [f, ...terms];
  }), focal);
}

export function lensProfileUniforms(profile: string, focal: number, aperture: number, distance: number): number[] {
  if (profile !== CANON_24_105_PROFILE) return [0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0];
  const [a, b, c] = interpolate(calibration.distortion, focal);
  // PTLens normalization preserves the magnification at the optical center.
  const d = 1 - a - b - c;
  const tca = interpolate(calibration.tca, focal);
  return [a / d ** 4, b / d ** 3, c / d ** 2, 1, ...tca,
    ...vignetteCoefficients(focal, aperture, distance), 1];
}
