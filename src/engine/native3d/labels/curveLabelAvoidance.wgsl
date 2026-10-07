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
fn sidePressure()->f32 {
 var left=0.;var right=0.;
 for(var y=0;y<16;y++){for(var x=0;x<8;x++){
   let q=vec2f(.025+(f32(x)+.5)*.45/8.,.025+(f32(y)+.5)*.95/16.);
   left+=density(q);right+=density(vec2f(1.-q.x,q.y));
 }}
 let difference=(left-right)/128.;
 return sign(difference)*smoothstep(.012,.14,abs(difference));
}
@compute @workgroup_size(16) fn arrange(@builtin(global_invocation_id) id:vec3u){
 let card=id.x;if(card>=u32(p.arrangement.w)){return;}
 let rows=ceil(p.arrangement.w*.5);let row=f32(card/2u);let side=select(-1.,1.,card%2u==1u);
 let base=vec2f(side*p.arrangement.x,((rows-1.)*.5-row)*labelRowSpacing());
 let halfCard=cardMetrics(card)*.5;
 let pressure=select(0.,sidePressure(),p.motion.y>0.);
 let migration=max(0.,-side*pressure)*p.motion.y;
 // Keep vertical neighborhoods but permit crowding and switching sides when space is occupied.
 let maxY=min(.96,base.y+labelRowSpacing()*.72)-halfCard.y-.025;
 let minY=max(-.96,base.y-labelRowSpacing()*.72)+halfCard.y+.025;
 let outer=max(.35,.96-halfCard.x);
 let lo=vec2f(-outer,minY)-base;let hi=vec2f(outer,maxY)-base;
 let drift=vec2f(sin(p.clock.x*.47+f32(card)*2.1)*.022,cos(p.clock.x*.36+f32(card)*1.7)*.029)*p.motion.x;
 let destination=vec2f(-side*min(p.arrangement.x*2.,1.38)*migration,
   select(-1.,1.,card%4u<2u)*labelRowSpacing()*.25*migration);
 let home=clamp(drift+destination,lo,hi);var shift=home;
 if(p.motion.y>0.){
   for(var step=0;step<14;step++){
     let dx=(occupied(card,shift+vec2f(.035,0))-occupied(card,shift-vec2f(.035,0)))/.07;
     let dy=(occupied(card,shift+vec2f(0,.035))-occupied(card,shift-vec2f(0,.035)))/.07;
     let mass=occupied(card,shift);
     let preference=vec2f(side*.015,select(-.012,.012,card%3u==0u))*mass;
     let movement=(-vec2f(dx,dy)*.075+preference)*p.motion.y-(shift-home)*.06;
     shift=clamp(shift+clamp(movement,vec2f(-.025),vec2f(.025)),lo,hi);
   }
 }
 offsets[card]=vec4f(shift,0,0);
}
