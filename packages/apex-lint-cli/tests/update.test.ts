import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { semverGt, readUpdateCache } from '../src/update.js';

const TMP = join(tmpdir(), 'test-apex-lint-update');

// semverGt tests
test('semverGt: major bump is greater', () => {
  assert.ok(semverGt('2.0.0', '1.9.9'));
});
test('semverGt: minor bump is greater', () => {
  assert.ok(semverGt('1.1.0', '1.0.99'));
});
test('semverGt: patch bump is greater', () => {
  assert.ok(semverGt('1.0.1', '1.0.0'));
});
test('semverGt: equal versions returns false', () => {
  assert.ok(!semverGt('1.0.0', '1.0.0'));
});
test('semverGt: older version returns false', () => {
  assert.ok(!semverGt('0.9.0', '1.0.0'));
});
test('semverGt: handles prerelease/build tags (no NaN)', () => {
  assert.ok(semverGt('1.2.0', '1.1.0-beta'));      // release > older prerelease
  assert.ok(semverGt('2.0.0-rc.1', '1.9.9'));        // newer prerelease > old release
  assert.ok(!semverGt('1.0.0-beta', '1.0.0-beta'));  // equal prerelease
  assert.ok(!semverGt('1.0.0+build.5', '1.0.1'));    // build metadata ignored
});

// readUpdateCache tests
test('readUpdateCache: returns null for missing file', () => {
  assert.strictEqual(readUpdateCache(TMP + '-nonexistent'), null);
});
test('readUpdateCache: returns null for malformed JSON', () => {
  const p = TMP + '-bad.json';
  writeFileSync(p, 'not-json', 'utf8');
  assert.strictEqual(readUpdateCache(p), null);
  unlinkSync(p);
});
test('readUpdateCache: returns null for wrong shape', () => {
  const p = TMP + '-shape.json';
  writeFileSync(p, JSON.stringify({ foo: 'bar' }), 'utf8');
  assert.strictEqual(readUpdateCache(p), null);
  unlinkSync(p);
});
test('readUpdateCache: returns parsed object for valid cache', () => {
  const p = TMP + '-valid.json';
  const expected = { latest: '0.2.0', checkedAt: 1719446400000 };
  writeFileSync(p, JSON.stringify(expected), 'utf8');
  assert.deepStrictEqual(readUpdateCache(p), expected);
  unlinkSync(p);
});
