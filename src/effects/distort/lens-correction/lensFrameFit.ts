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

export function lensOutputRadius(sourceRadius: number, geometry: Geometry): number {
  if (sourceRadius === 0) return 0;
  let lower=0, upper=sourceRadius;
  const limit=sourceRadius/.05;
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
