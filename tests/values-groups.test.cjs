const assert = require('node:assert/strict');
const test = require('node:test');
const {build} = require('../assets/values-groups.js');

const groupValue = (row, field) => ({key: row[field], label: row[field]});

test('wallet groups keep first-seen group and row order', () => {
  const rows = [
    {wallet: '0xB', id: 1}, {wallet: '0xA', id: 2},
    {wallet: '0xB', id: 3}, {wallet: '0xC', id: 4}
  ];
  const groups = build(rows, ['wallet'], groupValue);
  assert.deepEqual(groups.map(group => group.label), ['0xB', '0xA', '0xC']);
  assert.deepEqual(groups.map(group => group.rows.map(row => row.id)), [[1, 3], [2], [4]]);
  assert.equal(groups[0].key, '[["wallet","0xB"]]');
  assert.equal(groups[0].field, 'wallet');
  assert.deepEqual(groups[0].children, []);
  assert.equal(groups[0].rows[0], rows[0]);
  assert.equal(groups[0].rows[1], rows[2]);
});

test('outcome keys remain distinct even when their labels match', () => {
  const rows = [
    {outcome: 'asset-yes-1'}, {outcome: 'asset-yes-2'}, {outcome: 'asset-yes-1'}
  ];
  const groups = build(rows, ['outcome'], row => ({key: row.outcome, label: 'Yes'}));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, 'Yes');
  assert.equal(groups[1].label, 'Yes');
  assert.notEqual(groups[0].key, groups[1].key);
  assert.deepEqual(groups.map(group => group.rows.length), [2, 1]);
});

test('wallet, status and outcome form independent nested groups', () => {
  const rows = [
    {wallet: 'A', status: 'Open', outcome: 'Yes', id: 1},
    {wallet: 'B', status: 'Open', outcome: 'Yes', id: 2},
    {wallet: 'A', status: 'Close', outcome: 'No', id: 3},
    {wallet: 'A', status: 'Open', outcome: 'No', id: 4},
    {wallet: 'A', status: 'Open', outcome: 'Yes', id: 5}
  ];
  const groups = build(rows, ['wallet', 'status', 'outcome'], groupValue);
  assert.deepEqual(groups.map(group => group.label), ['A', 'B']);
  assert.deepEqual(groups[0].rows.map(row => row.id), [1, 3, 4, 5]);
  assert.deepEqual(groups[0].children.map(group => group.label), ['Open', 'Close']);
  const openA = groups[0].children[0];
  assert.equal(openA.field, 'status');
  assert.deepEqual(openA.rows.map(row => row.id), [1, 4, 5]);
  assert.deepEqual(openA.children.map(group => group.label), ['Yes', 'No']);
  assert.deepEqual(openA.children[0].rows.map(row => row.id), [1, 5]);
  assert.equal(openA.children[0].key, '[["wallet","A"],["status","Open"],["outcome","Yes"]]');
  assert.notEqual(openA.children[0].key, groups[1].children[0].children[0].key);
  assert.deepEqual(openA.children[0].children, []);
});

test('absent and null values share a missing group without swallowing zero or false', () => {
  const rows = [{}, {outcome: null}, {outcome: 0}, {outcome: false}, {outcome: NaN}];
  const groups = build(rows, ['outcome'], groupValue);
  assert.deepEqual(groups.map(group => group.label), ['—', '0', 'false']);
  assert.equal(groups[0].key, '[["outcome",null]]');
  assert.deepEqual(groups[0].rows, [rows[0], rows[1], rows[4]]);
  const noValue = build(rows.slice(0, 2), ['outcome'], () => undefined);
  assert.equal(noValue.length, 1);
  assert.equal(noValue[0].label, '—');
});

test('typed keys and delimiter-containing values have deterministic, collision-free paths', () => {
  const rows = [{outcome: 1}, {outcome: '1'}, {outcome: 'a|b' }, {outcome: 'a\"b' }];
  const first = build(rows, ['outcome'], groupValue);
  const second = build(rows, ['outcome'], groupValue);
  assert.equal(first.length, 4);
  assert.equal(new Set(first.map(group => group.key)).size, 4);
  assert.deepEqual(first.map(group => group.key), second.map(group => group.key));
  first.forEach((group, index) => assert.deepEqual(JSON.parse(group.key), [['outcome', rows[index].outcome]]));
});

test('empty input and an ungrouped view produce an empty group tree', () => {
  assert.deepEqual(build([], ['wallet'], groupValue), []);
  assert.deepEqual(build([{wallet: 'A'}], [], () => { throw new Error('Ungrouped accessor'); }), []);
});

test('grouping preserves source arrays and original row references', () => {
  const rows = Object.freeze([
    Object.freeze({wallet: 'A', outcome: 'Yes'}),
    Object.freeze({wallet: 'A', outcome: 'No'})
  ]);
  const fields = Object.freeze(['wallet', 'outcome']);
  const groups = build(rows, fields, groupValue);
  assert.notEqual(groups[0].rows, rows);
  assert.equal(groups[0].rows[0], rows[0]);
  assert.equal(groups[0].children[1].rows[0], rows[1]);
  assert.deepEqual(fields, ['wallet', 'outcome']);
  groups[0].rows.pop();
  assert.equal(rows.length, 2);
});
