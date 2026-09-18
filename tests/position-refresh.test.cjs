const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Execute the production functions directly. The app is a single HTML file and
// has no build step; a small VM harness keeps these regressions dependency-free.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function productionFunction(name) {
  const match = html.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  }', 'm'));
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}
function productionConstant(name) {
  const match = html.match(new RegExp('^  const ' + name + ' = .+$', 'm'));
  assert.ok(match, `Missing production constant ${name}`);
  return match[0];
}

const WALLET_A = '0x' + 'a'.repeat(40);
const WALLET_B = '0x' + 'b'.repeat(40);
function position(overrides = {}) {
  return {
    proxyWallet: WALLET_A,
    asset: 'nrg-token',
    conditionId: 'mouz-nrg',
    outcome: 'NRG',
    title: 'Counter-Strike: MOUZ vs NRG - Map 1 Winner',
    size: 583.53,
    avgPrice: 0.668,
    curPrice: 0.605,
    initialValue: 390.12,
    currentValue: 353.03565,
    cashPnl: -37.08435,
    percentPnl: -9.50588,
    redeemable: false,
    ...overrides,
  };
}
function response(body, status = 200) {
  return {ok: status >= 200 && status < 300, status, headers: {get: () => null}, json: async () => body};
}
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}
function harness(options = {}) {
  const calls = [];
  const events = [];
  const elements = new Map();
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal,
    console: {warn: (...args) => events.push(['warn', ...args])},
    POS_MAX_PAGES: 4,
    LIVE_MS: 3000,
    PRICE_MS: 1000,
    LIVE_MAX_TOKENS: 600,
    LIVE_CHUNK: 300,
    allPositions: options.positions || [],
    currentWallets: options.wallets || [WALLET_A],
    posRunSeq: 1,
    posLoaded: true,
    posLoading: false,
    posRenderKey: 'previous-render',
    posFailedWallets: [],
    posTruncated: false,
    posHistCache: new Map(),
    expandedPos: new Set(),
    liveBusy: false,
    liveActive: false,
    livePositionError: '',
    livePriceError: '',
    priceBusyRun: null,
    nextPriceRefreshAt: 0,
    latestMidpoints: new Map(),
    nextLiveRefreshAt: 0,
    nextHistoryRefreshAt: 0,
    document: {hidden: false},
    sleep: async () => {},
    fetch: async (url, init) => {
      calls.push({url: String(url), init});
      return options.fetch ? options.fetch(String(url), init) : response([]);
    },
    $: id => {
      if (!elements.has(id)) elements.set(id, {
        value: '', textContent: '', innerHTML: '', children: [],
        classList: {contains: () => true},
      });
      return elements.get(id);
    },
    renderPositions: () => events.push(['render']),
    refreshPositionActivity: async () => ({changed: false, failed: false}),
    refreshPositionHistory: async () => ({failed: false}),
    refreshPortfolioValue: async () => {},
    updateRefreshCountdown: () => events.push(['countdown']),
    applyLivePrices: (changes, delta, priceTick) => events.push(['apply', changes, delta, priceTick]),
    setPosNote: note => events.push(['note', note]),
    buildPosNote: () => '',
    visiblePositions: () => context.allPositions,
    positionViewRows: () => context.allPositions,
    positionTradesFor: () => [],
  });
  const names = ['fetchWithRetry', 'fetchCurrentPositions', 'positionSnapshotKey', 'rememberPositionChange', 'applyPositionMidpoint', 'refreshPositionHoldings', 'posStatus', 'pollLiveHoldings', 'pollLivePrices', 'flashPositionPrice'];
  vm.runInContext(['posKey', 'short', 'fmtNum', 'fmtUsd'].map(productionConstant).concat(names.map(productionFunction)).join('\n'), context, {filename: 'index.html extracted functions'});
  return {context, calls, events, elements};
}

