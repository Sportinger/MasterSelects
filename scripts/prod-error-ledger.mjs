#!/usr/bin/env node
// The state of every production error group, so no agent has to find out again what was already
// handled. It joins three sources and changes nothing:
//   - production telemetry (D1 app_diagnostic_events, read-only, needs CLOUDFLARE_API_TOKEN),
//   - the shared status on the operations host (ssh fassandra.de, written with status-cli.mjs),
//   - git: is the commit of a "fixed" status part of a release, and did the error come back after it?
//
//   node scripts/prod-error-ledger.mjs            what needs attention
//   node scripts/prod-error-ledger.mjs --all      every group
//   node scripts/prod-error-ledger.mjs --json     machine-readable
//
// Run `git fetch origin` first: releases are read from origin/master.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STATUS_PATH = '/var/lib/masterselects-aws-control/status.json';
const OVERVIEW_PATH = '/var/lib/masterselects-aws-public/overview.json';
// Same matching as functions/lib/diagnosticTraffic.ts, which the dashboard uses.
const CRAWLER_SQL = `(lower(COALESCE(user_agent, '')) LIKE '%bot%' OR lower(COALESCE(user_agent, '')) LIKE '%spider%'
  OR lower(COALESCE(user_agent, '')) LIKE '%crawler%' OR lower(COALESCE(user_agent, '')) LIKE '%headlesschrome%'
  OR lower(COALESCE(user_agent, '')) LIKE '%meta-external%' OR lower(COALESCE(user_agent, '')) LIKE '%meta-webindexer%')`;

/** Note of a group closed only because it stopped happening: unlike browser noise, its return means work. */
export const WATCHED_NOTE_PREFIX = 'Not seen since';

/** Order of the report: what needs someone first. */
export const STATES = Object.freeze({
  RETURNED: 'came back',
  UNMARKED: 'no status yet',
  OPEN: 'open',
  UNRELEASED: 'fixed, not released',
  FIXED: 'fixed and released',
  IGNORED: 'ignored',
});
const ATTENTION = [STATES.RETURNED, STATES.UNMARKED, STATES.OPEN, STATES.UNRELEASED];

export function versionNumber(version) {
  const [major = 0, minor = 0, patch = 0] = String(version ?? '').split('.').map(part => Number(part) || 0);
  return major * 1e6 + minor * 1e3 + patch;
}

/**
 * The state of one group. `versions` holds its sessions per app version, without crawlers; `fix` is
 * where the status commit landed: null without a status commit, { version: null } when it is in no release.
 */
export function classifyGroup(status, versions, fix) {
  const kind = status?.status;
  if (!kind) return STATES.UNMARKED;
  if (kind === 'ignored') {
    const watched = status.note?.startsWith(WATCHED_NOTE_PREFIX) && versions.some(entry => entry.people > 0 && Date.parse(entry.last) > status.at);
    return watched ? STATES.RETURNED : STATES.IGNORED;
  }
  if (kind !== 'fixed') return STATES.OPEN;
  if (!fix?.version) return STATES.UNRELEASED;
  const after = versions.filter(entry => entry.people > 0 && versionNumber(entry.version) >= versionNumber(fix.version));
  return after.length > 0 ? STATES.RETURNED : STATES.FIXED;
}

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function readReleases() {
  const log = git('log', 'origin/master', '--format=%h', '-G', 'APP_VERSION = ', '--', 'src/version.ts') ?? '';
  return log.split('\n').filter(Boolean).map((commit) => {
    const version = /APP_VERSION = '([^']+)'/.exec(git('show', `${commit}:src/version.ts`) ?? '')?.[1] ?? null;
    return { commit, version };
  }).filter(release => release.version).reverse();
}

function locateFix(revision, releases, cache) {
  if (!revision) return null;
  if (cache.has(revision)) return cache.get(revision);
  const known = git('rev-parse', '--verify', `${revision}^{commit}`);
  const contains = commit => git('merge-base', '--is-ancestor', revision, commit) !== null;
  const release = known ? releases.find(entry => contains(entry.commit)) : undefined;
  const fix = { version: release?.version ?? null, known: Boolean(known) };
  cache.set(revision, fix);
  return fix;
}

