// A phone import returns before its copy into the project is durable; the switch to the copy is recorded
// in the project that imported it. Opening, creating or closing another project before that would leave the
// old project with media whose copy is never recorded (offline after a reload). Every project switch
// therefore finishes the running copies first and shows that on the project load screen, with how many
// bytes are left (the storage worker reports its reads).
//
// The wait always has a way out: a caller's AbortSignal (e.g. Cancel of an archive import) ends it with an
// AbortError, and after CONTINUE_WITHOUT_COPIES_AFTER_MS the load screen offers to continue without the
// copies. Continuing reports each unfinished copy as interrupted (the media must be picked again); the
// project's note of running copies (pendingProjectCopyMarker) stays, so reopening that project names them
// again. A copy that hangs (storage that never answers, a transaction that never ends) can therefore never
// hold the editor on the load screen until a reload.

import { Logger } from '../../logger';
import { setProjectLoadProgress } from '../load/loadProgress';
import {
  abandonPendingProjectMediaCopies,
  formatMediaBytes,
  getProjectMediaCopyNotice,
  hasPendingProjectMediaCopies,
  subscribeProjectMediaCopyNotice,
} from './projectMediaCopyNotices';

const log = Logger.create('ProjectMediaCopy');

/** How long a project switch waits for copies before the load screen offers to continue without them. */
export const CONTINUE_WITHOUT_COPIES_AFTER_MS = 8000;

/** The message of a copy left unfinished by the person's choice. */
export const COPY_LEFT_BY_SWITCH_MESSAGE = 'the project was switched before its copy finished';

const continueHandlers = new Set<() => void>();

function showProgress(offerContinue: boolean): void {
  const notice = getProjectMediaCopyNotice();
  if (!notice || notice.pendingFiles === 0) return;
  const left = Math.max(0, notice.pendingBytes - notice.pendingDoneBytes);
  const fraction = notice.pendingBytes > 0 ? notice.pendingDoneBytes / notice.pendingBytes : 0;
  setProjectLoadProgress({
    phase: 'opening',
    percent: Math.max(4, Math.min(99, Math.round(fraction * 100))),
    message: 'Finishing the copy into the current project',
    detail: `${notice.pendingFiles} file${notice.pendingFiles === 1 ? '' : 's'} · ${formatMediaBytes(left)} left`,
    blocking: true,
    action: offerContinue ? 'continue-without-copies' : undefined,
  });
}

/**
 * Called by the load screen's "Continue without the copy" action: every waiting project switch goes on,
 * and the unfinished copies are reported as interrupted.
 */
export function continueProjectSwitchWithoutCopies(): void {
  for (const handler of [...continueHandlers]) handler();
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The project switch was cancelled', 'AbortError');
}

/**
 * Waits until every announced copy into the open project is recorded, failed (reported) or released as
 * unused, before the project is replaced or closed, or until the person continues without them. Rejects
 * with the abort reason when `signal` aborts; the copies then keep running and the project stays open.
 */
export async function finishProjectMediaCopiesBeforeSwitch(signal?: AbortSignal): Promise<void> {
  if (!hasPendingProjectMediaCopies()) return;
  if (signal?.aborted) throw abortError(signal);
  const startedAt = Date.now();
  log.info('Project switch waits for copies into the current project', { pendingFiles: getProjectMediaCopyNotice()?.pendingFiles });
  let offerContinue = false;
  showProgress(offerContinue);
  const cleanups: Array<() => void> = [];
  try {
    const outcome = await new Promise<'finished' | 'continued'>((resolve, reject) => {
      cleanups.push(subscribeProjectMediaCopyNotice(() => {
        if (!hasPendingProjectMediaCopies()) resolve('finished');
        else showProgress(offerContinue);
      }));
      const offerTimer = setTimeout(() => {
        offerContinue = true;
        log.info('Project switch still waits for copies; the load screen offers to continue without them', { waitedMs: Date.now() - startedAt });
        showProgress(offerContinue);
      }, CONTINUE_WITHOUT_COPIES_AFTER_MS);
      cleanups.push(() => clearTimeout(offerTimer));
      const onContinue = () => resolve('continued');
      continueHandlers.add(onContinue);
      cleanups.push(() => { continueHandlers.delete(onContinue); });
      if (signal) {
        const onAbort = () => reject(abortError(signal));
        signal.addEventListener('abort', onAbort, { once: true });
        cleanups.push(() => signal.removeEventListener('abort', onAbort));
      }
    });
    if (outcome === 'continued') {
      const abandoned = abandonPendingProjectMediaCopies(COPY_LEFT_BY_SWITCH_MESSAGE);
      log.warn('Project switch continued without finishing copies into the current project', { abandoned, waitedMs: Date.now() - startedAt });
      return;
    }
    log.info('Copies into the current project finished; the project switch continues', { waitedMs: Date.now() - startedAt });
  } catch (error) {
    log.info('Project switch cancelled while it waited for copies into the current project', { waitedMs: Date.now() - startedAt });
    throw error;
  } finally {
    for (const cleanup of cleanups.splice(0)) cleanup();
    setProjectLoadProgress(null);
  }
}
