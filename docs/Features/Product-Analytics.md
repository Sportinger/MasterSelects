# Product Analytics

MasterSelects has a first-party product-analytics pipeline for understanding whether users reach meaningful editor outcomes. It records a fixed catalog of semantic product actions, sends them to a same-origin Cloudflare Pages Function, stores them in the existing D1 database, and exposes privacy-reduced aggregate funnels and feature engagement in Fassandra's private Stats view.

The system is deliberately separate from runtime debugging telemetry. Product analytics answers questions such as "did an import finish?" or "did an export succeed?"; playback traces, filenames, project data, media, prompts, and diagnostic logs are not product-analytics properties.

## Privacy contract

- Collection can be disabled under **Settings > General > Privacy > Share product usage**.
- Browser `Do Not Track` and Global Privacy Control signals disable collection.
- The analytics session identifier exists only in memory. The system creates no analytics cookie and does not persist a cross-browser device identifier.
- Signed-in events may be linked to the internal account ID. Anonymous events contain only the ephemeral session identifier.
- Every event and property is defined in a compile-time allowlist. Unknown events and properties are dropped again on the server.
- Filenames, paths, project names, timeline content, media bytes, prompts, chat text, transcript text, provider errors, and raw exception messages are never accepted.
- Durations, resolutions, frame rates, sizes, and error causes are reduced to bounded categories.
- Product events are retained for 180 days. An hourly guarded cleanup deletes older rows.

The user-facing disclosure lives in the privacy pages. The preference itself is stored locally as `ms.productAnalytics.enabled`.

## Operational diagnostics

Operational diagnostics are the error-tracking channel. Unlike product
analytics they are not opt-out and they carry the actual failure content,
because their purpose is debugging real sessions. AI-generation lifecycle
events additionally reference a provider task ID, but the Pages Function accepts
them only when that task belongs to the signed-in account.

Capture starts in `src/bootDiagnostics.ts`, the first import of `main.tsx`, so
the console patch, the window listeners, and the server reporter are active
before any other module evaluates. Sources:

- uncaught exceptions (`window_error`), unhandled promise rejections
  (`unhandledrejection`), `console.error` calls (`console_error`), and
  error-level Logger entries (`logger_error`, module as component; errors
  logged before the reporter existed are replayed once at install);
- React 19 root hooks (`react_render`, `react_caught`, `react_recoverable`)
  including the component stack;
- failed script/stylesheet loads (`resource_error`) and chunk-load reloads
  (`chunk_load`);
- WebGPU uncaptured errors and device loss (`webgpu_uncapturederror`,
  `webgpu_device_lost`);
- AI-generation lifecycle: provider processing/result, download, import.

Every runtime event carries message, error name, stack, `filename:line:column`,
a cross-build fingerprint (normalized message plus top frame, with chunk hashes,
line numbers, URLs, and IDs removed), a repeat count, page path, session ID
(`sessionStorage`), device ID (`localStorage`), app version,
browser/platform/device class, a context object (user agent, viewport, screen,
CPU and RAM hints, JS heap, connection, online/visibility, uptime, WebGPU
adapter, storage estimate) and the last 30 console/log breadcrumbs. Failure
codes are derived from the error name and stage (`javascript_error`,
`unhandled_rejection`, `chunk_load_failed`, `react_render_error`,
`network_unavailable`, `out_of_memory`, `storage_quota`, ...) instead of
free-text heuristics. Secrets are redacted by the Logger and the runtime buffer
before anything is queued.

Rate limiting keeps floods out: three events per fingerprint per minute and
150 events per ten minutes per tab. Suppressed repeats are counted and attached
to the next event of that fingerprint as `repeatCount`. Batches are capped at
20 events and 400 KB, or 56 KB when sent with `keepalive` on page hide.

