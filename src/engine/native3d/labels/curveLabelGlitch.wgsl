// One second from top-right to bottom-left in the CURRENT camera view.
// Window geometry/text and leader curves use these helpers; tracking anchors remain intact.
fn glitchRandom(seed:f32)->f32 {return fract(sin(seed*12.9898+78.233)*43758.5453);}
fn glitchArrival(ndc:vec2f)->f32 {return clamp((2.-ndc.x-ndc.y)*.25,0.,1.);}
fn glitchRecovery(card:u32)->f32 {return 1.+glitchRandom(f32(card)*17.+p.glitch.y*71.+4.);}
fn glitchEnvelope(age:f32,arrival:f32,recovery:f32)->f32 {
 let local=age-arrival;
 return smoothstep(0.,.035,local)*pow(clamp(1.-local/recovery,0.,1.),1.35);
}
fn windowGlitch(card:u32)->f32 {
 if(p.glitch.z<=0.||p.glitch.x<0.||p.glitch.x>3.){return 0.;}
 let center=p.vp*vec4f(projectedCardPoint(card,vec2f(0),offsets[card].xy),1);
 if(center.w<=.001){return 0.;}
 return glitchEnvelope(p.glitch.x,glitchArrival(center.xy/center.w),glitchRecovery(card))*p.glitch.z;
}
fn glitchTick(card:u32)->f32 {return floor(p.clock.x*18.)+f32(card)*29.+p.glitch.y*101.;}
fn windowGlitchOffset(card:u32,group:f32)->vec2f {
 let amount=windowGlitch(card);let seed=glitchTick(card)+group*13.;
 return vec2f((glitchRandom(seed)-.5)*.36,(glitchRandom(seed+9.)-.5)*.09)*amount;
}
// Keep distortion in window-local coordinates; tracking anchors are never warped.
fn glitchGeometry(q:vec2f,amount:f32,seed:f32)->vec2f {
 let scale=vec2f(1.)+vec2f(glitchRandom(seed+3.)-.5,glitchRandom(seed+7.)-.5)*amount*1.7;
 let shear=(glitchRandom(seed+17.)-.5)*amount*.8;
 let band=floor((q.y+.5)*7.);
 return q*scale+vec2f(q.y*shear+(glitchRandom(seed+band*31.)-.5)*amount*.18,0.);
}
fn windowGlyphScale(card:u32,group:f32)->f32 {
 return 1.+windowGlitch(card)*(glitchRandom(glitchTick(card)+group*19.)*1.65-.4);
}
// A continuously morphing connection, with both attachments held exactly in place.
fn glitchLeaderPoint(card:u32,a:vec3f,b:vec3f,t:f32)->vec3f {
 if(t<=0.){return a;}if(t>=1.){return b;}
 let delta=b-a;let span=max(.00001,length(delta));let direction=delta/span;
 let crossDirection=cross(direction,p.forward.xyz);
 let side=normalize(select(p.right.xyz,crossDirection,dot(crossDirection,crossDirection)>.00001));
 let amount=windowGlitch(card);let phase=p.clock.x*5.+f32(card)*1.7;
 let envelope=sin(t*3.14159265);let size=span*.32*amount;
 return mix(a,b,t)+side*sin(t*6.2831853+sin(phase)*.65)*envelope*size
   +direction*sin(t*12.5663706)*envelope*size*.7
   +p.forward.xyz*sin(t*6.2831853-phase)*envelope*size*.15;
}
