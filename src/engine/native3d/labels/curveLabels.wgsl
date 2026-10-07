@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> points:array<Point>;
@group(0) @binding(2) var<storage,read> anchors:array<vec4f>;
@group(0) @binding(3) var<storage,read> glyphs:array<u32>;
@group(0) @binding(4) var atlas:texture_2d<f32>;
@group(0) @binding(5) var atlasSampler:sampler;
@group(0) @binding(6) var<storage,read> offsets:array<vec4f>;
struct Out { @builtin(position) position:vec4f, @location(0) uv:vec2f,
 @location(1) alpha:f32, @location(2) @interpolate(flat) kind:u32, @location(3) @interpolate(flat) accent:f32 }
fn anchor(card:u32)->vec3f {
 let a=anchors[card];return (p.world*vec4f(mix(points[u32(a.x)].position.xyz,points[u32(a.y)].position.xyz,a.z),1)).xyz;
}
fn cardPoint(card:u32,q:vec2f)->vec3f {return projectedCardPoint(card,q,offsets[card].xy);}
fn fade(card:u32)->f32 {
 let phase=fract(p.clock.x/p.clock.y+f32(card)*.173)*p.clock.y;
 return smoothstep(0.,.35,phase)*smoothstep(0.,.5,p.clock.y-phase)*p.color.a;
}
fn corner(vertex:u32)->vec2f {
 let q=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));return q[vertex];
}
@vertex fn lines(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 let card=instance/70u;let item=instance%70u;let trackedPoint=anchor(card);
 let side=select(-1.,1.,card%2u==1u);var a=cardPoint(card,vec2f(-.5,.5));var b=cardPoint(card,vec2f(.5,.5));
 if(item<32u){
   if(roundCard(card)){
     let angle=f32(item)*6.28318530718/32.;let next=angle+6.28318530718/32.;
     a=cardPoint(card,vec2f(cos(angle),sin(angle))*.5);b=cardPoint(card,vec2f(cos(next),sin(next))*.5);
   }else{
     let corners=array<vec2f,5>(vec2f(-.5,.5),vec2f(.5,.5),vec2f(.5,-.5),vec2f(-.5,-.5),vec2f(-.5,.5));
     let edge=item/8u;let u=f32(item%8u)/8.;
     a=cardPoint(card,mix(corners[edge],corners[edge+1u],u));b=cardPoint(card,mix(corners[edge],corners[edge+1u],u+.125));
   }
 }
 let inset=select(1.,.76,roundCard(card));
 if(item==32u){a=cardPoint(card,vec2f(-.44,.205)*inset);b=cardPoint(card,vec2f(.44,.205)*inset);}
 if(item==33u){let s=fract(p.clock.x*.16+f32(card)*.13);a=cardPoint(card,vec2f(-.45+s*.9,-.46)*inset);b=cardPoint(card,vec2f(-.45+s*.9,-.40)*inset);}
 if(item==34u){a=cardPoint(card,vec2f(-.53,.5));b=cardPoint(card,vec2f(-.53,.32));}
 if(item==35u){a=cardPoint(card,vec2f(.53,-.5));b=cardPoint(card,vec2f(.53,-.32));}
 if(item==36u||item==37u){
   let joint=cardPoint(card,vec2f(-side*.5,0));let elbow=joint-p.right.xyz*side*p.right.w*.1;
   a=select(joint,elbow,item==37u);b=select(elbow,trackedPoint,item==37u);
 }
 var ca=p.vp*vec4f(a,1);var cb=p.vp*vec4f(b,1);
 if(item>=38u){
   let center=p.vp*vec4f(trackedPoint,1);let angle=f32(item-38u)*6.28318530718/32.;let next=angle+6.28318530718/32.;
   ca=center;cb=center;
   ca=vec4f(center.xy+vec2f(cos(angle),sin(angle))*p.metrics.w*2./p.viewport.xy*center.w,center.zw);
   cb=vec4f(center.xy+vec2f(cos(next),sin(next))*p.metrics.w*2./p.viewport.xy*center.w,center.zw);
 }
 let q=corner(vertex);let ndca=ca.xy/max(ca.w,1e-5);let ndcb=cb.xy/max(cb.w,1e-5);
 let direction=(ndcb-ndca)*p.viewport.xy;let len=max(length(direction),1e-5);let normal=vec2f(-direction.y,direction.x)/len;
 var clip=mix(ca,cb,q.x);let spread=max(.7,p.metrics.z)*2.;
 clip=vec4f(clip.xy+normal*(q.y-.5)*spread*2./p.viewport.xy*clip.w,clip.zw);
 var out:Out;out.position=clip;out.uv=vec2f(q.x,(q.y-.5)*spread);out.kind=0u;out.accent=0.;
 out.alpha=fade(card)*select(0.,1.,ca.w>.001&&cb.w>.001&&!(roundCard(card)&&(item==34u||item==35u)));return out;
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
 let card=instance/80u;let slot=instance%80u;let row=slot/20u;let col=slot%20u;
 let accent=glyphs[instance]>=1024u;var code=glyphs[instance]%1024u;if(code>=256u){code=coordinateGlyph(code,anchor(card));}
 let glyph=clamp(code,32u,127u)-32u;let q=corner(vertex);
 var position=vec2f(-.445+(f32(col)+q.x)*.0445,.39-(f32(row)+q.y)*.208)*select(1.,.76,roundCard(card));
 if(p.motion.z>.5&&row>0u){position.x+=sin(p.clock.x*.8+f32(card)*1.3+f32(row))*.006;}
 var out:Out;out.position=p.vp*vec4f(cardPoint(card,position),1);out.kind=1u;
 let phase=fract(p.clock.x/p.clock.y+f32(card)*.173)*p.clock.y;
 out.accent=select(0.,smoothstep(1.2,1.5,phase)*(1.-smoothstep(3.5,3.8,phase)),accent);
 let face=select(select(0u,card%3u,p.motion.z>.5),3u,accent);
 out.uv=(vec2f(f32(glyph%16u),f32(glyph/16u+face*6u))+q)/vec2f(16,24);
 out.alpha=fade(card);return out;
}
@fragment fn fragment(in:Out)->@location(0) vec4f {
 var coverage=1.;
 if(in.kind==0u){coverage=clamp(p.metrics.z*.5+.5-abs(in.uv.y),0.,1.);}
 else{coverage=textureSampleLevel(atlas,atlasSampler,in.uv,0.).a;}
 let alpha=in.alpha*coverage;return vec4f(mix(p.color.rgb,vec3f(1.,.15,.11),in.accent)*alpha,alpha);
}
