fn imageRotate2d(value: vec2f, angle: f32) -> vec2f {
  let sine = sin(angle);
  let cosine = cos(angle);
  return vec2f(
    value.x * cosine - value.y * sine,
    value.x * sine + value.y * cosine,
  );
}
