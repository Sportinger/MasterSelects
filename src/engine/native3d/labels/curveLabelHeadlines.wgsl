@group(1) @binding(0) var headlines:texture_2d<f32>;
@group(1) @binding(1) var headlineSampler:sampler;
@group(1) @binding(2) var<storage,read> headlineBounds:array<vec4f>;
struct HeadlineOut {
 @builtin(position) position:vec4f, @location(0) uv:vec2f,
 @location(1) alpha:f32, @location(2) pulse:f32,
 @location(3) @interpolate(flat) bounds:vec4f,
}
@vertex fn headlineVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) item:u32)->HeadlineOut {
 let index=select(p.intro.x,p.intro.y,item==1u);let card=u32(max(0.,index));
 let row=u32(select(p.headline.x,p.headline.y,item==1u));let bounds=headlineBounds[row];
 let pulse=select(p.headline.z,p.headline.w,item==1u);
 let center=cardPoint(card,vec2f(0),0u);
 let right=cardPoint(card,vec2f(1,0),0u)-center;let up=cardPoint(card,vec2f(0,1),0u)-center;
 let aspect=length(right)/max(length(up),1e-6);
 let textAspect=bounds.z*1024./max(bounds.w*p.headlineMotion.z,1.);
 var extent=vec2f(.9,.9*aspect/max(textAspect,.01));extent*=min(1.,.74/max(extent.y,.01));
 let cornerUV=corner(vertex);let q=vec2f(cornerUV.x-.5,.5-cornerUV.y)*extent;
 let time=p.clock.x;let seed=f32(card)*1.731;
 let yaw=sin(time*.57+seed)*.08*p.headlineMotion.y;
 let pitch=sin(time*.43+seed+2.)*.08*p.headlineMotion.y;
 let roll=sin(time*.37+seed+1.)*.04*p.headlineMotion.y;
 let raw=cross(right,up);var normal=raw/max(length(raw),1e-6);
 normal*=select(-1.,1.,dot(normal,p.liveEye.xyz-center)>=0.);
 let xr=right*cos(yaw)+normal*length(right)*sin(yaw);
 let yu=up*cos(pitch)+normal*length(up)*sin(pitch);
 let rotated=vec2f(q.x*cos(roll)-q.y*sin(roll),q.x*sin(roll)+q.y*cos(roll));
 let drift=vec2f(sin(time*.49+seed),sin(time*.39+seed+2.))*.012*p.headlineMotion.y;
 let depth=p.headlineMotion.x*p.arrangement.z*(1.+sin(time*.33+seed)*.18*p.headlineMotion.y);
 let glitch=vec2f(sin(floor(time*42.)*13.+seed),cos(floor(time*37.)*7.+seed))*.014*pulse;
 let position=center+xr*(rotated.x+drift.x+glitch.x)+yu*(rotated.y+drift.y)+normal*depth;
 var out:HeadlineOut;out.position=p.vp*vec4f(position,1);out.uv=bounds.xy+corner(vertex)*bounds.zw;
 out.bounds=bounds;out.pulse=pulse;out.alpha=smoothstep(0.,.08,life(card))*p.headlineMotion.w*smoothstep(.6,1.,life(card))*select(0.,1.,index>=0.);
 return out;
}
@fragment fn headlineFragment(in:HeadlineOut)->@location(0) vec4f {
 let inset=vec2f(.0005);let lo=in.bounds.xy+inset;let hi=in.bounds.xy+in.bounds.zw-inset;
 let band=floor((in.uv.y-in.bounds.y)/in.bounds.w*12.);
 let jitter=sin(band*17.+floor(p.clock.x*45.)*7.)*.018*in.pulse;
 let uv=clamp(in.uv+vec2f(jitter,0),lo,hi);
 let split=vec2f(.006*in.pulse,0);
 let red=textureSampleLevel(headlines,headlineSampler,clamp(uv-split,lo,hi),0.).a;
 let green=textureSampleLevel(headlines,headlineSampler,uv,0.).a;
 let blue=textureSampleLevel(headlines,headlineSampler,clamp(uv+split,lo,hi),0.).a;
 let alpha=max(red,max(green,blue))*in.alpha;
 return vec4f(vec3f(red,green,blue)*in.alpha,alpha);
}
