struct Sizes { render: vec2f, output: vec2f };
@group(0) @binding(0) var<uniform> sizes: Sizes;
@group(0) @binding(1) var<storage, read> color: array<vec4f>;
@group(0) @binding(2) var<storage, read> depth: array<f32>;
struct Result { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p*2.0-1.0,0.0,1.0);
}
fn sampleColor(p: vec2i) -> vec4f {
  let q = clamp(p,vec2i(0),vec2i(sizes.render)-1);
  return color[u32(q.y)*u32(sizes.render.x)+u32(q.x)];
}
@fragment fn fragment(@builtin(position) position: vec4f) -> Result {
  let uv = position.xy*sizes.render/sizes.output-0.5;
  let base = vec2i(floor(uv)); let f = fract(uv);
  let a = sampleColor(base); let b = sampleColor(base+vec2i(1,0));
  let c = sampleColor(base+vec2i(0,1)); let d = sampleColor(base+vec2i(1,1));
  // Keep the raster/previous native frame beyond the center-first sampling frontier.
  if (min(min(a.a,b.a),min(c.a,d.a)) < 0.0) { discard; }
  let rgba = mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
  let p = clamp(vec2u(position.xy*sizes.render/sizes.output),vec2u(0),vec2u(sizes.render)-1u);
  let linear = max(rgba.rgb/max(rgba.a,1e-8),vec3f(0.0));
  let encoded = select(1.055*pow(linear,vec3f(1.0/2.4))-0.055,linear*12.92,linear<=vec3f(0.0031308));
  var result: Result; result.color = vec4f(encoded*rgba.a,rgba.a);
  result.depth = select(1.0,depth[p.y*u32(sizes.render.x)+p.x],rgba.a>0.0); return result;
}
