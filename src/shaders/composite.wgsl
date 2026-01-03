// Vertex shader for fullscreen quad
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  // Fullscreen triangle positions
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );

  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

// Layer uniform for transform and blend settings
struct LayerUniforms {
  opacity: f32,
  blendMode: u32,
  posX: f32,
  posY: f32,
  scaleX: f32,
  scaleY: f32,
  rotation: f32,
  sourceAspect: f32,  // source width / height
  outputAspect: f32,  // output width / height (16:9 = 1.777)
  _padding1: f32,
  _padding2: f32,
  _padding3: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseTexture: texture_2d<f32>;
@group(0) @binding(2) var layerTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> layer: LayerUniforms;

// Blend mode functions
fn blendNormal(base: vec3f, blend: vec3f) -> vec3f {
  return blend;
}

fn blendAdd(base: vec3f, blend: vec3f) -> vec3f {
  return min(base + blend, vec3f(1.0));
}

fn blendMultiply(base: vec3f, blend: vec3f) -> vec3f {
  return base * blend;
}

fn blendScreen(base: vec3f, blend: vec3f) -> vec3f {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}

fn blendOverlay(base: vec3f, blend: vec3f) -> vec3f {
  let r = select(
    1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r),
    2.0 * base.r * blend.r,
    base.r < 0.5
  );
  let g = select(
    1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g),
    2.0 * base.g * blend.g,
    base.g < 0.5
  );
  let b = select(
    1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b),
    2.0 * base.b * blend.b,
    base.b < 0.5
  );
  return vec3f(r, g, b);
}

fn blendDifference(base: vec3f, blend: vec3f) -> vec3f {
  return abs(base - blend);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  // Apply transform to UV
  var uv = input.uv;

  // Center, rotate, scale, then offset
  uv = uv - vec2f(0.5);

  // Apply rotation
  let cosR = cos(layer.rotation);
  let sinR = sin(layer.rotation);
  uv = vec2f(
    uv.x * cosR - uv.y * sinR,
    uv.x * sinR + uv.y * cosR
  );

  // Apply user scale
  uv = uv / vec2f(layer.scaleX, layer.scaleY);

  // Aspect ratio correction: fit source into output while maintaining aspect ratio
  let aspectRatio = layer.sourceAspect / layer.outputAspect;
  if (aspectRatio > 1.0) {
    // Source is wider than output - fit to width, letterbox top/bottom
    uv.y = uv.y * aspectRatio;
  } else {
    // Source is taller than output - fit to height, letterbox left/right
    uv.x = uv.x / aspectRatio;
  }

  uv = uv + vec2f(0.5) - vec2f(layer.posX, layer.posY);

  // Clamp UV to valid range for sampling
  let clampedUV = clamp(uv, vec2f(0.0), vec2f(1.0));

  // Sample both textures in uniform control flow
  let baseColor = textureSample(baseTexture, texSampler, input.uv);
  let layerColor = textureSample(layerTexture, texSampler, clampedUV);

  // Check if UV is out of bounds - use this to mask the layer
  let outOfBounds = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
  let maskAlpha = select(layerColor.a, 0.0, outOfBounds);

  // Apply blend mode
  var blended: vec3f;
  switch (layer.blendMode) {
    case 0u: { blended = blendNormal(baseColor.rgb, layerColor.rgb); }
    case 1u: { blended = blendAdd(baseColor.rgb, layerColor.rgb); }
    case 2u: { blended = blendMultiply(baseColor.rgb, layerColor.rgb); }
    case 3u: { blended = blendScreen(baseColor.rgb, layerColor.rgb); }
    case 4u: { blended = blendOverlay(baseColor.rgb, layerColor.rgb); }
    case 5u: { blended = blendDifference(baseColor.rgb, layerColor.rgb); }
    default: { blended = layerColor.rgb; }
  }

  // Apply opacity and alpha blending with bounds mask
  let alpha = maskAlpha * layer.opacity;
  let result = mix(baseColor.rgb, blended, alpha);

  return vec4f(result, max(baseColor.a, alpha));
}
