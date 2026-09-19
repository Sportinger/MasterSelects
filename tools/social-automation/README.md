# MasterSelects Social Automation

This tool is the deterministic boundary between a content agent and public
social accounts. The agent can inspect strategy, identify missing founder
inputs, create one structured post package, validate platform variants, and
prepare a dispatch manifest. It cannot silently publish.

This is a maintainer tool. Its `content/social/` configuration, metrics, and
drafts are kept in the private development repository and are not included in
public editor snapshots.

## Commands

```bash
npm run social:status
npm run social:brief:remote
npm run social:new -- browser-proof-02 --campaign first-export-90d
npm run social:validate -- content/social/posts/2026-08-28-browser-proof-01.json
npm run social:preview -- content/social/posts/2026-08-28-browser-proof-01.json
npm run social:dispatch -- content/social/posts/2026-08-28-browser-proof-01.json --dry-run
```

`social:status` is the daily control surface. It reports account/OAuth blockers
by environment-variable name only and then lists the exact assets, facts, or
decisions Roman needs to provide for the next post.

`social:brief:remote` reads the persistent Social Center state through the
token-protected Admin API. Set `MS_SOCIAL_AGENT_TOKEN` in the agent runtime;
optionally set `MS_SOCIAL_CENTER_URL` for a non-production environment. The
response contains secret readiness flags, never credential values.

Post lifecycle:

```text
idea -> needs-input -> draft -> review -> approved -> scheduled -> published
```

Only `approved` and `scheduled` packages can produce a dispatch manifest.
Required assets must exist, founder-input requests must be cleared, and every
MasterSelects URL must carry matching source, campaign, and post attribution.

## Secret boundary

Never add access tokens, refresh tokens, client secrets, app passwords, or
platform cookies to this repository. The configuration contains only the
environment-variable names expected by future publisher adapters. Production
tokens belong in Cloudflare secrets. The future publisher receives an approved
immutable package, uploads its media, records the platform post ID, and retries
idempotently; it does not generate or rewrite public copy.

## Agent operating rule

The content agent may create and refine drafts, but it must preserve these
boundaries:

- Use one user problem, one proof, and one call to action per post.
- Write a native variant for each platform instead of copying one caption.
- Never automate replies, DMs, Reddit participation, or Discord conversation.
- Never invent usage numbers, testimonials, benchmark results, or competitor
  claims.
- Never publish footage without an explicit ownership/permission confirmation.
- Describe the editor as AGPL-3.0-only. The separately maintained private
  kernel and hosted services are not included in the public editor license.

Maintainers keep the rollout and platform constraints in the private
`docs/ongoing/Social-Content-Automation.md` plan.
