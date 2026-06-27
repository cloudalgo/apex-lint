import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import type { Violation } from '../../src/engine/types.js';
import { testWithoutAsserts } from '../../src/rules/style.js';

function violations(source: string): Violation[] {
  return new Linter([testWithoutAsserts]).lint(source).violations;
}

test('TestWithoutAsserts: flags a test method with no assertions', () => {
  const src = `@IsTest class FooTest { @IsTest static void t() { Integer x = 1 + 1; } }`;
  const v = violations(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'TestWithoutAsserts');
});

test('TestWithoutAsserts: no flag with System.assertEquals', () => {
  const src = `@IsTest class FooTest { @IsTest static void t() { System.assertEquals(1, 1, 'ok'); } }`;
  assert.equal(violations(src).length, 0);
});

test('TestWithoutAsserts: no flag with the Spring \'22 Assert class', () => {
  const src = `@IsTest class FooTest { @IsTest static void t() { Assert.areEqual(1, 1); } }`;
  assert.equal(violations(src).length, 0);
});

// Regression: mock-framework verification counts as an assertion (fflib, apex-mockery).
test('TestWithoutAsserts: no flag when the test uses mocks.verify()', () => {
  const src = `@IsTest class FooTest {
    @IsTest static void t() {
      fflib_ApexMocks mocks = new fflib_ApexMocks();
      MyList m = (MyList) mocks.mock(MyList.class);
      ((MyList.IList) mocks.verify(m, mocks.times(2))).add('x');
    }
  }`;
  assert.equal(violations(src).length, 0);
});

test('TestWithoutAsserts: ignores non-test helper methods', () => {
  const src = `@IsTest class FooTest { static MyList buildList() { return new MyList(); } }`;
  assert.equal(violations(src).length, 0);
});
