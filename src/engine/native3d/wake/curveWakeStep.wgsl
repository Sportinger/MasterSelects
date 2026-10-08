@group(0) @binding(3) var<storage,read_write> states:array<WakeState>;
fn waterFlow(pos:vec3f,time:f32)->vec3f {
  let q=pos*2.1;let t=time*p.motion.w;
  // Each component is independent of its own axis: smooth divergence-free flow.
  return vec3f(sin(q.y+t*.37)-cos(q.z-t*.23),sin(q.z+t*.29)-cos(q.x+t*.19),
    sin(q.x-t*.31)-cos(q.y+t*.17))*.5*p.motion.z;
}
@compute @workgroup_size(128)
fn advance(@builtin(global_invocation_id) id:vec3u){
  let index=id.x;if(index>=arrayLength(&states)){return;}
  let key=index+u32(p.colorSeed.w)*7919u;
  let range=ranges[index%u32(p.pulse.w)];
  if(range.y<2u){states[index].appearance.x=0.;return;}
  let at=hash(key+11u)*f32(range.y-1u);let low=u32(floor(at));
  let a=points[range.x+low];let b=points[range.x+min(low+1u,range.y-1u)];
  let anchor=mix(a.position.xyz,b.position.xyz,fract(at));
  var normal=mix(a.normalRadius.xyz,b.normalRadius.xyz,fract(at));
  if(dot(normal,normal)>1e-8){normal=normalize(normal);}else{normal=vec3f(1.,0.,0.);}
  let source=(p.world*vec4f(anchor+normal*p.wave.w,1.)).xyz;
  let clock=p.pulse.x-(p.wave.x-anchor.z/p.wave.z)*p.wave.y/TAU-.5-(hash(key+23u)-.5)*.14;
  let cycle=floor(clock);let pulseAge=fract(clock)/max(p.pulse.y,.0001);
  let lifetime=min(p.pulse.z,.95/max(p.pulse.y,.0001))*(.7+.3*hash(key+31u));
  let tail=(p.world*vec4f(0.,0.,-p.motion.x,0.)).xyz;
  let damping=max(p.motion.y,.01);
  var state=states[index];let dt=p.step.y;
  var advanceTime=dt;
  let reset=p.step.z>.5;
  if(reset || cycle>state.velocityCycle.w){
    var impulse=vec3f(0.);var birth=source;
    var age=pulseAge;
    if(!reset && dt>1e-5){
      impulse=(source-state.anchorTime.xyz)/dt;
      let magnitude=length(impulse);
      if(magnitude>2.){impulse*=2./magnitude;}
      age=min(pulseAge,dt);
      birth=mix(state.anchorTime.xyz,source,1.-clamp(age/dt,0.,1.));
    }
    state.positionAge=vec4f(birth,0.);
    state.velocityCycle=vec4f(impulse*p.step.w+tail,cycle);
    advanceTime=age;
    // A seek has no source history; seed a bounded approximation, not a huge impulse.
    if(reset){state.velocityCycle=vec4f(tail,cycle);}
  }
  if(advanceTime>0.){
    let h=min(advanceTime,lifetime);
    let decay=exp(-damping*h);let integral=(1.-decay)/damping;
    let force=(waterFlow(state.positionAge.xyz,p.step.x-h*.5)+tail*.08)*damping;
    state.positionAge=vec4f(state.positionAge.xyz+state.velocityCycle.xyz*integral+
      force*(h-integral)/damping,state.positionAge.w+advanceTime);
    state.velocityCycle=vec4f(state.velocityCycle.xyz*decay+force*integral,state.velocityCycle.w);
  }
  let age=state.positionAge.w;
  let fade=smoothstep(0.,.035,age)*(1.-smoothstep(.3*lifetime,lifetime,age));
  state.appearance=vec4f(fade,hash(key+53u),hash(key+59u),lifetime);
  state.anchorTime=vec4f(source,p.step.x);
  states[index]=state;
}
