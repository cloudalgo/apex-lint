import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBar } from '../src/progress.js';

test('renders full bar at 100%', () => {
  const line = renderBar(10, 10, 42, '/path/to/MyClass.cls', 120);
  assert.ok(line.includes('█'.repeat(32)), 'bar should be fully filled');
  assert.ok(line.includes('100%'), 'should show 100%');
  assert.ok(line.includes('10/10'), 'should show count');
  assert.ok(line.includes('42 violations'), 'should show violation count');
  assert.ok(line.includes('MyClass.cls'), 'should show basename');
});

test('renders bar at first file (10%)', () => {
  const line = renderBar(1, 10, 0, '/path/to/File.cls', 120);
  assert.ok(line.includes('░'), 'should have empty segments at 10%');
  assert.ok(line.includes(' 10%'), 'should show 10%');
  assert.ok(line.includes('0 violations'), 'should show zero violations');
});

test('renders half-filled bar at 50%', () => {
  const line = renderBar(5, 10, 100, '/path/to/File.cls', 120);
  assert.ok(line.includes('█'.repeat(16) + '░'.repeat(16)), 'bar should be half filled');
  assert.ok(line.includes(' 50%'), 'should show 50%');
});

test('formats violations with comma separator', () => {
  const line = renderBar(1, 10, 1234, '/path/to/File.cls', 120);
  assert.ok(line.includes('1,234 violations'), 'should format with commas');
});

test('truncates long filename to fit terminal width', () => {
  const longName = 'A'.repeat(80) + '.cls';
  const line = renderBar(1, 10, 0, `/path/${longName}`, 100);
  assert.ok(line.length <= 100, `line length ${line.length} should be <= 100`);
  assert.ok(line.includes('…'), 'should include ellipsis for truncation');
});

test('drops filename when terminal too narrow for any filename', () => {
  // cols=72 leaves no room for "  ·  <filename>" after the base
  const line = renderBar(1, 10, 0, '/path/File.cls', 72);
  assert.ok(line.length <= 72, `line length ${line.length} should be <= 72`);
});

test('uses basename only, not full path', () => {
  const line = renderBar(1, 10, 0, '/very/long/path/to/MyClass.cls', 120);
  assert.ok(line.includes('MyClass.cls'), 'should show basename');
  assert.ok(!line.includes('/very/long/path/to/'), 'should not show full path');
});
