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
const WALLET_A = '0x' + 'a'.repeat(40);
const WALLET_B = '0x' + 'b'.repeat(40);
function trade(overrides = {}) {
  return {
    proxyWallet: WALLET_A, asset: 'nrg-token', conditionId: 'match-one', outcome: 'NRG',
    type: 'TRADE', side: 'BUY', timestamp: 150, title: 'First match', slug: 'first-match',
    transactionHash: '0xAbCd0123', size: 25, ...overrides
  };
}
function position(overrides = {}) {
  return { proxyWallet: WALLET_A, asset: 'nrg-token', conditionId: 'match-one', outcome: 'NRG',
    title: 'First match', slug: 'first-match', curPrice: 0.5, ...overrides };
}
function harness({ records = [], positions = [], params = {} } = {}) {
  const elements = new Map();
  const context = vm.createContext({
    allRecords: records, allPositions: positions, filteredRecords: [], lastParams: params,
    positionGroupCache: null, searchByTx: false, catFilter: new Set(), posStatusFilter: new Set(),
    marketFilter: null, sortDir: 'desc',
    recCategory: record => record.isCombo ? 'combo' : 'single',
    dateBound: id => context.$(id).value === '' ? null : Number(context.$(id).value),
    $: id => {
      if (!elements.has(id)) elements.set(id, {
        value: '', textContent: '', innerHTML: '', placeholder: '', title: '', attributes: new Map(), listeners: new Map(),
        classList: { contains: () => true, toggle() {} },
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
        getAttribute(name) { return this.attributes.get(name); },
        addEventListener(event, listener) { this.listeners.set(event, listener); }
      });
      return elements.get(id);
    }
  });
  const names = ['transactionMatches', 'updateSearchMode', 'applySearch', 'positionGroupKey', 'positionOutcomeKey',
    'positionActivityGroups', 'positionGroupFor', 'positionTradesFor', 'positionViewRows', 'searchPositions'];
  vm.runInContext(names.map(productionFunction).join('\n'), context);
  return context;
}

test('TxID mode matches only case-insensitive transaction hashes, including partial queries', () => {
  const matching = trade();
  const titleOnly = trade({ transactionHash: '0x9988', title: 'abcd title', slug: 'abcd', outcome: 'ABCD' });
  const missingHash = trade({ transactionHash: undefined, title: 'abcd' });
  const c = harness({ records: [matching, titleOnly, missingHash] });
  c.$('searchBox').value = '  aBcD  ';
  c.searchByTx = true;
  c.applySearch();
  assert.deepEqual(Array.from(c.filteredRecords), [matching]);
  c.searchByTx = false;
  c.applySearch();
  assert.deepEqual(Array.from(c.filteredRecords), [titleOnly, missingHash]);
  c.searchByTx = true;
  c.$('searchBox').value = '';
  c.applySearch();
  assert.equal(c.filteredRecords.length, 3, 'an empty query still shows records without hashes');
});

test('transaction searching intersects existing activity date, type, side and market filters', () => {
  const matching = trade();
  const c = harness({ records: [matching, trade({ side: 'SELL' }), trade({ type: 'REDEEM' }),
    trade({ timestamp: 250 }), trade({ conditionId: 'another-match' })] });
  c.searchByTx = true;
  c.$('searchBox').value = 'abcd';
  c.$('typeSel').value = 'TRADE';
  c.$('sideSel').value = 'BUY';
  c.$('dateFrom').value = '100';
  c.$('dateTo').value = '200';
  c.marketFilter = { conditionId: 'match-one' };
  c.applySearch();
  assert.deepEqual(Array.from(c.filteredRecords), [matching]);
});

test('positions match grouped trade and redemption hashes without leaking across wallets or outcomes', () => {
  const first = position();
  const otherOutcome = position({ asset: 'mouz-token', outcome: 'MOUZ' });
  const otherWallet = position({ proxyWallet: WALLET_B });
  const c = harness({ records: [trade(), trade({ asset: 'mouz-token', outcome: 'MOUZ', transactionHash: '0x9999' }),
    trade({ proxyWallet: WALLET_B, transactionHash: '0x8888' }), trade({ type: 'REDEEM', transactionHash: '0xFeeDd00d' })],
    positions: [first, otherOutcome, otherWallet] });
  c.searchByTx = true;
  c.$('searchBox').value = 'ABCD';
  assert.deepEqual(Array.from(c.searchPositions()), [first]);
  c.$('searchBox').value = 'feed';
  assert.deepEqual(Array.from(c.searchPositions()), [first], 'history records are included, not only BUY/SELL trades');
  c.$('searchBox').value = 'first match';
  assert.equal(c.searchPositions().length, 0, 'market title cannot match while TxID mode is active');
});

