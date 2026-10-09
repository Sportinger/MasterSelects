@group(0) @binding(3) var<storage,read> states:array<WakeState>;
struct VertexOut {
  @builtin(position) position:vec4f,
  @location(0) uv:vec2f,
  @location(1) opacity:f32,
}
@vertex fn vertex(@builtin(vertex_index) corner:u32,@builtin(instance_index) id:u32)->VertexOut {
  var out:VertexOut;out.position=vec4f(2.,2.,2.,1.);out.opacity=0.;out.uv=vec2f(0.);
  let state=states[id];let alpha=state.appearance.x*p.upOpacity.w;
  if(alpha<=.001){return out;}
  let corners=array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
  let uv=corners[corner];let center=state.positionAge.xyz;
  if(p.display.z>=1.){
    // Density dissolves rather than transparency: surviving pixels stay bright and sharp.
    if(state.appearance.z>alpha){return out;}
    var clip=p.viewProjection*vec4f(center,1.);
    if(clip.w<=0.){return out;}
    let screen=(clip.xy/clip.w*.5+.5)*p.display.xy;
    let diameter=floor(p.display.z+.5);
    let snapped=floor(screen)+vec2f(fract(diameter*.5));
    clip.x=((snapped.x+uv.x*diameter*.5)/p.display.x*2.-1.)*clip.w;
    clip.y=((snapped.y+uv.y*diameter*.5)/p.display.y*2.-1.)*clip.w;
    out.position=clip;out.opacity=1.;
  }else{
    let size=p.rightSize.w*length(p.world[0].xyz)*(.4+1.1*state.appearance.y);
    out.position=p.viewProjection*vec4f(center+(p.rightSize.xyz*uv.x+p.upOpacity.xyz*uv.y)*size,1.);
    out.opacity=alpha*(.3+.7*state.appearance.z);
  }
  out.uv=uv;return out;
}
@fragment fn fragment(in:VertexOut)->@location(0) vec4f {
  if(p.display.z>=1.){return vec4f(p.colorSeed.rgb*p.display.w,1.);}
  let r=length(in.uv);let edge=max(fwidth(r),.02);
  if(r>1. || in.opacity<=.001){discard;}
  let alpha=(1.-smoothstep(1.-edge,1.,r))*in.opacity;
  return vec4f(p.colorSeed.rgb*alpha*p.display.w,alpha);
}
