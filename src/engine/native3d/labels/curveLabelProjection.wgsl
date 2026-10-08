struct Params {
  vp:mat4x4f, world:mat4x4f, right:vec4f, up:vec4f, forward:vec4f, eye:vec4f,
  viewport:vec4f, color:vec4f, metrics:vec4f, arrangement:vec4f, clock:vec4f, motion:vec4f, tracking:vec4f, animation:vec4f, marker:vec4f, glitch:vec4f,
  liveRight:vec4f, liveUp:vec4f, liveForward:vec4f, liveEye:vec4f, lock:vec4f, intro:vec4f, headline:vec4f, headlineMotion:vec4f, stack:vec4f, finalAnchor:vec4f, finalTiming:vec4f, finalColor:vec4f,
}
fn finalTargetBlend(card:u32)->f32 {
 if(p.finalAnchor.w<.5){return 0.;}
 return smoothstep(0.,max(p.finalTiming.z,.001),p.clock.x-p.finalTiming.x-f32(card)*p.finalTiming.y);
}
struct Point { position:vec4f, normal:vec4f, tangent:vec4f }
fn roundCard(card:u32)->bool {return p.motion.z>.5&&(card%4u==1u||card%4u==2u);}
fn introCard(card:u32)->bool {return p.intro.z>0.&&(abs(f32(card)-p.intro.x)<.1||abs(f32(card)-p.intro.y)<.1);}
// Spare uniform components carry hold start/end/count; ordinary cards keep full camera lag.
fn heldCardAmount(card:u32)->f32 {
 if(f32(card)>=p.liveEye.w||p.forward.w<=p.eye.w){return 0.;}
 return smoothstep(p.eye.w-p.clock.z,p.eye.w,p.clock.x)*(1.-smoothstep(p.forward.w,p.forward.w+p.clock.z,p.clock.x));
}
fn heldCardOffset(card:u32,delta:vec3f)->vec3f {
 let perspective=length(vec3f(p.vp[0].w,p.vp[1].w,p.vp[2].w))>.1;
 let nearer=select(delta-p.liveForward.xyz*dot(delta,p.liveForward.xyz)*.8,delta*.2,perspective);
 return mix(delta,nearer,heldCardAmount(card));
}
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
fn cameraStackDelay(card:u32)->f32 {return f32(card)*p.stack.w;}
fn cameraStackStart(card:u32)->f32 {
 return p.stack.y+select(f32(card/2u)*.08,cameraStackDelay(card),p.stack.w>0.);
}
fn cameraStackAmount(card:u32)->f32 {
 if(f32(card)>=p.stack.x*2.||p.stack.z<=p.stack.y){return 0.;}
 let start=cameraStackStart(card);let end=p.stack.z+cameraStackDelay(card);
 return rotationEase((p.clock.x-start)/.5)*rotationEase((end-p.clock.x)/.7);
}
fn cameraLockAmount(card:u32)->f32 {
 return max(cameraStackAmount(card),select(0.,p.lock.y,abs(f32(card)-p.lock.x)<.1));
}
fn cameraLockAge(card:u32)->f32 {
 return select(p.lock.z,p.clock.x-cameraStackStart(card),cameraStackAmount(card)>0.);
}
// Reserve the full (differently sized) footprints from the bottom upward.
fn cameraStackMetrics(card:u32)->vec3f {
 let side=card%2u;var total=0.;var preceding=0.;
 for(var row=0u;row<u32(p.stack.x);row++){
   let height=cardMetrics(row*2u+side).y;
   total+=height;if(row<card/2u){preceding+=height+.08;}
 }
 let scale=min(1.,1.05/max(.01,total+.08*max(0.,p.stack.x-1.)));
 return vec3f(cardMetrics(card)*scale,(-.90+(preceding+cardMetrics(card).y*.5)*scale));
}
fn projectedCardPoint(card:u32,q:vec2f,shift:vec2f)->vec3f {
 let rows=ceil(p.arrangement.w*.5);let row=f32(card/2u);let side=select(-1.,1.,card%2u==1u);
 let introDistance=select(1.,p.intro.w,introCard(card));
 let depth=introDistance*p.arrangement.z*(1.+sin(f32(card)*2.399963+.5)*p.tracking.w
   +sin(p.clock.x*p.animation.x*.32+f32(card)*1.91)*p.animation.y);
 let baseCenter=p.eye.xyz+p.forward.xyz*depth
   +p.right.xyz*p.right.w*introDistance*side*p.arrangement.x
   +p.up.xyz*p.up.w*introDistance*((rows-1.)*.5-row)*labelRowSpacing();
 // Avoidance translates in the LIVE image plane, independently of lagged card
 // orientation. Inverting an edge-on lagged plane otherwise amplifies tiny changes.
 let screenDepth=max(.001,dot(baseCenter-p.liveEye.xyz,p.liveForward.xyz));
 let perspectiveView=length(vec3f(p.vp[0].w,p.vp[1].w,p.vp[2].w))>.1;
 let units=select(1.,screenDepth/max(.001,p.arrangement.z),perspectiveView);
 let center=baseCenter+(p.liveRight.xyz*p.liveRight.w*shift.x+p.liveUp.xyz*p.liveUp.w*shift.y)*units;
 let rotation=cardRotation(card);let yaw=rotation.x;let pitch=rotation.y;let roll=rotation.z;
 let tiltedRight=p.right.xyz*cos(yaw)+p.forward.xyz*sin(yaw);
 let normal=p.forward.xyz*cos(yaw)-p.right.xyz*sin(yaw);
 let tiltedUp=p.up.xyz*cos(pitch)+normal*sin(pitch);
 var right=tiltedRight*cos(roll)+tiltedUp*sin(roll);
 var up=tiltedUp*cos(roll)-tiltedRight*sin(roll);
 // Intro planes retain spatial position lag, but their words face the live camera.
 // A small residual tilt preserves depth without the ordinary 45-degree excursions.
 if(introCard(card)){
   right=normalize(mix(right,p.liveRight.xyz,.96));
   up=normalize(mix(up,p.liveUp.xyz,.96));
   up=normalize(up-right*dot(up,right));
 }
 var floating=center+right*q.x*p.right.w*cardMetrics(card).x+up*q.y*p.up.w*cardMetrics(card).y;
 // Bring held cards toward the camera without enlarging their projected footprint.
 // They retain their tilted 3D planes, but no longer sit behind the inspected yarn.
 floating=p.liveEye.xyz+heldCardOffset(card,floating-p.liveEye.xyz);
 let amount=cameraLockAmount(card);
 if(amount<=0.){return floating;}
 let dimensions=cardMetrics(card);
 let corner=vec2f(select(-1.,1.,u32(p.lock.w)%2u==1u),select(1.,-1.,u32(p.lock.w)>=2u));
 var size=dimensions;var location=corner*(vec2f(.92)-size*.5);
 let stacked=cameraStackAmount(card)>0.;
 if(stacked){
   let metrics=cameraStackMetrics(card);size=metrics.xy;
   location=vec2f(side*(.92-size.x*.5),metrics.z);
 }
 // Stacks sit in front of the inspected object, preserving their screen footprint.
 let perspective=length(vec3f(p.vp[0].w,p.vp[1].w,p.vp[2].w))>.1;
 let lateral=select(1.,.2,stacked&&perspective);let depthFactor=select(1.,.2,stacked);
 let locked=p.liveEye.xyz+p.liveForward.xyz*p.arrangement.z*depthFactor
   +p.liveRight.xyz*p.liveRight.w*(location.x+q.x*size.x)*lateral
   +p.liveUp.xyz*p.liveUp.w*(location.y+q.y*size.y)*lateral;
 return mix(floating,locked,amount);
}

// Move the entire plane away along its center sightline. Its world size remains
// unchanged, so perspective makes it smaller without moving its screen center.
fn placedCardPoint(card:u32,q:vec2f,shift:vec2f,depthYield:f32)->vec3f {
 let point=projectedCardPoint(card,q,shift);
 let center=projectedCardPoint(card,vec2f(0),shift);
 let perspective=length(vec3f(p.vp[0].w,p.vp[1].w,p.vp[2].w))>.1;
 let displacement=select(p.liveForward.xyz*p.arrangement.z,center-p.liveEye.xyz,perspective);
 return point+displacement*depthYield*(1.-cameraLockAmount(card));
}
