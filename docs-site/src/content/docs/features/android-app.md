---
title: "Android App"
---

[Back to Index](/features/readme/)

The Android project packages the full built editor inside Android WebView. Local
editing starts without internet, including the bundled FFmpeg WASM tier. Cloud AI,
login, credits, media search and externally hosted models still need a connection.
The app is available to invited Google Play internal testers; it is not a public release.

## Runtime

- `android/` is a standalone Gradle project. Android 10/API 29 is the installation
  minimum; usable WebGPU/WebCodecs depend on the installed WebView and GPU.
- HTML, chunks, fonts, workers and public runtime assets are copied from `dist/`.
  The generated inventory records URLs, stored filenames, MIME types, sizes and
  SHA-256 hashes. Gzip assets retain their compressed bytes through AAPT packaging.
- Local content uses `https://www.masterselects.com` inside WebView. `/api/*` calls
  reach the hosted backend. Missing local resources return 404 instead of silently
  mixing editor versions. External models retain their original network URLs.
  Local responses include COOP/COEP; actual isolation support depends on WebView.
- Projects use a selected Android folder when File System Access is available,
  otherwise the existing OPFS backend in the app's WebView profile. Chrome
  browser storage and cookies are separate. Installation does not migrate or clear them.
  Copy/reimport media when moving a project. Uninstalling or clearing app data
  removes app-local projects, so keep external backups.
- File selection preserves WebView's requested operation: import, writable file,
  **Save as**, or Android's folder picker. Folder requests have no file MIME filter.
  Selected document/tree URIs retain only the read/write grants returned by Android.
  Android 17/API 37 with a supporting WebView can use project folders. The app
  targets API 37 to opt into WebView's File System Access compatibility change;
  targeting 36 silently cancels folder requests before the native callback.
  On Android 16 and below, the native startup script hides the nonfunctional
  picker APIs so the editor uses its existing app-private OPFS storage fallback.
  Android restricts
  selection of storage roots and some system folders. Camera/microphone permissions
  are requested on use.
- Blob/data-URL exports use Android **Save as**, then offer **Share**. Transfers use
  acknowledged 256 KiB chunks and verify the total byte count. Cancelled/failed
  saves remove the partial destination where the provider supports deletion.
  This bounds the transfer copy; the media muxer still buffers the finished file.
- Export panels, the export dialog and batch export hold a foreground screen lock.
  Android uses a window flag; browsers use Screen Wake Lock where supported.
  This does not guarantee background/locked-screen export. Android can terminate
  the renderer under memory pressure.
- Rotation retains the WebView. System bars, cutouts and the keyboard have safe
  insets. Back asks before leaving. Debug builds support WebView inspection.
- Native messages accept only the main frame at the exact editor origin. External
  pages receive no arbitrary filesystem or JavaScript bridge access.

## Cloud sign-in

### Review access preparation (not enabled)

The server contains a dedicated review sign-in form at
`/api/auth/callback?state=review&token=review`, compatible with the Android
**Open email sign-in link** dialog. These URL values are public markers, not
credentials. The form sends the separately generated 256-bit access code by POST.
Only an explicitly provisioned user can sign in; codes are stored as SHA-256
hashes. Disabling the account or changing its hash invalidates existing review
sessions. Migration `0029_reviewer_access.sql` is required before provisioning.

This is **not a working cloud reviewer account yet**. New accounts default to
disabled. Review sessions may access account status, credit summary, hosted Kie
chat and the Normal Path kernel only when both a separately capped
`KIEAI_REVIEW_API_KEY` and a distinct `KERNEL_REVIEW_ORIGIN` are configured.
The Kie chat route replaces the ordinary key before dispatch; Normal Path turns
are sent to the dedicated review kernel origin. That kernel must be pinned to
Kie with the **same capped review key** and have no other paid provider keys.
Other cloud AI routes remain blocked. The vendor-side key cap, rather than app
credits, is the hard provider-spend boundary. `reviewerBudget.ts` and the
migration offer additional atomic reservations, but cannot substitute for the
vendor cap without proven upper cost bounds. No production account, credential,
review kernel or provider key binding has been provisioned by this implementation.

### Regular account sign-in

Use **Send link**, then open the email link with MasterSelects after App Links are
configured, or use **Open email sign-in link** and paste the original link. The
existing server validates the signed, expiring token and issues its session cookie
inside WebView. No server authentication bypass or credential copying is added.

