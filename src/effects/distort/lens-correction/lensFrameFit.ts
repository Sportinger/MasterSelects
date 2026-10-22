interface Geometry {
  aspect: number; centerX: number; centerY: number; cropFactor: number;
  distortion: number; fineDistortion: number; profile: readonly number[];
}
const fits = new Map<string, number>();

/** The lens polynomial alone (profile and Distortion terms), as 3.2.7 drew it everywhere. */
function polynomialSourceRadius(radius: number, geometry: Geometry): number {
  const [a,b,c,enabled] = geometry.profile;
  const profileRadius = radius * 1.80277564 / geometry.cropFactor;
  const measured = 1 + enabled * (a*profileRadius**3 + b*profileRadius**2 + c*profileRadius);
  return radius * Math.max(.05, measured * (1 + geometry.distortion*radius**2 + geometry.fineDistortion*radius**4));
}

/** No knee found up to the scanned radius. */
export const LENS_NO_KNEE = 1e6;
/**
 * Slope (source radius per output radius) below which the polynomial hands over to a straight line.
 * Strong barrel removal flattens r(1 + k r²) until it turns back (folds) and would mirror the outer
 * picture; from this slope on the mapping keeps moving outward at that rate instead. 0.25 keeps the
 * polynomial everywhere in a centred frame down to Distortion −25.
 */
export const LENS_KNEE_SLOPE = .25;
const KNEE_SCAN_RADIUS = 8, KNEE_SCAN_STEPS = 1024;
export interface LensKnee { radius: number; source: number; slope: number }
const knees = new Map<string, LensKnee>();
const geometryKey = (geometry: Geometry) => JSON.stringify([geometry.aspect, geometry.centerX, geometry.centerY, geometry.cropFactor,
  geometry.distortion, geometry.fineDistortion, geometry.profile.slice(0, 4)]);
const polynomialSlope = (radius: number, geometry: Geometry) => {
  const delta = 1e-5 * Math.max(1, radius);
  return (polynomialSourceRadius(radius + delta, geometry) - polynomialSourceRadius(Math.max(0, radius - delta), geometry))
    / (radius + delta - Math.max(0, radius - delta));
};

/**
 * First output radius where the polynomial's slope falls to LENS_KNEE_SLOPE, with the source radius
 * there: beyond it lensSourceRadius continues in a straight line at that slope, so the correction never
 * folds and every source radius is reached (Fit Entire Photo works at any strength). LENS_NO_KNEE when
 * the slope stays above it up to radius 8 (no barrel removal strong enough to matter).
 */
export function lensKnee(geometry: Geometry): LensKnee {
  const key = geometryKey(geometry), cached = knees.get(key);
  if (cached) return cached;
  let knee: LensKnee = { radius: LENS_NO_KNEE, source: LENS_NO_KNEE, slope: 1 };
  for (let step = 1; step <= KNEE_SCAN_STEPS; step++) {
    const radius = KNEE_SCAN_RADIUS * step / KNEE_SCAN_STEPS;
    if (polynomialSlope(radius, geometry) > LENS_KNEE_SLOPE) continue;
    let lower = KNEE_SCAN_RADIUS * (step - 1) / KNEE_SCAN_STEPS, upper = radius;
    for (let iteration = 0; iteration < 40; iteration++) {
      const middle = (lower + upper) / 2;
      if (polynomialSlope(middle, geometry) > LENS_KNEE_SLOPE) lower = middle; else upper = middle;
    }
    knee = { radius: lower, source: polynomialSourceRadius(lower, geometry), slope: LENS_KNEE_SLOPE };
    break;
  }
  if (knees.size >= 64) knees.delete(knees.keys().next().value!);
  knees.set(key, knee);
  return knee;
}

/** Radius mapping shared with lens-correction/shader.wgsl (scale is applied separately): the polynomial, then the knee's line. */
export function lensSourceRadius(radius: number, geometry: Geometry, knee = lensKnee(geometry)): number {
  return radius <= knee.radius ? polynomialSourceRadius(radius, geometry) : knee.source + knee.slope * (radius - knee.radius);
}

/** Output radius that shows `sourceRadius`: the mapping only moves outward (slope at least LENS_KNEE_SLOPE), so one answer exists. */
export function lensOutputRadius(sourceRadius: number, geometry: Geometry): number {
  if (sourceRadius <= 0) return 0;
  const knee = lensKnee(geometry);
  // The radial factor never drops below 0.05 and the slope never below LENS_KNEE_SLOPE before the knee.
  let lower = 0, upper = sourceRadius;
  const limit = sourceRadius / Math.min(.05, LENS_KNEE_SLOPE);
  while (lensSourceRadius(upper, geometry, knee) < sourceRadius && upper < limit) upper = Math.min(limit, upper * 1.25);
  for (let iteration = 0; iteration < 48; iteration++) {
    const middle = (lower + upper) / 2;
    if (lensSourceRadius(middle, geometry, knee) < sourceRadius) lower = middle; else upper = middle;
  }
  return (lower + upper) / 2;
}

/** Fits the inverse-mapped source perimeter into the effect texture, preserving optical center. */
export function lensFullImageScale(geometry: Geometry): number {
  const key=geometryKey(geometry);
  const cached=fits.get(key); if(cached!==undefined)return cached;
  const radiusScale=2/Math.hypot(geometry.aspect,1);
  let fit=1;
  const include=(u:number,v:number)=>{
    const dx=u-geometry.centerX, dy=v-geometry.centerY;
    const radius=Math.hypot(dx*geometry.aspect*radiusScale,dy*radiusScale);
    if(radius<1e-9)return;
    const ratio=lensOutputRadius(radius,geometry)/radius;
    const x=dx*ratio, y=dy*ratio;
    if(x>1e-9)fit=Math.min(fit,(1-geometry.centerX)/x);
    if(x< -1e-9)fit=Math.min(fit,geometry.centerX/-x);
    if(y>1e-9)fit=Math.min(fit,(1-geometry.centerY)/y);
    if(y< -1e-9)fit=Math.min(fit,geometry.centerY/-y);
  };
  for(let sample=0;sample<=128;sample++) {
    const t=sample/128; include(t,0);include(t,1);include(0,t);include(1,t);
  }
  // A small margin covers sampling between perimeter points and float32 shader rounding.
  const result=fit<1-1e-6 ? Math.max(.0001,fit*.999) : 1;
  if(fits.size>=64)fits.delete(fits.keys().next().value!);
  fits.set(key,result); return result;
}
