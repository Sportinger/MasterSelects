@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> points:array<Point>;
@group(0) @binding(2) var<storage,read_write> field:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> offsets:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> softened:array<f32>;
@group(0) @binding(5) var<storage,read> presence:array<f32>;
var<workgroup> placedBounds:array<vec4f,16>;
const GRID=vec2f(64,96);
@compute @workgroup_size(64) fn occupy(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&points)){return;}
 if(points[id.x].normal.w<=.00001){return;}
 let clip=p.vp*p.world*vec4f(points[id.x].position.xyz,1);
 if(clip.w<=.001||clip.z<0.||clip.z>clip.w){return;}
 let cell=(clip.xy/clip.w*.5+.5)*GRID;let center=vec2i(floor(cell));
 // Soft splats keep the potential continuous as strands cross grid boundaries.
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
   let q=center+vec2i(x,y);if(any(q<vec2i(0))||q.x>=64||q.y>=96){continue;}
   let d=(vec2f(q)+.5-cell)/1.25;let weight=u32(exp(-dot(d,d))*65535.);
   atomicMax(&field[u32(q.y)*64u+u32(q.x)],weight);
 }}
}
// Smooth the obstacle field, not playback history: seeks and exports stay identical.
// Broad, separable Gaussian filtering stops individual strands from becoming slots.
@compute @workgroup_size(64) fn softenX(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=6144u){return;}let cell=vec2i(i32(id.x%64u),i32(id.x/64u));
 var sum=0.;var total=0.;
 for(var tap=-5;tap<=5;tap++){
   let weight=exp(-f32(tap*tap)/12.5);let x=clamp(cell.x+tap,0,63);
   sum+=f32(atomicLoad(&field[u32(cell.y*64+x)]))*weight;total+=weight;
 }softened[id.x]=sum/total;
}
@compute @workgroup_size(64) fn softenY(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=6144u){return;}let cell=vec2i(i32(id.x%64u),i32(id.x/64u));
 var sum=0.;var total=0.;
 for(var tap=-5;tap<=5;tap++){
   let weight=exp(-f32(tap*tap)/12.5);let y=clamp(cell.y+tap,0,95);
   sum+=softened[u32(y*64+cell.x)]*weight;total+=weight;
 }atomicStore(&field[id.x],u32(sum/total));
}
fn density(q:vec2f)->f32 {
 let c=clamp(q*GRID-.5,vec2f(0),GRID-vec2f(1.001));let a=vec2u(floor(c));let f=fract(c);
 let v00=f32(atomicLoad(&field[a.y*64u+a.x]));let v10=f32(atomicLoad(&field[a.y*64u+a.x+1u]));
 let v01=f32(atomicLoad(&field[(a.y+1u)*64u+a.x]));let v11=f32(atomicLoad(&field[(a.y+1u)*64u+a.x+1u]));
 return mix(mix(v00,v10,f.x),mix(v01,v11,f.x),f.y)/65535.;
}
struct CardFootprint {center:vec4f,right:vec4f,up:vec4f}
fn depthFootprint(card:u32,shift:vec2f,depthYield:f32)->CardFootprint {
 let center=p.vp*vec4f(placedCardPoint(card,vec2f(0),shift,depthYield),1);
 return CardFootprint(center,
   p.vp*vec4f(placedCardPoint(card,vec2f(1,0),shift,depthYield),1)-center,
   p.vp*vec4f(placedCardPoint(card,vec2f(0,1),shift,depthYield),1)-center);
}
fn cardFootprint(card:u32,shift:vec2f)->CardFootprint {return depthFootprint(card,shift,0.);}
fn occupied(footprint:CardFootprint)->f32 {
 var sum=0.;var peak=0.;
 // Project the complete plane once, then sample its footprint cheaply.
 for(var y=0;y<5;y++){for(var x=0;x<7;x++){
   let q=vec2f(f32(x)/6.-.5,f32(y)/4.-.5)*1.16;
   let clip=footprint.center+footprint.right*q.x+footprint.up*q.y;
   if(clip.w<=.001){return 1.;}
   let ndc=clip.xy/clip.w;
   let edge=smoothstep(.88,1.,max(abs(ndc.x),abs(ndc.y)));
   let value=max(density(ndc*.5+.5),edge);
   sum+=value;peak=max(peak,value);
 }}return sum/35.*.65+peak*.35;
}
// Solve a screen-space destination back into the lagged 3D card plane. Searching in
// source row coordinates cannot reach free corners after camera pans or depth drift.
fn shiftToScreen(card:u32,destination:vec2f,initial:vec2f)->vec2f {
 var shift=initial;
 for(var step=0;step<2;step++){
   let c=p.vp*vec4f(projectedCardPoint(card,vec2f(0),shift),1);
   let dx=(p.vp*vec4f(projectedCardPoint(card,vec2f(0),shift+vec2f(.01,0)),1)-c)/.01;
   let dy=(p.vp*vec4f(projectedCardPoint(card,vec2f(0),shift+vec2f(0,.01)),1)-c)/.01;
   let x=dx.xy-destination*dx.w;let y=dy.xy-destination*dy.w;
   let determinant=x.x*y.y-x.y*y.x;
   if(abs(determinant)<1e-6){return shift;}
   let error=destination*c.w-c.xy;
   shift+=clamp(vec2f(error.x*y.y-error.y*y.x,x.x*error.y-x.y*error.x)/determinant,vec2f(-2),vec2f(2));
 }return shift;
}
// Intro and priority tracking cards need their full projected footprint, including
// depth and tilt, kept in frame. Blend the hold correction to avoid a position snap.
fn containCard(card:u32,initial:vec2f)->vec2f {
 let amount=select(heldCardAmount(card),1.,introCard(card));
 if(amount<=0.){return initial;}
 var shift=initial;
 for(var iteration=0;iteration<3;iteration++){
   var low=vec2f(1e10);var high=vec2f(-1e10);
   for(var corner=0u;corner<4u;corner++){
     let q=vec2f(select(-.59,.59,corner%2u==1u),select(-.59,.59,corner>=2u));
     let clip=p.vp*vec4f(projectedCardPoint(card,q,shift),1);
     if(clip.w<=.001){return shift;}
     low=min(low,clip.xy/clip.w);high=max(high,clip.xy/clip.w);
   }
   let correction=max(vec2f(-.94)-low,vec2f(0))-max(high-vec2f(.94),vec2f(0));
   if(length(correction)<.0001){break;}
   let center=p.vp*vec4f(projectedCardPoint(card,vec2f(0),shift),1);
   let dx=p.vp*vec4f(projectedCardPoint(card,vec2f(0),shift+vec2f(.01,0)),1);
   let dy=p.vp*vec4f(projectedCardPoint(card,vec2f(0),shift+vec2f(0,.01)),1);
   let x=(dx.xy/dx.w-center.xy/center.w)/.01;let y=(dy.xy/dy.w-center.xy/center.w)/.01;
   let determinant=x.x*y.y-x.y*y.x;
   if(abs(determinant)<1e-6){return shift;}
   shift+=vec2f(correction.x*y.y-correction.y*y.x,x.x*correction.y-x.y*correction.x)/determinant;
 }
 return mix(initial,shift,amount);
}
fn initialPlacement(card:u32)->vec2f {
 let drift=vec2f(sin(p.clock.x*p.animation.x*.47+f32(card)*2.1)*.022,
   cos(p.clock.x*p.animation.x*.36+f32(card)*1.7)*.029)*p.motion.x;
 var shift=drift;
 if(p.motion.y>0.&&cameraLockAmount(card)<.999){
   let home=cardFootprint(card,drift);
   let origin=clamp(home.center.xy/max(.001,home.center.w),vec2f(-.8),vec2f(.8));
   // Stable individual preferences avoid symmetric averaging into the subject.
   // They do not change with each strand, appearance, or frame.
   let preferred=clamp(origin+vec2f(0,(rotationRandom(f32(card)*13.+7.)-.5)*.65),vec2f(-.8),vec2f(.8));
   var sum=vec2f(0);var total=0.;
   for(var y=0;y<9;y++){for(var x=0;x<7;x++){
     let destination=vec2f(-.8+f32(x)*1.6/6.,-.8+f32(y)*.2);
     let candidate=shiftToScreen(card,destination,drift);
     let footprint=cardFootprint(card,candidate);
     let actual=footprint.center.xy/max(.001,footprint.center.w);
     let distance=actual-preferred;
     let cost=occupied(footprint)*18.*p.motion.y+dot(distance,distance)*3.;
     let weight=exp(-cost);
     sum+=candidate*weight;total+=weight;
   }}
   let seek=smoothstep(.01,.30,occupied(home));
   if(total>1e-12){shift=mix(drift,sum/total,seek*p.motion.y*(1.-smoothstep(0.,.5,cameraLockAmount(card))));}
 }
 return containCard(card,shift);
}

