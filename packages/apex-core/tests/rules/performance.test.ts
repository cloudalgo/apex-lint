import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import type { Violation } from '../../src/engine/types.js';
import { avoidNonRestrictiveQueries } from '../../src/rules/performance.js';

function violations(source: string): Violation[] {
  return new Linter([avoidNonRestrictiveQueries]).lint(source).violations;
}

const wrap = (q: string) => `public class Foo { void run() { List<SObject> r = ${q}; } }`;

test('AvoidNonRestrictiveQueries: flags a query with no WHERE/LIMIT', () => {
  const v = violations(wrap('[SELECT Id FROM Account]'));
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'AvoidNonRestrictiveQueries');
});

test('AvoidNonRestrictiveQueries: no flag with a WHERE clause', () => {
  assert.equal(violations(wrap("[SELECT Id FROM Account WHERE Name = 'x']")).length, 0);
});

test('AvoidNonRestrictiveQueries: no flag with a LIMIT clause', () => {
  assert.equal(violations(wrap('[SELECT Id FROM Account LIMIT 5]')).length, 0);
});

// Regression: substring matching on the query text used to suppress these because
// the field name contains "where"/"limit" — they are genuinely unrestricted.
test('AvoidNonRestrictiveQueries: flags unrestricted query selecting a field named like a keyword', () => {
  assert.equal(violations(wrap('[SELECT Limit_Reached__c FROM Account]')).length, 1);
  assert.equal(violations(wrap('[SELECT Whereabouts__c FROM Contact]')).length, 1);
});
