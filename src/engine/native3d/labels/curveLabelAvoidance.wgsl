@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> points:array<Point>;
@group(0) @binding(2) var<storage,read_write> field:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> offsets:array<vec4f>;
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
fn density(q:vec2f)->f32 {
 let c=clamp(q*GRID-.5,vec2f(0),GRID-vec2f(1.001));let a=vec2u(floor(c));let f=fract(c);
 let v00=f32(atomicLoad(&field[a.y*64u+a.x]));let v10=f32(atomicLoad(&field[a.y*64u+a.x+1u]));
 let v01=f32(atomicLoad(&field[(a.y+1u)*64u+a.x]));let v11=f32(atomicLoad(&field[(a.y+1u)*64u+a.x+1u]));
 return mix(mix(v00,v10,f.x),mix(v01,v11,f.x),f.y)/65535.;
}
fn occupied(card:u32,shift:vec2f)->f32 {
 var sum=0.;
 // Integrate the projected card footprint, including a small breathing margin.
 for(var y=0;y<5;y++){for(var x=0;x<7;x++){
   let q=vec2f(f32(x)/6.-.5,f32(y)/4.-.5)*1.12;
   let clip=p.vp*vec4f(projectedCardPoint(card,q,shift),1);
   sum+=density(clip.xy/max(clip.w,.001)*.5+.5);
 }}return sum/35.;
}
// Compare broad halves, so a filled side can yield to the clear side instead of trapping cards.
fn sidePressure(card:u32)->f32 {
 let center=p.vp*vec4f(projectedCardPoint(card,vec2f(0),vec2f(0)),1);
 let rowCenter=clamp(center.y/max(center.w,.001)*.5+.5,.08,.92);
 var left=0.;var right=0.;
 for(var y=0;y<16;y++){for(var x=0;x<8;x++){
   let q=vec2f(.025+(f32(x)+.5)*.45/8.,clamp(rowCenter+(f32(y)/15.-.5)*.30,.01,.99));
   left+=density(q);right+=density(vec2f(1.-q.x,q.y));
 }}
 let difference=(left-right)/128.;
 return sign(difference)*smoothstep(.04,.22,abs(difference));
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
@compute @workgroup_size(16) fn arrange(@builtin(global_invocation_id) id:vec3u){
 let card=id.x;if(card>=u32(p.arrangement.w)){return;}
 let rows=ceil(p.arrangement.w*.5);let row=f32(card/2u);let side=select(-1.,1.,card%2u==1u);
 let base=vec2f(side*p.arrangement.x,((rows-1.)*.5-row)*labelRowSpacing());
 let halfCard=cardMetrics(card)*.5;
 let pressure=select(0.,sidePressure(card),p.motion.y>0.);
 let migration=max(0.,-side*pressure)*p.motion.y;
 // Keep vertical neighborhoods but permit crowding and switching sides when space is occupied.
 let roomY=max(.02,.935-halfCard.y);
 let maxY=min(roomY,base.y+labelRowSpacing()*.50);
 let minY=max(-roomY,base.y-labelRowSpacing()*.50);
 let safeMinY=min(minY,maxY);
 let outer=max(.35,.96-halfCard.x);
 let lo=vec2f(-outer,safeMinY)-base;let hi=vec2f(outer,maxY)-base;
 let drift=vec2f(sin(p.clock.x*p.animation.x*.47+f32(card)*2.1)*.022,cos(p.clock.x*p.animation.x*.36+f32(card)*1.7)*.029)*p.motion.x;
 let destination=vec2f(-side*min(p.arrangement.x*2.,1.38)*migration,
   select(-1.,1.,card%4u<2u)*labelRowSpacing()*.25*migration);
 let home=clamp(drift+destination,lo,hi);var shift=home;
 if(p.motion.y>0.){
   // Average a fixed neighborhood instead of iterating toward moving local minima.
   // Continuous weights prevent tiny strand changes from flipping the chosen slot.
   var sum=vec2f(0);var total=0.;
   for(var y=-3;y<=3;y++){for(var x=-3;x<=3;x++){
     let delta=vec2f(f32(x)*.07,f32(y)*.06);
     let candidate=clamp(home+delta,lo,hi);
     let displacement=candidate-home;
     let cost=occupied(card,candidate)*6.*p.motion.y+dot(displacement,displacement)*20.;
     let weight=exp(-cost);
     sum+=candidate*weight;total+=weight;
   }}
   shift=sum/max(total,.0001);
 }

 offsets[card]=vec4f(containCard(card,shift),0,0);
}