function readRemoteJson(path) {
  return JSON.parse(execFileSync('ssh', ['fassandra.de', `cat ${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function databaseId() {
  const id = /database_name = "masterselects"\s*\ndatabase_id = "([0-9a-f-]+)"/.exec(readFileSync('wrangler.toml', 'utf8'))?.[1];
  if (!id) throw new Error('wrangler.toml names no masterselects database');
  return id;
}

async function queryTelemetry() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const accounts = await (await fetch('https://api.cloudflare.com/client/v4/accounts', { headers })).json();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accounts.result[0].id}/d1/database/${databaseId()}/query`;
  const query = async (sql) => {
    const body = await (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ sql }) })).json();
    if (!body.success) throw new Error(`D1 query failed: ${JSON.stringify(body.errors)}`);
    return body.result[0].results;
  };
  const [versions, messages] = await Promise.all([
    query(`SELECT fingerprint fp, app_version version, count(distinct session_id) sessions,
      count(distinct CASE WHEN ${CRAWLER_SQL} THEN session_id END) crawlers, max(occurred_at) last
      FROM app_diagnostic_events WHERE kind='client_runtime' AND fingerprint IS NOT NULL GROUP BY 1,2`),
    query(`SELECT fingerprint fp, substr(max(message),1,160) message FROM app_diagnostic_events
      WHERE kind='client_runtime' AND fingerprint IS NOT NULL GROUP BY 1`),
  ]);
  return { versions, messages: new Map(messages.map(row => [row.fp, row.message])) };
}

export function buildLedger({ versions, messages, statuses, loopStatuses, releases }) {
  const fixes = new Map();
  const groups = new Map();
  for (const row of versions) {
    const group = groups.get(row.fp) ?? { fingerprint: row.fp, versions: [] };
    group.versions.push({ version: row.version, people: row.sessions - row.crawlers, last: row.last });
    groups.set(row.fp, group);
  }
  return [...groups.values()].map((group) => {
    const status = statuses[`issue:${group.fingerprint}`] ?? loopStatuses[group.fingerprint] ?? null;
    const fix = locateFix(status?.revision, releases, fixes);
    const newest = group.versions.reduce((best, entry) => versionNumber(entry.version) > versionNumber(best.version) ? entry : best);
    return {
      fingerprint: group.fingerprint,
      state: classifyGroup(status, group.versions, fix),
      people: group.versions.reduce((sum, entry) => sum + entry.people, 0),
      lastSeen: group.versions.map(entry => entry.last).sort().at(-1),
      lastVersion: newest.version,
      revision: status?.revision ?? null,
      fixedIn: fix?.version ?? null,
      note: status?.note ?? null,
      message: (messages.get(group.fingerprint) ?? '').replace(/\s+/g, ' '),
    };
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const { versions, messages } = await queryTelemetry();
  const statuses = readRemoteJson(STATUS_PATH).items ?? {};
  const loopStatuses = readRemoteJson(OVERVIEW_PATH).issueStatus ?? {};
  const ledger = buildLedger({ versions, messages, statuses, loopStatuses, releases: readReleases() });
  if (args.has('--json')) {
    console.log(JSON.stringify(ledger, null, 2));
    return;
  }
  const count = state => ledger.filter(group => group.state === state).length;
  console.log(`${ledger.length} error groups. ${Object.values(STATES).map(state => `${state}: ${count(state)}`).join(' | ')}`);
  for (const state of args.has('--all') ? Object.values(STATES) : ATTENTION) {
    const rows = ledger.filter(group => group.state === state).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.people - a.people);
    if (rows.length === 0) continue;
    console.log(`\n== ${state} (${rows.length})`);
    for (const row of rows) {
      const fix = row.revision ? ` ${row.revision.slice(0, 9)}${row.fixedIn ? ` in ${row.fixedIn}` : ''}` : '';
      console.log(`${row.fingerprint.slice(0, 12)} | ${row.people} people | ${row.lastSeen.slice(0, 10)} on ${row.lastVersion}${fix} | ${row.message.slice(0, 110)}`);
    }
  }
  console.log('\nMark a group: ssh fassandra.de node /home/admin/masterselects-social/current/repair/status-cli.mjs set <fingerprint> fixed|ignored --by <agent> [--revision <commit>] --note "<tests and platforms>"');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
