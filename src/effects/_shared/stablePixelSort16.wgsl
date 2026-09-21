// Stable ascending sort of 16 complete RGBA records by source-encoded Rec.709
// luminance. Strict greater-than preserves the order of equal-luma records.
fn imageStableSort16ByRec709(inputColors: array<vec4f, 16>) -> array<vec4f, 16> {
  var colors = inputColors;
  for (var outer = 0; outer < 16; outer = outer + 1) {
    for (var inner = 0; inner < 15 - outer; inner = inner + 1) {
      let leftTone = dot(colors[inner].rgb, vec3f(0.2126, 0.7152, 0.0722));
      let rightTone = dot(colors[inner + 1].rgb, vec3f(0.2126, 0.7152, 0.0722));
      if (leftTone > rightTone) {
        let swap = colors[inner];
        colors[inner] = colors[inner + 1];
        colors[inner + 1] = swap;
      }
    }
  }
  return colors;
}
