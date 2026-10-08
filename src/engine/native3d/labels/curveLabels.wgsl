@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> points:array<Point>;
@group(0) @binding(2) var<storage,read> anchors:array<vec4f>;
@group(0) @binding(3) var<storage,read> glyphs:array<u32>;
@group(0) @binding(4) var atlas:texture_2d<f32>;
@group(0) @binding(5) var atlasSampler:sampler;
@group(0) @binding(6) var<storage,read> offsets:array<vec4f>;
@group(0) @binding(7) var<storage,read> tracked:array<vec4f>;
struct Out { @builtin(position) position:vec4f, @location(0) uv:vec2f,
 @location(1) alpha:f32, @location(2) @interpolate(flat) kind:u32, @location(3) @interpolate(flat) accent:f32, @location(4) @interpolate(flat) tint:vec3f, @location(5) @interpolate(flat) weight:f32, @location(6) @interpolate(flat) glitch:f32 }
fn anchor(card:u32)->vec3f {return (p.world*vec4f(tracked[card].xyz,1)).xyz;}
fn flicker(t:f32,seed:f32)->f32 {
 let i=floor(t);let f=fract(t);let a=fract(sin(i*12.9898+seed)*43758.5453);
 let b=fract(sin((i+1.)*12.9898+seed)*43758.5453);
 return mix(a,b,f*f*(3.-2.*f));
}
fn signalColor(card:u32,base:vec3f)->vec3f {
 let seed=f32(card)*7.173+1.;let wave=flicker(p.clock.x*6.7,seed)*.7+flicker(p.clock.x*13.1,seed+9.)*.3;
 let orange=vec3f(1.,.38,.055);let red=vec3f(1.,.055,.025);
 if(card<u32(round(p.arrangement.w*p.tracking.z))){
   let alert=mix(red,orange,smoothstep(.2,.8,wave))*(.82+wave*.28);
   return mix(base,alert,tracked[card].w);
 }
 let amount=smoothstep(1.-p.tracking.y-.14,1.-p.tracking.y+.14,wave)*p.tracking.x*p.tracking.y;
 return mix(base,orange,amount);
}
fn cardPoint(card:u32,q:vec2f,copy:u32)->vec3f {
 let trail=f32(copy);
 return projectedCardPoint(card,q,offsets[card].xy)+p.forward.xyz*p.arrangement.z*.045*trail
   +p.right.xyz*p.right.w*.022*trail+p.up.xyz*p.up.w*.014*trail;
}
fn windowPoint(card:u32,q:vec2f,copy:u32)->vec3f {
 return cardPoint(card,glitchGeometry(q,windowGlitch(card),glitchTick(card)),copy);
}
fn echoAlpha(card:u32,copy:u32)->f32 {
 if(copy==0u){return 1.;}
 let decor=anchors[card*4u+3u];
 return select(0.,decor.y*.65*pow(.90,f32(copy-1u)),f32(copy)<=decor.x);
}
fn cardPhase(card:u32)->f32 {
 return max(0.,p.clock.x-anchors[card*4u].w);
}
fn life(card:u32)->f32 {
 if(p.clock.x<anchors[card*4u].w){return 0.;}
 let phase=cardPhase(card);
 let visible=anchors[card*4u+1u].w;let duration=min(p.clock.z,visible*.5);
 return clamp(min(phase,visible-phase)/max(duration,.001),0.,1.);
}
fn fade(card:u32)->f32 {return smoothstep(0.,.08,life(card))*p.color.a;}
fn corner(vertex:u32)->vec2f {
 let q=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));return q[vertex];
}
@vertex fn lines(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 // Main card: 36 outline pieces, 64 leader pieces, 32 ring pieces.
 // Echoes only repeat their 36 outline pieces, never hidden rings/leader geometry.
 let count=u32(p.arrangement.w);let primary=instance<count*132u;
 let echo=max(instance,count*132u)-count*132u;
 let card=select((echo/36u)%count,instance/132u,primary);
 let copy=select(1u+(echo/36u)/count,0u,primary);
 let item=select(echo%36u,instance%132u,primary);let trackedPoint=anchor(card);
 let reveal=life(card);var drawn=1.;
 let side=select(-1.,1.,card%2u==1u);var a=windowPoint(card,vec2f(-.5,.5),copy);var b=windowPoint(card,vec2f(.5,.5),copy);
 if(item<32u){
   if(roundCard(card)){
     let angle=f32(item)*6.28318530718/32.;let next=angle+6.28318530718/32.;
     a=windowPoint(card,vec2f(cos(angle),sin(angle))*.5,copy);b=windowPoint(card,vec2f(cos(next),sin(next))*.5,copy);
   }else{
     let corners=array<vec2f,5>(vec2f(-.5,.5),vec2f(.5,.5),vec2f(.5,-.5),vec2f(-.5,-.5),vec2f(-.5,.5));
     let edge=item/8u;let u=f32(item%8u)/8.;
     a=windowPoint(card,mix(corners[edge],corners[edge+1u],u),copy);b=windowPoint(card,mix(corners[edge],corners[edge+1u],u+.125),copy);
   }
 }
 let inset=select(1.,.76,roundCard(card));
 if(item==32u){a=windowPoint(card,vec2f(-.44,.205)*inset,copy);b=windowPoint(card,vec2f(.44,.205)*inset,copy);}
 if(item==33u){let s=fract(p.clock.x*.16+f32(card)*.13);a=windowPoint(card,vec2f(-.45+s*.9,-.46)*inset,copy);b=windowPoint(card,vec2f(-.45+s*.9,-.40)*inset,copy);}
 if(item==34u){a=windowPoint(card,vec2f(-.53,.5),copy);b=windowPoint(card,vec2f(-.53,.32),copy);}
 if(item==35u){a=windowPoint(card,vec2f(.53,-.5),copy);b=windowPoint(card,vec2f(.53,-.32),copy);}
 if(item>=36u&&item<100u){
   let joint=cardPoint(card,vec2f(-side*.5,0),copy);let elbow=joint-p.right.xyz*side*p.right.w*.1;
   let local=item-36u;let second=local>=32u;let segment=local%32u;
   let start=select(trackedPoint,elbow,second);let end=select(elbow,joint,second);
   a=glitchLeaderPoint(card,start,end,f32(segment)/32.);
   b=glitchLeaderPoint(card,start,end,f32(segment+1u)/32.);
   let progress=select(smoothstep(.02,.30,reveal),smoothstep(.30,.42,reveal),second);
   drawn=clamp(progress*32.-f32(segment),0.,1.);
 }
 if(item<32u){drawn=clamp(smoothstep(.28,.80,reveal)*32.-f32(item),0.,1.);}
 if(item>=32u&&item<=35u){drawn=smoothstep(.70,.95,reveal);}
 if(item<36u){
   let offset=windowGlitchOffset(card,f32(item/4u));
   let shift=cardPoint(card,offset,copy)-cardPoint(card,vec2f(0),copy);a+=shift;b+=shift;
 }
 b=mix(a,b,drawn);
 var ca=p.vp*vec4f(a,1);var cb=p.vp*vec4f(b,1);
 if(item>=100u){
   let center=p.vp*vec4f(trackedPoint,1);let angle=f32(item-100u)*6.28318530718/32.;let next=angle+6.28318530718/32.;
   ca=center;cb=center;drawn=smoothstep(0.,.18,reveal);
   ca=vec4f(center.xy+vec2f(cos(angle),sin(angle))*p.metrics.w*mix(.45,1.,drawn)*2./p.viewport.xy*center.w,center.zw);
   cb=vec4f(center.xy+vec2f(cos(next),sin(next))*p.metrics.w*mix(.45,1.,drawn)*2./p.viewport.xy*center.w,center.zw);
 }
 let q=corner(vertex);let ndca=ca.xy/max(ca.w,1e-5);let ndcb=cb.xy/max(cb.w,1e-5);
 let direction=(ndcb-ndca)*p.viewport.xy;let len=max(length(direction),1e-5);let normal=vec2f(-direction.y,direction.x)/len;
 let isTracker=item>=36u;
 let weight=p.metrics.z*select(select(1.,p.viewport.w,isTracker),p.viewport.z,item>=100u);
 let haloRadius=max(p.metrics.z*3.,weight*1.5);
 var clip=mix(ca,cb,q.x);let spread=max(.7,weight)*2.+select(0.,haloRadius*6.,isTracker&&p.marker.w>0.)+select(windowGlitch(card)*max(6.,weight*16.),0.,isTracker);
 clip=vec4f(clip.xy+normal*(q.y-.5)*spread*2./p.viewport.xy*clip.w,clip.zw);
 var out:Out;out.position=clip;out.uv=vec2f(q.x,(q.y-.5)*spread);out.glitch=select(windowGlitch(card),0.,isTracker);out.kind=select(0u,2u,isTracker);out.weight=weight;out.accent=0.;out.tint=signalColor(card,select(p.color.rgb,p.marker.rgb,item>=100u));
 out.alpha=fade(card)*echoAlpha(card,copy)*select(0.,1.,(copy==0u||item<36u)&&drawn>.0001&&ca.w>.001&&cb.w>.001&&!(roundCard(card)&&(item==34u||item==35u)));return out;
}
fn coordinateGlyph(code:u32,position:vec3f)->u32 {
 let axis=(code-256u)/8u;let slot=(code-256u)%8u;let v=position[axis];
 if(slot==0u){return select(43u,45u,v<0.);}
 if(slot==4u){return 46u;}
 let digits=u32(round(min(abs(v),999.99)*100.));
 let powers=array<u32,7>(1u,10000u,1000u,100u,1u,10u,1u);
 return 48u+(digits/powers[slot])%10u;
}
@vertex fn text(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 let card=(instance/80u)%u32(p.arrangement.w);let copy=(instance/80u)/u32(p.arrangement.w);let slot=instance%80u;let glyphIndex=card*80u+slot;let row=slot/20u;let col=slot%20u;
 let accent=(glyphs[glyphIndex]&1024u)!=0u;let bold=accent||(glyphs[glyphIndex]&2048u)!=0u||(anchors[card*4u+3u].z>.5&&row==0u);var code=glyphs[glyphIndex]%1024u;if(code>=256u){code=coordinateGlyph(code,anchor(card));}
 let disturbance=windowGlitch(card);
 // Temporary display corruption leaves the underlying coordinate values untouched.
 if(glitchRandom(glitchTick(card)+f32(slot)*7.)<disturbance*.45&&code!=32u){code=33u+u32(glitchRandom(f32(slot)+glitchTick(card)+3.)*58.);}
 let glyph=clamp(code,32u,127u)-32u;let q=corner(vertex);
 var position=vec2f(-.445+(f32(col)+q.x)*.0445,.39-(f32(row)+q.y)*.208)*select(1.,.76,roundCard(card));
 if(p.motion.z>.5&&row>0u){position.x+=sin(p.clock.x*.8+f32(card)*1.3+f32(row))*.006;}
 if(p.motion.z>.5&&card%4u>=2u){position.y*=p.metrics.y/max(cardMetrics(card).y,.001);}
 position*=1.+(fract(f32(card)*.618034+.1)*2.-1.)*.12*p.animation.w;
 let group=f32(row*4u+col/5u);
 let groupCenter=vec2f(-.445+(f32((col/5u)*5u)+2.5)*.0445,.39-(f32(row)+.5)*.208)*select(1.,.76,roundCard(card));
 position=groupCenter+(position-groupCenter)*windowGlyphScale(card,group);
 position=glitchGeometry(position,disturbance,glitchTick(card));
 position+=windowGlitchOffset(card,group);
 var out:Out;out.position=p.vp*vec4f(cardPoint(card,position,copy),1);out.glitch=disturbance;out.kind=1u;out.weight=0.;out.tint=signalColor(card,p.color.rgb);
 let phase=cardPhase(card);
 out.accent=select(0.,smoothstep(1.2,1.5,phase)*(1.-smoothstep(3.5,3.8,phase)),accent);
 let face=select(select(0u,card%3u,p.motion.z>.5),3u,bold);
 out.uv=(vec2f(f32(glyph%16u),f32(glyph/16u+face*6u))+q)/vec2f(16,24);
 out.alpha=fade(card)*echoAlpha(card,copy)*smoothstep(.60,1.,life(card));return out;
}
@vertex fn blocks(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 let count=u32(p.arrangement.w);let card=(instance/6u)%count;let copy=(instance/6u)/count;let block=instance%6u;
 let seed=glitchTick(card)+f32(block)*37.;let amount=windowGlitch(card);
 let center=vec2f(glitchRandom(seed)-.5,glitchRandom(seed+2.)-.5)*.72;
 var extent=vec2f(.08+glitchRandom(seed+4.)*.38,.03+glitchRandom(seed+8.)*.13);
 let sphere=block%3u==2u;
 if(sphere){extent=vec2f(.14+glitchRandom(seed+4.)*.2);extent.y*=p.right.w*cardMetrics(card).x/max(p.up.w*cardMetrics(card).y,.001);}
 let position=center+(corner(vertex)-.5)*extent;
 var out:Out;out.position=p.vp*vec4f(windowPoint(card,position,copy),1);out.uv=corner(vertex);out.kind=select(3u,4u,sphere);
 out.weight=0.;out.glitch=amount;out.accent=0.;out.tint=mix(vec3f(.1,.9,1.),vec3f(1.,.16,.25),glitchRandom(seed+6.));
 out.alpha=fade(card)*echoAlpha(card,copy)*amount*.85*select(0.,1.,glitchRandom(seed+11.)<.3+amount*.65)*smoothstep(.6,1.,life(card));return out;
}
@fragment fn fragment(in:Out)->@location(0) vec4f {
 var coverage=1.;
 if(in.kind==0u||in.kind==2u){
   coverage=clamp(in.weight*.5+.5-abs(in.uv.y),0.,1.);
   if(in.kind==2u&&p.marker.w>0.){
     let radius=max(p.metrics.z*3.,in.weight*1.5);
     let distance=max(0.,abs(in.uv.y)-in.weight*.5);
     let halo=exp(-2.*distance*distance/(radius*radius))*.38*p.marker.w;
     coverage=coverage+(1.-coverage)*halo;
   }
 }
 else if(in.kind==1u){
   coverage=textureSampleLevel(atlas,atlasSampler,in.uv,0.).a;
   if(in.glitch>.001){
     let grid=vec2f(16,24);let cell=floor(in.uv*grid);let inset=vec2f(.001)/grid;
     let offset=vec2f(in.glitch*.014,0.);
     let red=textureSampleLevel(atlas,atlasSampler,clamp(in.uv-offset,cell/grid+inset,(cell+1.)/grid-inset),0.).a;
     let blue=textureSampleLevel(atlas,atlasSampler,clamp(in.uv+offset,cell/grid+inset,(cell+1.)/grid-inset),0.).a;
     let radius=vec2f(.003,.002)*in.glitch;
     let upper=textureSampleLevel(atlas,atlasSampler,clamp(in.uv+radius,cell/grid+inset,(cell+1.)/grid-inset),0.).a;
     let lower=textureSampleLevel(atlas,atlasSampler,clamp(in.uv-radius,cell/grid+inset,(cell+1.)/grid-inset),0.).a;
     let halo=(red+blue+upper+lower)*.14*in.glitch;
     let channels=vec3f(red,coverage,blue);let alpha=min(1.,max(red,max(coverage,blue))+halo)*in.alpha;
     return vec4f((channels*(1.+in.glitch*2.)+vec3f(halo))*mix(in.tint,vec3f(1),in.glitch*.8)*in.alpha,alpha);
   }
 }
 if(in.kind==0u&&in.glitch>.001){
   let split=in.glitch*max(1.,in.weight)*1.8;
   let red=clamp(in.weight*.5+.5-abs(in.uv.y-split),0.,1.);
   let blue=clamp(in.weight*.5+.5-abs(in.uv.y+split),0.,1.);
   let radius=max(2.,in.weight*2.8);
   let halo=exp(-abs(in.uv.y)*abs(in.uv.y)/(radius*radius))*.4*in.glitch;
   let channels=vec3f(red,coverage,blue);let alpha=min(1.,max(red,max(coverage,blue))+halo)*in.alpha;
   return vec4f((channels*(1.+in.glitch*2.5)+vec3f(halo))*mix(in.tint,vec3f(1),in.glitch*.8)*in.alpha,alpha);
 }
 if(in.kind==3u||in.kind==4u){
   let q=(in.uv-.5)*2.;
   var distance=abs(max(abs(q.x),abs(q.y))-.72);
   if(in.kind==4u){
     distance=min(abs(length(q)-.72),min(abs(length(q*vec2f(2.4,1.))-.72),abs(length(q*vec2f(1.,2.4))-.72)));
   }
   let core=1.-smoothstep(.025,.075,distance);
   let halo=exp(-distance*distance*32.)*.4;
   let alpha=(core+(1.-core)*halo)*in.alpha;
   return vec4f(in.tint*(core*3.+halo)*in.alpha,alpha);
 }
 let alpha=in.alpha*coverage;return vec4f(mix(in.tint,vec3f(1.,.15,.11),in.accent*(1.-p.tracking.x))*alpha,alpha);
}
