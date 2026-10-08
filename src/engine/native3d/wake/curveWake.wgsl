struct Params {
  viewProjection:mat4x4f, world:mat4x4f,
  rightSize:vec4f, upOpacity:vec4f, colorSeed:vec4f,
  pulse:vec4f, motion:vec4f, wave:vec4f, pad0:vec4f, pad1:vec4f,
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
struct VertexOut {
  @builtin(position) position:vec4f,
  @location(0) uv:vec2f,
  @location(1) opacity:f32,
}
@vertex fn vertex(@builtin(vertex_index) corner:u32,@builtin(instance_index) id:u32)->VertexOut {
  var out:VertexOut;out.position=vec4f(2.,2.,2.,1.);out.opacity=0.;out.uv=vec2f(0.);
  if(p.pulse.y<=0.){return out;}
  let key=id+u32(p.colorSeed.w)*7919u;
  let strand=id%u32(p.pulse.w);let range=ranges[strand];
  if(range.y<2u){return out;}
  let u=hash(key+11u);let at=u*f32(range.y-1u);let low=u32(floor(at));
  let a=points[range.x+low];let b=points[range.x+min(low+1u,range.y-1u)];
  let anchor=mix(a.position.xyz,b.position.xyz,fract(at));
  let waveDelay=(p.wave.x-anchor.z/p.wave.z)*p.wave.y/TAU;
  // Peak of (1-cos(phase))/2 is half a turn. Stagger each tiny release around it.
  let clock=p.pulse.x-waveDelay-.5-(hash(key+23u)-.5)*.14;
  let age=fract(clock)/p.pulse.y;
  let lifetime=min(p.pulse.z,.95/p.pulse.y)*(.65+.35*hash(key+31u));
  if(age>=lifetime){return out;}
  let fade=smoothstep(0.,.09,age)*(1.-smoothstep(.35*lifetime,lifetime,age));
  let damping=p.motion.y;
  let drift=p.motion.x*(.15*age+.85*(1.-exp(-damping*age))/damping);
  let angle=hash(key+41u)*TAU;let rate=p.motion.w*(.7+.6*hash(key+43u));
  let spread=(1.-exp(-age*1.1))*p.motion.z;
  let swirl=vec3f(sin(angle+age*rate)-sin(angle),cos(angle+age*rate*.83)-cos(angle),
    .3*(sin(angle+age*rate*.6)-sin(angle)))*spread;
  var normal=mix(a.normalRadius.xyz,b.normalRadius.xyz,fract(at));
  if(dot(normal,normal)<1e-8){normal=vec3f(cos(angle),sin(angle),0.);}else{normal=normalize(normal);}
  let radial=normal*(p.wave.w+spread*(.25+.5*hash(key+47u)));
  let local=anchor+radial+swirl+vec3f(0.,0.,-drift);
  let center=(p.world*vec4f(local,1.)).xyz;
  let worldScale=length(p.world[0].xyz);
  let size=p.rightSize.w*worldScale*(.4+1.1*hash(key+53u));
  let corners=array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
  let uv=corners[corner];
  out.position=p.viewProjection*vec4f(center+(p.rightSize.xyz*uv.x+p.upOpacity.xyz*uv.y)*size,1.);
  out.uv=uv;out.opacity=fade*p.upOpacity.w*(.3+.7*hash(key+59u));
  return out;
}
@fragment fn fragment(in:VertexOut)->@location(0) vec4f {
  let r=length(in.uv);let edge=max(fwidth(r),.02);
  if(r>1. || in.opacity<=.001){discard;}
  let alpha=(1.-smoothstep(1.-edge,1.,r))*in.opacity;
  return vec4f(p.colorSeed.rgb*alpha,alpha);
}