`POST /api/analytics/diagnostics` accepts at most 20 events and 512 KB per
request, enforces same-origin delivery, validates stage/code tokens and
identifiers, truncates oversized text instead of dropping the event, attaches
the request user agent and country server-side, and stores rows for 90 days.
Migrations `0025_app_diagnostics.sql`, `0026_app_diagnostic_components.sql`,
and `0027_app_diagnostic_details.sql` create the table, the component
dimension, and the detail columns (`message`, `error_name`, `stack`,
`fingerprint`, `repeat_count`, `page_path`, `session_id`, `device_id`,
`user_agent`, `country`, `context_json`). Apply `0027` before deploying the
Pages Functions that write these columns.

Fassandra's Stats view shows the aggregates (sources, codes, components,
platforms, browsers, builds, pages, 14-day trend), the top fingerprints of the
last seven days with occurrences, sessions, and users, and the 30 most recent
events with stack, context, and breadcrumbs.

The top list selects up to 50 fingerprints by affected sessions, then occurrences. The private dashboard can sort by sessions, occurrences, or a labeled heuristic priority (saving, startup/export, editor functions, telemetry); repeat storms are not equivalent to many affected users.

Recognizable automated user agents (bots, crawlers, headless Chrome and Meta
crawlers) are excluded from runtime error totals, trends, top errors, recent
errors and diagnostic build-error comparison. Their reports remain in D1;
`excludedAutomatedEvents7d` and `excludedAutomatedSessions7d` report the excluded
volume separately. Matching uses the server-observed user agent. Unrecognized
or missing agents are retained, so the remainder is not a verified human count.
Historical product-analytics events do not retain user agents and are not
retroactively filtered. Product-analytics and diagnostic session IDs are
independent; their counts must not be divided to estimate a failure rate.

Production builds embed an ISO timestamp build ID, sent with `app_opened` and runtime diagnostic context (including reduced payloads). Development builds use `development` and are excluded from release comparison. The comparison observes the latest two timestamp builds within 30 days, including builds with app opens but no errors; it shows distinct error sessions and occurrences per fingerprint. Different usage and observation periods mean a decrease or absence does not prove a fix. Legacy events without a timestamp build remain explicitly unassigned.

Export outcome aggregation joins starts and terminal events by analytics session and `run_id` over seven days, deduplicates repeated events, and uses the latest terminal outcome. Completed, cancelled, failed, and missing-outcome runs are separate; a missing outcome can mean an in-progress export or missing telemetry. Events without a run ID are counted separately and excluded from run-based success. The older completion/start event ratio remains an event ratio, not a measured failure rate.

The `/api/logs` sync of the Logger buffer exists only in the Vite dev server.
Production builds no longer send it.

## Event catalog

The allowlist in `src/services/productAnalytics/catalog.ts` currently covers:

| Area | Events |
|---|---|
| Entry | landing viewed, app opened |
| Privacy | analytics preference enabled |
| Setup | setup started, background selected, completed, cancelled |
| Tutorial | started, step viewed, completed, skipped, cancelled |
| Projects | created, opened, closed, action failed |
| Media | import started, completed, failed, cancelled |
| Editing | semantic edit committed, control committed, properties surface viewed, undo, redo, history restore |
| Playback | started, paused/stopped/ended |
| Workspace | panel opened |
| Billing | pricing viewed, checkout started, redirected, failed, returned |
| Export | started, completed, failed, cancelled |

Committed timeline edits carry fixed `action`, `operation`, `origin`, and `target` dimensions. This distinguishes, for example, a user moving a clip from an agent trimming a clip, without retaining the free-form history label.

Control events describe a completed interaction through allowlisted identifiers only: editor area, control ID, control kind, input method, interaction, and optional effect/property type. Effects and audio effects record their registry type and parameter ID; transform, color, volume, and speed controls record stable property IDs. Parameter values, clip/effect instance IDs, labels, and project content are not collected.

App-open events can also carry bounded acquisition identifiers from social
links: an allowlisted source and medium plus identifier-only campaign and post
slugs. Free-form referrers, search terms, and URL contents are not collected.
Social links use `utm_source`, `utm_medium`, `utm_campaign`, and `utm_content`;
unsupported or content-bearing values are dropped before queueing and
re-sanitized by the server.

