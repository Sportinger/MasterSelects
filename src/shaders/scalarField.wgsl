// Shared scalar field arithmetic for instanced geometry and raymarched relief.
fn evaluateScalarField(sampleValue: f32, operations: array<vec4f, 32>, count: u32, output: u32) -> f32 {
  var values: array<f32, 32>;
  for (var i = 0u; i < min(count, 32u); i += 1u) {
    let operation = operations[i];
    let a = values[min(u32(operation.y), 31u)];
    let b = values[min(u32(operation.z), 31u)];
    var result = 0.0;
    switch u32(operation.x) {
      case 0u: { result = operation.w; }
      case 1u: { result = sampleValue; }
      case 2u: { result = a + b; }
      case 3u: { result = a - b; }
      case 4u: { result = a * b; }
      case 5u: { if (abs(b) >= 0.000000001) { result = a / b; } }
      case 6u: {
        if (b == 0.0) { result = 1.0; }
        else if (a <= 0.0) { result = select(0.0, 10000.0, b < 0.0); }
        else { result = pow(a, b); }
      }
      case 7u: { result = min(a, b); }
      case 8u: { result = max(a, b); }
      case 9u: { result = abs(a); }
      case 10u: { result = sin(a); }
      case 11u: { let c = values[min(u32(operation.w), 31u)]; result = clamp(a, min(b, c), max(b, c)); }
      default: {}
    }
    // Bound geometry values, including singular power operations.
    values[i] = clamp(result, -10000.0, 10000.0);
  }
  return values[min(output, 31u)];
}
