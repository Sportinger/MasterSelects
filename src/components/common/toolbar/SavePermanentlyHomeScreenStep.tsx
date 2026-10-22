import type { PointerEvent, ReactNode } from 'react';

const blurAfterPointer = (event: PointerEvent<HTMLElement>) => event.currentTarget.blur();

/** Safari's Share glyph: a square with an arrow pointing up out of it. */
function ShareGlyph() {
  return <svg className="save-permanently-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M8.5 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-2" />
  </svg>;
}

/** Safari's Add to Home Screen glyph: a rounded square with a plus. */
function AddGlyph() {
  return <svg className="save-permanently-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>;
}

function Step({ number, done, label, hint, children }: { number: number; done?: boolean; label: ReactNode; hint?: string; children?: ReactNode }) {
  return <li className="save-permanently-step" data-done={done ? 'true' : 'false'}>
    <span className="save-permanently-step-number" aria-hidden="true">{done ? '✓' : number}</span>
    <span className="save-permanently-step-text">
      <strong>{label}</strong>
      {hint && <small>{hint}</small>}
    </span>
    {children}
  </li>;
}

/**
 * iPhone/iPad browser tab only: Safari evicts a site's storage after seven days of
 * browsing without a visit, Home Screen apps are exempt. Their storage is separate,
 * so the project travels along as a .msproj archive: download first, then install.
 */
export function SavePermanentlyHomeScreenStep({ busy, downloaded, onDownload }: { busy: string | null; downloaded: boolean; onDownload(): void }) {
  return <section className="save-permanently-fix" aria-label="Fix: use the Home Screen app">
    <p className="save-permanently-fix-title">Fix: use the Home Screen app. It keeps your data.</p>
    <ol className="save-permanently-steps">
      <Step number={1} done={downloaded} label="Download this project" hint="The new app starts empty.">
        <button type="button" className="save-permanently-primary save-permanently-take-along" data-autofocus="true" disabled={busy !== null}
          onPointerUp={blurAfterPointer} onClick={onDownload}>
          {busy === 'take-along' ? 'Downloading…' : downloaded ? 'Download again' : 'Download project'}
        </button>
      </Step>
      <Step number={2} label={<>Tap Share <ShareGlyph /></>} hint="In Safari’s toolbar or ••• menu." />
      <Step number={3} label={<>Tap Add to Home Screen <AddGlyph /></>} hint="Maybe under More. Keep “Open as Web App” on." />
      <Step number={4} label={<>Open the new <img className="save-permanently-app-icon" src="/icons/apple-touch-icon.png" alt="" /> icon</>} />
      <Step number={5} label="Open Project → Import" hint="Pick the downloaded file." />
    </ol>
  </section>;
}
