// @vitest-environment node
// Phone imports copy in the background, so two copies run at once. Two different files with the same name
// (every phone camera writes video.mp4) must both land in Raw: the first under its name, the second under
// its hashed name. Before, both saw the name free, and the second lost the compare-and-set and was reported
// as a failed copy.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyRepositoryRaw } from '../../src/services/project/repository/lifecycle/repositoryFiles';

const host = vi.hoisted(() => {
  const files = new Map<string, File>();
  let tick: Promise<void> = Promise.resolve();
  return {
    files,
    /** Lets every write take a while, so concurrent copies really overlap. */
    setTick(next: Promise<void>) { tick = next; },
    async readFile(_folder: string, name: string) { return files.get(name) ?? null; },
    async writeFile(_folder: string, name: string, file: File) {
      // Compare-and-set like createRepositoryDomainPublication: the entity read before the write must be current.
      const before = files.get(name) ?? null;
      await tick;
      if ((files.get(name) ?? null) !== before) return false;
      files.set(name, file);
      return true;
    },
  };
});
vi.mock('../../src/services/project/repository/artifacts/RepositoryDomainPublication', () => ({
  captureRepositoryDomainPublication: () => host,
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => null,
}));

beforeEach(() => { host.files.clear(); host.setTick(Promise.resolve()); });

describe('Raw names of concurrent media copies', () => {
  it('two different files with the same name both land in Raw', async () => {
    let release!: () => void;
    host.setTick(new Promise(resolve => { release = resolve; }));
    const first = copyRepositoryRaw(new File(['first clip'], 'video.mp4'));
    const second = copyRepositoryRaw(new File(['second clip, other bytes'], 'video.mp4'));
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a?.relativePath).toBe('Raw/video.mp4');
    expect(b?.relativePath).toMatch(/^Raw\/video-[0-9a-f]{16}\.mp4$/u);
    expect(host.files.size).toBe(2);
  });

  it('two copies of the same bytes share one stored file', async () => {
    let release!: () => void;
    host.setTick(new Promise(resolve => { release = resolve; }));
    const first = copyRepositoryRaw(new File(['same clip'], 'video.mp4'));
    const second = copyRepositoryRaw(new File(['same clip'], 'video.mp4'));
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({ relativePath: 'Raw/video.mp4', alreadyExisted: false });
    expect(b).toMatchObject({ relativePath: 'Raw/video.mp4', alreadyExisted: true });
    expect(host.files.size).toBe(1);
  });
});
