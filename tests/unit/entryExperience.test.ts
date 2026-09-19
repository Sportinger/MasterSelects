import { describe, expect, it, vi } from 'vitest';
import {
  buildChatHref,
  buildEditorHref,
  buildLandingHref,
  buildMediumHref,
  canonicalEntryPath,
  createLandingBackedEntryState,
  ensureDirectEntryReturnsToLanding,
  isSupportedPagePath,
  resolveEntryExperience,
} from '../../src/routing/entryExperience';

describe('entry experience routing', () => {
  it('opens the editor directly as the default localhost experience', () => {
    expect(resolveEntryExperience({
      hostname: 'localhost',
      pathname: '/',
      search: '',
    })).toBe('editor');
    expect(canonicalEntryPath({ hostname: 'localhost', pathname: '/' })).toBe('/editor');
  });

  it('opens the editor on the legacy landing host', () => {
    expect(resolveEntryExperience({
      hostname: 'landing.localhost',
      pathname: '/',
      search: '',
    })).toBe('editor');
  });

  it('maps each canonical route to its own refresh-stable experience', () => {
    expect(resolveEntryExperience({
      hostname: 'localhost',
      pathname: '/landing',
      search: '',
    })).toBe('editor');
    expect(resolveEntryExperience({
      hostname: 'localhost',
      pathname: '/chat',
      search: '',
    })).toBe('chat');
    expect(resolveEntryExperience({
      hostname: 'localhost',
      pathname: '/editor',
      search: '',
    })).toBe('editor');
    expect(resolveEntryExperience({
      hostname: 'localhost',
      pathname: '/medium',
      search: '',
    })).toBe('medium');
    expect(canonicalEntryPath({ hostname: 'localhost', pathname: '/landing' })).toBe('/editor');
    expect(canonicalEntryPath({ hostname: 'localhost', pathname: '/chat' })).toBeNull();
    expect(canonicalEntryPath({ hostname: 'localhost', pathname: '/editor' })).toBeNull();
    expect(canonicalEntryPath({ hostname: 'localhost', pathname: '/medium' })).toBeNull();
  });

  it('canonicalizes old landing routes to the editor', () => {
    expect(resolveEntryExperience({
      hostname: 'localhost',
      pathname: '/landing-preview',
      search: '',
    })).toBe('editor');
    expect(isSupportedPagePath('/landing-preview')).toBe(true);
    expect(canonicalEntryPath({ hostname: 'localhost', pathname: '/landing-preview' }))
      .toBe('/editor');
  });

  it.each(['/admin', '/admin/'])('does not expose the removed admin route %s', (pathname) => {
    expect(resolveEntryExperience({
      hostname: 'www.masterselects.com',
      pathname,
      search: '',
    })).toBe('editor');
    expect(isSupportedPagePath(pathname)).toBe(false);
  });

  it.each([
    ['/impressum', 'imprint'],
    ['/impressum/', 'imprint'],
    ['/datenschutz', 'privacy'],
    ['/privacy', 'privacy'],
    ['/agb', 'terms'],
    ['/terms', 'terms'],
    ['/widerruf', 'withdrawal'],
    ['/withdrawal', 'withdrawal'],
    ['/kuendigen', 'cancellation'],
    ['/cancel/', 'cancellation'],
  ] as const)('serves the legal route %s', (pathname, experience) => {
    expect(resolveEntryExperience({ hostname: 'www.masterselects.com', pathname })).toBe(experience);
    expect(isSupportedPagePath(pathname)).toBe(true);
  });

  it('forces the editor when test mode is requested', () => {
    const location = {
      hostname: 'landing.localhost',
      pathname: '/',
      search: '?test=parallel-decode',
    };
    expect(resolveEntryExperience(location)).toBe('editor');
    expect(canonicalEntryPath(location)).toBeNull();
  });

  it('builds canonical links for landing, chat, medium, and editor', () => {
    expect(buildLandingHref({ hostname: 'localhost', pathname: '/' })).toBe('/editor');
    expect(buildChatHref({ hostname: 'localhost', pathname: '/landing' })).toBe('/chat');
    expect(buildEditorHref({ hostname: 'localhost', pathname: '/landing' })).toBe('/editor');
    expect(buildMediumHref({ hostname: 'localhost', pathname: '/landing' })).toBe('/medium');

    const landingHost = {
      hostname: 'landing.localhost',
      pathname: '/',
      protocol: 'http:',
      port: '5173',
    };
    expect(buildLandingHref(landingHost)).toBe('http://localhost:5173/editor');
    expect(buildChatHref(landingHost)).toBe('http://localhost:5173/chat');
    expect(buildEditorHref(landingHost)).toBe('http://localhost:5173/editor');
    expect(buildMediumHref(landingHost)).toBe('http://localhost:5173/medium');
  });

  it.each(['/chat', '/medium', '/editor'])('does not place landing behind a direct %s entry', (pathname) => {
    const calls: Array<{ method: 'push' | 'replace'; state: unknown; url: string }> = [];
    const history = {
      state: { existing: 'state' },
      pushState(state: unknown, _unused: string, url?: string | URL | null) {
        calls.push({ method: 'push', state, url: String(url) });
      },
      replaceState(state: unknown, _unused: string, url?: string | URL | null) {
        calls.push({ method: 'replace', state, url: String(url) });
      },
    };

    expect(ensureDirectEntryReturnsToLanding({
      hash: '#open',
      hostname: 'localhost',
      pathname,
      search: '?project=one',
    }, history)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does not duplicate a landing return entry after reload or in-app navigation', () => {
    const pushState = vi.fn();
    const replaceState = vi.fn();
    const markedState = createLandingBackedEntryState({ existing: 'state' });

    expect(ensureDirectEntryReturnsToLanding({
      hostname: 'localhost',
      pathname: '/editor',
    }, {
      state: markedState,
      pushState,
      replaceState,
    })).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('leaves landing and non-editor routes untouched', () => {
    const pushState = vi.fn();
    const replaceState = vi.fn();

    expect(ensureDirectEntryReturnsToLanding({
      hostname: 'localhost',
      pathname: '/landing',
    }, {
      state: null,
      pushState,
      replaceState,
    })).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