test('a live snapshot updates shares, average, cost, value and PnL together, preserving the rendered object', async () => {
  const original = position();
  const fresh = position({size: 1000, avgPrice: 0.7, initialValue: 700, currentValue: 605, cashPnl: -95, percentPnl: -95 / 700 * 100});
  const {context} = harness({positions: [original], fetch: async () => response([fresh])});
  const report = await context.refreshPositionHoldings(1);
  assert.equal(context.allPositions.length, 1);
  assert.equal(context.allPositions[0], original);
  for (const field of ['size', 'avgPrice', 'initialValue', 'currentValue', 'cashPnl', 'percentPnl']) {
    assert.equal(original[field], fresh[field], field);
  }
  assert.equal(report.structureChanged, false);
  assert.ok(report.changed.has(original));
  assert.ok(Math.abs(report.totalDelta - (605 - 353.03565)) < 1e-8);
});

test('complete snapshots add and remove current singles while retaining history and combos', async () => {
  const removed = position();
  const combo = position({asset: 'combo', isCombo: true});
  const redeemed = position({asset: '', conditionId: 'redeemed', isRedeemed: true});
  const closed = position({asset: 'old', conditionId: 'closed', isClosed: true});
  const added = position({asset: 'new', conditionId: 'new'});
  const {context} = harness({positions: [removed, combo, redeemed, closed], fetch: async () => response([added])});
  const report = await context.refreshPositionHoldings(1);
  assert.equal(report.structureChanged, true);
  assert.ok(!context.allPositions.includes(removed));
  assert.ok(context.allPositions.includes(combo));
  assert.ok(context.allPositions.includes(redeemed));
  assert.ok(context.allPositions.includes(closed));
  assert.equal(context.allPositions.filter(p => p.asset === 'new').length, 1);
});

test('re-entering a closed market replaces its historical row without showing a duplicate', async () => {
  const closed = position({isClosed: true});
  const reopened = position({size: 1000, avgPrice: 0.7});
  const {context} = harness({positions: [closed], fetch: async () => response([reopened])});
  const report = await context.refreshPositionHoldings(1);
  assert.equal(report.structureChanged, true);
  assert.equal(context.allPositions.length, 1);
  assert.ok(!context.allPositions[0].isClosed);
  assert.equal(context.allPositions[0].size, 1000);
});

test('an empty complete snapshot removes fully sold current holdings', async () => {
  const {context} = harness({positions: [position()], fetch: async () => response([])});
  const report = await context.refreshPositionHoldings(1);
  assert.equal(context.allPositions.length, 0);
  assert.equal(report.structureChanged, true);
});

test('one failed wallet retains its holdings while the successful wallet updates', async () => {
  const a = position();
  const b = position({proxyWallet: WALLET_B});
  const {context} = harness({positions: [a, b], wallets: [WALLET_A, WALLET_B], fetch: async url => {
    if (new URL(url).searchParams.get('user') === WALLET_B) return response({}, 503);
    return response([position({size: 1000, avgPrice: 0.7})]);
  }});
  const report = await context.refreshPositionHoldings(1);
  assert.equal(a.size, 1000);
  assert.equal(a.avgPrice, 0.7);
  assert.ok(context.allPositions.includes(b));
  assert.equal(b.size, 583.53);
  assert.deepEqual(Array.from(report.failedWallets), [WALLET_B]);
});

test('a truncated wallet snapshot cannot erase or partially replace its existing holdings', async () => {
  const original = position();
  const page = Array.from({length: 500}, (_, i) => position({asset: `new-${i}`, size: 1000}));
  const {context, calls} = harness({positions: [original], fetch: async () => response(page)});
  const report = await context.refreshPositionHoldings(1);
  assert.equal(calls.length, context.POS_MAX_PAGES);
  assert.equal(context.allPositions.length, 1);
  assert.equal(context.allPositions[0], original);
  assert.equal(original.size, 583.53);
  assert.deepEqual(Array.from(report.failedWallets), [WALLET_A]);
});

