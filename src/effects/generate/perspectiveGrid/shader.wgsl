// Perspective Grid: vanishing-point floor grid that scrolls toward the viewer.
// Lines either keep a fixed width on the floor (Line Width at the front edge, in 1080p pixels
// scaled to the output), so they thin toward the horizon, or an even width on screen (grids saved
// before the choice existed). Each line family is drawn with analytic derivatives and filtered like
// Ben Golus' "pristine grid": below one pixel a line keeps its brightness share instead of
// aliasing, and where lines crowd closer than a pixel they fade to their average coverage (an even
// haze) instead of a solid or moiré band. The coverage functions are scalar so the unit tests run
// this exact code on the CPU (tests/unit/generateShaderMath.test.ts).

struct PerspectiveGridParams {
  horizon: f32,
  columns: f32,
  rows: f32,
  // Row scroll (Speed × time + Scroll Offset) wrapped to one row on the CPU, in double precision.
  scroll: f32,
  // Full line width in output pixels (floor: at the front edge).
  linePixels: f32,
  fade: f32,
  opacity: f32,
  // 0 = add (glowing lines), 1 = normal (lines cover the image).
  blend: f32,
  color: vec4f,
  width: f32,
  height: f32,
  // 0 = width fixed on the floor, 1 = even width on screen.
  screenWidth: f32,
  _pad0: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PerspectiveGridParams;

// Coverage of one family of lines at integer `coord`. `deriv`: cells per pixel; `lineWidth`: line
// width in cells. A line one cell wide or wider covers everything.
fn pristineLine(coord: f32, deriv: f32, lineWidth: f32) -> f32 {
  let width = clamp(lineWidth, 0.0, 1.0);
  if (width <= 0.0) { return 0.0; }
  if (width >= 1.0) { return 1.0; }
  let invertLine = width > 0.5;
  let targetWidth = select(width, 1.0 - width, invertLine);
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

// Line amount (0..1, before Opacity) at horizontal position `uvX` (0..1) and floor `depth` (0 at the
// horizon, 1 at the bottom edge). `width` and `floorPixels`: output pixels across and down the floor.
fn perspectiveGridLines(uvX: f32, depth: f32, columns: f32, rows: f32, scroll: f32, linePixels: f32,
    screenWidth: f32, fade: f32, width: f32, floorPixels: f32) -> f32 {
  if (depth <= 0.0 || linePixels <= 0.0) { return 0.0; }
  let z = max(depth, 1e-4);
  let x = uvX - 0.5;
  // Perspective division: `columns` lines cross the bottom edge and converge at the vanishing
  // point; rows sit at constant floor spacing, crowd toward the horizon and scroll forward.
  let across = x / z * columns;
  let forward = rows / z + scroll;
  // Exact screen derivatives (cells per pixel).
  let acrossX = columns / (z * width);
  let acrossY = x * columns / (z * z * floorPixels);
  let dAcross = sqrt(acrossX * acrossX + acrossY * acrossY);
  let dForward = rows / (z * z * floorPixels);
  // Line widths in cells: fixed on the floor (as at the front edge) or fixed in pixels.
  let onScreen = screenWidth > 0.5;
  let columnWidth = select(linePixels * columns / width, linePixels * dAcross, onScreen);
  let rowWidth = select(linePixels * rows / floorPixels, linePixels * dForward, onScreen);
  let columnLines = select(0.0, pristineLine(across, dAcross, columnWidth), columns > 0.0);
  let rowLines = select(0.0, pristineLine(forward, dForward, rowWidth), rows > 0.0);
  let lines = columnLines + rowLines - columnLines * rowLines;
  // Horizon Fade dims the distant lines; where they have melted into haze it fades at least
  // linearly, so a low Horizon Fade gives a floor receding into the distance, not a flat band.
  let floorDepth = clamp(depth, 0.0, 1.0);
  let lineFade = select(1.0, pow(floorDepth, fade), fade > 0.0);
  let hazeShare = clamp(max(dAcross, dForward) * 2.0 - 1.0, 0.0, 1.0);
  let fadeIn = mix(lineFade, pow(floorDepth, max(fade, 1.0)), hazeShare);
  // A 1.5 px soft edge at the horizon itself.
  let horizonEdge = smoothstep(0.0, 1.5 / floorPixels, depth);
  return clamp(lines * fadeIn * horizonEdge, 0.0, 1.0);
}

@fragment
fn perspectiveGridFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = textureSample(inputTex, texSampler, input.uv);
  let floorPixels = max((1.0 - params.horizon) * params.height, 1.0);
  // Depth along the floor: 0 at the horizon, 1 at the bottom edge.
  let depth = (input.uv.y - params.horizon) * params.height / floorPixels;
  let strength = clamp(params.opacity, 0.0, 1.0) * params.color.a;
  let amount = perspectiveGridLines(input.uv.x, depth, params.columns, params.rows, params.scroll, params.linePixels,
    params.screenWidth, params.fade, params.width, floorPixels) * strength;
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
