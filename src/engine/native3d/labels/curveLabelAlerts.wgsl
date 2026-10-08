// Existing bold glyph atlas, shared card geometry and tracking readiness.
// At most six groups of four glyphs per card; no texture regeneration or readback.
@vertex fn alerts(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 let card=(instance/4u)%u32(p.arrangement.w);
 let group=(instance/4u)/u32(p.arrangement.w);let letter=instance%4u;
 let seed=f32(card)*97.13+f32(group)*31.7+floor(anchors[card*4u].w*17.);
 let letters=2u+u32(glitchRandom(seed+1.)*3.);
 let threshold=(f32(group)+glitchRandom(seed+2.)*.45)/6.;
 let growth=smoothstep(threshold,threshold+.07,p.tracking.y);
 let acquired=tracked[card].w>=.999&&tracked[card].w<1.5&&p.tracking.x>0.
   &&card<u32(round(p.arrangement.w*p.tracking.z));
 let q=corner(vertex);
 let size=vec2f(.045+.024*glitchRandom(seed+3.),.18+.10*glitchRandom(seed+4.));
 let inset=select(1.,.72,roundCard(card));
 let center=vec2f((glitchRandom(seed+5.)-.5)*.40,(glitchRandom(seed+6.)-.5)*.50)*inset;
 var position=center+vec2f((f32(letter)+q.x-f32(letters)*.5)*size.x,(.5-q.y)*size.y)*inset;
 position=glitchGeometry(position,windowGlitch(card),glitchTick(card));
 var out:Out;out.position=p.vp*vec4f(cardPoint(card,position,0u),1);
 // ASCII !, face 3 = bold sans. Keep warnings red even during orange card flicker.
 out.uv=(vec2f(1,18)+q)/vec2f(16,30);out.kind=1u;out.tint=vec3f(1.,.065,.035);
 out.weight=0.;out.accent=0.;out.glitch=windowGlitch(card)*.25;
 out.alpha=fade(card)*smoothstep(.6,1.,life(card))*growth*(.65+.35*flicker(p.clock.x*7.,seed))
   *select(0.,1.,acquired&&letter<letters);
 return out;
}