test('a response from an older search cannot overwrite the current search', async () => {
  const gate = deferred();
  const {context} = harness({positions: [position()], fetch: () => gate.promise});
  const pending = context.refreshPositionHoldings(1);
  const newSearchPosition = position({proxyWallet: WALLET_B, size: 42});
  context.posRunSeq = 2;
  context.currentWallets = [WALLET_B];
  context.allPositions = [newSearchPosition];
  gate.resolve(response([position({size: 1000})]));
  assert.equal(await pending, null);
  assert.equal(context.allPositions.length, 1);
  assert.equal(context.allPositions[0], newSearchPosition);
  assert.equal(newSearchPosition.size, 42);
});

test('current holdings paginate sequentially, stop at a short page and bypass browser cache', async () => {
  const firstPage = Array.from({length: 500}, (_, i) => position({asset: String(i)}));
  const first = deferred();
  const {context, calls} = harness({fetch: (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return offset === 0 ? first.promise : response([position({asset: 'last'})]);
  }});
  const pending = context.fetchCurrentPositions(WALLET_A);
  assert.equal(calls.length, 1, 'later pages should wait for the preceding page');
  first.resolve(response(firstPage));
  const result = await pending;
  assert.equal(calls.length, 2);
  assert.equal(result.out.length, 501);
  assert.equal(result.truncated, false);
  assert.deepEqual(calls.map(c => new URL(c.url).searchParams.get('offset')), ['0', '500']);
  for (const call of calls) {
    assert.equal(call.init.cache, 'no-store');
    assert.ok(call.init.signal);
    assert.equal(new URL(call.url).pathname, '/positions');
    assert.equal(new URL(call.url).searchParams.get('user'), WALLET_A);
  }
});

test('a live tick discovers the first holding and fetches its midpoint after the holdings snapshot', async () => {
  const {context, calls, events} = harness({positions: [], fetch: async url => {
    if (new URL(url).pathname === '/positions') {
      return response([position({size: 1000, avgPrice: 0.7, initialValue: 700, currentValue: 605, cashPnl: -95})]);
    }
    return response({'nrg-token': '0.61'});
  }});
  await context.pollLiveHoldings();
  await context.pollLivePrices();
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).pathname, '/positions');
  assert.equal(new URL(calls[1].url).pathname, '/midpoints');
  assert.equal(context.allPositions.length, 1);
  assert.equal(context.allPositions[0].size, 1000);
  assert.equal(context.allPositions[0].avgPrice, 0.7);
  assert.equal(context.allPositions[0].initialValue, 700);
  assert.equal(context.allPositions[0].currentValue, 610);
  assert.equal(context.allPositions[0].cashPnl, -90);
  assert.equal(context.liveBusy, false);
  assert.equal(context.liveActive, true);
  assert.ok(context.nextLiveRefreshAt > Date.now());
  assert.ok(events.some(e => e[0] === 'render'), 'new holdings need a table render');
});

test('hidden, inactive, busy and not-yet-due ticks make no requests', async t => {
  for (const mode of ['hidden', 'inactive', 'busy', 'loading', 'notLoaded', 'notDue']) {
    await t.test(mode, async () => {
      const {context, calls} = harness({positions: [position()]});
      if (mode === 'hidden') context.document.hidden = true;
      if (mode === 'inactive') context.$('posWrap').classList.contains = () => false;
      if (mode === 'busy') context.liveBusy = true;
      if (mode === 'loading') context.posLoading = true;
      if (mode === 'notLoaded') context.posLoaded = false;
      if (mode === 'notDue') context.nextLiveRefreshAt = Date.now() + 10000;
      await context.pollLiveHoldings();
      assert.equal(calls.length, 0);
    });
  }
});

