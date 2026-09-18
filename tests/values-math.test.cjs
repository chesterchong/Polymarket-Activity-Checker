const assert = require('node:assert/strict');
const test = require('node:test');
const {aggregate, normalizeConfig} = require('../assets/values-math.js');

test('profit and loss aggregates include negative values, zero and numeric strings', () => {
  const samples = [-40, ' 12.50 ', 0, '7.5'];
  assert.deepEqual(aggregate(samples, 'sum'), {
    value: -20, count: 4, total: 4, missing: 0, pending: 0, partial: false
  });
  assert.equal(aggregate(samples, 'avg').value, -5);
  assert.equal(aggregate(samples, 'min').value, -40);
  assert.equal(aggregate(samples, 'max').value, 12.5);
  assert.equal(aggregate(samples, 'count').value, 4);
});

test('blanks, booleans and invalid numeric values do not silently become zero', () => {
  const samples = [null, undefined, '', '  ', false, true, NaN, Infinity, -Infinity, 'NaN', 'Infinity', 'not a number', 0];
  assert.deepEqual(aggregate(samples, 'sum'), {
    value: 0, count: 1, total: 13, missing: 12, pending: 0, partial: true
  });
  assert.equal(aggregate(samples, 'count').value, 1);
  assert.equal(aggregate(samples, 'avg').value, 0);
});

test('pending and unavailable fees cannot use stale numeric values', () => {
  const samples = [
    {value: 1.25, status: 'ready'},
    {value: 99, status: 'pending'},
    {value: 100, status: 'unavailable'},
    {value: 0, status: 'ready'},
    {value: null, status: 'ready'},
    {value: 500, status: 'skip'}
  ];
  assert.deepEqual(aggregate(samples, 'sum'), {
    value: 1.25, count: 2, total: 5, missing: 2, pending: 1, partial: true
  });
  assert.equal(aggregate(samples, 'avg').value, 0.625);
  assert.equal(aggregate(samples, 'count').value, 2);
});

test('empty sets and wholly missing totals are distinct', () => {
  for (const samples of [[], [{value: 25, status: 'skip'}]]) {
    for (const op of ['sum', 'count']) {
      assert.deepEqual(aggregate(samples, op), {
        value: 0, count: 0, total: 0, missing: 0, pending: 0, partial: false
      });
    }
    for (const op of ['avg', 'min', 'max']) assert.equal(aggregate(samples, op).value, null);
  }
  for (const op of ['sum', 'avg', 'min', 'max']) {
    assert.deepEqual(aggregate([null, {status: 'pending', value: 8}], op), {
      value: null, count: 0, total: 2, missing: 1, pending: 1, partial: true
    });
  }
  assert.equal(aggregate([null, {status: 'pending'}], 'count').value, 0);
});

test('compensated sums retain small cash flows amid cancellation', () => {
  assert.equal(aggregate([1e16, 1, -1e16], 'sum').value, 1);
  assert.equal(aggregate([1e16, 1, -1e16], 'avg').value, 1 / 3);
  assert.ok(Math.abs(aggregate([0.1, 0.2, -0.3], 'sum').value) < 1e-15);
  assert.equal(Object.is(aggregate([-0], 'min').value, -0), false);
});

test('large finite values never leak Infinity or NaN into aggregates', () => {
  const large = Number.MAX_VALUE;
  assert.equal(aggregate([large, large, -large], 'sum').value, large);
  assert.equal(aggregate([large, large], 'avg').value, large);
  assert.equal(aggregate([large, large], 'sum').value, null);
  assert.equal(aggregate([-large, -large], 'sum').value, null);
});

test('invalid operations use sum and malformed samples remain safe', () => {
  assert.equal(aggregate([2, 3], 'unknown').value, 5);
  assert.deepEqual(aggregate(null, 'sum'), {
    value: 0, count: 0, total: 0, missing: 0, pending: 0, partial: false
  });
  assert.equal(aggregate([{value: 4}, {value: 5, status: 'unknown'}, [6]], 'sum').value, null);
});

test('stored Values configuration is sanitized without mutating its source', () => {
  const config = [
    {field: 'cashPnl', op: 'avg', unused: true},
    {field: 'fees', op: 'bogus'},
    {field: 'cashPnl', op: 'max'},
    {field: 'title', op: 'count'},
    null, false, 'cashPnl', {field: 4, op: 'sum'}
  ];
  const before = JSON.stringify(config);
  assert.deepEqual(normalizeConfig(config, ['cashPnl', 'fees'], []), [
    {field: 'cashPnl', op: 'avg'}, {field: 'fees', op: 'sum'}
  ]);
  assert.equal(JSON.stringify(config), before);
});

test('empty configuration is intentional and malformed storage uses sanitized defaults', () => {
  const allowed = new Set(['cashPnl', 'fees']);
  const defaults = [{field: 'cashPnl', op: 'sum'}, {field: 'fees', op: 'count'}, {field: 'title', op: 'sum'}];
  assert.deepEqual(normalizeConfig([], allowed, defaults), []);
  for (const invalid of [undefined, null, '', '[]', false, {field: 'fees'}]) {
    assert.deepEqual(normalizeConfig(invalid, allowed, defaults), defaults.slice(0, 2));
  }
  assert.deepEqual(normalizeConfig(null, allowed, null), []);
  assert.deepEqual(normalizeConfig(defaults, null, defaults), []);
});
