// Shared scalar Gaussian used by catalog shaders and the image operator compiler.
fn gaussian(x: f32, sigma: f32) -> f32 {
  return exp(-(x * x) / ((2.0 * sigma) * sigma));
}
