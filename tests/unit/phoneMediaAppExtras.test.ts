// Media jobs, clipboard paste, first-run welcome, install view and the move of temporary projects on
// the phone (packet G6): the pure rules behind each sheet row.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaFile } from '../../src/stores/mediaStore/types';
import { countRunningPhoneMediaJobs, phoneMediaJobs, phoneMediaJobsOf } from '../../src/components/mobileSkin/library/phoneMediaJobs';
import { classifyPhoneClipboard, classifyPhoneClipboardText } from '../../src/components/mobileSkin/library/phoneClipboardImport';
import {
  dismissPhoneWelcome, isPhoneWelcomeDue, PHONE_WELCOME_STORAGE_KEY, resetPhoneWelcome,
} from '../../src/components/mobileSkin/home/phoneWelcome';
import { phoneInstallPlatform, phoneInstallView } from '../../src/components/mobileSkin/settings/phoneHelpModel';
import { movePhoneTemporaryProjects } from '../../src/components/mobileSkin/project/phoneProjectStorage';

function file(overrides: Partial<MediaFile>): MediaFile {
  return { id: 'f1', name: 'clip.mp4', type: 'video', url: 'blob:x', parentId: null, createdAt: 0, ...overrides } as MediaFile;
}

describe('phone media jobs', () => {
  it('lists running, waiting, failed and finished jobs with the commands the phone has for them', () => {
    const jobs = phoneMediaJobs([
      file({ id: 'a', name: 'a.mp4', proxyStatus: 'generating', proxyProgress: 42 }),
      file({ id: 'b', name: 'b.mp4', proxyStatus: 'error', waveformStatus: 'ready' }),
      file({ id: 'c', name: 'c.mp4', isImporting: true, importProgress: 0.5, transcriptStatus: 'transcribing' }),
    ]);
    expect(jobs.map((job) => [job.fileId, job.kind, job.state])).toEqual([
      ['a', 'proxy', 'running'], ['c', 'import', 'running'], ['c', 'transcript', 'running'],
      ['b', 'proxy', 'failed'], ['b', 'waveform', 'done'],
    ]);
    expect(jobs[0]).toMatchObject({ progress: 42, actions: ['stop'] });
    expect(jobs[1].progress).toBe(50);
    expect(jobs.find((job) => job.fileId === 'b' && job.kind === 'proxy')?.actions).toEqual(['retry']);
    expect(jobs.find((job) => job.kind === 'waveform')?.actions).toEqual(['retry', 'show']);
  });

  it('hides finished jobs on request, ignores idle states and counts the active ones', () => {
    const files = [file({ proxyStatus: 'ready', waveformStatus: 'skipped', analysisStatus: 'none' }), file({ id: 'g', faceAnalysisStatus: 'analyzing' })];
    expect(phoneMediaJobs(files, { hideDone: true }).map((job) => job.kind)).toEqual(['faces']);
    expect(phoneMediaJobsOf(file({}))).toEqual([]);
    expect(countRunningPhoneMediaJobs(files)).toBe(1);
  });
});

describe('phone clipboard paste', () => {
  it('prefers pasted files, turns a lone address into a link and keeps prose as text', () => {
    const image = new File([new Uint8Array([1, 2, 3])], 'clip.png', { type: 'image/png' });
    expect(classifyPhoneClipboard([image], 'clip.png')).toEqual({ kind: 'files', files: [image] });
    expect(classifyPhoneClipboard([new File([], 'empty.png')], '')).toEqual({ kind: 'empty' });
    expect(classifyPhoneClipboardText('www.youtube.com/watch?v=abc')).toEqual({ kind: 'link', url: 'https://www.youtube.com/watch?v=abc' });
    expect(classifyPhoneClipboardText('see https://a.com today')).toEqual({ kind: 'text', text: 'see https://a.com today' });
    expect(classifyPhoneClipboardText('   ')).toEqual({ kind: 'empty' });
  });
});

describe('phone first-run welcome', () => {
  afterEach(() => { window.localStorage.removeItem(PHONE_WELCOME_STORAGE_KEY); resetPhoneWelcome(); });

  it('shows until dismissed, remembers the choice on the device and comes back on request', () => {
    resetPhoneWelcome();
    expect(isPhoneWelcomeDue()).toBe(true);
    dismissPhoneWelcome();
    expect(isPhoneWelcomeDue()).toBe(false);
    expect(window.localStorage.getItem(PHONE_WELCOME_STORAGE_KEY)).toBe('1');
    resetPhoneWelcome();
    expect(isPhoneWelcomeDue()).toBe(true);
  });
});

describe('phone install page', () => {
  it('is honest about the install state and the platform steps', () => {
    expect(phoneInstallView({ canInstall: true, installed: true, dismissed: false })).toBe('installed');
    expect(phoneInstallView({ canInstall: true, installed: false, dismissed: true })).toBe('prompt');
    expect(phoneInstallView({ canInstall: false, installed: false, dismissed: false })).toBe('steps');
    expect(phoneInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(phoneInstallPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5)).toBe('ios');
    expect(phoneInstallPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 7)')).toBe('android');
    expect(phoneInstallPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('other');
  });
});

describe('phone move of temporary projects', () => {
  it('moves every project it can and names the ones it kept', async () => {
    const move = vi.fn(async (name: string) => {
      if (name === 'Open one') throw new Error('"Open one" is open in another tab.');
      return { to: `${name} (2)` };
    });
    const result = await movePhoneTemporaryProjects(['A', 'Open one', 'B'], move);
    expect(move).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ ok: true, message: 'Moved 2 of 3 to permanent storage. "Open one" stays temporary: "Open one" is open in another tab.' });
    expect((await movePhoneTemporaryProjects(['X'], async () => { throw new Error('locked'); })).ok).toBe(false);
    expect(await movePhoneTemporaryProjects([], move)).toEqual({ ok: true, message: 'Moved 0 of 0 to permanent storage.' });
  });
});
