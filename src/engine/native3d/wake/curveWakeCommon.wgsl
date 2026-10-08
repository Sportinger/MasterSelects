struct Params {
  viewProjection:mat4x4f, world:mat4x4f,
  rightSize:vec4f, upOpacity:vec4f, colorSeed:vec4f,
  pulse:vec4f, motion:vec4f, wave:vec4f, display:vec4f, step:vec4f, vortex:vec4f,
}
struct Point { position:vec4f, normalRadius:vec4f, tangentStrand:vec4f }
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> points:array<Point>;
@group(0) @binding(2) var<storage,read> ranges:array<vec2u>;
const TAU=6.28318530718;
fn hash(value:u32)->f32 {
  var v=value;v^=v>>16u;v*=0x7feb352du;v^=v>>15u;v*=0x846ca68bu;v^=v>>16u;
  return f32(v & 0x00ffffffu)/16777216.;
}
struct WakeState { positionAge:vec4f, velocityCycle:vec4f, anchorTime:vec4f, appearance:vec4f, vortexCenter:vec4f, vortexAxis:vec4f, vortexDrift:vec4f }