test('the visible shares, average and cost cells refresh even when the midpoint is unchanged and columns are reordered', async () => {
  const original = position();
  const fresh = position({size: 1000, avgPrice: 0.7, initialValue: 700, currentValue: 605, cashPnl: -95});
  const {context} = harness({positions: [original], fetch: async url => response(new URL(url).pathname === '/positions' ? [fresh] : {'nrg-token': '0.605'})});
  context.posCols = {order: [4, 8, 6, 3, 5, 7, 0, 1, 2, 9]};
  context.posRendered = [original];
  const cells = context.posCols.order.map(() => ({innerHTML: '', classList: {toggle() {}, remove() {}}}));
  context.$('posBody').children = [{dataset: {pi: '0'}, cells, classList: {contains: kind => kind === 'pos-row', toggle() {}}}];
  context.tweenCell = (cell, old, value, format) => { cell.innerHTML = format(value); };
  context.tickArrow = () => '';
  let valuesRefreshes = 0;
  context.refreshValues = () => { valuesRefreshes++; };
  vm.runInContext(productionFunction('applyLivePrices'), context);
  await context.pollLiveHoldings();
  assert.equal(cells[context.posCols.order.indexOf(3)].innerHTML, '1,000');
  assert.equal(cells[context.posCols.order.indexOf(4)].innerHTML, '0.700');
  assert.equal(cells[context.posCols.order.indexOf(6)].innerHTML, '$700.00');
  assert.equal(cells[context.posCols.order.indexOf(7)].innerHTML, '$605.00');
  assert.equal(valuesRefreshes, 1, 'fresh holdings also refresh the Values panel');
});

test('a failed midpoint request still applies fresh holdings and reports an unavailable live price', async () => {
  const original = position();
  const fresh = position({size: 1000, avgPrice: 0.7, initialValue: 700, currentValue: 605, cashPnl: -95});
  const {context, events} = harness({positions: [original], fetch: async url => (
    new URL(url).pathname === '/positions' ? response([fresh]) : response({}, 503)
  )});
  await context.pollLiveHoldings();
  await context.pollLivePrices();
  assert.equal(original.size, 1000);
  assert.equal(original.avgPrice, 0.7);
  assert.equal(context.liveActive, false);
  assert.match(context.livePriceError, /prices unavailable/i);
  assert.ok(events.some(e => e[0] === 'apply' && e[1].has(original)));
  assert.equal(context.liveBusy, false);
  assert.ok(context.nextLiveRefreshAt > Date.now());
});

test('a failed holdings request keeps the previous wallet and marks its holdings stale', async () => {
  const original = position();
  const {context} = harness({positions: [original], fetch: async url => (
    new URL(url).pathname === '/positions' ? response({}, 503) : response({'nrg-token': '0.605'})
  )});
  await context.pollLiveHoldings();
  assert.equal(context.allPositions[0], original);
  assert.equal(original.size, 583.53);
  assert.equal(context.liveActive, false);
  assert.match(context.livePositionError, /holdings refresh failed/i);
  assert.equal(context.liveBusy, false);
  assert.ok(context.nextLiveRefreshAt > Date.now());
});

test('recovering current singles does not clear an initial wallet failure that also left history and combos missing', async () => {
  const {context} = harness({positions: [], fetch: async () => response([position({size: 1000})])});
  context.posFailedWallets = [WALLET_A];
  const report = await context.refreshPositionHoldings(1);
  assert.equal(context.allPositions[0].size, 1000);
  assert.equal(report.failedWallets.length, 0, 'the current singles request recovered');
  assert.deepEqual(Array.from(context.posFailedWallets), [WALLET_A], 'the initial incomplete wallet warning must remain');
});

