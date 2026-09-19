struct Triangle { a:vec4f, qa:vec4f, b:vec4f, qb:vec4f, c:vec4f, qc:vec4f }
struct TerrainParams {
  color:vec4f, display:vec4f, options:vec4f, occ01:vec4f, occ23:vec4f,
  triangles:array<Triangle,128>,
}
@group(0) @binding(0) var texSampler:sampler;
@group(0) @binding(1) var inputTex:texture_2d<f32>;
@group(0) @binding(2) var<uniform> params:TerrainParams;
fn cross2(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
fn isOccluded(p:vec2f)->bool{
  let a=params.occ01.xy;let b=params.occ01.zw;let c=params.occ23.xy;let d=params.occ23.zw;
  if(abs(cross2(b-a,c-a))<0.000001){return false;}
  let e=vec4f(cross2(b-a,p-a),cross2(c-b,p-b),cross2(d-c,p-c),cross2(a-d,p-d));
  return all(e>=vec4f(0))||all(e<=vec4f(0));
}
@fragment fn terrainOverlayFragment(input:VertexOutput)->@location(0) vec4f{
  let original=textureSample(inputTex,texSampler,input.uv);
  var nearest:f32=0;var uv=vec2f(-10);var edge:f32=1;
  for(var i:u32=0;i<min(u32(params.options.w),128u);i++){
    let t=params.triangles[i];
    let low=min(t.a.xy,min(t.b.xy,t.c.xy));let high=max(t.a.xy,max(t.b.xy,t.c.xy));
    if(any(input.uv<low)||any(input.uv>high)){continue;}
    let d=cross2(t.b.xy-t.a.xy,t.c.xy-t.a.xy);
    let b=cross2(input.uv-t.a.xy,t.c.xy-t.a.xy)/d;
    let c=cross2(t.b.xy-t.a.xy,input.uv-t.a.xy)/d;let a=1-b-c;
    if(min(a,min(b,c))< -0.00001){continue;}
    let invDepth=a*t.a.z+b*t.b.z+c*t.c.z;
    let q=a*t.qa.xyz+b*t.qb.xyz+c*t.qc.xyz;
    if(invDepth>nearest&&q.z>0){nearest=invDepth;uv=q.xy/q.z;edge=min(a,min(b,c));}
  }
  let centered=uv-.5;let halfSize=.5-clamp(params.options.x,0,.45);
  var distance=max(abs(centered.x),abs(centered.y))-halfSize;
  if(params.options.y==1){distance=length(centered)-halfSize;}
  let aa=max(length(vec2f(dpdx(distance),dpdy(distance))),.00001);
  let line=1-smoothstep(params.display.z*aa,params.display.z*aa+aa,abs(distance));
  let fill=(1-smoothstep(-aa,aa,distance))*params.display.w;
  var alpha=max(line,fill);
  if(params.options.y==2){let diagonal=min(abs(centered.x-centered.y),abs(centered.x+centered.y));alpha=max(alpha,(1-smoothstep(params.display.z*aa,params.display.z*aa+aa,diagonal))*select(0.0,1.0,distance<0));}
  let edgeWidth=max(fwidth(edge),.00001);
  var wire=(1-smoothstep(edgeWidth,edgeWidth*1.8,edge))*params.options.z*.75;
  if(nearest<=0||isOccluded(input.uv)){alpha=0;wire=0;}
  alpha*=params.color.a;
  let marked=mix(original.rgb,params.color.rgb,alpha);
  return vec4f(mix(marked,vec3f(.2,.85,1),wire),original.a+max(alpha,wire)*(1-original.a));
}
