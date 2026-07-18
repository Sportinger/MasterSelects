import { describe, expect, it } from 'vitest';
import {
  buildEditorHref,
  buildLandingHref,
  isSupportedPagePath,
  resolveEntryExperience,
} from '../../src/routing/entryExperience';

describe('entry experience routing', () => {
  it('keeps localhost root on the editor', () => {
    expect(resolveEntryExperience({
      hostname: 'localhost',
      pathname: '/',
      search: '',
    })).toBe('editor');
  });

  it('shows the landing page on landing.localhost', () => {
    expect(resolveEntryExperience({
      hostname: 'landing.localhost',
      pathname: '/',
      search: '',
    })).toBe('landing');
  });

  it('shows the landing page on the /landing fallback route', () => {
    expect(resolveEntryExperience({
      hostname: 'localhost',
      pathname: '/landing',
      search: '',
    })).toBe('landing');
  });

  it.each([
    ['/impressum', 'imprint'],
    ['/impressum/', 'imprint'],
    ['/datenschutz', 'privacy'],
    ['/privacy', 'privacy'],
  ] as const)('serves the legal route %s', (pathname, experience) => {
    expect(resolveEntryExperience({ hostname: 'www.masterselects.com', pathname })).toBe(experience);
    expect(isSupportedPagePath(pathname)).toBe(true);
  });

  it('forces the editor when test mode is requested', () => {
    expect(resolveEntryExperience({
      hostname: 'landing.localhost',
      pathname: '/',
      search: '?test=parallel-decode',
    })).toBe('editor');
  });

  it('links the landing host back to localhost root for editing', () => {
    expect(buildEditorHref({
      hostname: 'landing.localhost',
      pathname: '/',
      protocol: 'http:',
      port: '5173',
    })).toBe('http://localhost:5173/');
  });

  it('uses the /landing fallback for non-subdomain links', () => {
    expect(buildLandingHref({
      hostname: 'localhost',
      pathname: '/',
      protocol: 'http:',
      port: '5173',
    })).toBe('/landing');
  });
});
