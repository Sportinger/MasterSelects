import './chunkRecoveryNotice.css';

// Plain DOM, not React: a failed lazy import can unmount the whole React root,
// and this notice must still explain the blank editor and offer a reload.
const NOTICE_ID = 'masterselects-chunk-recovery-notice';

export type ChunkRecoveryNoticeKind = 'offline' | 'unsaved' | 'retry';

const MESSAGES: Record<ChunkRecoveryNoticeKind, string> = {
  offline: 'You are offline, so part of MasterSelects could not be loaded. It reloads as soon as the connection is back.',
  unsaved: 'Part of MasterSelects could not be loaded, probably because a newer version was published. Save your project, then reload.',
  retry: 'Part of MasterSelects could not be loaded. Reload to try again.',
};

export function showChunkRecoveryNotice(kind: ChunkRecoveryNoticeKind): void {
  if (typeof document === 'undefined' || !document.body) return;
  let notice = document.getElementById(NOTICE_ID);
  if (!notice) {
    notice = document.createElement('div');
    notice.id = NOTICE_ID;
    notice.className = 'chunk-recovery-notice';
    notice.setAttribute('role', 'alert');
    const message = document.createElement('p');
    message.className = 'chunk-recovery-notice-message';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'chunk-recovery-notice-reload';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => window.location.reload());
    notice.append(message, reload);
    document.body.append(notice);
  }
  notice.dataset.kind = kind;
  notice.querySelector('.chunk-recovery-notice-message')!.textContent = MESSAGES[kind];
}

export function hideChunkRecoveryNotice(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(NOTICE_ID)?.remove();
}
