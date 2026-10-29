# App updates

When a new version of MasterSelects goes live while you are working, the editor tells you quietly and
updates with one click, without losing any work.

<figure class="docs-shot docs-shot--float-right">

![The workspace bar brand "MasterSelects 3.3.8" glowing turquoise in the bottom left corner](./assets/app-updates/update-glow.webp)

<figcaption>A new version is ready: the brand in the bottom left glows.</figcaption>
</figure>

- **The brand glows.** "MasterSelects" with its version number, bottom left in the workspace bar,
  glows turquoise and slowly pulses. Hold the pointer over it to see which version is ready.
- **Click it to update.** The editor saves your project, waits for media that are still being copied
  into the project, then loads the new version. Your project opens again as you left it.
- **A running export is never interrupted.** The editor asks first: **Update after export** waits for
  the export and then updates, **Not now** keeps working on this version.

**Tip:** you do not have to update right away. The brand keeps glowing until you click it or reload
the page yourself.

<div class="docs-float-end"></div>

## Options

**The glowing brand** – appears only when the server has a different version than the one you are
using. A second upload of the same version does not make it glow. With reduced motion turned on in your
system, it glows without pulsing. The keyboard reaches it with Tab like every other button.

**Update after export / Not now** – shown only when you click the brand while an export runs. While the
editor waits or saves, the small window says what it is doing; **Cancel** stops waiting (a save that has
already started still finishes).

**On the phone** – the phone editor at `/m` shows a turquoise **Update** button with a circular arrow in
its top bar, next to the project name, as soon as a new version is ready. A tap does the same as the
brand: save, wait for copies and exports, then reload. **Settings → App → Check for update** checks
by hand and offers **Save and reload**.

## Limits

- The editor looks for a new version about every five minutes while its tab is in front, and right away
  when you come back to the tab or your connection returns. A tab in the background does not check.
- With several MasterSelects tabs open in one browser, only one visible tab asks the server and tells the
  others, so every tab glows at the same time. When that tab is closed or goes to the background, another
  visible tab takes over.
- Without a connection it simply tries again later; a version it already found stays announced.
- If the project cannot be saved, the editor does not reload and tells you why.
- Work that has no project or browser recovery behind it is still guarded by the browser's own
  "Leave site?" question.

## Technical details

- **Version check** (`src/services/appUpdate/appUpdateCheck.ts`): fetches `/build-info.json?check=<time>`
  with `cache: 'no-store'`, every 5 minutes plus up to 60 s of jitter, and on `visibilitychange` (to
  visible) and `online`, at most once a minute for those events. A clean release is compared by its
  `releaseId` (version and commit), so redeploying the same commit is not an update; local builds fall
  back to `buildId`. An answer that is not JSON build info (dev server, SPA fallback) is "unknown", never
  an update. Failures are logged once per failure streak (`Logger.enable('AppUpdateCheck')`).
- **Several tabs** (`appUpdateTabs.ts`): only the visible tab holding the Web Lock
  `masterselects-app-update-leader` polls. A tab asks for the lock only while it is visible and releases it
  when it is hidden or stops, so a closed, hidden or frozen leader hands over to the next visible tab in the
  lock queue (no stealing); the new leader keeps the previous tab's rhythm. Every answer goes out on the
  BroadcastChannel `masterselects-app-update` as the served build (`version`, `buildId`, `releaseId`), and each
  tab compares it with the build it runs itself, so tabs of different versions stay correct. A tab that
  comes back or reconnects posts `check`; the leader checks unless any tab checked within the last minute,
  and otherwise re-sends its last answer (a tab that was frozen catches up). A new tab posts `hello` and gets
  the last answer. Without Web Locks or BroadcastChannel every tab checks on its own as before.
- **Dev server**: the check is off, because Vite serves no build info. `localStorage['ms.updateCheck.enabled'] = 'true'`
  turns it on there; `'false'` turns it off in a built editor.
- **Safe reload** (`updateReloadFlow.ts`, wired in `reloadForAppUpdate.ts`): asks while
  `isExporting` is set (or waits for it after **Update after export**), waits for
  `hasPendingProjectMediaCopies()` to clear, saves with `saveCurrentProject({ source: 'manual' })`
  (the browser recovery workspace is flushed with `flushEditorRepository()`), repeats when new copies or
  an export started during the save, then refreshes the HTTP cache entry of the page (`fetch` with
  `cache: 'reload'`), removes a leftover service worker (the app registers none) and calls
  `location.reload()`. Assets are content-hashed and deploys keep the assets of earlier releases
  (`deploy:retain-assets`), so the old tab keeps working until the reload.
- **UI**: `src/components/common/WorkspaceBarBrand.tsx` (desktop) and
  `src/components/mobileSkin/shell/PhoneUpdateButton.tsx` (phone) share `src/hooks/useAppUpdate.ts`.
  Colours are the `--update-available` tokens in `src/styles/tokens.css`; the pulse animates only the
  opacity of a glow layer.
- **Tests**: `tests/unit/appUpdateCheck.test.ts`, `tests/unit/appUpdateTabs.test.ts` (simulated tabs: one
  request, every tab glows, handover, fallback), `tests/unit/updateReloadFlow.test.ts` and the journey
  `tests/playwright/platform/app-update.spec.ts` (routes `/build-info.json` to a newer release, checks the
  glow, clicks it and checks that a change made just before survived the reload; a second case opens two
  editor tabs and checks one request and two glowing brands).
