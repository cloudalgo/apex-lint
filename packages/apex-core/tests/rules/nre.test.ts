import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import type { Violation } from '../../src/engine/types.js';
import { mapGetWithoutNullCheck } from '../../src/rules/nre.js';

function violations(source: string): Violation[] {
  return new Linter([mapGetWithoutNullCheck]).lint(source).violations;
}

// ─── MapGetWithoutNullCheck ───────────────────────────────────────────────────

test('MapGetWithoutNullCheck: flags inline .get().field dereference', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id i) {
    String name = m.get(i).Name;
  }
}`;
  assert.equal(violations(src).length, 1);
  assert.equal(violations(src)[0].ruleId, 'MapGetWithoutNullCheck');
  assert.equal(violations(src)[0].line, 4);
});

test('MapGetWithoutNullCheck: flags inline .get().method() dereference', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id i) {
    m.get(i).doSomething();
  }
}`;
  assert.equal(violations(src).length, 1);
});

test('MapGetWithoutNullCheck: no flag when result stored and null-checked', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id i) {
    Account a = m.get(i);
    if (a != null) { String name = a.Name; }
  }
}`;
  assert.equal(violations(src).length, 0);
});

test('MapGetWithoutNullCheck: no flag when safe navigation used', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id i) {
    String name = m.get(i)?.Name;
  }
}`;
  assert.equal(violations(src).length, 0);
});

test('MapGetWithoutNullCheck: no flag for non-get methods', () => {
  const src = `
public class Foo {
  public void run() {
    String name = SomeService.getInstance().getName();
  }
}`;
  assert.equal(violations(src).length, 0);
});

test('MapGetWithoutNullCheck: skips @IsTest classes', () => {
  const src = `
@IsTest
public class FooTest {
  static testMethod void run() {
    Map<Id, Account> m = new Map<Id, Account>();
    String name = m.get(null).Name;
  }
}`;
  assert.equal(violations(src).length, 0);
});
