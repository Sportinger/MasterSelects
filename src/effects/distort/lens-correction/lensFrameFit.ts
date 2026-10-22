interface Geometry {
  aspect: number; centerX: number; centerY: number; cropFactor: number;
  distortion: number; fineDistortion: number; profile: readonly number[];
}
const fits = new Map<string, number>();

/** Radius mapping shared with lens-correction/shader.wgsl; scale is applied separately. */
export function lensSourceRadius(radius: number, geometry: Geometry): number {
  const [a,b,c,enabled] = geometry.profile;
  const profileRadius = radius * 1.80277564 / geometry.cropFactor;
  const measured = 1 + enabled * (a*profileRadius**3 + b*profileRadius**2 + c*profileRadius);
  return radius * Math.max(.05, measured * (1 + geometry.distortion*radius**2 + geometry.fineDistortion*radius**4));
}

/** No fold found up to the scanned radius. */
export const LENS_NO_FOLD = 1e6;
const FOLD_SCAN_STEPS = 1024;

/**
 * First output radius where the correction stops moving outward: strong barrel removal
 * (Distortion below about -33, Fine Distortion below -20, or a profile combined with
 * them) maps the outer ring back inside and would mirror the picture. Pixels beyond it have
 * no valid source; the shader leaves them transparent. LENS_NO_FOLD when none up to `maxRadius`.
 */
export function lensFoldRadius(geometry: Geometry, maxRadius: number): number {
  const limit = Math.max(1e-6, maxRadius);
  let previous = 0;
  for (let step = 1; step <= FOLD_SCAN_STEPS; step++) {
    const radius = limit * step / FOLD_SCAN_STEPS, mapped = lensSourceRadius(radius, geometry);
    if (mapped <= previous) {
      // The turning point lies between the last three samples; refine it on the sign of the slope.
      let lower = limit * Math.max(0, step - 2) / FOLD_SCAN_STEPS, upper = radius;
      for (let iteration = 0; iteration < 32; iteration++) {
        const middle = (lower + upper) / 2, delta = upper * 1e-6 + 1e-9;
        if (lensSourceRadius(middle + delta, geometry) > lensSourceRadius(middle, geometry)) lower = middle; else upper = middle;
      }
      return lower;
    }
    previous = mapped;
  }
  return LENS_NO_FOLD;
}

export function lensOutputRadius(sourceRadius: number, geometry: Geometry, foldRadius = LENS_NO_FOLD): number {
  if (sourceRadius === 0) return 0;
  // Beyond the fold the source is unreachable: the last visible ring is the answer.
  if (foldRadius < LENS_NO_FOLD && sourceRadius >= lensSourceRadius(foldRadius, geometry)) return foldRadius;
  let lower=0, upper=Math.min(sourceRadius, foldRadius);
  const limit=Math.min(sourceRadius/.05, foldRadius);
  while (lensSourceRadius(upper,geometry)<sourceRadius && upper<limit) upper=Math.min(limit,upper*1.25);
  for(let iteration=0;iteration<48;iteration++) {
    const middle=(lower+upper)/2;
    if(lensSourceRadius(middle,geometry)<sourceRadius)lower=middle;else upper=middle;
  }
  return (lower+upper)/2;
}

/** Fits the inverse-mapped source perimeter into the effect texture, preserving optical center. */
export function lensFullImageScale(geometry: Geometry): number {
  const key=JSON.stringify([geometry.aspect,geometry.centerX,geometry.centerY,geometry.cropFactor,
    geometry.distortion,geometry.fineDistortion,geometry.profile.slice(0,4)]);
  const cached=fits.get(key); if(cached!==undefined)return cached;
  const radiusScale=2/Math.hypot(geometry.aspect,1);
  let fit=1;
  // Source perimeter points beyond a fold cannot be shown; fit the last visible ring instead.
  const fold=lensFoldRadius(geometry,8);
  const include=(u:number,v:number)=>{
    const dx=u-geometry.centerX, dy=v-geometry.centerY;
    const radius=Math.hypot(dx*geometry.aspect*radiusScale,dy*radiusScale);
    if(radius<1e-9)return;
    const ratio=lensOutputRadius(radius,geometry,fold)/radius;
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
