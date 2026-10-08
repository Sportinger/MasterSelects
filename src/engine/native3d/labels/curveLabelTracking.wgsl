@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> points:array<Point>;
@group(0) @binding(2) var<storage,read> anchors:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> tracked:array<vec4f>;
@group(0) @binding(4) var<storage,read> topology:array<vec2u>;
fn along(start:f32,count:f32,u:f32)->vec3f {
 let at=clamp(u,0.,1.)*max(count-1.,0.);let low=floor(at);
 return mix(points[u32(start+low)].position.xyz,points[u32(start+min(low+1.,count-1.))].position.xyz,fract(at));
}
fn selected(a:vec4f)->vec3f {return mix(points[u32(a.x)].position.xyz,points[u32(a.y)].position.xyz,a.z);}
fn finishTracking(card:u32,position:vec3f,ready:f32)->vec4f {
 let blend=finalTargetBlend(card);
 if(blend<=0.){return vec4f(position,ready);}
 let arrived=blend>=1.;
 return vec4f(mix(position,selected(p.finalAnchor),blend),select(ready,2.,arrived));
}
@compute @workgroup_size(16) fn track(@builtin(global_invocation_id) id:vec3u){
 let card=id.x;if(card>=u32(p.arrangement.w)){return;}
 let a=anchors[card*4u];let b=anchors[card*4u+1u];let ranges=anchors[card*4u+2u];
 if(finalTargetBlend(card)>=1.){tracked[card]=vec4f(selected(p.finalAnchor),2.);return;}
 var destination=selected(b);var ready=select(0.,1.,p.tracking.x>=.999);
 if(p.tracking.x>0.&&p.animation.z>0.&&card<u32(round(p.arrangement.w*p.tracking.z))){
   let total=arrayLength(&topology);
   // At full release the final curve is no longer a parent/reference. Comparing
   // its sampled polyline against itself invents separation from chord error.
   if(p.tracking.y>=1.&&u32(ranges.x)==topology[total-1u].x){
     tracked[card]=finishTracking(card,mix(selected(a),destination,p.tracking.x),ready);return;
   }
   let firstRemaining=min(total-1u,u32(floor(p.tracking.y*f32(total-1u)))+1u);
   // Compare against every remaining parent curve, so an attached outer stitch does not look detached.
   var low=vec3f(1e20);var high=vec3f(-1e20);
   for(var strand=firstRemaining;strand<total;strand++){
     let range=topology[strand];
     for(var reference=0;reference<32;reference++){
       let point=along(f32(range.x),f32(range.y),f32(reference)/31.);
       low=min(low,point);high=max(high,point);
     }
   }
   var best=0.;var bestU=0.;
   for(var sample=0;sample<64;sample++){
     let u=(f32(sample)+.5)/64.;let point=along(ranges.x,ranges.y,u);var nearest=1e20;
     for(var strand=firstRemaining;strand<total;strand++){
       let range=topology[strand];var previous=along(f32(range.x),f32(range.y),0.);
       for(var reference=1;reference<48;reference++){
         let next=along(f32(range.x),f32(range.y),f32(reference)/47.);let edge=next-previous;
         let closest=previous+edge*clamp(dot(point-previous,edge)/max(dot(edge,edge),1e-10),0.,1.);
         let delta=point-closest;nearest=min(nearest,dot(delta,delta));previous=next;
       }
     }
     if(nearest>best){best=nearest;bestU=u;}
   }
   let separation=max(length(high-low)*.018,.005);
   ready*=smoothstep(separation*separation,separation*separation*4.,best);
   if(best>.0001){
     let spread=(fract(f32(card)*.381966)-.5)*.018;
     destination=mix(destination,along(ranges.x,ranges.y,fract(bestU+spread+1.)),p.animation.z);
   }
 }
 tracked[card]=finishTracking(card,mix(selected(a),destination,p.tracking.x),ready);
}
