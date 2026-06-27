import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import type { Violation } from '../../src/engine/types.js';
import { avoidHardcodedId } from '../../src/rules/hardcoded.js';

function violations(source: string): Violation[] {
  return new Linter([avoidHardcodedId]).lint(source).violations;
}

test('AvoidHardcodedId: flags a valid 18-char ID (checksum valid)', () => {
  const src = `public class Foo { void run() { Id a = '001D000000IqhSLIAZ'; } }`;
  const v = violations(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'AvoidHardcodedId');
});

test('AvoidHardcodedId: flags a 15-char ID (zero-padding signature)', () => {
  const src = `public class Foo { void run() { Id a = '001D000000IqhSL'; } }`;
  assert.equal(violations(src).length, 1);
});

test('AvoidHardcodedId: no flag on a random 15-char token (no zero run)', () => {
  const src = `public class Foo { void run() { String t = 'a1b2c3d4e5f6g7h'; } }`;
  assert.equal(violations(src).length, 0);
});

test('AvoidHardcodedId: no flag on an 18-char base64-ish token (checksum invalid)', () => {
  const src = `public class Foo { void run() { String t = 'YWJjZGVmZ2hpajEyMw'; } }`;
  assert.equal(violations(src).length, 0);
});

test('AvoidHardcodedId: no flag inside a test class', () => {
  const src = `@IsTest class FooTest { @IsTest static void t() { Id a = '001D000000IqhSLIAZ'; } }`;
  assert.equal(violations(src).length, 0);
});
