// Helpers of every path tracing integrator: camera rays (with thin lens), the indirect clamp and
// ray origins offset off a surface. Requires PtCommon.wgsl and PtSceneBindings.wgsl.

fn ptRenderSize() -> vec2u {
  return vec2u(frame.size.xy);
}

/** Camera ray through render pixel `pixel` with subpixel offset and lens sample. */
fn ptCameraRay(pixel: vec2u, subpixel: vec2f, lens: vec2f) -> PtRay {
  let size = frame.size.xy;
  let ndc = vec2f((f32(pixel.x) + subpixel.x) / size.x * 2.0 - 1.0, 1.0 - (f32(pixel.y) + subpixel.y) / size.y * 2.0);
  let right = frame.cameraRight.xyz;
  let up = frame.cameraUp.xyz;
  let forward = frame.cameraForward.xyz;
  var ray: PtRay;
  ray.tMin = 0.0;
  ray.tMax = PT_INFINITY;
  if (frame.cameraPosition.w > 0.5) {
    ray.origin = frame.cameraPosition.xyz + right * ndc.x * frame.cameraRight.w + up * ndc.y * frame.cameraUp.w;
    ray.direction = forward;
    return ray;
  }
  ray.origin = frame.cameraPosition.xyz;
  ray.direction = normalize(forward + right * ndc.x * frame.cameraRight.w + up * ndc.y * frame.cameraUp.w);
  let lensRadius = frame.lens.x;
  if (lensRadius > 0.0) {
    // Thin lens: every ray through the lens disk meets the pinhole ray on the focus plane.
    let focus = ray.origin + ray.direction * (frame.lens.y / max(dot(ray.direction, forward), 1e-4));
    let r = lensRadius * sqrt(lens.x);
    let phi = PT_TWO_PI * lens.y;
    ray.origin = ray.origin + right * (r * cos(phi)) + up * (r * sin(phi));
    ray.direction = normalize(focus - ray.origin);
  }
  return ray;
}

/** Luminance clamp of an indirect contribution (fireflies); 0 disables it. */
fn ptClampIndirect(value: vec3f) -> vec3f {
  let limit = frame.environment.w;
  let l = ptLuminance(value);
  return select(value, value * (limit / max(l, 1e-12)), limit > 0.0 && l > limit);
}

fn ptOffsetOrigin(surface: PtSurface, direction: vec3f) -> vec3f {
  let n = select(-surface.geometricNormal, surface.geometricNormal, dot(surface.geometricNormal, direction) >= 0.0);
  return surface.position + n * (1e-4 * max(1.0, length(surface.position)));
}
