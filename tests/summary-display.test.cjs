const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function productionFunction(name) {
  const match = html.match(new RegExp('^  function ' + name + '\\([^]*?^  }', 'm'));
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}

test('summary refresh retains trade volume and leaves independent financial cards untouched', () => {
  const elements = new Map([
    ['stVolume', { textContent: '' }], ['stPnl', { textContent: '$25.00' }],
    ['stPortfolio', { textContent: '$100.00' }], ['stBalance', { textContent: '$50.00' }]
  ]);
  let refreshes = 0;
  const context = vm.createContext({
    filteredRecords: [
      { type: 'TRADE', size: 10, usdcSize: 7 }, { type: 'TRADE', size: '25', usdcSize: 20 },
      { type: 'DEPOSIT', size: 1000, usdcSize: 1000 }, { type: 'TAKER_REBATE', usdcSize: 4 },
      { type: 'REDEEM', size: 100, usdcSize: 100 }
    ],
    fmtUsd: value => Number(value).toFixed(2),
    $: id => { assert.ok(elements.has(id), `Unexpected obsolete summary field ${id}`); return elements.get(id); },
    refreshValues() { refreshes++; }
  });
  vm.runInContext(productionFunction('renderSummary'), context);
  context.renderSummary();
  assert.equal(elements.get('stVolume').textContent, '$35.00');
  assert.equal(elements.get('stPnl').textContent, '$25.00');
  assert.equal(elements.get('stPortfolio').textContent, '$100.00');
  assert.equal(elements.get('stBalance').textContent, '$50.00');
  assert.equal(refreshes, 1, 'totals and tab counts refresh with activity changes');
  context.filteredRecords = [];
  context.renderSummary();
  assert.equal(elements.get('stVolume').textContent, '$0.00');
});

test('a background position response refreshes counts without rebuilding the inactive position table', () => {
  let refreshes = 0;
  const context = vm.createContext({
    $: id => {
      assert.equal(id, 'posWrap', 'inactive view should not touch its table rows');
      return { classList: { contains: () => false } };
    },
    refreshValues() { refreshes++; }
  });
  vm.runInContext(productionFunction('renderPositions'), context);
  context.renderPositions();
  assert.equal(refreshes, 1);
});
