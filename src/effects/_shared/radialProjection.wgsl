fn radialProjectionRadius(theta: f32, maxTheta: f32, model: f32) -> f32 {
  if (model < 0.5) {
    return theta / max(maxTheta, 0.0001);
  }
  if (model < 1.5) {
    return sin(theta * 0.5) / max(sin(maxTheta * 0.5), 0.0001);
  }
  if (model < 2.5) {
    return tan(theta * 0.5) / max(tan(maxTheta * 0.5), 0.0001);
  }
  return sin(theta) / max(sin(maxTheta), 0.0001);
}

fn inverseRadialProjectionRadius(radius: f32, maxTheta: f32, model: f32) -> f32 {
  if (model < 0.5) {
    return radius * maxTheta;
  }
  if (model < 1.5) {
    return 2.0 * asin(clamp(radius * sin(maxTheta * 0.5), -1.0, 1.0));
  }
  if (model < 2.5) {
    return 2.0 * atan(radius * tan(maxTheta * 0.5));
  }
  return asin(clamp(radius * sin(maxTheta), -1.0, 1.0));
}
