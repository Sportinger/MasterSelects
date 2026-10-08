struct Params {
  vp:mat4x4f, world:mat4x4f, right:vec4f, up:vec4f, forward:vec4f, eye:vec4f,
  viewport:vec4f, color:vec4f, metrics:vec4f, arrangement:vec4f, clock:vec4f, motion:vec4f, tracking:vec4f, animation:vec4f, marker:vec4f, glitch:vec4f,
}
struct Point { position:vec4f, normal:vec4f, tangent:vec4f }
fn roundCard(card:u32)->bool {return p.motion.z>.5&&(card%4u==1u||card%4u==2u);}
fn cardMetrics(card:u32)->vec2f {
 if(p.motion.z<.5){return p.metrics.xy;}
 let phase=fract(f32(card)*.618034+.17);
 let size=vec2f(mix(.78,1.18,phase),mix(.82,1.3,fract(phase+.37)));
 var metrics=p.metrics.xy*mix(vec2f(1),size,p.motion.w);
 if(card%4u>=2u){metrics.y=metrics.x*p.right.w/max(p.up.w,.0001);}
 return metrics;
}
fn labelRowSpacing()->f32 {
 let rows=ceil(p.arrangement.w*.5);
 let height=max(p.metrics.y,select(0.,p.metrics.x*p.right.w/max(p.up.w,.0001),p.motion.z>.5))*(1.+select(0.,.3*p.motion.w,p.motion.z>.5));
 return min(p.arrangement.y,max(.05,(1.8-height)/max(rows-1.,1.)));
}
// Smooth independent target orientations; no frame history or jittering placement feedback.
fn rotationNoise(time:f32,seed:f32)->f32 {
 let tick=floor(time);let u=fract(time);let blend=u*u*(3.-2.*u);
 let a=fract(sin((tick+seed)*127.1)*43758.5453)*2.-1.;
 let b=fract(sin((tick+1.+seed)*127.1)*43758.5453)*2.-1.;
 return mix(a,b,blend);
}
fn cardRotation(card:u32)->vec3f {
 let side=select(-1.,1.,card%2u==1u);let phase=f32(card)*1.7;
 let t=p.clock.x*p.animation.x;
 let limit=max(.14,p.glitch.w);
 let yaw=clamp(side*.07+sin(t*.43+phase)*.065*p.motion.x
   +rotationNoise(t*.18+phase,13.+phase)*p.glitch.w,-limit,limit);
 let pitch=clamp(sin(t*.31+phase*.73)*.05*p.motion.x
   +rotationNoise(t*.15+phase*.73,47.+phase)*p.glitch.w,-limit,limit);
 return vec3f(yaw,pitch,sin(t*.27+phase*1.13)*.04*p.motion.x);
}
fn projectedCardPoint(card:u32,q:vec2f,shift:vec2f)->vec3f {
 let rows=ceil(p.arrangement.w*.5);let row=f32(card/2u);let side=select(-1.,1.,card%2u==1u);
 let depth=p.arrangement.z*(1.+sin(f32(card)*2.399963+.5)*p.tracking.w
   +sin(p.clock.x*p.animation.x*.32+f32(card)*1.91)*p.animation.y);
 let center=p.eye.xyz+p.forward.xyz*depth
   +p.right.xyz*p.right.w*(side*p.arrangement.x+shift.x)
   +p.up.xyz*p.up.w*(((rows-1.)*.5-row)*labelRowSpacing()+shift.y);
 let rotation=cardRotation(card);let yaw=rotation.x;let pitch=rotation.y;let roll=rotation.z;
 let tiltedRight=p.right.xyz*cos(yaw)+p.forward.xyz*sin(yaw);
 let normal=p.forward.xyz*cos(yaw)-p.right.xyz*sin(yaw);
 let tiltedUp=p.up.xyz*cos(pitch)+normal*sin(pitch);
 let right=tiltedRight*cos(roll)+tiltedUp*sin(roll);
 let up=tiltedUp*cos(roll)-tiltedRight*sin(roll);
 return center+right*q.x*p.right.w*cardMetrics(card).x+up*q.y*p.up.w*cardMetrics(card).y;
}
