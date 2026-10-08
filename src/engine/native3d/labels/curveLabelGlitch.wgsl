// One second from top-right to bottom-left in the CURRENT camera view.
// Only window geometry/text uses these helpers; anchors and leaders remain intact.
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
 return vec2f((glitchRandom(seed)-.5)*.16,(glitchRandom(seed+9.)-.5)*.035)*amount;
}
