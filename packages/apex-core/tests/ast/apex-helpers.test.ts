import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApex } from '../../src/ast/parser.js';
import { walk, nodeType } from '../../src/ast/walk.js';
import { hasAnnotation, isTestClass, isInsideTestClass, isTestMethod } from '../../src/ast/apex-helpers.js';

function firstOf(src: string, type: string): any {
  const { tree } = parseApex(src);
  let n: any = null;
  walk(tree, (x) => { if (!n && nodeType(x) === type) n = x; });
  return n;
}
function allOf(src: string, type: string): any[] {
  const { tree } = parseApex(src);
  const out: any[] = [];
  walk(tree, (x) => { if (nodeType(x) === type) out.push(x); });
  return out;
}

test('isTestClass: true for an @IsTest outer class, false for a plain class', () => {
  assert.equal(isTestClass(firstOf('@IsTest public class FooTest { }', 'ClassDeclarationContext')), true);
  assert.equal(isTestClass(firstOf('public class Foo { }', 'ClassDeclarationContext')), false);
});

test('isTestClass: an inner class is not a test class (only outer @IsTest counts)', () => {
  // Outer @IsTest, inner plain -> outer true, inner false.
  const [outer, inner] = allOf('@IsTest public class FooTest { class Helper { } }', 'ClassDeclarationContext');
  assert.equal(isTestClass(outer), true);
  assert.equal(isTestClass(inner), false);
});

test('isInsideTestClass: true for a node inside an @IsTest class', () => {
  const method = firstOf('@IsTest public class FooTest { static void m() { Integer x = 1; } }', 'MethodDeclarationContext');
  assert.equal(isInsideTestClass(method), true);
  const other = firstOf('public class Foo { static void m() {} }', 'MethodDeclarationContext');
  assert.equal(isInsideTestClass(other), false);
});

test('isTestMethod: @IsTest method and legacy testMethod keyword', () => {
  const [ann, legacy, plain] = allOf(
    'public class C { @IsTest static void a(){} static testMethod void b(){} static void c(){} }',
    'MethodDeclarationContext');
  assert.equal(isTestMethod(ann), true);
  assert.equal(isTestMethod(legacy), true);
  assert.equal(isTestMethod(plain), false);
});

test('hasAnnotation: matches by name, ignoring args and case', () => {
  const cls = firstOf("@IsTest(SeeAllData=true) public class T {}", 'ClassDeclarationContext');
  assert.equal(hasAnnotation(cls.parentCtx, 'istest'), true);
  assert.equal(hasAnnotation(cls.parentCtx, 'auraenabled'), false);
});