test('closing and re-entering a position both invalidate its cached history without clearing unrelated history', async () => {
  let snapshot = [];
  const {context} = harness({positions: [position()], fetch: async () => response(snapshot)});
  const key = `${WALLET_A}|mouz-nrg`;
  const unrelatedKey = `${WALLET_B}|other-market`;
  const unrelatedHistory = [{type: 'BUY', size: 42}];
  context.posHistCache.set(key, [{type: 'BUY', size: 583.53}]);
  context.posHistCache.set(unrelatedKey, unrelatedHistory);
  await context.refreshPositionHoldings(1);
  assert.equal(context.allPositions.length, 0);
  assert.equal(context.posHistCache.has(key), false, 'a removed position must discard its stale trade history');
  context.posHistCache.set(key, [{type: 'SELL', size: 583.53}]);
  snapshot = [position({size: 1000})];
  await context.refreshPositionHoldings(1);
  assert.equal(context.allPositions[0].size, 1000);
  assert.equal(context.posHistCache.has(key), false, 'a new holding must discard any history cached before re-entry');
  assert.equal(context.posHistCache.get(unrelatedKey), unrelatedHistory);
});

test('one-second quotes continue during slow holdings sync, which preserves the quote with fresh shares and cost', async () => {
  const gate = deferred();
  const original = position();
  const {context, calls} = harness({positions: [original], fetch: async url =>
    new URL(url).pathname === '/positions' ? gate.promise : response({'nrg-token': '0.62'})});
  const pending = context.pollLiveHoldings();
  assert.equal(context.liveBusy, true);
  await context.pollLivePrices();
  assert.equal(original.curPrice, 0.62, 'slow holdings must not block the price loop');
  assert.equal(context.liveBusy, true);
  gate.resolve(response([position({size: 1000, avgPrice: 0.7, initialValue: 700, curPrice: 0.6, currentValue: 600, cashPnl: -100})]));
  await pending;
  assert.equal(calls.length, 2);
  assert.equal(original.size, 1000);
  assert.equal(original.avgPrice, 0.7);
  assert.equal(original.initialValue, 700);
  assert.equal(original.curPrice, 0.62);
  assert.equal(original.currentValue, 620);
  assert.equal(original.cashPnl, -80);
});

test('a delayed quote values the latest shares after a holdings update, without starting a second price request', async () => {
  const gate = deferred();
  const original = position();
  const {context, calls} = harness({positions: [original], fetch: async url =>
    new URL(url).pathname === '/midpoints' ? gate.promise
      : response([position({size: 1000, initialValue: 700, curPrice: 0.6, currentValue: 600, cashPnl: -100})])});
  const startedAt = Date.now();
  const pending = context.pollLivePrices();
  await context.pollLivePrices();
  assert.equal(calls.length, 1, 'in-flight midpoint requests cannot overlap');
  await context.refreshPositionHoldings(1);
  gate.resolve(response({'nrg-token': '0.61'}));
  await pending;
  assert.equal(original.size, 1000);
  assert.equal(original.currentValue, 610);
  assert.equal(original.cashPnl, -90);
  assert.equal(context.priceBusyRun, null);
  assert.ok(context.nextPriceRefreshAt >= startedAt + 1000);
  assert.ok(context.nextPriceRefreshAt <= Date.now() + 1000);
});

test('a pending quote cannot mutate removed, redeemed or newly resolved positions', async t => {
  for(const status of ['removed', 'redeemed', 'winner', 'loser']) await t.test(status, async () => {
    const gate = deferred();
    const original = position();
    const {context, events} = harness({positions: [original], fetch: async () => gate.promise});
    const pending = context.pollLivePrices();
    if(status === 'removed') context.allPositions = [];
    if(status === 'redeemed') Object.assign(original, {isRedeemed: true, currentValue: 0});
    if(status === 'winner') Object.assign(original, {redeemable: true, curPrice: 1, currentValue: 583.53});
    if(status === 'loser') Object.assign(original, {redeemable: true, curPrice: 0, currentValue: 0});
    const snapshot = {...original};
    gate.resolve(response({'nrg-token': '0.8'}));
    await pending;
    assert.deepEqual(original, snapshot);
    assert.equal(events.find(e => e[0] === 'apply')[1].size, 0);
  });
});

