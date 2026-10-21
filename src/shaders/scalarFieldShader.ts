/**
 * WGSL evaluator for scalar-field programs (`services/operators/scalarField.ts`,
 * CPU twin `evaluateScalarField.ts`), bound to the caller's uniform operation
 * array. The former shared function took `array<vec4f, 32>` by value, so every
 * inlined call copied 512 bytes into registers; inside the Voxel Relief
 * raymarch loop that was a large part of what mobile Vulkan compilers rejected
 * (`CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN`).
 */
export function scalarFieldShader(functionName: string, operations: string): string {
  return /* wgsl */`
fn ${functionName}(sampleValue: f32, count: u32, output: u32) -> f32 {
  var values: array<f32, 32>;
  for (var i = 0u; i < min(count, 32u); i += 1u) {
    let operation = ${operations}[i];
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
`;
}
