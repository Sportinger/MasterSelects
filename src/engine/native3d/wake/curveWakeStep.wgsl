@group(0) @binding(3) var<storage,read_write> states:array<WakeState>;
fn waterFlow(pos:vec3f,time:f32)->vec3f {
  let q=pos*2.1;let t=time*p.motion.w;
  // Each component is independent of its own axis: smooth divergence-free flow.
  return vec3f(sin(q.y+t*.37)-cos(q.z-t*.23),sin(q.z+t*.29)-cos(q.x+t*.19),
    sin(q.x-t*.31)-cos(q.y+t*.17))*.5*p.motion.z;
}
// A pulse sheds a rolling eddy in the radial/trailing plane. Its birth frame
// stays in world space, so detached water does not turn with the yarn later.
fn strokeRoll(pos:vec3f,state:WakeState,age:f32)->vec3f {
  let radius=max(state.vortexCenter.w,.0001);
  let axis=state.vortexAxis.xyz;
  let offset=pos-state.vortexCenter.xyz;
  let planar=offset-axis*dot(offset,axis);
  let distance2=dot(planar,planar)/(radius*radius);
  // Finite core: velocity goes to zero at the center, without a singularity.
  let falloff=exp(-.65*max(0.,distance2-1.));
  let fade=exp(-p.vortex.z*age);
  return cross(axis,planar)/radius*state.vortexAxis.w*p.vortex.x*fade*falloff;
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
    var axial=(p.world*vec4f(0.,0.,1.,0.)).xyz;
    if(dot(axial,axial)>1e-8){axial=normalize(axial);}else{axial=vec3f(0.,0.,1.);}
    var radial=(p.world*vec4f(anchor.x,anchor.y,0.,0.)).xyz;
    radial-=axial*dot(radial,axial);
    if(dot(radial,radial)<1e-8){
      var basis=vec3f(1.,0.,0.);
      if(abs(axial.x)>.9){basis=vec3f(0.,1.,0.);}
      radial=cross(axial,basis);
    }
    radial=normalize(radial);
    let worldScale=max(length(p.world[0].xyz),.001);
    // Nearby births have similar radii, producing coherent rolls rather than noise.
    let variation=.9+.15*sin(anchor.z*6.+anchor.x*3.+anchor.y*2.);
    let radius=p.vortex.y*worldScale*variation;
    state.vortexCenter=vec4f(birth+radial*radius,radius);
    state.vortexAxis=vec4f(normalize(cross(radial,axial)),worldScale*(.8+.3*min(length(impulse),1.)));
    state.vortexDrift=vec4f(radial*p.vortex.x*worldScale*.10+tail*.18,0.);
    state.velocityCycle=vec4f(state.velocityCycle.xyz+radial*p.vortex.x*worldScale*.12,cycle);
    // A seek starts with no inherited impulse: no historical source motion is invented.
  }
  if(advanceTime>0.){
    let duration=min(advanceTime,lifetime);
    // Short local steps resolve the rolling force at export and playback cadences.
    // Bounded to eight, including seek reseeds; no neighbor solve or CPU readback.
    let steps=u32(clamp(ceil(duration*60.),1.,8.));
    let h=duration/f32(steps);
    let decay=exp(-damping*h);let integral=(1.-decay)/damping;
    for(var j=0u;j<steps;j++){
      let age=state.positionAge.w;
      // The eddy itself drifts outwards, rolling water away from the bell edge.
      state.vortexCenter=vec4f(state.vortexCenter.xyz+
        state.vortexDrift.xyz*h*exp(-p.vortex.z*age),state.vortexCenter.w);
      let midpoint=p.step.x-duration+(f32(j)+.5)*h;
      let flow=waterFlow(state.positionAge.xyz,midpoint)+strokeRoll(state.positionAge.xyz,state,age+h*.5)+tail*.08;
      let force=flow*damping;
      state.positionAge=vec4f(state.positionAge.xyz+state.velocityCycle.xyz*integral+
        force*(h-integral)/damping,age+h);
      state.velocityCycle=vec4f(state.velocityCycle.xyz*decay+force*integral,state.velocityCycle.w);
    }
    state.positionAge.w+=max(0.,advanceTime-duration);
  }
  let age=state.positionAge.w;
  let fade=smoothstep(0.,.035,age)*(1.-smoothstep(.3*lifetime,lifetime,age));
  state.appearance=vec4f(fade,hash(key+53u),hash(key+59u),lifetime);
  state.anchorTime=vec4f(source,p.step.x);
  states[index]=state;
}
