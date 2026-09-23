/** Independent WebGPU implementation of DIS's fast path: Gaussian pyramid,
 * inverse-compositional patch search and residual-weighted dense aggregation.
 * Algorithm: Kroeger et al., https://arxiv.org/abs/1603.03590 (2016).
 * Not an OpenCV binary/port; variational refinement is not enabled here. */
export const DIS_FLOW_WGSL = /* wgsl */`
struct Params {
  size: vec2u, sourceSize: vec2u, grid: vec2u, slots: vec2u,
  delta: f32, stage: u32, padding: vec2u,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source: texture_2d_array<f32>;
@group(0) @binding(2) var reference: texture_2d<f32>;
@group(0) @binding(3) var targetImage: texture_2d<f32>;
@group(0) @binding(4) var seed: texture_2d<f32>;
@group(0) @binding(5) var patches: texture_2d<f32>;
@group(0) @binding(6) var output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var linearSampler: sampler;
@group(0) @binding(8) var volume: texture_storage_2d_array<rgba16float, write>;

fn read(image: texture_2d<f32>, p: vec2i) -> vec4f {
  return textureLoad(image, clamp(p, vec2i(0), vec2i(textureDimensions(image))-1), 0);
}
fn sample(image: texture_2d<f32>, p: vec2f) -> vec4f {
  let size = vec2f(textureDimensions(image));
  return textureSampleLevel(image, linearSampler, clamp((p+.5)/size, .5/size, 1.0-.5/size), 0.0);
}
@compute @workgroup_size(8,8)
fn extract(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= params.size)) { return; }
  let slot = params.slots.x;
  let cell = vec2u(slot % params.grid.x, (slot / params.grid.x) % params.grid.y);
  let color = textureLoad(source, vec2i(cell * params.size + id.xy), i32(slot/(params.grid.x*params.grid.y)), 0);
  textureStore(output, vec2i(id.xy), vec4f(dot(color.rgb, vec3f(.299,.587,.114)), 0.0, 0.0, color.a));
}
@compute @workgroup_size(8,8)
fn downsample(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(output))) { return; }
  let center = vec2i(id.xy*2u);
  var sum = 0.0; var valid = 1.0;
  let weights = array<f32,5>(1.0,4.0,6.0,4.0,1.0);
  for (var y = -2; y <= 2; y++) { for (var x = -2; x <= 2; x++) {
    let v = read(reference, center+vec2i(x,y));
    sum += v.x*weights[u32(x+2)]*weights[u32(y+2)]; valid = min(valid, v.a);
  } }
  textureStore(output, vec2i(id.xy), vec4f(sum/256.0,0.0,0.0,valid));
}
fn patchError(center: vec2i, displacement: vec2f) -> f32 {
  var sum = 0.0; var square = 0.0;
  for (var y = -3; y <= 4; y++) { for (var x = -3; x <= 4; x++) {
    let p = center+vec2i(x,y);
    let e = read(reference,p).x-sample(targetImage,vec2f(p)+displacement).x;
    sum += e; square += e*e;
  } }
  return max(0.0, square-sum*sum/64.0)/64.0;
}
@compute @workgroup_size(8,8)
fn search(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(output))) { return; }
  let size = vec2f(textureDimensions(reference));
  let center = vec2i(id.xy*4u);
  let uv = (vec2f(center)+.5)/size;
  var displacement = textureSampleLevel(seed,linearSampler,uv,0.0).xy*size;
  var bestError = patchError(center, displacement);
  // A coarse integer seed avoids starting inverse search beyond its local
  // convergence basin. Only the smallest pyramid level has the 1x1 seed.
  if (params.stage == 0u && textureDimensions(seed).x == 1u) {
    for (var y = -2; y <= 2; y++) { for (var x = -2; x <= 2; x++) {
      let candidate = vec2f(f32(x),f32(y));
      let error = patchError(center,candidate);
      if (error < bestError) { displacement = candidate; bestError = error; }
    } }
  }
  // Spatial propagation uses a completed previous pass, never racing neighbors.
  if (params.stage == 1u) {
    let offsets = array<vec2i,5>(vec2i(0),vec2i(-1,0),vec2i(1,0),vec2i(0,-1),vec2i(0,1));
    for (var i = 0u; i < 5u; i++) {
      let candidate = read(patches, vec2i(id.xy)+offsets[i]).xy*size;
      let error = patchError(center,candidate);
      if (error < bestError) { displacement = candidate; bestError = error; }
    }
  } else {
    let zeroError = patchError(center,vec2f(0.0));
    if (zeroError < bestError) { displacement = vec2f(0.0); bestError = zeroError; }
  }
  let initial = displacement;
  var referencePatch: array<f32,64>; var gradient: array<vec2f,64>;
  var mean = 0.0; var meanGradient = vec2f(0.0); var valid = 1.0;
  for (var y = -3; y <= 4; y++) { for (var x = -3; x <= 4; x++) {
    let index = u32((y+3)*8+x+3); let p = center+vec2i(x,y);
    let value = read(reference,p); referencePatch[index] = value.x; mean += value.x; valid = min(valid,value.a);
    gradient[index] = .5*vec2f(read(reference,p+vec2i(1,0)).x-read(reference,p-vec2i(1,0)).x,
      read(reference,p+vec2i(0,1)).x-read(reference,p-vec2i(0,1)).x);
    meanGradient += gradient[index];
  } }
  mean /= 64.0; meanGradient /= 64.0;
  var h = vec3f(0.0);
  for (var i = 0u; i < 64u; i++) {
    referencePatch[i] -= mean; gradient[i] -= meanGradient;
    let g = gradient[i]; h += vec3f(g.x*g.x,g.y*g.y,g.x*g.y);
  }
  // Inverse-compositional Hessian is computed once per patch, not per iteration.
  let determinant = h.x*h.y-h.z*h.z;
  var best = displacement;
  if (determinant > 1e-9 && valid > .99) {
    for (var iteration = 0u; iteration < 8u; iteration++) {
      var warped: array<f32,64>; var targetMean = 0.0;
      for (var y = -3; y <= 4; y++) { for (var x = -3; x <= 4; x++) {
        let i = u32((y+3)*8+x+3);
        warped[i] = sample(targetImage,vec2f(center+vec2i(x,y))+displacement).x; targetMean += warped[i];
      } }
      targetMean /= 64.0; var rhs = vec2f(0.0); var error = 0.0;
      for (var i = 0u; i < 64u; i++) {
        let residual = referencePatch[i]-(warped[i]-targetMean);
        rhs += gradient[i]*residual; error += residual*residual;
      }
      error /= 64.0;
      if (error <= bestError) { best = displacement; bestError = error; }
      let update = vec2f(h.y*rhs.x-h.z*rhs.y,h.x*rhs.y-h.z*rhs.x)/determinant;
      displacement += clamp(update,vec2f(-2.0),vec2f(2.0));
      if (length(displacement-initial) > 8.0 || dot(update,update) < .0001) { break; }
    }
    let finalError = patchError(center,displacement);
    if (length(displacement-initial) <= 8.0 && finalError < bestError) { best = displacement; bestError = finalError; }
  }
  let eigen = max(0.0,.5*(h.x+h.y-sqrt(max(0.0,(h.x-h.y)*(h.x-h.y)+4.0*h.z*h.z)))/64.0);
  let confidence = eigen/(eigen+.00001)*exp(-bestError/.01)*valid;
  textureStore(output,vec2i(id.xy),vec4f(best/size,confidence,select(0.0,1.0,confidence>.001)));
}
@compute @workgroup_size(8,8)
fn densify(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(output); if (any(id.xy >= size)) { return; }
  let p = vec2i(id.xy); let cell = p/4;
  var velocity = vec2f(0.0); var weights = 0.0; var confidence = 0.0; var support = 0.0;
  let original = read(reference,p);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let index = cell+vec2i(x,y); let offset = p-index*4;
    if (any(index<vec2i(0)) || any(index>=vec2i(textureDimensions(patches))) || any(offset<vec2i(-3)) || any(offset>vec2i(4))) { continue; }
    let flow = textureLoad(patches,index,0); let q = vec2f(p)+flow.xy*vec2f(size);
    if (any(q<vec2f(0.0)) || any(q>vec2f(size)-1.0)) { continue; }
    let warped = sample(targetImage,q);
    let w = flow.b*flow.a*warped.a/max(.01,abs(original.x-warped.x));
    velocity += flow.xy*w; weights += w; confidence += flow.b*w; support += 1.0;
  } }
  var result = vec4f(0.0);
  if (weights > .00001 && original.a > .99) {
    result = vec4f(velocity/weights,confidence/weights,1.0);
  }
  textureStore(output,p,result);
}
@compute @workgroup_size(8,8)
fn storeFlow(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= params.size)) { return; }
  let uv = (vec2f(id.xy)+.5)/vec2f(params.size);
  let flow = textureLoad(seed,vec2i(id.xy),0); let q = uv+flow.xy;
  let reverse = textureSampleLevel(patches,linearSampler,q,0.0);
  let error = length((flow.xy+reverse.xy)*vec2f(params.size));
  let tolerance = .5+.05*length(flow.xy*vec2f(params.size));
  let confidence = min(flow.b,reverse.b)*(1.0-smoothstep(tolerance,2.0*tolerance,error));
  let valid = flow.a*reverse.a*select(0.0,1.0,all(q>=vec2f(0.0)) && all(q<=vec2f(1.0)) && abs(params.delta)>.000001);
  let slot = params.slots.x;
  let cell = vec2u(slot%params.grid.x,(slot/params.grid.x)%params.grid.y);
  let velocity = flow.xy/select(1.0,params.delta,abs(params.delta)>.000001);
  textureStore(volume,vec2i(cell*params.size+id.xy),i32(slot/(params.grid.x*params.grid.y)),vec4f(velocity,confidence*valid,valid));
}
`;