test('a quote from an older search cannot update current rows or cache and the new search can retry', async () => {
  const gate = deferred();
  let attempt = 0;
  const original = position();
  const {context} = harness({positions: [original], fetch: async () => ++attempt === 1 ? gate.promise : response({'nrg-token': '0.8'})});
  const pending = context.pollLivePrices();
  context.posRunSeq++;
  const next = position({size: 1000, currentValue: 605, cashPnl: -95});
  context.allPositions = [next];
  await context.pollLivePrices();
  assert.equal(attempt, 1, 'a previous search still owns the pending request');
  gate.resolve(response({'nrg-token': '0.9'}));
  await pending;
  assert.equal(next.curPrice, 0.605);
  assert.equal(original.curPrice, 0.605);
  assert.equal(context.latestMidpoints.size, 0);
  assert.equal(context.priceBusyRun, null);
  assert.equal(context.nextPriceRefreshAt, 0);
  await context.pollLivePrices();
  assert.equal(attempt, 2);
  assert.equal(next.curPrice, 0.8);
  assert.equal(next.currentValue, 800);
});

test('price polling respects visibility, loading, wallets and its own deadline', async t => {
  for(const mode of ['hidden', 'inactive', 'loading', 'notLoaded', 'notDue', 'noWallets']) await t.test(mode, async () => {
    const {context, calls} = harness({positions: [position()]});
    if(mode === 'hidden') context.document.hidden = true;
    if(mode === 'inactive') context.$('posWrap').classList.contains = () => false;
    if(mode === 'loading') context.posLoading = true;
    if(mode === 'notLoaded') context.posLoaded = false;
    if(mode === 'notDue') context.nextPriceRefreshAt = Date.now() + 10000;
    if(mode === 'noWallets') context.currentWallets = [];
    await context.pollLivePrices();
    assert.equal(calls.length, 0);
  });
});

test('unchanged quotes do not produce a row change, and price errors clear when no ongoing positions remain', async () => {
  let failed = false;
  const original = position();
  const {context, events} = harness({positions: [original], fetch: async () => failed ? response({}, 503) : response({'nrg-token': '0.605'})});
  await context.pollLivePrices();
  assert.equal(events.find(e => e[0] === 'apply')[1].size, 0);
  failed = true;
  context.nextPriceRefreshAt = 0;
  await context.pollLivePrices();
  assert.match(context.livePriceError, /prices unavailable/i);
  context.livePositionError = 'Holdings refresh failed';
  context.allPositions = [];
  context.nextPriceRefreshAt = 0;
  await context.pollLivePrices();
  assert.equal(context.livePriceError, '');
  assert.equal(context.livePositionError, 'Holdings refresh failed');
  assert.equal(context.liveActive, false, 'price recovery cannot erase a holdings error');
  assert.ok(events.some(e => e[0] === 'note'));
});

test('row pulse follows total profit or loss, independent of price direction, and excludes unchanged or settled rows', () => {
  const {context} = harness();
  const classes = new Set();
  let restarts = 0;
  const row = {classList: {add: c => classes.add(c), remove: (...cs) => cs.forEach(c => classes.delete(c))}, get offsetWidth(){ restarts++; return 100; }};
  context.flashPositionPrice(row, position({curPrice: 0.7, cashPnl: 20}), 0.8);
  assert.equal(classes.has('price-profit'), true, 'a profitable downward move stays green');
  context.flashPositionPrice(row, position({curPrice: 0.6, cashPnl: -20}), 0.5);
  assert.equal(classes.has('price-loss'), true, 'a losing upward move stays red');
  assert.equal(classes.has('price-profit'), false);
  context.flashPositionPrice(row, position({curPrice: 0.6, cashPnl: -20}), 0.6);
  context.flashPositionPrice(row, position({curPrice: 1, redeemable: true, cashPnl: 20}), 0.9);
  assert.equal(restarts, 2, 'unchanged and redeemable positions do not start pulses');
  context.flashPositionPrice(row, position({curPrice: 0.7, cashPnl: 0}), 0.6);
  assert.equal(classes.size, 0, 'break-even remains neutral');
});
