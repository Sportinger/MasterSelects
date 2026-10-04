// Surface setup at a hit: material, normals, fiber tangent and offset h, textures, emission.
// Requires PtCommon.wgsl, PtSceneBindings.wgsl, PtSurfaceTexture.wgsl and PtTraverse.wgsl.
// Unlit surface materials (the raster's planes show their texture unlit) emit their color instead
// of reflecting, so a plane looks the same in both engines; a plane becomes a lit surface once its
// material.surface sets roughness or metallic (ptSceneMaterials.ts clears unlit then).

fn ptUnpackColor(bits: u32) -> vec3f {
  return unpack4x8unorm(bits).rgb;
}

fn ptFiberSurface(s: PtSurface, inst: PtInstance, hit: PtHit, ray: PtRay) -> PtSurface {
  var surface = s;
  let segment = ptFiber(inst.refs.y + hit.primitive);
  let along = hit.uv.x;
  surface.kind = PT_MATERIAL_FIBER;
  surface.materialIndex = inst.refs.w + (segment.material & 0xffffu);
  surface.flags = segment.material & 0xff0000u;
  let axis = segment.b.xyz - segment.a.xyz;
  surface.tangent = ptSafeNormalize(axis, vec3f(1.0, 0.0, 0.0));
  let onAxis = segment.a.xyz + axis * along;
  let outward = surface.position - onAxis;
  let n = ptSafeNormalize(outward - surface.tangent * dot(outward, surface.tangent), -ray.direction);
  surface.normal = n;
  surface.geometricNormal = n;
  // h: the offset across the fiber in the frame PtBsdf.wgsl builds from the tangent and wo.
  let wo = -ray.direction;
  var z = wo - surface.tangent * dot(wo, surface.tangent);
  z = ptSafeNormalize(z, ptBasis(surface.tangent)[0]);
  surface.h = clamp(dot(n, cross(z, surface.tangent)), -0.999, 0.999);
  let a0 = unpack4x8unorm(segment.attr0);
  let a1 = unpack4x8unorm(segment.attr1);
  let pointLook = mix(a0, a1, along);
  let melanin = mix(unpack2x16unorm(segment.melanin).x, unpack2x16unorm(segment.melanin).y, along) * PT_MELANIN_RANGE;
  let material = materials[surface.materialIndex];
  let flags = u32(material.header.y + 0.5);
  surface.baseColor = select(material.c0.rgb, vec3f(1.0), (flags & PT_MATERIAL_FLAG_COLOR_FIELD) != 0u) * pointLook.rgb;
  surface.roughness = pointLook.a * PT_ROUGHNESS_SCALE_RANGE;
  surface.melanin = select(material.c2.w, melanin, (flags & PT_MATERIAL_FLAG_MELANIN_FIELD) != 0u);
  surface.opacity = 1.0;
  return surface;
}

/** Applies a surface material at texture coordinate uv (and a primitive color for voxels / particles). */
fn ptApplySurfaceMaterial(s: PtSurface, materialIndex: u32, uv: vec2f, primitiveColor: vec3f) -> PtSurface {
  var surface = s;
  let material = materials[materialIndex];
  surface.kind = PT_MATERIAL_SURFACE;
  surface.materialIndex = materialIndex;
  let flags = u32(material.header.y + 0.5);
  let colorOpacity = ptSurfaceColorOpacity(material, uv);
  surface.baseColor = select(colorOpacity.rgb, material.c0.rgb * primitiveColor, (flags & PT_MATERIAL_FLAG_PRIMITIVE_COLOR) != 0u);
  surface.opacity = colorOpacity.a;
  surface.roughness = clamp(material.c0.w, 0.0, 1.0);
  surface.metallic = clamp(material.c1.x, 0.0, 1.0);
  surface.emission = ptSurfaceEmission(material, uv);
  if (material.c1.y > 0.5) {
    // Unlit: shows its color like the raster, as emitted light.
    surface.emission += surface.baseColor;
    surface.baseColor = vec3f(0.0);
  }
  return surface;
}