Google OAuth in embedded WebView is not supported in this version. Android offers
email login instead; Google needs a future secure browser-to-app session handoff.
External documentation opens in the browser. The Android beta disables purchases,
plan changes and the external billing portal; existing account credits remain
usable. Purchase entry points also refuse checkout/portal API requests. Website
billing is unchanged. Play Billing or an applicable enrolled alternative-payment
program is needed before enabling Android purchases. The hosted AI login journey
still needs real-device integration checks.

## Build

Install the repo's pinned Node version, JDK 17, Android SDK platform 37.0, build tools
36.0.0 or later, and platform-tools. Set `ANDROID_HOME`; common per-user SDK paths
are also recognized. Gradle 9.3.1 is pinned with distribution SHA-256 verification;
AGP is 9.1.1.

```sh
npm ci
npm run build
node scripts/android.mjs doctor
node scripts/android.mjs build
```

`build` packages the existing final `dist/`, runs Android unit tests/lint, builds
the debug APK, compares every packaged asset byte-for-byte and verifies its signature. Outputs:

- `output/android/MasterSelects-debug.apk` (`com.masterselects.app.debug`)
- `output/android/assetlinks.debug.json` (optional development App Links)

Rebuild the website after source changes before packaging. Only public runtime
assets are bundled: no `functions/`, local secrets, private kernel, source maps,
desktop helper downloads or development media fixtures. Large optional models
are not automatically fetched by the packager.

```sh
node scripts/android.mjs install --serial DEVICE_ID
```

For Android Studio, run `node scripts/android.mjs prepare` and open `android/`.
Gradle fails explicitly if the editor bundle has not been prepared.

## Signing and distribution preparation

Release uses `com.masterselects.app` and the existing editor version. Set these
environment variables outside the repository:

- `MS_ANDROID_KEYSTORE`: absolute path to the release/upload keystore
- `MS_ANDROID_STORE_PASSWORD`
- `MS_ANDROID_KEY_ALIAS`
- `MS_ANDROID_KEY_PASSWORD`

```sh
node scripts/android.mjs bundle --version-code 1
node scripts/android.mjs assetlinks --fingerprint SHA256_CERTIFICATE_FINGERPRINT
```

Use an increasing Android version code for subsequent releases. Outputs are
`output/android/MasterSelects-release.aab` and `output/android/assetlinks.json`.
For Play App Signing, use the **app signing** certificate, not the upload key.
Merge the generated statement with existing associations and serve JSON without
redirects at `https://www.masterselects.com/.well-known/assetlinks.json`.
Association enables automatic incoming links; offline startup does not need it.
Do not deploy development certificates as production identities.

```sh
node scripts/android.mjs verify-links
```

No command deploys, uploads to Play, sends messages, bumps the editor version or
creates a release. Store billing for digital purchases and applicable regional
programs must be addressed before store release. Gradle wrapper and AndroidX
dependencies retain their upstream licenses; editor licensing remains unchanged.

## Verification and limits

`EditorFilePickerTest` is an Android instrumentation regression test for folder,
writable-file, save and multi-file requests. From `android/`, build with
`./gradlew :app:assembleDebugAndroidTest`, then install the test APK with
`adb -s <serial> install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`.
With the current debug app already installed, run
`adb -s <serial> shell am instrument -w -r com.masterselects.app.debug.test/androidx.test.runner.AndroidJUnitRunner`.
Use `gradlew.bat` on Windows. This manual invocation preserves the installed app
and its data; Gradle's `connectedDebugAndroidTest` uninstalls the app during cleanup.

Automated checks cover URL/origin restrictions, signing identities, binary chunk
integrity, cancellation and screen-lock races. Device acceptance must cover offline
cold start, project reopening, import/playback/effects, audio/video export and
sharing, rotation, camera/mic permission denial, email login and a cloud AI request.
Qualify both Adreno and Mali hardware before promising broad GPU compatibility.

The package retains capability detection. It adds no Android port of the desktop
Native Helper, unrestricted folders, native screen capture, new hardware codecs or
background export engine. Models/runtimes hosted externally are not necessarily
available offline. 4K, many simultaneous video layers and large buffered exports
remain device-dependent.

References: [Android local web content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content),
[WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview),
[WebGPU compatibility](https://developer.chrome.com/blog/new-in-webgpu-146),
[Screen Wake Lock](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock).

## Device verification

On Pixel 10 Pro with Android 17 and WebView 152, project-folder selection, native
video import, explicit save, and restoring the saved media entry after an app
restart were verified. Five on-device picker contract tests and five bridge
unit tests pass. Android 16 and older storage fallback is covered by bridge
unit tests; it still needs a physical-device run.
