// Phone skin colour tokens (dark and light) keep readable contrast, and clip tiles have spoken names.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatSpokenSeconds,
  phoneClipAccessibleName,
} from '../../src/components/mobileSkin/timeline/phoneTimelineGeometry';
import { resolvePhoneColorScheme } from '../../src/components/mobileSkin/runtime/phoneColorScheme';

const read = (file: string) => readFileSync(path.resolve(__dirname, '../../src/components/mobileSkin', file), 'utf8');
// Dark tokens are the defaults on .mobile-skin (shell/PhoneShell.css). The light palette lives only in
// PhoneApp.css under .mobile-skin[data-phone-scheme='light']; PhoneApp sets data-phone-scheme from
// runtime/phoneColorScheme.ts (Light, System on a light device, bright Custom).
const SHELL_CSS = read('shell/PhoneShell.css');
const APP_CSS = read('PhoneApp.css');
const LIGHT_SELECTOR = ".mobile-skin[data-phone-scheme='light']";

function tokenBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no token block ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--phone-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[match[1]] = match[2];
  return tokens;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = tokenBlock(SHELL_CSS, '.mobile-skin');
const lightOnly = tokenBlock(APP_CSS, LIGHT_SELECTOR);
const light = { ...dark, ...lightOnly };
const BACKGROUNDS = ['--phone-bg', '--phone-surface', '--phone-surface-2', '--phone-surface-3'];
const BODY_TEXT = ['--phone-text', '--phone-text-dim', '--phone-accent', '--phone-danger'];

describe.each([['dark', dark], ['light', light]] as const)('%s phone tokens', (_name, tokens) => {
  it.each(BODY_TEXT)('%s reaches 4.5:1 on every background', (text) => {
    for (const background of BACKGROUNDS) {
      expect(contrast(tokens[text], tokens[background]), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('greyed text stays at least 3:1 and the label on an accent button 4.5:1', () => {
    for (const background of BACKGROUNDS) {
      expect(contrast(tokens['--phone-text-off'], tokens[background]), `text-off on ${background}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(tokens['--phone-on-accent'], tokens['--phone-accent'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('light palette wiring', () => {
  it('overrides every dark colour token, so no dark colour leaks into the light phone', () => {
    expect(Object.keys(dark).filter((token) => !(token in lightOnly))).toEqual([]);
  });

  it('is the only light token block, keyed to the attribute PhoneApp sets from the editor theme', () => {
    expect(SHELL_CSS).not.toMatch(/data-theme=.light/);
    expect(APP_CSS.split(`${LIGHT_SELECTOR} {`).length - 1).toBe(1);
    expect(read('PhoneApp.tsx')).toMatch(/data-phone-scheme=\{colorScheme\}/);
  });

  it('turns light for Light, System on a light device and a bright Custom theme', () => {
    const base = { resolveThemeUnlocked: false, customBrightness: 0, systemPrefersDark: true } as const;
    expect(resolvePhoneColorScheme({ ...base, theme: 'light' })).toBe('light');
    expect(resolvePhoneColorScheme({ ...base, theme: 'system', systemPrefersDark: false })).toBe('light');
    expect(resolvePhoneColorScheme({ ...base, theme: 'system' })).toBe('dark');
    expect(resolvePhoneColorScheme({ ...base, theme: 'custom', customBrightness: 100 })).toBe('light');
    expect(resolvePhoneColorScheme({ ...base, theme: 'dark' })).toBe('dark');
  });
});

describe('phone clip accessible names', () => {
  it('names the clip, its start and its length', () => {
    expect(phoneClipAccessibleName({ name: 'Beach', startTime: 1.5, duration: 3 })).toBe('Beach, starts at 1.50 s, 3.00 s long');
    expect(phoneClipAccessibleName({ name: '  ', startTime: 62, duration: 0.25 })).toBe('Untitled clip, starts at 1 min 2.00 s, 0.25 s long');
  });

  it('never speaks NaN or negative times', () => {
    expect(formatSpokenSeconds(Number.NaN)).toBe('0.00 s');
    expect(formatSpokenSeconds(-4)).toBe('0.00 s');
  });
});
