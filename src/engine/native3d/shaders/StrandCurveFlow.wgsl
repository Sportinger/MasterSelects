// Resample each closed strand from an immutable packed snapshot. Arc lengths were
// produced by StrandFrames; no point positions travel back to the CPU.
struct Params { points:u32, strands:u32, width:u32, statsWidth:u32, phase:f32, distance:u32, pad:vec2u }
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> source:array<vec4f>;
@group(0) @binding(2) var<storage,read> ranges:array<vec2u>;
@group(0) @binding(3) var<storage,read> contexts:array<vec4u>;
@group(0) @binding(4) var<storage,read_write> output:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> metrics:array<vec2f>;
fn wrap(value:f32,period:f32)->f32 {return value-floor(value/period)*period;}
@compute @workgroup_size(256)
fn flow(@builtin(global_invocation_id) id:vec3u){
 let index=id.x+id.y*p.width*256u;if(index>=p.points){return;}
 let info=contexts[index];let range=ranges[info.y];
 if(range.y<3u){
   output[index*3u]=source[index*3u];output[index*3u+1u]=source[index*3u+1u];return;
 }
 let segments=range.y-1u;
 // The duplicate endpoint must sample exactly the same position/radius as point 0.
 let point=select(info.x,0u,info.x==segments);
 var at=f32(point)+wrap(p.phase,1.)*f32(segments);
 if(p.distance!=0u){
   at=f32(point);
   let length=source[(range.x+segments)*3u].w;
   if(length>0.){
     let travel=wrap(p.phase,length);
     if(travel!=0.){
       let distance=wrap(source[(range.x+point)*3u].w+travel,length);
       var low=0u;var high=segments;
       loop {
         if(low+1u>=high){break;}
         let mid=(low+high)/2u;
         if(source[(range.x+mid)*3u].w<=distance){low=mid;}else{high=mid;}
       }
       let begin=source[(range.x+low)*3u].w;
       let span=source[(range.x+high)*3u].w-begin;
       at=f32(low);
       if(span>0.){at+=(distance-begin)/span;}
     }
   }
 }
 let lower=u32(floor(at));let amount=fract(at);
 let a=(range.x+lower%segments)*3u;let b=(range.x+(lower+1u)%segments)*3u;
 output[index*3u]=vec4f(mix(source[a].xyz,source[b].xyz,amount),0.);
 output[index*3u+1u]=vec4f(0.,0.,0.,mix(source[a+1u].w,source[b+1u].w,amount));
}
// Run after the regular metric pass so its existing tiny readback also carries
// an explicit failure for invalid input. Never silently close an open curve.
@compute @workgroup_size(64)
fn validate(@builtin(global_invocation_id) id:vec3u){
 let strand=id.x+id.y*p.statsWidth*64u;if(strand>=p.strands){return;}
 let range=ranges[strand];
 if(range.y<3u){metrics[strand].x=-1.;return;}
 let delta=source[range.x*3u].xyz-source[(range.x+range.y-1u)*3u].xyz;
 if(dot(delta,delta)>1e-12){metrics[strand].x=-1.;}
}