/** Everything the integrator needs about a hit (hit.t < PT_INFINITY). */
fn ptSurfaceAt(hit: PtHit, ray: PtRay) -> PtSurface {
  var surface: PtSurface;
  surface.position = ray.origin + ray.direction * hit.t;
  surface.tangent = vec3f(0.0);
  surface.h = 0.0;
  surface.roughness = 1.0;
  surface.metallic = 0.0;
  surface.emission = vec3f(0.0);
  surface.opacity = 1.0;
  surface.melanin = 0.0;
  surface.flags = 0u;
  surface.coverage = 1.0;
  let inst = ptInstance(hit.instance);
  surface.objectId = inst.info.w;
  if (hit.kind == PT_PRIMITIVE_FIBER) {
    return ptFiberSurface(surface, inst, hit, ray);
  }
  if (hit.kind == PT_PRIMITIVE_TRIANGLE) {
    let tri = ptTriangle(inst.refs.y + hit.primitive);
    let v0 = ptVertex(tri.indices.x);
    let v1 = ptVertex(tri.indices.y);
    let v2 = ptVertex(tri.indices.z);
    let w = vec3f(1.0 - hit.uv.x - hit.uv.y, hit.uv.x, hit.uv.y);
    let objectNormal = v0.normal.xyz * w.x + v1.normal.xyz * w.y + v2.normal.xyz * w.z;
    let uv = vec2f(v0.position.w, v0.normal.w) * w.x + vec2f(v1.position.w, v1.normal.w) * w.y + vec2f(v2.position.w, v2.normal.w) * w.z;
    let p0 = ptTransformPoint(inst.objectToWorld0, inst.objectToWorld1, inst.objectToWorld2, v0.position.xyz);
    let p1 = ptTransformPoint(inst.objectToWorld0, inst.objectToWorld1, inst.objectToWorld2, v1.position.xyz);
    let p2 = ptTransformPoint(inst.objectToWorld0, inst.objectToWorld1, inst.objectToWorld2, v2.position.xyz);
    surface.geometricNormal = ptSafeNormalize(cross(p1 - p0, p2 - p0), -ray.direction);
    surface.normal = select(surface.geometricNormal, ptTransformNormal(inst.worldToObject0, inst.worldToObject1, inst.worldToObject2,
      objectNormal), dot(objectNormal, objectNormal) > 1e-12);
    return ptApplySurfaceMaterial(surface, inst.refs.w + tri.indices.w, uv, vec3f(1.0));
  }
  if (hit.kind == PT_PRIMITIVE_QUAD) {
    let q = ptShape(inst.refs.y + hit.primitive * 4u);
    let n = normalize(cross(q.p1.xyz, q.p2.xyz));
    surface.geometricNormal = n;
    surface.normal = n;
    return ptApplySurfaceMaterial(surface, bitcast<u32>(q.p0.w), vec2f(hit.uv.x, 1.0 - hit.uv.y), vec3f(1.0));
  }
  if (hit.kind == PT_PRIMITIVE_SPHERE) {
    let sphere = ptShape(inst.refs.y + hit.primitive * 4u);
    let center = ptTransformPoint(inst.objectToWorld0, inst.objectToWorld1, inst.objectToWorld2, sphere.p0.xyz);
    let n = ptSafeNormalize(surface.position - center, -ray.direction);
    surface.geometricNormal = n;
    surface.normal = n;
    return ptApplySurfaceMaterial(surface, inst.refs.w + bitcast<u32>(sphere.p1.x), vec2f(0.5), ptUnpackColor(bitcast<u32>(sphere.p1.y)));
  }
  let box = ptShape(inst.refs.y + hit.primitive * 4u);
  let local = ptTransformPoint(inst.worldToObject0, inst.worldToObject1, inst.worldToObject2, surface.position);
  let center = 0.5 * (box.p0.xyz + box.p1.xyz);
  let rel = (local - center) / max(0.5 * (box.p1.xyz - box.p0.xyz), vec3f(1e-9));
  let a = abs(rel);
  var objectNormal = vec3f(0.0, 0.0, sign(rel.z));
  if (a.x >= a.y && a.x >= a.z) {
    objectNormal = vec3f(sign(rel.x), 0.0, 0.0);
  } else if (a.y >= a.z) {
    objectNormal = vec3f(0.0, sign(rel.y), 0.0);
  }
  let n = ptTransformNormal(inst.worldToObject0, inst.worldToObject1, inst.worldToObject2, objectNormal);
  surface.geometricNormal = n;
  surface.normal = n;
  return ptApplySurfaceMaterial(surface, inst.refs.w + bitcast<u32>(box.p0.w), vec2f(0.5), ptUnpackColor(bitcast<u32>(box.p1.w)));
}
