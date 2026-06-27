import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApex } from '../../src/ast/parser.js';
import { walk, nodeType } from '../../src/ast/walk.js';
import { isEntryPoint, entryPointParamNames, getTaint, isInjectableType, TAINT_SOURCES, SOQL_SANITIZERS } from '../../src/engine/taint.js';

function methods(src: string): any[] {
  const { tree } = parseApex(src);
  const out: any[] = [];
  walk(tree, (n) => { if (nodeType(n) === 'MethodDeclarationContext') out.push(n); });
  return out;
}

function firstMethod(src: string): any {
  const { tree } = parseApex(src);
  let m: any = null;
  walk(tree, (n) => { if (!m && nodeType(n) === 'MethodDeclarationContext') m = n; });
  return m;
}

test('isEntryPoint: public/global/webservice methods are entry points', () => {
  const [pub, glob, ws, priv, none] = methods(`public class C {
    public void a(String x){}
    global void b(){}
    webservice static void c(String f){}
    private void d(String y){}
    void e(String z){}
  }`);
  assert.equal(isEntryPoint(pub), true);
  assert.equal(isEntryPoint(glob), true);
  assert.equal(isEntryPoint(ws), true);
  assert.equal(isEntryPoint(priv), false);
  assert.equal(isEntryPoint(none), false);
});

test('isEntryPoint: @AuraEnabled public method is an entry point (via public)', () => {
  const [m] = methods(`public class C { @AuraEnabled public static List<Account> s(String term, Id who){ return null; } }`);
  assert.equal(isEntryPoint(m), true);
  assert.deepEqual(entryPointParamNames(m), ['term', 'who']);
});

test('getTaint: VF param source taints assigned var and propagates through concat', () => {
  const m = firstMethod(`public class C { void run(){
    String name = ApexPages.currentPage().getParameters().get('q');
    String soql = 'SELECT Id FROM Account WHERE Name = ' + name;
  }}`);
  const { tainted } = getTaint(m, SOQL_SANITIZERS);
  assert.ok(tainted.has('name'));
  assert.ok(tainted.has('soql'));
});

test('getTaint: public method params are tainted; escapeSingleQuotes clears taint', () => {
  const m = firstMethod(`public class C { public void run(String term){
    String safe = String.escapeSingleQuotes(term);
  }}`);
  const { tainted, isEntryPoint } = getTaint(m, SOQL_SANITIZERS);
  assert.equal(isEntryPoint, true);
  assert.ok(tainted.has('term'));
  assert.equal(tainted.has('safe'), false); // sanitized
});

test('getTaint: private method params are NOT tainted', () => {
  const m = firstMethod(`public class C { private void run(String term){
    String soql = 'SELECT Id FROM Account WHERE Name = ' + term;
  }}`);
  const { tainted } = getTaint(m, SOQL_SANITIZERS);
  assert.equal(tainted.has('term'), false);
  assert.equal(tainted.has('soql'), false);
});

test('getTaint: result is cached (same object for same node + sanitizers)', () => {
  const m = firstMethod(`public class C { public void run(String t){} }`);
  assert.strictEqual(getTaint(m, SOQL_SANITIZERS), getTaint(m, SOQL_SANITIZERS));
});

test('isInjectableType: String/Object and string-bearing collections only', () => {
  for (const t of ['String', 'Object', 'List<String>', 'Set<Object>', 'Map<String,Account>', 'Map<Id,String>'])
    assert.equal(isInjectableType(t), true, `${t} should be injectable`);
  for (const t of ['Id', 'Integer', 'Long', 'Decimal', 'Boolean', 'Date', 'Datetime', 'Blob', 'Account', 'List<Account>', 'MyString__c', 'Map<Id,Account>'])
    assert.equal(isInjectableType(t), false, `${t} should NOT be injectable`);
});

test('getTaint: only injectable-typed params are seeded', () => {
  const m = firstMethod(`public class C { public void run(String term, Id who, Integer n, List<Account> recs, List<String> tags){} }`);
  const { tainted } = getTaint(m, SOQL_SANITIZERS);
  assert.ok(tainted.has('term'));
  assert.ok(tainted.has('tags'));
  assert.equal(tainted.has('who'), false);
  assert.equal(tainted.has('n'), false);
  assert.equal(tainted.has('recs'), false);
});

test('getTaint: non-injectable local declarations are not tainted', () => {
  const m = firstMethod(`public class C { public void run(String term){
    Boolean b = (term == 'x');
    Integer len = term.length();
    String s = term + '!';
  }}`);
  const { tainted } = getTaint(m, SOQL_SANITIZERS);
  assert.ok(tainted.has('term'));
  assert.ok(tainted.has('s'));
  assert.equal(tainted.has('b'), false);
  assert.equal(tainted.has('len'), false);
});
