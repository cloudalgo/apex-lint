import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';

function tmpConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'apexlint-cfg-'));
  const p = join(dir, 'apexlint.config.json');
  writeFileSync(p, contents);
  return p;
}

test('loadConfig: rejects a non-array "rules" field', () => {
  const p = tmpConfig('{"rules":"SoqlInLoop"}');
  assert.throws(() => loadConfig(process.cwd(), p), /"rules" must be an array of strings/);
});

test('loadConfig: rejects an invalid "failOn" value', () => {
  const p = tmpConfig('{"failOn":"bogus"}');
  assert.throws(() => loadConfig(process.cwd(), p), /"failOn" must be one of/);
});

test('loadConfig: rejects a non-number "maxViolationsPerFile"', () => {
  const p = tmpConfig('{"maxViolationsPerFile":"10"}');
  assert.throws(() => loadConfig(process.cwd(), p), /"maxViolationsPerFile" must be a number/);
});

test('loadConfig: accepts a valid config', () => {
  const p = tmpConfig('{"rules":["SoqlInLoop"],"failOn":"high","maxViolationsPerFile":5}');
  const { config } = loadConfig(process.cwd(), p);
  assert.deepEqual(config.rules, ['SoqlInLoop']);
  assert.equal(config.failOn, 'high');
});

test('loadConfig: returns defaults when no config is found in cwd or ancestors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apexlint-empty-'));
  const { config, path } = loadConfig(dir);
  assert.equal(path, undefined);
  assert.deepEqual(config.disabledRules, []);
});
