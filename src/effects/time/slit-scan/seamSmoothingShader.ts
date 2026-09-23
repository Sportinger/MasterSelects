import { GEOMETRY_SAMPLE_TIME_WGSL } from './geometrySampleTimes';

export const SEAM_SMOOTHING_WGSL = GEOMETRY_SAMPLE_TIME_WGSL + /* wgsl */`
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var query: texture_2d<f32>;
@group(0) @binding(2) var imageSampler: sampler;
struct Settings { shape: vec4f, time: vec4f }
@group(0) @binding(3) var<uniform> settings: Settings;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return Vertex(vec4f(uv*vec2f(2,-2)+vec2f(-1,1),0,1),uv);
}
fn age(p: vec2i) -> f32 {
  let safe = clamp(p,vec2i(0),vec2i(textureDimensions(query))-1);
  return sampledSourceAge(textureLoad(query,safe,0).b,u32(settings.time.x),settings.time.y>.5).x;
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4f {
  let center = textureSampleLevel(image,imageSampler,v.uv,0.0);
  let p = vec2i(v.position.xy); let radius = settings.shape.z;
  if (radius<=0.0 || settings.time.w<=0.0) { return center; }
  let r = i32(max(1.0,ceil(radius)));
  let a = age(p); let l = age(p-vec2i(r,0)); let h = age(p+vec2i(r,0));
  let t = age(p-vec2i(0,r)); let b = age(p+vec2i(0,r));
  // Linear time ramps have zero curvature. Actual quantized PTS changes and
  // holds have nonzero curvature, independent of ordinary image edges.
  let curvature = vec2f(abs(l+h-2.0*a),abs(t+b-2.0*a));
  let seam = smoothstep(settings.time.z*.05,settings.time.z*.5,max(curvature.x,curvature.y));
  if (seam<=0.0) { return center; }
  var direction = vec2f(h-l,b-t);
  if (length(direction)<.000001) { direction=select(vec2f(0,1),vec2f(1,0),curvature.x>=curvature.y); }
  let offset = normalize(direction)*radius/settings.shape.xy;
  let halfPixel = .5/settings.shape.xy;
  let sigma = mix(.75,.035,settings.shape.w);
  var sum = vec4f(center.rgb*center.a,center.a); var weights = 1.0;
  for (var i=1;i<=4;i++) {
    let distance = f32(i)/4.0;
    for (var side=-1;side<=1;side+=2) {
      let uv = clamp(v.uv+offset*distance*f32(side),halfPixel,vec2f(1)-halfPixel);
      let c = textureSampleLevel(image,imageSampler,uv,0.0);
      let difference = c.rgb-center.rgb;
      let edge = exp(-dot(difference,difference)/(3.0*sigma*sigma));
      let alphaGuard = exp(-abs(c.a-center.a)*32.0);
      let w = exp(-2.0*distance*distance)*mix(1.0,edge,settings.shape.w)*alphaGuard;
      sum += vec4f(c.rgb*c.a,c.a)*w; weights += w;
    }
  }
  let average = sum/weights;
  let filtered = vec4f(average.rgb/max(average.a,.000001),average.a);
  return mix(center,filtered,seam*settings.time.w);
}`;
