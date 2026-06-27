import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import type { Violation } from '../../src/engine/types.js';
import { mapGetWithoutNullCheck, soqlResultIndexWithoutCheck, triggerContextNullAccess, chainedRelationshipAccess, soqlResultNotNullChecked, mapGetResultNotNullChecked } from '../../src/rules/nre.js';

function violations(source: string): Violation[] {
  return new Linter([mapGetWithoutNullCheck]).lint(source).violations;
}

// ─── MapGetWithoutNullCheck ───────────────────────────────────────────────────

// Uses a key-named arg (accId): a bare loop-counter arg like get(i) is treated as
// List index access (List.get(index) never returns null) — see the List.get tests.
test('MapGetWithoutNullCheck: flags inline .get().field dereference', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id accId) {
    String name = m.get(accId).Name;
  }
}`;
  assert.equal(violations(src).length, 1);
  assert.equal(violations(src)[0].ruleId, 'MapGetWithoutNullCheck');
  assert.equal(violations(src)[0].line, 4);
});

test('MapGetWithoutNullCheck: flags inline .get().method() dereference', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id accId) {
    m.get(accId).doSomething();
  }
}`;
  assert.equal(violations(src).length, 1);
});

test('MapGetWithoutNullCheck: no flag for List.get(index).field (literal or loop counter)', () => {
  const src = `
public class Foo {
  public void run(List<Account> l, Integer i) {
    String a = l.get(0).Name;
    String b = l.get(i).Name;
  }
}`;
  assert.equal(violations(src).length, 0);
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

// ─── SoqlResultIndexWithoutCheck ─────────────────────────────────────────────

test('SoqlResultIndexWithoutCheck: flags [SOQL][0]', () => {
  const src = `
public class Foo {
  public void run() {
    Account a = [SELECT Id FROM Account LIMIT 1][0];
  }
}`;
  const v = new Linter([soqlResultIndexWithoutCheck]).lint(src).violations;
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'SoqlResultIndexWithoutCheck');
});

test('SoqlResultIndexWithoutCheck: flags [SOQL].get(0)', () => {
  const src = `
public class Foo {
  public void run() {
    Account a = [SELECT Id FROM Account LIMIT 1].get(0);
  }
}`;
  const v = new Linter([soqlResultIndexWithoutCheck]).lint(src).violations;
  assert.equal(v.length, 1);
});

test('SoqlResultIndexWithoutCheck: no flag when assigned to list and checked', () => {
  const src = `
public class Foo {
  public void run() {
    List<Account> accs = [SELECT Id FROM Account LIMIT 1];
    if (!accs.isEmpty()) { Account a = accs[0]; }
  }
}`;
  const v = new Linter([soqlResultIndexWithoutCheck]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('SoqlResultIndexWithoutCheck: no flag for SOQL in for-each (bulkification pattern)', () => {
  const src = `
public class Foo {
  public void run() {
    for (Account a : [SELECT Id FROM Account]) { }
  }
}`;
  const v = new Linter([soqlResultIndexWithoutCheck]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('SoqlResultIndexWithoutCheck: skips @IsTest classes', () => {
  const src = `
@IsTest
public class FooTest {
  static testMethod void run() {
    Account a = [SELECT Id FROM Account LIMIT 1][0];
  }
}`;
  const v = new Linter([soqlResultIndexWithoutCheck]).lint(src).violations;
  assert.equal(v.length, 0);
});

// ─── TriggerContextNullAccess ─────────────────────────────────────────────────

test('TriggerContextNullAccess: flags Trigger.old in insert-only trigger', () => {
  const src = `trigger AccTrigger on Account (before insert) {
  for (Account old : Trigger.old) { }
}`;
  const v = new Linter([triggerContextNullAccess]).lint({ source: src, filePath: 'AccTrigger.trigger' }).violations;
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'TriggerContextNullAccess');
});

test('TriggerContextNullAccess: flags Trigger.old in after-insert-only trigger', () => {
  const src = `trigger AccTrigger on Account (after insert) {
  List<Account> olds = Trigger.old;
}`;
  const v = new Linter([triggerContextNullAccess]).lint({ source: src, filePath: 'AccTrigger.trigger' }).violations;
  assert.equal(v.length, 1);
});

test('TriggerContextNullAccess: no flag when trigger handles insert AND update', () => {
  const src = `trigger AccTrigger on Account (before insert, before update) {
  for (Account old : Trigger.old) { }
}`;
  const v = new Linter([triggerContextNullAccess]).lint({ source: src, filePath: 'AccTrigger.trigger' }).violations;
  assert.equal(v.length, 0);
});

test('TriggerContextNullAccess: flags Trigger.new in delete-only trigger', () => {
  const src = `trigger AccTrigger on Account (before delete) {
  for (Account n : Trigger.new) { }
}`;
  const v = new Linter([triggerContextNullAccess]).lint({ source: src, filePath: 'AccTrigger.trigger' }).violations;
  assert.equal(v.length, 1);
});

test('TriggerContextNullAccess: no flag when trigger handles delete AND undelete', () => {
  const src = `trigger AccTrigger on Account (after delete, after undelete) {
  for (Account n : Trigger.new) { }
}`;
  const v = new Linter([triggerContextNullAccess]).lint({ source: src, filePath: 'AccTrigger.trigger' }).violations;
  assert.equal(v.length, 0);
});

test('TriggerContextNullAccess: no flag for class files', () => {
  const src = `
public class Foo {
  public void run() {
    for (Account a : Trigger.old) { }
  }
}`;
  const v = new Linter([triggerContextNullAccess]).lint({ source: src, filePath: 'Foo.cls' }).violations;
  assert.equal(v.length, 0);
});

// ─── ChainedRelationshipAccess ────────────────────────────────────────────────

test('ChainedRelationshipAccess: flags 3-level sObject chain', () => {
  const src = `
public class Foo {
  public void run(Account a) {
    String email = a.Owner.Email;
  }
}`;
  const v = new Linter([chainedRelationshipAccess]).lint(src).violations;
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'ChainedRelationshipAccess');
});

test('ChainedRelationshipAccess: flags 4-level sObject chain', () => {
  const src = `
public class Foo {
  public void run(Opportunity opp) {
    String name = opp.Account.Owner.Name;
  }
}`;
  const v = new Linter([chainedRelationshipAccess]).lint(src).violations;
  assert.equal(v.length, 1);
});

test('ChainedRelationshipAccess: no flag for 2-level chain', () => {
  const src = `
public class Foo {
  public void run(Account a) {
    String name = a.Name;
  }
}`;
  const v = new Linter([chainedRelationshipAccess]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('ChainedRelationshipAccess: no flag for method call chain (not property chain)', () => {
  const src = `
public class Foo {
  public void run() {
    String s = SomeService.getInstance().getConfig().value;
  }
}`;
  const v = new Linter([chainedRelationshipAccess]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('ChainedRelationshipAccess: no flag when safe nav used', () => {
  const src = `
public class Foo {
  public void run(Account a) {
    String email = a.Owner?.Email;
  }
}`;
  const v = new Linter([chainedRelationshipAccess]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('ChainedRelationshipAccess: no flag for Schema namespace chains', () => {
  const src = `
public class Foo {
  public void run() {
    String label = Schema.SObjectType.Account.fields.Name.label;
  }
}`;
  const v = new Linter([chainedRelationshipAccess]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('ChainedRelationshipAccess: skips @IsTest classes', () => {
  const src = `
@IsTest
public class FooTest {
  static testMethod void run() {
    Account a = new Account();
    String email = a.Owner.Email;
  }
}`;
  const v = new Linter([chainedRelationshipAccess]).lint(src).violations;
  assert.equal(v.length, 0);
});

// ─── SoqlResultNotNullChecked ─────────────────────────────────────────────────

test('SoqlResultNotNullChecked: flags variable access after LIMIT 1 assignment', () => {
  const src = `
public class Foo {
  public void run(Id someId) {
    Account a = [SELECT Name FROM Account WHERE Id = :someId LIMIT 1];
    System.debug(a.Name);
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'SoqlResultNotNullChecked');
});

test('SoqlResultNotNullChecked: no flag when null check precedes access', () => {
  const src = `
public class Foo {
  public void run(Id someId) {
    Account a = [SELECT Name FROM Account WHERE Id = :someId LIMIT 1];
    if (a != null) {
      System.debug(a.Name);
    }
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('SoqlResultNotNullChecked: no flag for SOQL without LIMIT 1', () => {
  const src = `
public class Foo {
  public void run() {
    List<Account> accs = [SELECT Name FROM Account];
    System.debug(accs[0].Name);
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('SoqlResultNotNullChecked: no flag when safe nav used on the variable', () => {
  const src = `
public class Foo {
  public void run(Id someId) {
    Account a = [SELECT Name FROM Account WHERE Id = :someId LIMIT 1];
    String name = a?.Name;
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('SoqlResultNotNullChecked: no flag when variable is not dereferenced', () => {
  const src = `
public class Foo {
  public void run(Id someId) {
    Account a = [SELECT Name FROM Account WHERE Id = :someId LIMIT 1];
    System.debug(a);
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('SoqlResultNotNullChecked: skips @IsTest classes', () => {
  const src = `
@IsTest
public class FooTest {
  static testMethod void run() {
    Account a = [SELECT Name FROM Account LIMIT 1];
    System.debug(a.Name);
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('SoqlResultNotNullChecked: no flag for List<T> SOQL assignment', () => {
  const src = `
public class Foo {
  public void run() {
    List<Contact> contacts = [SELECT Id FROM Contact LIMIT 1];
    Integer n = contacts.size();
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

// ─── MapGetResultNotNullChecked ───────────────────────────────────────────────

test('MapGetResultNotNullChecked: flags variable access after Map.get() assignment', () => {
  // Uses a key-named arg (accId): a bare loop-counter arg like get(i) is treated
  // as List index access, not Map.get() — see the List.get(loopCounter) tests.
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id accId) {
    Account a = m.get(accId);
    String name = a.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'MapGetResultNotNullChecked');
});

test('MapGetResultNotNullChecked: no flag when null check precedes access', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id i) {
    Account a = m.get(i);
    if (a != null) {
      System.debug(a.Name);
    }
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('MapGetResultNotNullChecked: no flag when safe nav used', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id i) {
    Account a = m.get(i);
    String name = a?.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('MapGetResultNotNullChecked: no flag for non-get method assignments', () => {
  const src = `
public class Foo {
  public void run() {
    Account a = SomeService.fetchAccount();
    String name = a.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('MapGetResultNotNullChecked: no flag when containsKey guard precedes access', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> m, Id i) {
    Account a = m.get(i);
    if (m.containsKey(i)) {
      System.debug(a.Name);
    }
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('MapGetResultNotNullChecked: skips @IsTest classes', () => {
  const src = `
@IsTest
public class FooTest {
  static testMethod void run() {
    Map<Id, Account> m = new Map<Id, Account>();
    Account a = m.get(null);
    System.debug(a.Name);
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('MapGetResultNotNullChecked: no flag when guard and access on same line', async (t) => {
  const src = `public class Foo {
  public void run(Map<Id, Account> m, Id id) {
    Account a = m.get(id);
    if (a != null) { System.debug(a.Name); }
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  t.assert.strictEqual(v.length, 0);
});

test('SoqlResultNotNullChecked: no flag when guard and access on same line', async (t) => {
  const src = `public class Foo {
  public void run(Id id) {
    Account a = [SELECT Name FROM Account WHERE Id = :id LIMIT 1];
    if (a != null) { System.debug(a.Name); }
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  t.assert.strictEqual(v.length, 0);
});

test('MapGetResultNotNullChecked: no flag for List.get(index) assignment', () => {
  const src = `
public class Foo {
  public void run(List<Account> accounts) {
    Account a = accounts.get(0);
    String name = a.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

// Regression: List.get() with a non-literal index (loop counter, arithmetic, or an
// *Index-named variable) was misclassified as Map.get() — 10 of 11 FPs on real repos.
test('MapGetResultNotNullChecked: no flag for List.get(loopCounter)', () => {
  const src = `
public class Foo {
  public void run(List<Account> accounts, Integer i) {
    Account a = accounts.get(i);
    String name = a.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('MapGetResultNotNullChecked: no flag for List.get(arithmetic index)', () => {
  const src = `
public class Foo {
  public void run(List<Account> accounts, Integer idxMethodCall) {
    Account a = accounts.get(idxMethodCall - 1);
    String name = a.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('MapGetResultNotNullChecked: no flag for List.get(randomIndex)', () => {
  const src = `
public class Foo {
  public void run(List<Account> contacts, Integer randomIndex) {
    Account a = contacts.get(randomIndex);
    String name = a.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

// Regression: iterating map.keySet() guarantees get(key) is non-null.
test('MapGetResultNotNullChecked: no flag when receiver is iterated by keySet()', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> amap) {
    for (Id aid : amap.keySet()) {
      Account a = amap.get(aid);
      String name = a.Name;
    }
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

// Regression: a containsKey guard often precedes the assignment via early-exit.
test('MapGetResultNotNullChecked: no flag when containsKey guard precedes the assignment', () => {
  const src = `
public class Foo {
  public void run(Map<Id, Account> existing, Id recordId) {
    if (!existing.containsKey(recordId)) {
      return;
    }
    Account a = existing.get(recordId);
    String name = a.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('MapGetResultNotNullChecked: still flags Map.get(key) with a non-index argument', () => {
  const src = `
public class Foo {
  public void run(Map<String, Account> m, String key) {
    Account a = m.get(key);
    String name = a.Name;
  }
}`;
  const v = new Linter([mapGetResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'MapGetResultNotNullChecked');
});

test('SoqlResultNotNullChecked: no flag when tracked var is shadowed in constructor', () => {
  // A LIMIT 1 var in a method is not tracked into the constructor scope.
  // In the constructor, a fresh Account is declared — no NRE risk.
  const src = `
public class Foo {
  public void run(Id someId) {
    Account a = [SELECT Name FROM Account WHERE Id = :someId LIMIT 1];
  }
  public Foo() {
    Account a = new Account();
    System.debug(a.Name);
  }
}`;
  const v = new Linter([soqlResultNotNullChecked]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('TriggerContextNullAccess: no duplicate for Trigger.old accessed twice on same line', () => {
  const src = `trigger AccTrigger on Account (before insert) {
  if (Trigger.old != null && !Trigger.old.isEmpty()) { }
}`;
  const v = new Linter([triggerContextNullAccess]).lint({ source: src, filePath: 'AccTrigger.trigger' }).violations;
  assert.ok(v.length <= 1, `Expected at most 1 violation, got ${v.length}`);
});
