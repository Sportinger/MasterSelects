import { describe, expect, it } from 'vitest';
import { pixelSort } from '../../src/effects/geometry';

describe('shared stable Pixel Sort shader', () => {
  it('assembles the exact bounded stable-sort helper into the legacy compute shader', () => {
    const shader = pixelSort.shader;
    expect(shader).toContain('fn imageStableSort16ByRec709(inputColors: array<vec4f, 16>) -> array<vec4f, 16>');
    expect(shader).toContain('var colors = inputColors;');
    expect(shader).toContain('for (var outer = 0; outer < 16; outer = outer + 1)');
    expect(shader).toContain('for (var inner = 0; inner < 15 - outer; inner = inner + 1)');
    expect(shader).toContain('dot(colors[inner].rgb, vec3f(0.2126, 0.7152, 0.0722))');
    expect(shader).toContain('if (leftTone > rightTone)');
    expect(shader).not.toContain('leftTone >= rightTone');
    expect(shader).toContain('let swap = colors[inner];');
    expect(shader).toContain('colors[inner + 1] = swap;');
    expect(shader).toContain('return colors;');
    expect(shader).toContain('let sourceIndex = min(index, segmentSize - 1);');
    expect(shader).toContain('colors = imageStableSort16ByRec709(colors);');
    expect(shader.match(/for \(var outer = 0; outer < 16; outer = outer \+ 1\)/g)).toHaveLength(1);
  });
});
