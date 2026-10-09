// Exact integer attachments stay separate from the false-color PNG visualization.
@group(1) @binding(0) var idSceneDepth:texture_depth_2d;
@fragment fn strandIdFragment(in:VertexOutput)->@location(0) vec4u {
  if(in.coverage<=0.||abs(in.across)>min(1.,in.pixels)){discard;}
  let pixel=vec2i(in.position.xy);
  let nearest=textureLoad(idSceneDepth,pixel,0);
  if(in.position.z>nearest+0.000002){discard;}
  return vec4u(in.pickPoint+1u,bitcast<u32>(clamp(in.pickT,0.,1.)),in.pickStrand+1u,u32(u.material.y));
}
