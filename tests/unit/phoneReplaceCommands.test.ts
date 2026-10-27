import { describe, expect, it } from 'vitest';

import { phoneReplaceShortNote, phoneReplaceUnsupportedReason } from '../../src/components/mobileSkin/replace/phoneReplaceCommands';

describe('phone replace commands', () => {
  it('names why a clip cannot take new footage', () => {
    expect(phoneReplaceUnsupportedReason({ source: { type: 'video', naturalDuration: 3 } }, false)).toBeNull();
    expect(phoneReplaceUnsupportedReason({ source: { type: 'video', naturalDuration: 3 } }, true)).toMatch(/locked/);
    expect(phoneReplaceUnsupportedReason({ source: { type: 'image', naturalDuration: 3 } }, false)).toMatch(/video clips only/);
    expect(phoneReplaceUnsupportedReason({ source: { type: 'video', naturalDuration: 3 }, isComposition: true }, false)).toMatch(/composition/);
  });

  it('warns when the new video is shorter than the part the clip uses', () => {
    expect(phoneReplaceShortNote({ outPoint: 4 }, { name: 'b.mp4', duration: 3 })).toMatch(/shorter/);
    expect(phoneReplaceShortNote({ outPoint: 3 }, { name: 'b.mp4', duration: 3 })).toBeNull();
    expect(phoneReplaceShortNote({ outPoint: 3 }, { name: 'b.mp4', duration: undefined })).toBeNull();
  });
});
