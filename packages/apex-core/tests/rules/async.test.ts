import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import { futureMethodChaining } from '../../src/rules/async.js';

function v(src: string) { return new Linter([futureMethodChaining]).lint(src).violations; }

test('FutureMethodChaining: flags a bare same-class @future call', () => {
  const src = `public class C { @future static void a(){ b(); } @future static void b(){} }`;
  assert.equal(v(src).length, 1);
});

test('FutureMethodChaining: flags a class-qualified same-class @future call', () => {
  const src = `public class C { @future static void a(){ C.b(); } @future static void b(){} }`;
  assert.equal(v(src).length, 1);
});

test('FutureMethodChaining: does not flag an unrelated other-class call with a matching name', () => {
  const src = `public class C { @future static void a(){ Other.b(); } @future static void b(){} }`;
  assert.equal(v(src).length, 0);
});
