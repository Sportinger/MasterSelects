import { describe, expect, it } from 'vitest';
import {
  describeMIDIPermissionState,
  getMIDIPermissionHelpText,
} from '../../src/types/midi';

describe('MIDI permission messaging', () => {
  it('describes denied permission as a site-level block', () => {
    expect(describeMIDIPermissionState('denied')).toBe(
      'Browser MIDI permission is blocked for this site.'
    );
  });

  it('guides the user to site settings when permission is denied', () => {
    expect(getMIDIPermissionHelpText('denied')).toContain('Site settings');
    expect(getMIDIPermissionHelpText('denied')).toContain('localhost');
  });

  it('tells the user that prompt state can still request permission', () => {
    expect(describeMIDIPermissionState('prompt')).toBe(
      'Browser can ask for MIDI permission.'
    );
    expect(getMIDIPermissionHelpText('prompt')).toContain('Enable MIDI');
  });
});
