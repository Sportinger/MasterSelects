import { describe, expect, it, vi } from 'vitest';
import {
  getMotionDesignEvidenceSessionNonce,
  isMotionDesignEvidenceSessionUrl,
} from '../../src/services/motionDesign/evidence/motionDesignEvidenceSession';
import { runToolbarProjectBootRestore } from '../../src/components/common/toolbar/toolbarProjectStartup';

describe('Motion Design evidence startup isolation', () => {
  it('recognizes only a nonce-coupled dedicated localhost origin', () => {
    const url = 'http://motion-md0-c4e8d2f7.localhost:5173/?motionDesignEvidenceSession=c4e8d2f7';
    expect(getMotionDesignEvidenceSessionNonce(url)).toBe('c4e8d2f7');
    expect(isMotionDesignEvidenceSessionUrl(url)).toBe(true);
  });

  it.each([
    'http://localhost:5173/?motionDesignEvidenceSession=c4e8d2f7',
    'http://other.localhost:5173/?motionDesignEvidenceSession=c4e8d2f7',
    'http://motion-md0-wrong123.localhost:5173/?motionDesignEvidenceSession=c4e8d2f7',
    'http://motion-md0-short.localhost:5173/?motionDesignEvidenceSession=short',
    'http://motion-md0-c4e8d2f7.localhost:5173/',
    'http://motion-md0-c4e8d2f7.localhost:5173/?motionDesignEvidenceSession=c4e8d2f7&motionDesignEvidenceSession=c4e8d2f7',
    'file:///tmp/?motionDesignEvidenceSession=c4e8d2f7',
    'http://user:secret@motion-md0-c4e8d2f7.localhost:5173/?motionDesignEvidenceSession=c4e8d2f7',
    'not a URL',
  ])('does not disable normal project restore for %s', (url) => {
    expect(getMotionDesignEvidenceSessionNonce(url)).toBeNull();
    expect(isMotionDesignEvidenceSessionUrl(url)).toBe(false);
  });

  it('calls neither project restore nor store hydration for an isolated evidence boot', async () => {
    const restoreLastProject = vi.fn(async () => true);
    const loadProjectToStores = vi.fn(async () => {});

    await expect(runToolbarProjectBootRestore({
      url: 'http://motion-md0-c4e8d2f7.localhost:5173/?motionDesignEvidenceSession=c4e8d2f7',
      restoreLastProject,
      loadProjectToStores,
    })).resolves.toBe('evidence-isolated');
    expect(restoreLastProject).not.toHaveBeenCalled();
    expect(loadProjectToStores).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost:5173/',
    'http://motion-md0-c4e8d2f7.localhost:5173/?motionDesignEvidenceSession=wrong123',
  ])('keeps normal restore and hydration behavior for %s', async (url) => {
    const restoreLastProject = vi.fn(async () => true);
    const loadProjectToStores = vi.fn(async () => {});

    await expect(runToolbarProjectBootRestore({
      url,
      restoreLastProject,
      loadProjectToStores,
    })).resolves.toBe('restored');
    expect(restoreLastProject).toHaveBeenCalledOnce();
    expect(loadProjectToStores).toHaveBeenCalledOnce();
  });

  it('does not hydrate stores when normal project restore finds nothing', async () => {
    const restoreLastProject = vi.fn(async () => false);
    const loadProjectToStores = vi.fn(async () => {});

    await expect(runToolbarProjectBootRestore({
      url: 'http://localhost:5173/',
      restoreLastProject,
      loadProjectToStores,
    })).resolves.toBe('not-restored');
    expect(loadProjectToStores).not.toHaveBeenCalled();
  });
});