// Conservative screen rectangles include tilted corners and a readability gap.
fn screenBounds(footprint:CardFootprint)->vec4f {
 var low=vec2f(1e5);var high=vec2f(-1e5);
 for(var corner=0u;corner<4u;corner++){
   let q=vec2f(select(-.52,.52,corner%2u==1u),select(-.52,.52,corner>=2u));
   let clip=footprint.center+footprint.right*q.x+footprint.up*q.y;
   if(clip.w<=.001){return vec4f(10,10,0,0);}
   let ndc=clip.xy/clip.w;low=min(low,ndc);high=max(high,ndc);
 }return vec4f((low+high)*.5,max((high-low)*.5,vec2f(.005)));
}
fn panelSeparation(card:u32)->vec2f {
 let bounds=placedBounds[card];var force=vec2f(0);var neighbors=0.;
 for(var other=0u;other<u32(p.arrangement.w);other++){
   if(other==card||presence[other]<=0.){continue;}
   let theirs=placedBounds[other];let gap=bounds.zw+theirs.zw+vec2f(.025);
   let delta=(bounds.xy-theirs.xy)/gap;let distance=length(delta);
   // A circumscribed ellipse conservatively separates rectangular corners too.
   let overlap=max(0.,1.415-distance);if(overlap<=0.){continue;}
   let low=min(card,other);let high=max(card,other);
   let angle=rotationRandom(f32(low)*19.+f32(high)*37.)*6.2831853;
   let fallback=vec2f(cos(angle),sin(angle))*select(-1.,1.,card>other);
   let direction=mix(fallback,delta/max(distance,.0001),smoothstep(0.,.08,distance));
   let weight=presence[other];force+=direction*gap*overlap*.20*weight;neighbors+=weight;
 }
 force/=max(1.,neighbors*.45);
 return force*min(1.,.045/max(length(force),.0001));
}
fn panelCrowding(card:u32)->f32 {
 let bounds=placedBounds[card];var pressure=0.;
 for(var other=0u;other<u32(p.arrangement.w);other++){
   if(other==card){continue;}
   let theirs=placedBounds[other];
   let overlap=max(vec2f(0),bounds.zw+theirs.zw-abs(bounds.xy-theirs.xy));
   let area=4.*min(bounds.z* bounds.w,theirs.z*theirs.w);
   pressure+=overlap.x*overlap.y/max(.0001,area)*presence[other];
 }return pressure;
}
@compute @workgroup_size(16) fn arrange(@builtin(local_invocation_index) card:u32){
 let valid=card<u32(p.arrangement.w);var shift=vec2f(0);var depthYield=0.;
 if(valid){shift=initialPlacement(card);}
 // All 16 lanes reach every barrier, including the unused lanes. Read a complete
 // layout before changing any card; results do not depend on invocation order.
 for(var iteration=0;iteration<6;iteration++){
   if(valid){placedBounds[card]=screenBounds(depthFootprint(card,shift,depthYield));}
   workgroupBarrier();
   var nextShift=shift;var nextDepth=depthYield;
   if(valid){
     if(p.motion.y>0.&&presence[card]>0.&&cameraLockAmount(card)<.999){
       let bounds=placedBounds[card];
       let freedom=p.motion.y*(1.-cameraLockAmount(card));
       let force=panelSeparation(card)*freedom;
       let congestion=panelCrowding(card)+occupied(depthFootprint(card,shift,depthYield))*.65;
       // Yield at most 55% of the original camera distance. Small relaxed updates
       // make depth a pressure release rather than another strong repelling force.
       nextDepth=mix(depthYield,.55*smoothstep(.04,.65,congestion)*freedom,.20);
       let center=p.vp*vec4f(projectedCardPoint(card,vec2f(0),shift),1);
       let origin=center.xy/max(.001,center.w);
       let room=max(vec2f(.04),vec2f(.94)-bounds.zw);
       var sum=vec2f(0);var total=0.;
       // Prefer the clear route around yarn while still separating the cards.
       for(var option=-1;option<=1;option++){
         let bend=vec2f(-force.y,force.x)*f32(option)*.65;
         let destination=clamp(origin+force+bend,-room,room);
         let candidate=shiftToScreen(card,destination,shift);
         let cost=occupied(depthFootprint(card,candidate,nextDepth))*14.+f32(option*option)*.3;
         let weight=exp(-cost);sum+=candidate*weight;total+=weight;
       }
       if(total>1e-12){nextShift=mix(shift,sum/total,presence[card]);}
     }
   }
   workgroupBarrier();
   shift=nextShift;depthYield=nextDepth;
 }
 if(valid){offsets[card]=vec4f(containCard(card,shift),depthYield,0);}
}
