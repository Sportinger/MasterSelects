// Perspective Grid: vanishing-point floor grid that scrolls toward the viewer.
// Lines have a fixed width on the floor (Line Width at the front edge, in 1080p pixels scaled to
// the output), so they thin toward the horizon. Each line family is drawn with analytic
// derivatives and filtered like Ben Golus' "pristine grid": below one pixel a line keeps its
// brightness share instead of aliasing, and where lines crowd closer than a pixel they fade to
// their average coverage (an even haze) instead of a solid or moiré band.

struct PerspectiveGridParams {
  horizon: f32,
  columns: f32,
  rows: f32,
  // Row scroll (Speed × time + Scroll Offset) wrapped to one row on the CPU, in double precision.
  scroll: f32,
  // Full line width in output pixels at the front (bottom) edge.
  linePixels: f32,
  fade: f32,
  opacity: f32,
  // 0 = add (glowing lines), 1 = normal (lines cover the image).
  blend: f32,
  color: vec4f,
  width: f32,
  height: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PerspectiveGridParams;

// Coverage of one family of lines at integer `coord`. `deriv`: cells per pixel; `lineWidth`: line
// width in cells. Both are finite and >= 0 (packUniforms sanitises the inputs).
fn pristineLine(coord: f32, deriv: f32, lineWidth: f32) -> f32 {
  if (lineWidth <= 0.0) { return 0.0; }
  let invertLine = lineWidth > 0.5;
  let targetWidth = select(lineWidth, 1.0 - lineWidth, invertLine);
  let pixel = max(deriv, 1e-6);
  let drawWidth = clamp(targetWidth, pixel, 0.5);
  let lineAA = pixel * 1.5;
  // 0 on a line, 1 halfway between two lines (inverted for lines wider than half a cell).
  var gridUV = abs(fract(coord) * 2.0 - 1.0);
  gridUV = select(1.0 - gridUV, gridUV, invertLine);
  var lines = 1.0 - smoothstep(drawWidth - lineAA, drawWidth + lineAA, gridUV);
  lines = lines * clamp(targetWidth / drawWidth, 0.0, 1.0);
  lines = mix(lines, targetWidth, clamp(pixel * 2.0 - 1.0, 0.0, 1.0));
  return select(lines, 1.0 - lines, invertLine);
}

@fragment
fn perspectiveGridFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);
  let floorPixels = max((1.0 - params.horizon) * params.height, 1.0);
  // Depth along the floor: 0 at the horizon, 1 at the bottom edge.
  let depth = (input.uv.y - params.horizon) * params.height / floorPixels;
  let strength = clamp(params.opacity, 0.0, 1.0) * params.color.a;
  if (depth <= 0.0 || strength <= 0.0 || params.linePixels <= 0.0) {
    return source;
  }
  let z = max(depth, 1e-4);
  let x = input.uv.x - 0.5;
  // Perspective division: `columns` lines cross the bottom edge and converge at the vanishing
  // point; rows sit at constant floor spacing, crowd toward the horizon and scroll forward.
  let across = x / z * params.columns;
  let forward = params.rows / z + params.scroll;
  // Exact screen derivatives (cells per pixel) and line widths in cells, fixed on the floor.
  let dAcross = length(vec2f(params.columns / (z * params.width), x * params.columns / (z * z * floorPixels)));
  let dForward = params.rows / (z * z * floorPixels);
  let columnLines = select(0.0, pristineLine(across, dAcross, params.linePixels * params.columns / params.width), params.columns > 0.0);
  let rowLines = select(0.0, pristineLine(forward, dForward, params.linePixels * params.rows / floorPixels), params.rows > 0.0);
  let lines = columnLines + rowLines - columnLines * rowLines;
  let fadeIn = select(1.0, pow(clamp(depth, 0.0, 1.0), params.fade), params.fade > 0.0);
  let amount = clamp(lines * fadeIn * strength, 0.0, 1.0);
  if (amount <= 0.0) {
    return source;
  }
  // Composite premultiplied, so a transparent (Blank) clip shows the lines at their full colour.
  let sourcePremultiplied = source.rgb * source.a;
  let linePremultiplied = params.color.rgb * amount;
  let outAlpha = amount + source.a * (1.0 - amount);
  let premultiplied = select(sourcePremultiplied + linePremultiplied,
    linePremultiplied + sourcePremultiplied * (1.0 - amount), params.blend > 0.5);
  return vec4f(premultiplied / max(outAlpha, 1e-5), outAlpha);
}
