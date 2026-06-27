import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import type { Violation } from '../../src/engine/types.js';
import { apexSOQLInjection, databaseQueryWithVariable, apexOpenRedirect, apexSSRF, apexXSSFromURLParam } from '../../src/rules/security.js';

function violations(source: string): Violation[] {
  return new Linter([apexSOQLInjection]).lint(source).violations;
}

function dqvViolations(source: string): Violation[] {
  return new Linter([databaseQueryWithVariable]).lint(source).violations;
}

test('ApexSOQLInjection: flags VF param flowing through a variable into Database.query', () => {
  const src = `
public class Foo {
  public List<Account> run() {
    String name = ApexPages.currentPage().getParameters().get('name');
    String q = 'SELECT Id FROM Account WHERE Name = ' + name;
    return Database.query(q);
  }
}`;
  const v = violations(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'ApexSOQLInjection');
  assert.equal(v[0].severity, 'critical');
});

// Regression: the canonical injection pattern wraps the value in escaped quotes
// (`= \'' + x + '\''`). A literal regex that ignored `\'` stripped the tainted
// variable away and missed this — the most common real-world form.
test('ApexSOQLInjection: flags inline query with escaped quotes around a tainted value', () => {
  const src = `
public class Foo {
  public List<Contact> run() {
    String city = RestContext.request.params.get('city');
    return Database.query('SELECT Id FROM Contact WHERE MailingCity = \\'' + city + '\\'');
  }
}`;
  assert.equal(violations(src).length, 1);
});

test('ApexSOQLInjection: no flag when a bind variable is used', () => {
  const src = `
public class Foo {
  public List<Account> run() {
    String name = ApexPages.currentPage().getParameters().get('name');
    return Database.query('SELECT Id FROM Account WHERE Name = :name');
  }
}`;
  assert.equal(violations(src).length, 0);
});

test('ApexSOQLInjection: no flag when escapeSingleQuotes sanitizes the value', () => {
  const src = `
public class Foo {
  public List<Account> run() {
    String name = ApexPages.currentPage().getParameters().get('name');
    String safe = String.escapeSingleQuotes(name);
    return Database.query('SELECT Id FROM Account WHERE Name = ' + safe);
  }
}`;
  assert.equal(violations(src).length, 0);
});

test('ApexSOQLInjection: no flag for a fully static query', () => {
  const src = `
public class Foo {
  public List<Account> run() {
    return Database.query('SELECT Id FROM Account LIMIT 10');
  }
}`;
  assert.equal(violations(src).length, 0);
});

// DatabaseQueryWithVariable: broad net for any dynamic query argument.
test('DatabaseQueryWithVariable: flags a bare variable argument', () => {
  const src = `public class Foo { List<Account> run(String q) { return Database.query(q); } }`;
  const v = dqvViolations(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].ruleId, 'DatabaseQueryWithVariable');
});

// Regression: 'SELECT ... ' + x also starts with a quote — must not be read as static.
test('DatabaseQueryWithVariable: flags inline concatenation starting with a literal', () => {
  const src = `public class Foo { List<Account> run(String x) { return Database.query('SELECT Id FROM Account WHERE Name = ' + x); } }`;
  assert.equal(dqvViolations(src).length, 1);
});

test('DatabaseQueryWithVariable: no flag for a fully static query', () => {
  const src = `public class Foo { List<Account> run() { return Database.query('SELECT Id FROM Account'); } }`;
  assert.equal(dqvViolations(src).length, 0);
});

test('ApexSOQLInjection: flags a tainted @AuraEnabled controller param reaching query', () => {
  const src = `public class Ctrl {
    @AuraEnabled
    public static List<Account> search(String term) {
      return Database.query('SELECT Id FROM Account WHERE Name = ' + term);
    }
  }`;
  const v = violations(src);
  assert.equal(v.length, 1);
  assert.equal(v[0].severity, 'critical');
});

test('ApexOpenRedirect: flags public-param URL into PageReference', () => {
  const src = `public class C { public PageReference go(String url){ return new PageReference(url); } }`;
  const v = new Linter([apexOpenRedirect]).lint(src).violations;
  assert.equal(v.length, 1);
});

test('ApexSSRF: flags public-param URL into setEndpoint', () => {
  const src = `public class C { public void call(String url){ HttpRequest r = new HttpRequest(); r.setEndpoint(url); } }`;
  const v = new Linter([apexSSRF]).lint(src).violations;
  assert.equal(v.length, 1);
});

test('ApexXSSFromURLParam: flags public-param into ApexPages.Message', () => {
  const src = `public class C { public void warn(String msg){ ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.ERROR, msg)); } }`;
  const v = new Linter([apexXSSFromURLParam]).lint(src).violations;
  assert.equal(v.length, 1);
});

test('ApexXSSFromURLParam: no flag when escapeHtml4 sanitizes', () => {
  const src = `public class C { public void warn(String msg){ String safe = String.escapeHtml4(msg); ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.ERROR, safe)); } }`;
  const v = new Linter([apexXSSFromURLParam]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('ApexXSSFromURLParam: no flag when a literal arg merely contains the param name', () => {
  const src = `public class C { public void f(String contactId) { ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.FATAL, 'Please pass in a valid contactId and Email.')); } }`;
  const v = new Linter([apexXSSFromURLParam]).lint(src).violations;
  assert.equal(v.length, 0);
});

test('ApexSOQLInjection: no flag when the tainted value is escaped at the sink', () => {
  const src = `public class C { public List<SObject> run(String objectName) {
    String q = 'SELECT Id FROM ' + objectName + ' WHERE Id IN ';
    return Database.query(String.escapeSingleQuotes(q) + ':ids');
  }}`;
  assert.equal(violations(src).length, 0);
});

test('ApexSOQLInjection: still flags an unescaped ORDER BY built from a param', () => {
  const src = `public class C { public List<SObject> run(String sortBy) {
    String q = 'SELECT Id FROM Account ORDER BY ' + sortBy;
    return Database.query(q);
  }}`;
  assert.equal(violations(src).length, 1);
});
