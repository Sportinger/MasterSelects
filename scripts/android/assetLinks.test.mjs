import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssetLinks, hasAssetLink, normalizeFingerprint } from './assetLinks.mjs';

test('matches the actual signing identity, not just the package name', () => {
  const expected = createAssetLinks('com.masterselects.app', ['ab'.repeat(32)]);
  assert.equal(hasAssetLink(expected, expected), true);
  assert.equal(hasAssetLink(createAssetLinks('com.masterselects.app.debug', ['ab'.repeat(32)]), expected), false);
  assert.equal(hasAssetLink(createAssetLinks('com.masterselects.app', ['cd'.repeat(32)]), expected), false);
  assert.equal(hasAssetLink([{ target: expected[0].target, relation: [] }], expected), false);
});
test('rejects malformed fingerprints and unintended packages', () => {
  assert.equal(normalizeFingerprint('ab'.repeat(32)), Array(32).fill('AB').join(':'));
  for (const value of ['', 'a'.repeat(63), 'zz'.repeat(32), '../../secret']) assert.throws(() => normalizeFingerprint(value));
  assert.throws(() => createAssetLinks('com.someone.else', ['ab'.repeat(32)]));
});
