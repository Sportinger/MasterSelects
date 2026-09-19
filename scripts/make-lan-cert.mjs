#!/usr/bin/env node
// Issues the TLS leaf certificate that `npm run dev:lan` serves.
//
// The address is baked into the certificate, so every network change (Wi-Fi
// to hotspot, new DHCP lease) invalidates it and needs a reissue. Run this,
// then restart dev:lan - the device keeps trusting the unchanged root CA.
//
// Validity is pinned to 397 days because Apple rejects TLS certificates
// valid for more than 398 days with a FATAL error, which Safari reports as
// "the network connection was lost". mkcert's own default is ~823 days and
// therefore unusable on iOS/iPadOS, which is why this script signs the leaf
// with openssl instead of calling mkcert directly.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLE_MAX_VALIDITY_DAYS = 398;
const VALIDITY_DAYS = 397;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDirectory = path.join(repoRoot, '.certs');

function fail(message) {
  console.error(`[make-lan-cert] ${message}`);
  process.exit(1);
}

function detectPrivateIpv4() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal)
    .map(entry => entry.address)
    .find(address => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) ?? null;
}

function resolveHost() {
  const explicit = process.argv.slice(2).find(argument => !argument.startsWith('-'));
  const host = explicit ?? detectPrivateIpv4();
  if (!host) {
    fail('No private IPv4 address found. Pass one explicitly: npm run cert:lan -- 192.168.1.42');
  }
  return host;
}

function resolveMkcertCa() {
  const candidates = [
    process.env.CAROOT,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'mkcert') : null,
    process.env.HOME ? path.join(process.env.HOME, '.local', 'share', 'mkcert') : null,
    process.env.HOME ? path.join(process.env.HOME, 'Library', 'Application Support', 'mkcert') : null,
  ].filter(Boolean);

  for (const directory of candidates) {
    const cert = path.join(directory, 'rootCA.pem');
    const key = path.join(directory, 'rootCA-key.pem');
    if (fs.existsSync(cert) && fs.existsSync(key)) {
      return { cert, key };
    }
  }

  return fail('No mkcert root CA found. Install mkcert and run `mkcert -install` first.');
}

function openssl(args) {
  try {
    return execFileSync('openssl', args, { cwd: certDirectory, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (error) {
    return fail(`openssl failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}

const host = resolveHost();
const ca = resolveMkcertCa();
fs.mkdirSync(certDirectory, { recursive: true });

const extensionsPath = path.join(certDirectory, 'lan-ext.cnf');
fs.writeFileSync(extensionsPath, [
  'basicConstraints = CA:FALSE',
  'keyUsage = digitalSignature, keyEncipherment',
  'extendedKeyUsage = serverAuth',
  `subjectAltName = DNS:localhost, IP:${host}, IP:127.0.0.1, IP:0:0:0:0:0:0:0:1`,
  '',
].join('\n'), 'utf-8');

openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', 'lan-key.pem', '-out', 'lan.csr', '-subj', '/CN=MasterSelects LAN dev']);
openssl(['x509', '-req', '-in', 'lan.csr', '-CA', ca.cert, '-CAkey', ca.key,
  '-CAcreateserial', '-out', 'lan-cert.pem', '-days', String(VALIDITY_DAYS),
  '-sha256', '-extfile', 'lan-ext.cnf']);
fs.rmSync(path.join(certDirectory, 'lan.csr'), { force: true });

// The device fetches the root over plain HTTP to escape the trust bootstrap
// circle, so it has to live next to the leaf rather than only in CAROOT.
fs.copyFileSync(ca.cert, path.join(certDirectory, 'rootCA.pem'));

const verification = openssl(['verify', '-CAfile', 'rootCA.pem', 'lan-cert.pem']);
if (!verification.includes('OK')) {
  fail(`Chain verification failed: ${verification.trim()}`);
}

console.log(`[make-lan-cert] Issued for ${host}, valid ${VALIDITY_DAYS} days (Apple rejects > ${APPLE_MAX_VALIDITY_DAYS}).`);
console.log(`[make-lan-cert] Chain verified. Start with: npm run dev:lan -- --lan=${host}`);

if (process.platform === 'win32') {
  try {
    const category = execFileSync('powershell', ['-NoProfile', '-Command',
      '(Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory'],
    { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (category === 'Public') {
      console.log('[make-lan-cert] WARNING: this network is classified Public, so Windows blocks inbound');
      console.log('[make-lan-cert] connections regardless of the firewall rule. In an elevated shell run:');
      console.log('[make-lan-cert]   Set-NetConnectionProfile -InterfaceAlias "WLAN" -NetworkCategory Private');
    }
  } catch { /* diagnostic only */ }
}
