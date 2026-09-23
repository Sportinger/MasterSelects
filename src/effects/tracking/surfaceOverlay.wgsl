struct Params {
  row0: vec4f, row1: vec4f, row2: vec4f,
  color: vec4f, display: vec4f, options: vec4f,
  occ01: vec4f, occ23: vec4f,
  contour: array<vec4f,64>,
}
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;
fn cross2(a: vec2f,b: vec2f)->f32 {return a.x*b.y-a.y*b.x;}
fn occluded(p: vec2f)->bool {
  let a=params.occ01.xy;let b=params.occ01.zw;let c=params.occ23.xy;let d=params.occ23.zw;
  let edges=vec4f(cross2(b-a,p-a),cross2(c-b,p-b),cross2(d-c,p-c),cross2(a-d,p-d));
  return all(edges>=vec4f(0))||all(edges<=vec4f(0));
}
@fragment fn surfaceOverlayFragment(input: VertexOutput)->@location(0) vec4f {
  let original=textureSample(inputTex,texSampler,input.uv);
  let p=vec3f(input.uv,1);
  let w=dot(params.row2.xyz,p);
  let uv=vec2f(dot(params.row0.xyz,p),dot(params.row1.xyz,p))/w;
  let inset=clamp(params.options.x,0,0.45);
  let halfSize=0.5-inset;
  let centered=uv-0.5;
  var distance=max(abs(centered.x),abs(centered.y))-halfSize;
  if(params.options.y==1) {distance=length(centered)-halfSize;}
  let aa=max(length(vec2f(dpdx(distance),dpdy(distance))),0.00001);
  let line=1-smoothstep(params.display.z*aa,params.display.z*aa+aa,abs(distance));
  let fill=(1-smoothstep(-aa,aa,distance))*params.display.w;
  var alpha=max(line,fill);
  if(params.options.y==2) {
    let diagonal=min(abs(centered.x-centered.y),abs(centered.x+centered.y));
    alpha=max(alpha,(1-smoothstep(params.display.z*aa,params.display.z*aa+aa,diagonal))*select(0.0,1.0,distance<0));
  }
  if(params.options.w>=3) {
    let count=u32(params.options.w);
    let pixel=input.uv*params.display.xy;
    var closest=1e10;
    var inside=false;
    for(var i=0u;i<count;i++) {
      let a=params.contour[i].xy*params.display.xy;
      let b=params.contour[(i+1u)%count].xy*params.display.xy;
      let edge=b-a;
      let t=clamp(dot(pixel-a,edge)/max(dot(edge,edge),0.000001),0.0,1.0);
      closest=min(closest,length(pixel-a-t*edge));
      if((a.y>pixel.y)!=(b.y>pixel.y)) {
        if(pixel.x<(b.x-a.x)*(pixel.y-a.y)/(b.y-a.y)+a.x) {inside=!inside;}
      }
    }
    alpha=max(1-smoothstep(params.display.z,params.display.z+1,closest),select(0.0,params.display.w,inside));
  }
  if(w<=0 || (params.options.z>0 && occluded(input.uv))) {alpha=0;}
  alpha*=params.color.a;
  return vec4f(mix(original.rgb,params.color.rgb,alpha),original.a+alpha*(1-original.a));
}
