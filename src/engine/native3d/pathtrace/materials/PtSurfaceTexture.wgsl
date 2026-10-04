// Surface textures of planes and meshes in the path tracer: base color and alpha come from a layer
// of the texture atlas (each plane or mesh texture is resampled into one layer per frame, see
// scene/ptTextureAtlas.ts). Alpha is the surface's opacity: camera and bounce rays pass through
// stochastically, shadow rays multiply the transmittance (pt_trace_transmittance).
// Requires PtCommon.wgsl and PtSceneBindings.wgsl.

/** Premultiplied texture sample of a surface material at uv, or white when it has no texture. */
fn ptSurfaceTexel(material: PtMaterial, uv: vec2f) -> vec4f {
  let layer = i32(round(material.header.z));
  if (layer < 0) {
    return vec4f(1.0);
  }
  let rect = material.c3;
  let atlasUv = mix(rect.xy, rect.zw, clamp(uv, vec2f(0.0), vec2f(1.0)));
  return textureSampleLevel(textureAtlas, linearSampler, atlasUv, layer, 0.0);
}

/** Straight base color and opacity at uv. */
fn ptSurfaceColorOpacity(material: PtMaterial, uv: vec2f) -> vec4f {
  let texel = ptSurfaceTexel(material, uv);
  let alpha = texel.a * material.header.w;
  let straight = select(texel.rgb / max(texel.a, 1e-4), vec3f(1.0), texel.a <= 0.0);
  return vec4f(material.c0.rgb * straight, clamp(alpha, 0.0, 1.0));
}

/** Emitted radiance of a surface at uv: the constant emission, optionally times the texture. */
fn ptSurfaceEmission(material: PtMaterial, uv: vec2f) -> vec3f {
  let emission = material.c2.rgb;
  if (material.c2.w < 0.5) {
    return emission;
  }
  let texel = ptSurfaceTexel(material, uv);
  return emission * texel.rgb;
}
