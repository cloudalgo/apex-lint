import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import { unguardedCrudOperation } from '../../src/rules/crud.js';
import type { MetadataProvider } from '../../src/metadata/provider.js';

// Stub provider that knows Account/Contact, so the type-aware rule fires.
const meta: MetadataProvider = {
  hasObject: (n) => ['account', 'contact'].includes(n.toLowerCase()),
  getObject: () => undefined,
  objectNames: () => ['Account', 'Contact'],
};
const v = (src: string) =>
  new Linter([unguardedCrudOperation]).lint({ source: src, filePath: 'X.cls', metadata: meta }).violations;

test('UnguardedCrudOperation: flags unguarded DML on a LOCAL-variable sObject', () => {
  const src = `public class C {
    public void run() {
      List<Account> accs = [SELECT Id FROM Account];
      insert accs;
    }
  }`;
  assert.equal(v(src).length, 1);
  assert.equal(v(src)[0].ruleId, 'UnguardedCrudOperation');
});

test('UnguardedCrudOperation: no flag when the local-variable DML is guarded for that object', () => {
  const src = `public class C {
    public void run() {
      List<Account> accs = [SELECT Id FROM Account];
      if (Schema.sObjectType.Account.isCreateable()) { insert accs; }
    }
  }`;
  assert.equal(v(src).length, 0);
});
