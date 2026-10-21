import type { PointerEvent } from 'react';

const blurAfterPointer = (event: PointerEvent<HTMLElement>) => event.currentTarget.blur();

/**
 * iPhone/iPad browser tab only: Safari evicts a site's storage after seven days of
 * browsing without a visit, Home Screen apps are exempt. Their storage is separate,
 * so the project travels along as a .msproj archive.
 */
export function SavePermanentlyHomeScreenStep({ busy, onDownload }: { busy: string | null; onDownload(): void }) {
  return <div className="save-permanently-option save-permanently-home-screen" data-recommended="true">
    <span className="save-permanently-option-title">Add MasterSelects to the Home Screen<em>Recommended</em></span>
    <span className="save-permanently-option-description">
      Safari clears a website’s storage after seven days of browsing without a visit. MasterSelects opened from the Home Screen is exempt and keeps its projects.
    </span>
    <ol className="save-permanently-steps">
      <li>Tap the Share button (the square with the arrow) in Safari’s toolbar.</li>
      <li>Choose <strong>Add to Home Screen</strong> (under <strong>More</strong> if it is not listed) and keep <strong>Open as Web App</strong> on.</li>
      <li>Open MasterSelects from the new icon on the Home Screen.</li>
    </ol>
    <span className="save-permanently-option-description">
      The Home Screen app has its own storage and does not see this project. Take it along: download it here, then in the Home Screen app use Open Project &gt; Import .msproj archive.
    </span>
    <button type="button" className="save-permanently-take-along" disabled={busy !== null} onPointerUp={blurAfterPointer} onClick={onDownload}>
      {busy === 'take-along' ? 'Downloading…' : 'Download .msproj to take along'}
    </button>
  </div>;
}
