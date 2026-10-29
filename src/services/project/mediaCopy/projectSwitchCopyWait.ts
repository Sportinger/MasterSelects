// A phone import returns before its copy into the project is durable; the switch to the copy is recorded
// in the project that imported it. Opening, creating or closing another project before that would leave the
// old project with media whose copy is never recorded (offline after a reload). Every project switch
// therefore finishes the running copies first and shows that on the project load screen.

import { Logger } from '../../logger';
import { setProjectLoadProgress } from '../load/loadProgress';
import {
  formatMediaBytes,
  getProjectMediaCopyNotice,
  hasPendingProjectMediaCopies,
  subscribeProjectMediaCopyNotice,
  waitForProjectMediaCopies,
} from './projectMediaCopyNotices';

const log = Logger.create('ProjectMediaCopy');

function showProgress(): void {
  const notice = getProjectMediaCopyNotice();
  if (!notice || notice.pendingFiles === 0) return;
  setProjectLoadProgress({
    phase: 'opening',
    percent: 4,
    message: 'Finishing the copy into the current project',
    detail: `${notice.pendingFiles} file${notice.pendingFiles === 1 ? '' : 's'} · ${formatMediaBytes(notice.pendingBytes)} left`,
    blocking: true,
  });
}

/**
 * Waits until every announced copy into the open project is recorded, failed (reported) or released as
 * unused, before the project is replaced or closed. Each copy always settles one of these ways.
 */
export async function finishProjectMediaCopiesBeforeSwitch(): Promise<void> {
  if (!hasPendingProjectMediaCopies()) return;
  const startedAt = Date.now();
  log.info('Project switch waits for copies into the current project', { pendingFiles: getProjectMediaCopyNotice()?.pendingFiles });
  showProgress();
  const unsubscribe = subscribeProjectMediaCopyNotice(showProgress);
  try {
    await waitForProjectMediaCopies();
  } finally {
    unsubscribe();
    setProjectLoadProgress(null);
  }
  log.info('Copies into the current project finished; the project switch continues', { waitedMs: Date.now() - startedAt });
}
