import { afterEach, describe, expect, it } from 'vitest';

import {
  isPhoneSizedTouchDevice,
  readPhoneEntryEnvironment,
  rememberFullEditorPreference,
  resolvePhoneEntryRedirect,
  type PhoneEntryEnvironment,
} from '../../src/routing/phoneEntry';

const PHONE: PhoneEntryEnvironment = { coarsePointer: true, screenWidth: 412, screenHeight: 915, prefersFullEditor: false };
const TABLET: PhoneEntryEnvironment = { coarsePointer: true, screenWidth: 820, screenHeight: 1180, prefersFullEditor: false };
const DESKTOP: PhoneEntryEnvironment = { coarsePointer: false, screenWidth: 1920, screenHeight: 1080, prefersFullEditor: false };

function at(pathname: string, search = '', hash = '') {
  return { hostname: 'www.masterselects.com', pathname, search, hash };
}

describe('isPhoneSizedTouchDevice', () => {
  it('takes touch devices with a short side below 600 px as phones', () => {
    expect(isPhoneSizedTouchDevice(PHONE)).toBe(true);
    expect(isPhoneSizedTouchDevice({ coarsePointer: true, screenWidth: 932, screenHeight: 430 })).toBe(true);
  });

  it('keeps tablets, unfolded foldables and desktops out', () => {
    expect(isPhoneSizedTouchDevice(TABLET)).toBe(false);
    expect(isPhoneSizedTouchDevice({ coarsePointer: true, screenWidth: 673, screenHeight: 841 })).toBe(false);
    expect(isPhoneSizedTouchDevice(DESKTOP)).toBe(false);
    // A narrow desktop window has a fine pointer, so it stays in the desktop editor.
    expect(isPhoneSizedTouchDevice({ coarsePointer: false, screenWidth: 400, screenHeight: 800 })).toBe(false);
    expect(isPhoneSizedTouchDevice({ coarsePointer: true, screenWidth: 0, screenHeight: 0 })).toBe(false);
  });
});

describe('resolvePhoneEntryRedirect', () => {
  it('sends phones from the editor entry to /m and keeps query and hash', () => {
    expect(resolvePhoneEntryRedirect(at('/editor'), PHONE)).toBe('/m');
    expect(resolvePhoneEntryRedirect(at('/'), PHONE)).toBe('/m');
    expect(resolvePhoneEntryRedirect(at('/editor/', '?project=a', '#x'), PHONE)).toBe('/m?project=a#x');
  });

  it('leaves tablets and desktops in the desktop editor', () => {
    expect(resolvePhoneEntryRedirect(at('/editor'), TABLET)).toBeNull();
    expect(resolvePhoneEntryRedirect(at('/editor'), DESKTOP)).toBeNull();
  });

  it('respects the full-editor choice and the explicit editor overrides', () => {
    expect(resolvePhoneEntryRedirect(at('/editor'), { ...PHONE, prefersFullEditor: true })).toBeNull();
    expect(resolvePhoneEntryRedirect(at('/editor', '?test'), PHONE)).toBeNull();
    expect(resolvePhoneEntryRedirect(at('/editor', '?entry=editor'), PHONE)).toBeNull();
  });

  it('never moves other pages or editor deep links', () => {
    for (const pathname of ['/m', '/medium', '/chat', '/impressum', '/credits/claim', '/editor/share/abc']) {
      expect(resolvePhoneEntryRedirect(at(pathname), PHONE)).toBeNull();
    }
  });
});

describe('full-editor preference', () => {
  afterEach(() => {
    rememberFullEditorPreference(false);
  });

  it('is remembered on the device and cleared again', () => {
    rememberFullEditorPreference(true);
    expect(readPhoneEntryEnvironment().prefersFullEditor).toBe(true);
    rememberFullEditorPreference(false);
    expect(readPhoneEntryEnvironment().prefersFullEditor).toBe(false);
  });
});
