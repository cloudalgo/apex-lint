import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/engine/engine.js';
import { unusedPrivateMethod } from '../../src/rules/design.js';

function v(src: string) { return new Linter([unusedPrivateMethod]).lint(src).violations; }

test('UnusedPrivateMethod: a method called only as the tail of a chain is not flagged', () => {
  const src = `public class C {
    public void entry() { this.helper().process(); }
    private C helper() { return this; }
    private void process() { System.debug('x'); }
  }`;
  assert.equal(v(src).length, 0);
});

test('UnusedPrivateMethod: a genuinely uncalled private method is flagged', () => {
  const src = `public class C {
    public void entry() { }
    private void deadCode() { Integer x = 1; }
  }`;
  const r = v(src);
  assert.equal(r.length, 1);
  assert.equal(r[0].ruleId, 'UnusedPrivateMethod');
});