Properties-tab views provide the exposure side of the feature funnel, allowing aggregate comparisons between users who opened a surface and users who completed an interaction there. Slider and drag gestures emit once when committed, not once per pointer movement. The history facade similarly reports one semantic edit for a committed batch.

## Client delivery

`ProductAnalyticsService` owns one ephemeral session, sanitizes properties before queueing, and batches up to 20 events. It flushes after four seconds, at the batch limit, and on `pagehide` or hidden-page transitions using Fetch `keepalive`. Failed network and server requests are retried twice from a bounded 100-event in-memory queue.

The service is retained across Vite HMR updates. Turning analytics off clears queued events immediately and removes the pending flush timer.

## Cloudflare and D1

Migration `0020_product_analytics.sql` creates `product_analytics_events` in the existing `masterselects` D1 database. Important fields are:

- event ID for idempotent `INSERT OR IGNORE` delivery;
- authenticated user ID when available;
- ephemeral session ID;
- allowlisted event name and schema version;
- app version;
- sanitized JSON properties;
- client occurrence and server receipt timestamps.

`POST /api/analytics/events` accepts at most 25 events and 48 KB per request. It enforces same-origin requests, validates identifiers and timestamp skew, re-sanitizes every property, attaches the authenticated account server-side, and returns `202` with accepted/discarded counts.

Apply the migration before deploying Pages Functions that write or query the table:

```bash
npm run cf:migrate:remote
npm run build
npx wrangler pages deploy dist --project-name=masterselects --branch=main
```

## Fassandra Stats

The private Fassandra console receives a reduced aggregate projection containing:

- active identities, sessions, signed-in users, and events per session;
- returning identities over 30 days;
- a sequential 30-day activation funnel from app open through import, edit, export start, and export completion;
- export success rate and tutorial completions;
- 14-day daily-active chart;
- semantic edit actions and categories;
- used effects/items and semantic edit actions;
- opened panels and export kinds;
- top event totals;
- attributed app opens grouped by social source.

Signed-in activity is attributed through the server-side account ID. Anonymous users remain pseudonymous and can only be followed inside their ephemeral in-memory session. No fingerprint or durable anonymous identifier is created. Customer records, recent session details, and per-event identities are excluded from the Fassandra boundary. If the migration is missing, the Stats view reports analytics as unavailable.

## Verification

Targeted coverage is in `tests/unit/productAnalytics.test.ts`, `tests/unit/productAnalyticsAdmin.test.ts`, `tests/unit/appDiagnostics.test.ts`, `tests/unit/historyAnalytics.test.ts`, `tests/unit/ParamSlider.test.tsx`, and `tests/unit/EditableDraggableNumber.test.tsx`. It verifies property minimization, semantic edit classification, control metadata, authenticated attribution, server-side re-sanitization, foreign-origin rejection, diagnostic task ownership, runtime failure detail storage and truncation, fingerprint stability, failure classification, platform detection, one-event-per-gesture history boundaries, and numeric-control commit semantics. A local end-to-end check should additionally POST through the Vite proxy and read the resulting D1 row to prove that content-bearing fields were removed.

Report-only CSP observations remain stored for security review but are excluded from runtime failure totals, breakdowns, trends, recent errors and build comparisons. The filter also recognizes historical records through their stored disposition. Enforced CSP violations remain included; an absent disposition is not assumed to prove blocking.


### Unavailable preference storage

If browser storage cannot be read, analytics stays disabled rather than throwing
from tracking or pagehide flushing. A choice that cannot be written remains in
memory for the current page, including development HMR, and still notifies
subscribers so opting out clears the queued events. GPC/Do Not Track continue
to override an enabled preference. A successful later write returns reads to
persistent storage. A failed write cannot guarantee persistence across a reload.