test('position hash matching stays inside the committed search and date windows', () => {
  const c = harness({ records: [trade({ timestamp: 90 }), trade({ transactionHash: '0x9988' })],
    positions: [position()], params: { start: '100', end: '200' } });
  c.searchByTx = true;
  c.$('searchBox').value = 'abcd';
  assert.equal(c.searchPositions().length, 0);
  c.allRecords.push(trade({ timestamp: 160 }));
  assert.equal(c.searchPositions().length, 1, 'new live history invalidates the activity grouping by length');
  c.$('dateTo').value = '155';
  assert.equal(c.searchPositions().length, 0, 'matching hashes outside the selected date range do not select a position');
});

test('holdings and price refreshes preserve the hash filter and current position snapshots', () => {
  const c = harness({ records: [trade()], positions: [position()] });
  c.searchByTx = true;
  c.$('searchBox').value = 'abcd';
  assert.equal(c.searchPositions()[0].curPrice, 0.5);
  c.allPositions = [position({ curPrice: 0.65, size: 1000 })];
  const [refreshed] = c.searchPositions();
  assert.equal(refreshed.curPrice, 0.65);
  assert.equal(refreshed.size, 1000);
  assert.equal(c.searchByTx, true);
  assert.equal(c.$('searchBox').value, 'abcd');
});

test('changing search mode invalidates cached position rendering even with the same query', () => {
  const hashMatch = position();
  const titleMatch = position({ asset: 'other-token', conditionId: 'match-two', title: 'abcd title' });
  const c = harness({ records: [trade(), trade({ asset: 'other-token', conditionId: 'match-two', transactionHash: '0x9999' })], positions: [hashMatch, titleMatch] });
  Object.assign(c, {
    posRunSeq: 1, posLoading: false, posLoaded: true, posError: null, posRenderKey: null,
    posRendered: [], POS_VIEW_CAP: 1000, expandedPos: new Set(),
    document: { querySelectorAll: () => [] },
    basePositions: () => c.searchPositions(), visiblePositions: () => c.searchPositions(),
    positionStatusGroup: () => 'open', matchesPositionStatus: () => true,
    loadFeesFor() {}, loadMarketTimesFor() {}, setPosNote() {}, buildPosNote: () => '', hideTooltip() {}, refreshValues() {},
    posRowHtml: row => `<tr>${row.title}</tr>`
  });
  vm.runInContext(productionFunction('renderPositions'), c);
  c.$('searchBox').value = 'abcd';
  c.renderPositions();
  assert.deepEqual(Array.from(c.posRendered), [titleMatch]);
  c.searchByTx = true;
  c.renderPositions();
  assert.deepEqual(Array.from(c.posRendered), [hashMatch]);
});

test('the # toggle preserves the query and other filters, and Reset restores market mode', () => {
  const c = harness();
  let refreshed = 0;
  Object.assign(c, {
    clearTimeout() {}, setTimeout() {}, posRenderKey: 'old', pageSize: 100,
    refreshResults() { refreshed++; }, renderPositions() {}, renderChips() {}, updateFchips() {},
    window: { DateRangePicker: { sync() {} } }, document: { querySelectorAll: () => [] }
  });
  const eventSource = html.slice(html.indexOf('  let searchTimer;'), html.indexOf('  // category filter chips (the COMBO'));
  vm.runInContext(eventSource + '\n' + productionFunction('resetFilters'), c);
  c.$('searchBox').value = 'abcd';
  c.$('typeSel').value = 'TRADE';
  c.$('dateFrom').value = '100';
  c.$('searchModeBtn').listeners.get('click')();
  assert.equal(c.searchByTx, true);
  assert.equal(c.$('searchModeBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(c.$('searchBox').placeholder, 'Filter TxIDs…');
  assert.equal(c.$('searchBox').value, 'abcd');
  assert.equal(c.$('typeSel').value, 'TRADE');
  assert.equal(c.$('dateFrom').value, '100');
  assert.equal(refreshed, 1);
  c.resetFilters();
  assert.equal(c.searchByTx, false);
  assert.equal(c.$('searchModeBtn').getAttribute('aria-pressed'), 'false');
  assert.equal(c.$('searchBox').placeholder, 'Filter markets…');
  assert.equal(c.$('searchBox').value, '');
});
