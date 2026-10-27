import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from './contracts.js';

test('canonicalJson ignores object key order at every depth', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } }), canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 2 }, b: 1 }));
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('canonicalJson preserves array order and distinguishes different values', () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
  assert.notEqual(canonicalJson({ a: null }), canonicalJson({}));
  assert.notEqual(canonicalJson({ a: '1' }), canonicalJson({ a: 1 }));
  assert.notEqual(canonicalJson({ a: [] }), canonicalJson({ a: {} }));
});

test('canonicalJson passes primitives through and does not mutate its input', () => {
  const input = { b: [{ z: 1, y: 2 }], a: 1 };
  const snapshot = structuredClone(input);
  canonicalJson(input);
  assert.deepEqual(Object.keys(input), Object.keys(snapshot));
  assert.deepEqual(input, snapshot);
  assert.equal(canonicalJson('text'), '"text"');
  assert.equal(canonicalJson(5), '5');
  assert.equal(canonicalJson(null), 'null');
});
