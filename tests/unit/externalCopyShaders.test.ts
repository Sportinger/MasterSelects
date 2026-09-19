import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_COPY_90_SHADER,
  EXTERNAL_COPY_180_SHADER,
  EXTERNAL_COPY_270_SHADER,
  EXTERNAL_COPY_SHADER,
} from '../../src/engine/pipeline/compositor/copyShaders';

describe('external effect copy shaders', () => {
  it('materializes each decoded display rotation before effects', () => {
    expect(EXTERNAL_COPY_SHADER).toContain('sourceTexture, texSampler, input.uv');
    expect(EXTERNAL_COPY_90_SHADER).toContain(
      'sourceTexture, texSampler, vec2f(input.uv.y, 1.0 - input.uv.x)',
    );
    expect(EXTERNAL_COPY_180_SHADER).toContain('vec2f(1.0 - input.uv.x, 1.0 - input.uv.y)');
    expect(EXTERNAL_COPY_270_SHADER).toContain('vec2f(1.0 - input.uv.y, input.uv.x)');
  });
});
