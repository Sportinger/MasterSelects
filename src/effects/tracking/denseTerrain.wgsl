struct Params {
  r0:vec4f,r1:vec4f,r2:vec4f,k:vec4f,lens:vec4f,
  origin:vec4f,axisX:vec4f,axisY:vec4f,normal:vec4f,
  placement:vec4f,style:vec4f,color:vec4f,options:vec4f,
  occ01:vec4f,occ23:vec4f,bounds:vec4f,heights:vec4f,
  contour:array<vec4f,32>,
  foreground:array<vec4f,8>,
  decision:vec4f,decisionInfo:vec4f,
  analysis:array<vec4f,48>,
}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var texSampler:sampler;
@group(0) @binding(2) var source:texture_2d<f32>;
@group(0) @binding(3) var projectorDepth:texture_depth_2d;
struct Output {@builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) bary:vec3f}
fn ground(world:vec3f)->vec3f{let d=world-p.origin.xyz;return vec3f(dot(d,p.axisX.xyz),dot(d,p.axisY.xyz),dot(d,p.normal.xyz));}
@vertex fn meshVertex(@location(0) world:vec3f,@builtin(vertex_index) index:u32)->Output{
  let c=vec3f(dot(p.r0.xyz,world)+p.r0.w,dot(p.r1.xyz,world)+p.r1.w,dot(p.r2.xyz,world)+p.r2.w);
  let n=c.xy/c.z;let uv=n*(1+p.lens.x*dot(n,n))*p.k.xy+p.k.zw;
  var bary=vec3f(0);bary[index%3u]=1;
  return Output(vec4f((uv.x*2-1)*c.z,(1-uv.y*2)*c.z,c.z-.001,c.z),world,bary);
}
@vertex fn shadowVertex(@location(0) world:vec3f)->@builtin(position) vec4f{
  let g=ground(world);let uv=(g.xy-p.bounds.xy)/p.bounds.zw;
  return vec4f(uv.x*2-1,1-uv.y*2,(p.heights.y-g.z)/p.heights.z,1);
}
@vertex fn copyVertex(@builtin(vertex_index) index:u32)->@builtin(position) vec4f{
  let xy=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(xy[index],0,1);
}
@fragment fn copyFragment(@builtin(position) pos:vec4f)->@location(0) vec4f{return textureSampleLevel(source,texSampler,pos.xy/p.lens.yz,0);}
@fragment fn hudFragment(@builtin(position) pos:vec4f)->@location(0) vec4f{let uv=pos.xy/p.lens.yz;return searchHud(uv,textureSampleLevel(source,texSampler,uv,0));}
fn cross2(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
fn insideQuad(uv:vec2f,ab:vec4f,cd:vec4f)->bool{
  let a=ab.xy;let b=ab.zw;let c=cd.xy;let d=cd.zw;
  if(abs(cross2(b-a,c-a))<.000001){return false;}
  let e=vec4f(cross2(b-a,uv-a),cross2(c-b,uv-b),cross2(d-c,uv-c),cross2(a-d,uv-d));return all(e>=vec4f(0))||all(e<=vec4f(0));
}
fn occluded(uv:vec2f)->bool{
  if(insideQuad(uv,p.occ01,p.occ23)){return true;}
  for(var i=0u;i<u32(p.lens.w);i++){if(insideQuad(uv,p.foreground[i*2u],p.foreground[i*2u+1u])){return true;}}
  return false;
}
@fragment fn meshFragment(input:Output)->@location(0) vec4f{
  let screen=input.position.xy/p.lens.yz;
  let original=textureSampleLevel(source,texSampler,screen,0);
  let g=ground(input.world);let delta=g.xy-p.placement.xy;
  let cs=cos(p.style.x);let sn=sin(p.style.x);
  let uv=vec2f(cs*delta.x+sn*delta.y,-sn*delta.x+cs*delta.y)/p.placement.zw+.5;
  let centered=uv-.5;let halfSize=.5-clamp(p.options.w,0,.45);
  var distance=max(abs(centered.x),abs(centered.y))-halfSize;
  if(p.options.x==1){distance=length(centered)-halfSize;}
  if(p.options.z>=3){
    distance=100.;var inside=false;
    for(var i=0u;i<u32(p.options.z);i++){
      let a=p.contour[i].xy;let b=p.contour[(i+1u)%u32(p.options.z)].xy;let edge=b-a;
      distance=min(distance,length(uv-a-edge*clamp(dot(uv-a,edge)/max(dot(edge,edge),.00000001),0,1)));
      if((a.y>uv.y)!=(b.y>uv.y)){if(uv.x<(b.x-a.x)*(uv.y-a.y)/(b.y-a.y)+a.x){inside=!inside;}}
    }
    if(inside){distance=-distance;}
  }
  let aa=max(length(vec2f(dpdx(distance),dpdy(distance))),.00001);
  let line=1-smoothstep(p.style.w*aa,p.style.w*aa+aa,abs(distance));
  var alpha=max(line,(1-smoothstep(-aa,aa,distance))*p.style.z);
  // Stylized hiking outsole: staggered chevrons, central drainage gap and heel.
  // This makes the footprint legible; it is not a reconstruction of the sole.
  if(p.color.a>0){
    let x=uv.x-.5;let row=fract(uv.y*9+abs(x)*2.4);
    let lug=(1-smoothstep(.30,.36,abs(row-.5)))*smoothstep(.025,.05,abs(x));
    let inside=1-smoothstep(-aa*3,-aa,distance);
    let heelGap=smoothstep(.012,.022,abs(uv.y-.73));
    alpha=max(alpha,lug*inside*heelGap*.8);
  }
  if(p.options.x==2&&p.options.z<3){let diag=min(abs(centered.x-centered.y),abs(centered.x+centered.y));alpha=max(alpha,(1-smoothstep(p.style.w*aa,(p.style.w+1)*aa,diag))*select(0.,1.,distance<0));}
  var ink=p.color.rgb;
  if(p.decision.x>0){let hud=decisionMark(uv,aa,distance,alpha);ink=hud.rgb;alpha=hud.a;}
  let shadowUv=(g.xy-p.bounds.xy)/p.bounds.zw;
  let size=vec2i(textureDimensions(projectorDepth));let pixel=clamp(vec2i(shadowUv*vec2f(size)),vec2i(0),size-1);
  let top=textureLoad(projectorDepth,pixel,0);
  if((p.heights.y-g.z)/p.heights.z>top+.0015){alpha=0;}
  let edge=min(input.bary.x,min(input.bary.y,input.bary.z));let edgeAA=max(fwidth(edge),.00001);
  var wire=(1-smoothstep(edgeAA,edgeAA*1.8,edge))*p.options.y*.6;
  if(occluded(screen)){alpha=0;wire=0;}
  alpha*=p.style.y;
  let marked=mix(original.rgb,ink,alpha);
  return vec4f(mix(marked,vec3f(.2,.85,1),wire),original.a+max(alpha,wire)*(1-original.a));
}
