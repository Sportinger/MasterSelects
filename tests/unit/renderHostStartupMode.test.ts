import { describe, expect, it } from 'vitest';
import { renderHostStartupMode } from '../../src/services/render/renderHostStartupMode';

describe('explicit development render host startup', () => {
  it.each(['main', 'worker-shadow', 'worker-presenting', 'worker-only', 'worker-gpu-only'] as const)(
    'admits %s only for an explicit development URL', mode => {
      expect(renderHostStartupMode(true, `?renderHost=${mode}`, null)).toBe(mode);
      expect(renderHostStartupMode(false, `?renderHost=${mode}`, null)).toBeNull();
    },
  );
  it('does not reactivate stale experimental storage on ordinary reloads', () => {
    expect(renderHostStartupMode(true, '', 'worker-gpu-only')).toBeNull();
    expect(renderHostStartupMode(false, '', 'worker-presenting')).toBeNull();
    expect(renderHostStartupMode(true, '', 'main')).toBe('main');
  });
  it('ignores unknown requests and lets an explicit dev URL override a main preference', () => {
    expect(renderHostStartupMode(true, '?renderHost=unknown', 'main')).toBe('main');
    expect(renderHostStartupMode(true, '?renderHost=worker-gpu-only', 'main')).toBe('worker-gpu-only');
    expect(renderHostStartupMode(false, '?renderHost=worker-gpu-only', 'main')).toBe('main');
  });
});
