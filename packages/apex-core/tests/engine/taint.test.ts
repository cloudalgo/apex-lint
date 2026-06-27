import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApex } from '../../src/ast/parser.js';
import { walk, nodeType } from '../../src/ast/walk.js';
import { isEntryPoint, entryPointParamNames } from '../../src/engine/taint.js';

function methods(src: string): any[] {
  const { tree } = parseApex(src);
  const out: any[] = [];
  walk(tree, (n) => { if (nodeType(n) === 'MethodDeclarationContext') out.push(n); });
  return out;
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
