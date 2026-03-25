#!/usr/bin/env node
/**
 * Visit Notifier — Polls Cloudflare for new page visits and plays an audio notification.
 *
 * Usage:
 *   node scripts/visit-notifier.mjs
 *
 * Environment variables (or .env in project root):
 *   SITE_URL            — Your deployed site URL (default: https://masterselects.pages.dev)
 *   VISITOR_NOTIFY_SECRET — The secret matching your Cloudflare env
 *   POLL_INTERVAL_MS    — Polling interval in ms (default: 5000)
 *   BEEP_FREQUENCY      — Beep frequency in Hz (default: 800)
 *   BEEP_DURATION       — Beep duration in ms (default: 400)
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Load .env if present ──────────────────────────────────────────
function loadEnv() {
  try {
    const envPath = resolve(ROOT, '.dev.vars');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .dev.vars not found — rely on process.env
  }
}

loadEnv();

// ── Config ────────────────────────────────────────────────────────
const SITE_URL = (process.env.SITE_URL || 'https://masterselects.pages.dev').replace(/\/$/, '');
const SECRET = process.env.VISITOR_NOTIFY_SECRET;
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const BEEP_FREQ = parseInt(process.env.BEEP_FREQUENCY || '800', 10);
const BEEP_DUR = parseInt(process.env.BEEP_DURATION || '400', 10);

if (!SECRET) {
  console.error('ERROR: VISITOR_NOTIFY_SECRET is not set.');
  console.error('Set it in .dev.vars or as an environment variable.');
  process.exit(1);
}

// ── Audio notification ────────────────────────────────────────────
function playBeep() {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "[console]::beep(${BEEP_FREQ},${BEEP_DUR})"`,
        { stdio: 'ignore' },
      );
    } else if (process.platform === 'darwin') {
      execSync('afplay /System/Library/Sounds/Glass.aiff', { stdio: 'ignore' });
    } else {
      // Linux: try paplay, then beep, then printf BEL
      try {
        execSync('paplay /usr/share/sounds/freedesktop/stereo/message-new-instant.oga', { stdio: 'ignore' });
      } catch {
        try {
          execSync(`beep -f ${BEEP_FREQ} -l ${BEEP_DUR}`, { stdio: 'ignore' });
        } catch {
          process.stdout.write('\x07'); // terminal bell
        }
      }
    }
  } catch {
    process.stdout.write('\x07'); // fallback: terminal bell
  }
}

// ── State ─────────────────────────────────────────────────────────
let lastSeenTs = Date.now();
let totalVisits = 0;

// ── Formatting ────────────────────────────────────────────────────
function formatVisit(v) {
  const time = new Date(v.ts).toLocaleTimeString('de-DE');
  const location = [v.city, v.country].filter(Boolean).join(', ') || 'unknown';
  return `  ${time}  ${v.path.padEnd(30)}  ${location}`;
}

// ── Polling ───────────────────────────────────────────────────────
async function poll() {
  try {
    const url = `${SITE_URL}/api/visits?secret=${encodeURIComponent(SECRET)}&since=${lastSeenTs}&limit=50`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MasterSelects-VisitNotifier/1.0' },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[${new Date().toLocaleTimeString()}] API error ${res.status}: ${text.slice(0, 200)}`);
      return;
    }

    const data = await res.json();

    if (data.visits && data.visits.length > 0) {
      // Sort oldest first for display
      const sorted = [...data.visits].sort((a, b) => a.ts - b.ts);

      for (const visit of sorted) {
        totalVisits++;
        console.log(`\n>>> NEW VISITOR (#${totalVisits}) <<<`);
        console.log(formatVisit(visit));
        playBeep();
      }

      // Update watermark to newest visit
      const newest = Math.max(...data.visits.map((v) => v.ts));
      lastSeenTs = newest;
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Poll error: ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────
console.log('===========================================');
console.log('   MasterSelects Visit Notifier');
console.log('===========================================');
console.log(`Site:     ${SITE_URL}`);
console.log(`Polling:  every ${POLL_MS / 1000}s`);
console.log(`Audio:    ${BEEP_FREQ}Hz, ${BEEP_DUR}ms`);
console.log('-------------------------------------------');
console.log('Waiting for visitors...\n');

// Initial beep to confirm audio works
playBeep();

// Poll loop
setInterval(poll, POLL_MS);
// Also poll immediately
poll();
