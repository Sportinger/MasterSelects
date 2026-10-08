struct Params {
  vp:mat4x4f, world:mat4x4f, right:vec4f, up:vec4f, forward:vec4f, eye:vec4f,
  viewport:vec4f, color:vec4f, metrics:vec4f, arrangement:vec4f, clock:vec4f, motion:vec4f, tracking:vec4f, animation:vec4f, marker:vec4f, glitch:vec4f,
  liveRight:vec4f, liveUp:vec4f, liveForward:vec4f, liveEye:vec4f, lock:vec4f, intro:vec4f, headline:vec4f, headlineMotion:vec4f,
}
struct Point { position:vec4f, normal:vec4f, tangent:vec4f }
fn roundCard(card:u32)->bool {return p.motion.z>.5&&(card%4u==1u||card%4u==2u);}
fn introCard(card:u32)->bool {return p.intro.z>0.&&(abs(f32(card)-p.intro.x)<.1||abs(f32(card)-p.intro.y)<.1);}
fn cardMetrics(card:u32)->vec2f {
 let introScale=select(1.,p.intro.z,introCard(card));
 if(p.motion.z<.5){return p.metrics.xy*introScale;}
 let phase=fract(f32(card)*.618034+.17);
 let size=vec2f(mix(.78,1.18,phase),mix(.82,1.3,fract(phase+.37)));
 var metrics=p.metrics.xy*mix(vec2f(1),size,p.motion.w);
 if(card%4u>=2u){metrics.y=metrics.x*p.right.w/max(p.up.w,.0001);}
 return metrics*introScale;
}
fn labelRowSpacing()->f32 {
 let rows=ceil(p.arrangement.w*.5);
 let height=max(p.metrics.y,select(0.,p.metrics.x*p.right.w/max(p.up.w,.0001),p.motion.z>.5))*(1.+select(0.,.3*p.motion.w,p.motion.z>.5));
 return min(p.arrangement.y,max(.05,(1.8-height)/max(rows-1.,1.)));
}
// Independent smooth excursions return all axes to camera-parallel rest each cycle.
// No permanent side bias, no frame history and zero angular speed at rest boundaries.
fn rotationRandom(seed:f32)->f32 {return fract(sin(seed*127.1)*43758.5453);}
fn rotationEase(u:f32)->f32 {let t=clamp(u,0.,1.);return t*t*t*(t*(t*6.-15.)+10.);}
fn cardRotation(card:u32)->vec3f {
 let seed=f32(card)*17.31+3.;let period=10.+rotationRandom(seed)*5.;
 let time=p.clock.x*p.animation.x/period+rotationRandom(seed+1.);
 let cycle=floor(time);let phase=fract(time);
 let envelope=rotationEase(phase/.22)*(1.-rotationEase((phase-.46)/.34));
 let yaw=(rotationRandom(seed+cycle*71.+2.)*2.-1.);
 let pitch=(rotationRandom(seed+cycle*71.+5.)*2.-1.);
 let roll=(rotationRandom(seed+cycle*71.+9.)*2.-1.)*.04*p.motion.x;
 let range=max(p.glitch.w,.07*p.motion.x);
 return vec3f(yaw*range,pitch*range,roll)*envelope;
}
fn cameraLockAmount(card:u32)->f32 {
 return select(0.,p.lock.y,abs(f32(card)-p.lock.x)<.1);
}
fn projectedCardPoint(card:u32,q:vec2f,shift:vec2f)->vec3f {
 let rows=ceil(p.arrangement.w*.5);let row=f32(card/2u);let side=select(-1.,1.,card%2u==1u);
 let introDistance=select(1.,p.intro.w,introCard(card));
 let depth=introDistance*p.arrangement.z*(1.+sin(f32(card)*2.399963+.5)*p.tracking.w
   +sin(p.clock.x*p.animation.x*.32+f32(card)*1.91)*p.animation.y);
 let center=p.eye.xyz+p.forward.xyz*depth
   +p.right.xyz*p.right.w*introDistance*(side*p.arrangement.x+shift.x)
   +p.up.xyz*p.up.w*introDistance*(((rows-1.)*.5-row)*labelRowSpacing()+shift.y);
 let rotation=cardRotation(card);let yaw=rotation.x;let pitch=rotation.y;let roll=rotation.z;
 let tiltedRight=p.right.xyz*cos(yaw)+p.forward.xyz*sin(yaw);
 let normal=p.forward.xyz*cos(yaw)-p.right.xyz*sin(yaw);
 let tiltedUp=p.up.xyz*cos(pitch)+normal*sin(pitch);
 let right=tiltedRight*cos(roll)+tiltedUp*sin(roll);
 let up=tiltedUp*cos(roll)-tiltedRight*sin(roll);
 let floating=center+right*q.x*p.right.w*cardMetrics(card).x+up*q.y*p.up.w*cardMetrics(card).y;
 let amount=cameraLockAmount(card);
 if(amount<=0.){return floating;}
 let dimensions=cardMetrics(card);
 let corner=vec2f(select(-1.,1.,u32(p.lock.w)%2u==1u),select(1.,-1.,u32(p.lock.w)>=2u));
 let location=corner*(vec2f(.92)-dimensions*.5);
 let locked=p.liveEye.xyz+p.liveForward.xyz*p.arrangement.z
   +p.liveRight.xyz*p.liveRight.w*(location.x+q.x*dimensions.x)
   +p.liveUp.xyz*p.liveUp.w*(location.y+q.y*dimensions.y);
 return mix(floating,locked,amount);
}
