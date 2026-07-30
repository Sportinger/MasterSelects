#!/usr/bin/env node
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const password = process.argv[2] ?? '';

if (password.length < 14) {
  console.error('Use a password with at least 14 characters.');
  process.exitCode = 1;
} else {
  // Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 rounds.
  const iterations = 100_000;
  const salt = randomBytes(24);
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const encode = (value) => value.toString('base64url');
  console.log(`pbkdf2-sha256$${iterations}$${encode(salt)}$${encode(hash)}`);
}
