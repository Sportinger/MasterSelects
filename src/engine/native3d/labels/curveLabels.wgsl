@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> points:array<Point>;
@group(0) @binding(2) var<storage,read> anchors:array<vec4f>;
@group(0) @binding(3) var<storage,read> glyphs:array<u32>;
@group(0) @binding(4) var atlas:texture_2d<f32>;
@group(0) @binding(5) var atlasSampler:sampler;
@group(0) @binding(6) var<storage,read> offsets:array<vec4f>;
@group(0) @binding(7) var<storage,read> tracked:array<vec4f>;
struct Out { @builtin(position) position:vec4f, @location(0) uv:vec2f,
 @location(1) alpha:f32, @location(2) @interpolate(flat) kind:u32, @location(3) @interpolate(flat) accent:f32, @location(4) @interpolate(flat) tint:vec3f, @location(5) @interpolate(flat) weight:f32 }
fn anchor(card:u32)->vec3f {return (p.world*vec4f(tracked[card].xyz,1)).xyz;}
fn flicker(t:f32,seed:f32)->f32 {
 let i=floor(t);let f=fract(t);let a=fract(sin(i*12.9898+seed)*43758.5453);
 let b=fract(sin((i+1.)*12.9898+seed)*43758.5453);
 return mix(a,b,f*f*(3.-2.*f));
}
fn signalColor(card:u32)->vec3f {
 let seed=f32(card)*7.173+1.;let wave=flicker(p.clock.x*6.7,seed)*.7+flicker(p.clock.x*13.1,seed+9.)*.3;
 let orange=vec3f(1.,.38,.055);let red=vec3f(1.,.055,.025);
 if(card<u32(round(p.arrangement.w*p.tracking.z))){
   let alert=mix(red,orange,smoothstep(.2,.8,wave))*(.82+wave*.28);
   return mix(p.color.rgb,alert,tracked[card].w);
 }
 let amount=smoothstep(1.-p.tracking.y-.14,1.-p.tracking.y+.14,wave)*p.tracking.x*p.tracking.y;
 return mix(p.color.rgb,orange,amount);
}
fn cardPoint(card:u32,q:vec2f,copy:u32)->vec3f {
 let trail=f32(copy);
 return projectedCardPoint(card,q,offsets[card].xy)+p.forward.xyz*p.arrangement.z*.045*trail
   +p.right.xyz*p.right.w*.022*trail+p.up.xyz*p.up.w*.014*trail;
}
fn echoAlpha(card:u32,copy:u32)->f32 {
 if(copy==0u){return 1.;}
 let decor=anchors[card*4u+3u];
 return select(0.,decor.y*.65*pow(.78,f32(copy-1u)),f32(copy)<=decor.x);
}
fn cardPhase(card:u32)->f32 {
 let period=anchors[card*4u+1u].w;
 return fract((p.clock.x-anchors[card*4u].w)/period)*period;
}
fn life(card:u32)->f32 {
 if(p.clock.x<anchors[card*4u].w){return 0.;}
 let phase=cardPhase(card);
 let visible=p.clock.y*p.clock.w;let duration=min(p.clock.z,visible*.5);
 return clamp(min(phase,visible-phase)/max(duration,.001),0.,1.);
}
fn fade(card:u32)->f32 {return smoothstep(0.,.08,life(card))*p.color.a;}
fn corner(vertex:u32)->vec2f {
 let q=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));return q[vertex];
}
@vertex fn lines(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 let card=(instance/70u)%u32(p.arrangement.w);let copy=(instance/70u)/u32(p.arrangement.w);let item=instance%70u;let trackedPoint=anchor(card);
 let reveal=life(card);var drawn=1.;
 let side=select(-1.,1.,card%2u==1u);var a=cardPoint(card,vec2f(-.5,.5),copy);var b=cardPoint(card,vec2f(.5,.5),copy);
 if(item<32u){
   if(roundCard(card)){
     let angle=f32(item)*6.28318530718/32.;let next=angle+6.28318530718/32.;
     a=cardPoint(card,vec2f(cos(angle),sin(angle))*.5,copy);b=cardPoint(card,vec2f(cos(next),sin(next))*.5,copy);
   }else{
     let corners=array<vec2f,5>(vec2f(-.5,.5),vec2f(.5,.5),vec2f(.5,-.5),vec2f(-.5,-.5),vec2f(-.5,.5));
     let edge=item/8u;let u=f32(item%8u)/8.;
     a=cardPoint(card,mix(corners[edge],corners[edge+1u],u),copy);b=cardPoint(card,mix(corners[edge],corners[edge+1u],u+.125),copy);
   }
 }
 let inset=select(1.,.76,roundCard(card));
 if(item==32u){a=cardPoint(card,vec2f(-.44,.205)*inset,copy);b=cardPoint(card,vec2f(.44,.205)*inset,copy);}
 if(item==33u){let s=fract(p.clock.x*.16+f32(card)*.13);a=cardPoint(card,vec2f(-.45+s*.9,-.46)*inset,copy);b=cardPoint(card,vec2f(-.45+s*.9,-.40)*inset,copy);}
 if(item==34u){a=cardPoint(card,vec2f(-.53,.5),copy);b=cardPoint(card,vec2f(-.53,.32),copy);}
 if(item==35u){a=cardPoint(card,vec2f(.53,-.5),copy);b=cardPoint(card,vec2f(.53,-.32),copy);}
 if(item==36u||item==37u){
   let joint=cardPoint(card,vec2f(-side*.5,0),copy);let elbow=joint-p.right.xyz*side*p.right.w*.1;
   a=select(elbow,trackedPoint,item==37u);b=select(joint,elbow,item==37u);
   drawn=select(smoothstep(.30,.42,reveal),smoothstep(.02,.30,reveal),item==37u);
 }
 if(item<32u){drawn=clamp(smoothstep(.28,.80,reveal)*32.-f32(item),0.,1.);}
 if(item>=32u&&item<=35u){drawn=smoothstep(.70,.95,reveal);}
 b=mix(a,b,drawn);
 var ca=p.vp*vec4f(a,1);var cb=p.vp*vec4f(b,1);
 if(item>=38u){
   let center=p.vp*vec4f(trackedPoint,1);let angle=f32(item-38u)*6.28318530718/32.;let next=angle+6.28318530718/32.;
   ca=center;cb=center;drawn=smoothstep(0.,.18,reveal);
   ca=vec4f(center.xy+vec2f(cos(angle),sin(angle))*p.metrics.w*mix(.45,1.,drawn)*2./p.viewport.xy*center.w,center.zw);
   cb=vec4f(center.xy+vec2f(cos(next),sin(next))*p.metrics.w*mix(.45,1.,drawn)*2./p.viewport.xy*center.w,center.zw);
 }
 let q=corner(vertex);let ndca=ca.xy/max(ca.w,1e-5);let ndcb=cb.xy/max(cb.w,1e-5);
 let direction=(ndcb-ndca)*p.viewport.xy;let len=max(length(direction),1e-5);let normal=vec2f(-direction.y,direction.x)/len;
 let weight=p.metrics.z*select(1.,p.viewport.z,item>=38u);
 var clip=mix(ca,cb,q.x);let spread=max(.7,weight)*2.;
 clip=vec4f(clip.xy+normal*(q.y-.5)*spread*2./p.viewport.xy*clip.w,clip.zw);
 var out:Out;out.position=clip;out.uv=vec2f(q.x,(q.y-.5)*spread);out.kind=0u;out.weight=weight;out.accent=0.;out.tint=signalColor(card);
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
 let glyph=clamp(code,32u,127u)-32u;let q=corner(vertex);
 var position=vec2f(-.445+(f32(col)+q.x)*.0445,.39-(f32(row)+q.y)*.208)*select(1.,.76,roundCard(card));
 if(p.motion.z>.5&&row>0u){position.x+=sin(p.clock.x*.8+f32(card)*1.3+f32(row))*.006;}
 if(p.motion.z>.5&&card%4u>=2u){position.y*=p.metrics.y/max(cardMetrics(card).y,.001);}
 position*=1.+(fract(f32(card)*.618034+.1)*2.-1.)*.12*p.animation.w;
 var out:Out;out.position=p.vp*vec4f(cardPoint(card,position,copy),1);out.kind=1u;out.weight=0.;out.tint=signalColor(card);
 let phase=cardPhase(card);
 out.accent=select(0.,smoothstep(1.2,1.5,phase)*(1.-smoothstep(3.5,3.8,phase)),accent);
 let face=select(select(0u,card%3u,p.motion.z>.5),3u,bold);
 out.uv=(vec2f(f32(glyph%16u),f32(glyph/16u+face*6u))+q)/vec2f(16,24);
 out.alpha=fade(card)*echoAlpha(card,copy)*smoothstep(.60,1.,life(card));return out;
}
@fragment fn fragment(in:Out)->@location(0) vec4f {
 var coverage=1.;
 if(in.kind==0u){coverage=clamp(in.weight*.5+.5-abs(in.uv.y),0.,1.);}
 else{coverage=textureSampleLevel(atlas,atlasSampler,in.uv,0.).a;}
 let alpha=in.alpha*coverage;return vec4f(mix(in.tint,vec3f(1.,.15,.11),in.accent*(1.-p.tracking.x))*alpha,alpha);
}
