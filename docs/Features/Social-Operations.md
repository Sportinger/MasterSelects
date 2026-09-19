[Back to Documentation Index](./README.md)

# Social Operations

MasterSelects has a private Social Operations console hosted on Fassandra. It combines three internal workflows in one navigation surface:

- **Stats** shows aggregate product and infrastructure health from the MasterSelects admin backend.
- **Accounts** manages the connected publishing channels and their OAuth state.
- **Planning** presents the content queue, open inputs, and scheduled publishing work.

The console lives in the separate private `masterselects-social` repository and is the only operations UI. The former `masterselects.com/admin` page has been removed. The editor repository exposes only the narrow statistics boundary needed by Fassandra.

## Statistics boundary

`GET /api/admin/stats-brief` returns a deliberately reduced view of the internal operations aggregates. Fassandra authorizes with the shared `MS_SOCIAL_AGENT_TOKEN`; the API also accepts an existing signed admin session for compatibility. The `/api/admin/` prefix remains because Fassandra depends on this server-to-server endpoint, not because an admin page still exists.

The response contains aggregate counts and operational summaries such as registered users, paying customers, conversion, open credit links, recent activity, billing totals, and Cloudflare status. It excludes customer email addresses, credit-claim links, per-session analytics, deployment URLs, commit messages, and hashes.

The browser never receives the shared token. It calls Fassandra's same-origin `/social/api/stats` route, and the Fassandra server performs the authenticated server-to-server request to MasterSelects.

```text
Fassandra browser
  -> /social/api/stats
  -> Fassandra server + MS_SOCIAL_AGENT_TOKEN
  -> masterselects.com/api/admin/stats-brief
```

## Cloudflare live analytics

The aggregate brief combines three Cloudflare read surfaces without exposing the API token to Fassandra:

- the Pages project API supplies project metadata, deployments, the Web Analytics site tag, and the production Functions script name;
- account-level GraphQL Web Analytics supplies seven-day page views, visits, daily activity, paths, countries, device classes, browsers, and referrers;
- account-level Pages Functions analytics supplies requests, errors, response volume, daily activity, and invocation status groups.

The Web Analytics tag and Functions script are discovered from the Pages project, so a zone ID is not required for the MasterSelects deployment. If `CLOUDFLARE_ZONE_ID` is deliberately configured, zone traffic remains the preferred source and Web Analytics is the fallback. Individual visitor identifiers, IP addresses, raw request records, and customer records never cross the Social Operations boundary.

## Configuration

Both deployments must hold the same `MS_SOCIAL_AGENT_TOKEN` value:

- MasterSelects Cloudflare Pages: encrypted production secret.
- Fassandra: `/etc/masterselects-social.env`, loaded by the systemd service.

The MasterSelects `.dev.vars.example` documents the local variable name without containing a real credential. Token comparison uses the existing constant-time social-agent authorization helper.

MasterSelects Pages additionally stores `CLOUDFLARE_API_TOKEN` as an encrypted production secret. The dedicated read token is restricted to the MasterSelects account and needs only Account Analytics Read, Cloudflare Pages Read, and D1 Read.

## Main source locations

| Area | Location |
|---|---|
| Aggregate response projection | `functions/lib/socialStatsBrief.ts` |
| Cloudflare project and analytics aggregation | `functions/lib/cloudflareAdmin.ts` |
| Authenticated Pages endpoint | `functions/api/admin/stats-brief.ts` |
| Analytics aggregation regression test | `tests/unit/cloudflareAdminAnalytics.test.ts` |
| Projection regression test | `tests/unit/socialStatsBrief.test.ts` |
| Fassandra UI and proxy | Private sibling repository `../masterselects-social` |

## Verification

- Run `npx vitest run tests/unit/cloudflareAdminAnalytics.test.ts tests/unit/cloudflareAdminRecentVisits.test.ts tests/unit/socialStatsBrief.test.ts` for the Cloudflare aggregation and response boundary.
- Run `npm run build` before committing MasterSelects changes.
- In `masterselects-social`, run `npm run check`, its targeted OAuth/operations tests, and `npm run build:fassandra` before deployment.
- On the live page, verify all three tabs, confirm Stats loads real aggregates, and confirm the browser console has no errors or horizontal overflow.
