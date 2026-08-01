# Native-Helper.md — audit 2026-08-02

## Verified (spot checks that held)

- The helper is a Rust binary at `tools/native-helper/`; its package is `masterselects-helper` and its current helper version is `0.3.15` (`tools/native-helper/Cargo.toml`, `src/version.ts`, `src/services/nativeHelper/releases.ts`). The app version is `2.4.4` (`package.json`, `src/version.ts`).
- The default endpoints remain WebSocket `127.0.0.1:9876` and HTTP `port + 1`; HTTP exposes `/file`, `/upload`, `/project-root`, `/startup-token`, and AI bridge routes (`tools/native-helper/src/main.rs`, `tools/native-helper/src/server.rs`, `tools/native-helper/src/http_server.rs`).
- Downloads use yt-dlp, look beside the executable before PATH, and support generic platform URLs plus format listing (`tools/native-helper/src/download/ytdlp.rs`, `tools/native-helper/src/protocol/commands.rs`).
- Firefox/native project persistence, native folder picking, granted paths, and the manual-path fallback are implemented (`src/services/project/ProjectFileService.ts`, `src/services/project/fileService/nativeBackend.ts`, `src/services/nativeHelper/nativeHelperFileCommands.ts`, `tools/native-helper/src/session.rs`).
- MatAnyone2 is NVIDIA CUDA-only and writes transparent VP9/WebM foreground plus alpha outputs; MuScriptor has persistent local sidecar support, strict `small`/`medium`/`large` variants, instrument constraints, progress, and cancellation (`tools/native-helper/src/matanyone/env.rs`, `tools/native-helper/python/matanyone2_server.py`, `tools/native-helper/src/muscriptor/`, `tools/native-helper/python/muscriptor_server.py`).
- Windows tray, auto-start, and GitHub-release update code exist (`tools/native-helper/src/tray.rs`, `tools/native-helper/src/updater.rs`).
- The stated test coverage is substantively present: Rust inline tests and focused browser tests cover dialog, project backend, MatAnyone commands, and MuScriptor commands (`tools/native-helper/src/**`, `tests/unit/nativeHelperDialog.test.tsx`, `tests/unit/projectFileServiceNativeBackend.test.ts`, `tests/unit/nativeHelperMatAnyoneCommands.test.ts`, `tests/unit/nativeHelperMuscriptorCommands.test.ts`).

## Outdated or wrong (claim → reality, with file evidence)

- “Turbo” toolbar text/status → the toolbar is an icon-only lightning button. Its dialog labels status **Disabled**, **Not running**, or **Connected**; it also presents release-target/capability pills. (`src/components/common/NativeHelperStatus.tsx`, `src/components/common/settings/NativeHelperSettings.tsx`).
- The status dialog lists “Download directory” and “Project root” → it does not render either field. It renders version, yt-dlp, project, AI bridge, MatAnyone2, and published-release/app-target status. (`src/components/common/NativeHelperStatus.tsx`).
- `--allowed-origins` says “empty = all localhost” → no such empty-list behaviour exists. With no option, `main.rs` installs explicit production, staging, and local-development origins; a supplied list is split verbatim. (`tools/native-helper/src/main.rs`).
- The WebSocket command table omits `grant_path` → it is an implemented command used to register absolute project roots. (`tools/native-helper/src/protocol/commands.rs`, `tools/native-helper/src/session.rs`, `src/services/nativeHelper/nativeHelperFileCommands.ts`).
- The HTTP table omits `/ai-tools` → both `/ai-tools` and `/api/ai-tools` are implemented GET/POST aliases. (`tools/native-helper/src/http_server.rs`).
- The curl example omits its required Bearer header → POST requests require `Authorization: Bearer <startup-token>` whenever helper authentication is enabled. (`tools/native-helper/src/http_server.rs`, `tools/native-helper/src/main.rs`).
- Browser-client source map lists only four files → the client is now split into command adapters, response utilities/handler, types, and release lookup in addition to those files. (`src/services/nativeHelper/`).
- `ureq` is described as Windows-only → it is a cross-platform Cargo dependency used for model downloads and API calls; only tray/updater modules are Windows-gated. (`tools/native-helper/Cargo.toml`, `tools/native-helper/src/main.rs`).
- The doc’s “planned future functionality” wording for the decode/encode protocol omits current state → `open`, `decode`, `prefetch`, `start_encode`, `encode_frame`, `finish_encode`, `cancel_encode`, and `close` are still sent by browser code but are absent from the Rust `Command` enum. (`src/services/nativeHelper/nativeHelperVideoCommands.ts`, `src/services/nativeHelper/NativeDecoder.ts`, `tools/native-helper/src/protocol/commands.rs`).

## Noteworthy / unusual

- The app explicitly disables `nativeDecodeEnabled` in the toolbar-status component, while timeline code still attempts `NativeDecoder.open()` when that setting is true and the helper is connected. Together with the absent Rust commands, this is dormant/dead client decode wiring rather than a shipped helper capability. (`src/components/common/NativeHelperStatus.tsx`, `src/stores/timeline/clip/addVideoClip.ts`, `src/services/nativeHelper/nativeHelperVideoCommands.ts`, `tools/native-helper/src/protocol/commands.rs`).
- The repository contains an old `tools/native-helper/MasterSelects-NativeHelper-v0.2.0-windows-x64.zip`, while source and app target version are `0.3.15`; release availability is determined at runtime through GitHub, not by that checked-in archive. (`tools/native-helper/MasterSelects-NativeHelper-v0.2.0-windows-x64.zip`, `tools/native-helper/Cargo.toml`, `src/services/nativeHelper/releases.ts`).
- The current docs index itself is stale: it identifies version `2.0.6`, whereas `package.json` and `src/version.ts` identify `2.4.4`. This audit did not modify it because it is outside the assigned file. (`docs/Features/README.md`, `package.json`, `src/version.ts`).
