const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the production HTML's functions without bundling the app or adding
// dependencies. UI state is supplied explicitly to make window boundaries exact.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function productionFunction(name) {
  const match = html.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  }', 'm'));
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}
const WALLET_A = '0x' + 'a'.repeat(40);
const WALLET_B = '0x' + 'b'.repeat(40);
function trade(overrides = {}) {
  return {
    proxyWallet: WALLET_A, asset: 'nrg-token', conditionId: 'mouz-nrg',
    outcome: 'NRG', type: 'TRADE', side: 'BUY', timestamp: 150,
    title: 'Counter-Strike: MOUZ vs NRG - Map 1 Winner', slug: 'mouz-nrg',
    size: 100, price: 0.7, usdcSize: 70,
    ...overrides,
  };
}
function position(overrides = {}) {
  return {
    proxyWallet: WALLET_A, asset: 'nrg-token', conditionId: 'mouz-nrg',
    outcome: 'NRG', title: 'Counter-Strike: MOUZ vs NRG - Map 1 Winner', slug: 'mouz-nrg',
    size: 1000, avgPrice: 0.7, curPrice: 0.6, initialValue: 700,
    currentValue: 600, cashPnl: -100, percentPnl: -100 / 700 * 100,
    redeemable: false,
    ...overrides,
  };
}
function response(body, status = 200) {
  return {ok: status >= 200 && status < 300, status, headers: {get: () => null}, json: async () => body};
}
function harness(options = {}) {
  const elements = new Map();
  const calls = [];
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal,
    allRecords: options.records || [],
    allPositions: options.positions || [],
    currentWallets: options.wallets || [WALLET_A],
    lastParams: options.params || {},
    positionGroupCache: null,
    feeCache: new Map(),
    timeWin: '2592000',
    catFilter: new Set(),
    posStatusFilter: new Set(),
    TZ_IANA: {ET: 'America/New_York', 'GMT+8': 'Asia/Singapore'},
    tzSel: 'GMT+8',
    POS_CLOSED_MAX_PAGES: 40,
    sleep: async () => {},
    fetch: async (url, init) => {
      calls.push({url: String(url), init});
      return options.fetch ? options.fetch(String(url), init) : response([]);
    },
    $: id => {
      if (!elements.has(id)) elements.set(id, {
        value: '', textContent: '', innerHTML: '', children: [],
        classList: {contains: () => true, toggle() {}},
        querySelector: () => ({textContent: ''}),
      });
      return elements.get(id);
    },
  });
  const names = ['zonedMidnight', 'zonedDayBound', 'dateBound', 'positionGroupKey', 'positionOutcomeKey', 'positionActivityGroups', 'positionGroupFor', 'positionTradesFor', 'positionViewRows', 'searchPositions', 'basePositions', 'visiblePositions', 'posStatus', 'positionStatusGroup', 'matchesPositionStatus', 'fetchWithRetry', 'fetchClosedPositions', 'mapClosedPosition', 'computeFeeFor', 'feeUnavailable', 'positionFeeEstimate', 'positionFeeText', 'positionsCsv'];
  const constants = [html.match(/^  const fmtUsd = .+$/m)[0], html.match(/^  const csvCell = [^]*?^  };/m)[0]];
  vm.runInContext(constants.concat(names.map(productionFunction)).join('\n'), context, {filename: 'index.html extracted position window functions'});
  return {context, elements, calls};
}

test('trade groups separate wallets, outcomes and combos while collecting both BUY and SELL trades', () => {
  const buy = trade();
  const sell = trade({side: 'SELL', timestamp: 160, size: 20});
  const {context} = harness({records: [buy, sell,
    trade({proxyWallet: WALLET_B}),
    trade({outcome: 'MOUZ', asset: 'mouz-token'}),
    trade({isCombo: true}),
    trade({type: 'DEPOSIT', conditionId: '', outcome: '', asset: ''}),
  ]});
  const groups = context.positionActivityGroups();
  const selected = groups.get(context.positionGroupKey(position()));
  assert.equal(selected.trades.length, 2);
  assert.equal(selected.trades[0], buy);
  assert.equal(selected.trades[1], sell);
  const keys = [position(), position({proxyWallet: WALLET_B}), position({outcome: 'MOUZ', asset: 'mouz-token'}), position({isCombo: true})]
    .map(p => context.positionGroupKey(p));
  assert.equal(new Set(keys).size, 4);
  assert.equal(context.positionTradesFor(position({proxyWallet: WALLET_B})).length, 1);
  assert.equal(context.positionTradesFor(position({outcome: 'MOUZ', asset: 'mouz-token'})).length, 1);
  assert.equal(context.positionTradesFor(position({isCombo: true})).length, 1);
});

test('window membership uses the committed search bounds with inclusive endpoints, independent of draft time and Activity filters', () => {
  const records = [99, 100, 150, 200, 201].map(timestamp => trade({timestamp}));
  const {context} = harness({records, params: {start: '100', end: '200'}});
  context.timeWin = '1';
  context.$('typeSel').value = 'REDEEM';
  context.$('sideSel').value = 'SELL';
  assert.deepEqual(Array.from(context.positionTradesFor(position()), r => r.timestamp), [100, 150, 200]);
  context.timeWin = '';
  assert.deepEqual(Array.from(context.positionTradesFor(position()), r => r.timestamp), [100, 150, 200]);
});

test('date bounds intersect the committed window at the selected timezone day boundaries', () => {
  const from = Date.parse('2026-09-16T16:00:00Z') / 1000;
  const to = Date.parse('2026-09-17T15:59:59Z') / 1000;
  const {context} = harness({records: [from - 1, from, to, to + 1].map(timestamp => trade({timestamp})), params: {start: String(from - 100), end: String(to + 100)}});
  context.$('dateFrom').value = '2026-09-17';
  context.$('dateTo').value = '2026-09-17';
  assert.deepEqual(Array.from(context.positionTradesFor(position()), r => r.timestamp), [from, to]);
  context.lastParams.start = String(from + 1);
  assert.deepEqual(Array.from(context.positionTradesFor(position()), r => r.timestamp), [to]);
});

test('a selected window includes matching snapshots and represents missing trade groups without inventing position numbers', () => {
  const current = position();
  const outside = position({asset: 'outside', conditionId: 'outside'});
  const missing = trade({asset: 'missing', conditionId: 'missing', title: 'Missing snapshot', timestamp: 160});
  const {context} = harness({positions: [current, outside], records: [trade(), missing], params: {start: '100', end: '200'}});
  const rows = context.positionViewRows();
  assert.equal(rows.length, 2);
  assert.ok(rows.includes(current), 'snapshot balances and cost basis remain authoritative');
  assert.ok(!rows.includes(outside));
  const historical = rows.find(p => p.conditionId === 'missing');
  assert.ok(historical.isActivityOnly);
  assert.equal(context.posStatus(historical), 'history');
  for (const field of ['size', 'avgPrice', 'curPrice', 'initialValue', 'currentValue', 'cashPnl']) {
    assert.equal(historical[field], null, `${field} must be unknown without a position snapshot`);
  }
  assert.ok(Number.isNaN(historical.percentPnl));
  assert.equal(historical.title, 'Missing snapshot');
});

test('a window with no matching activity excludes current snapshots', () => {
  const {context} = harness({positions: [position()], records: [trade({timestamp: 99})], params: {start: '100', end: '200'}});
  assert.equal(context.positionViewRows().length, 0);
});

test('All includes every snapshot plus missing traded groups exactly once', () => {
  const current = position();
  const snapshotOnly = position({asset: 'snapshot-only', conditionId: 'snapshot-only'});
  const historical = trade({asset: 'missing', conditionId: 'missing'});
  const {context} = harness({positions: [current, snapshotOnly], records: [trade(), historical, {...historical, side: 'SELL', timestamp: 160}]});
  const rows = context.positionViewRows();
  assert.equal(rows.length, 3);
  assert.ok(rows.includes(current));
  assert.ok(rows.includes(snapshotOnly));
  assert.equal(rows.filter(p => p.conditionId === 'missing').length, 1);
});

test('a date filter limits All to traded groups in that date range', () => {
  const inDate = Date.parse('2026-09-17T04:00:00Z') / 1000;
  const {context} = harness({positions: [position(), position({conditionId: 'outside', asset: 'outside'})], records: [trade({timestamp: inDate})]});
  context.$('dateFrom').value = '2026-09-17';
  context.$('dateTo').value = '2026-09-17';
  const rows = context.positionViewRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].conditionId, 'mouz-nrg');
});

test('search and category filters operate on missing-history rows as well as snapshots', () => {
  const {context} = harness({records: [trade({conditionId: 'single'}), trade({conditionId: 'combo', isCombo: true, title: 'Combo championship'})]});
  context.$('searchBox').value = 'championship';
  context.catFilter.add('combo');
  const rows = context.visiblePositions();
  assert.equal(rows.length, 1);
  assert.ok(rows[0].isCombo);
  assert.ok(rows[0].isActivityOnly);
});

test('snapshot and activity rows without asset IDs match by wallet, market and outcome', () => {
  const snapshot = position({asset: ''});
  const {context} = harness({positions: [snapshot], records: [trade(), trade({asset: 'mouz-token', outcome: 'MOUZ'})], params: {start: '100'}});
  const rows = context.positionViewRows();
  assert.equal(rows.length, 2);
  assert.ok(rows.includes(snapshot));
  assert.equal(context.positionTradesFor(snapshot).length, 1);
  assert.equal(context.positionTradesFor(snapshot)[0].outcome, 'NRG');
});

test('progressively arriving trade groups refresh the positions view with an unchanged snapshot count', () => {
  const {context} = harness({params: {start: '100'}});
  Object.assign(context, {
    posRunSeq: 1, posLoading: false, posLoaded: true, posError: null,
    posRenderKey: null, posRendered: [], POS_VIEW_CAP: 1000,
    expandedPos: new Set(),
    document: {querySelectorAll: () => []},
    setPosNote() {}, buildPosNote: () => '', hideTooltip() {}, loadFeesFor() {},
    posRowHtml: p => `<tr>${p.title}</tr>`,
  });
  vm.runInContext(productionFunction('renderPositions'), context);
  context.renderPositions();
  assert.equal(context.posRendered.length, 0);
  context.allRecords.push(trade());
  context.renderPositions();
  assert.equal(context.posRendered.length, 1);
  assert.ok(context.posRendered[0].isActivityOnly);
  assert.match(context.$('posBody').innerHTML, /MOUZ vs NRG/);
});

test('closed snapshots use sequential 50-row timestamp pages, stop on a short page and deduplicate overlap', async () => {
  const firstPage = Array.from({length: 50}, (_, i) => position({asset: `closed-${i}`, conditionId: `closed-${i}`, timestamp: 1000 - i, totalBought: 20, realizedPnl: 4}));
  let resolveFirst;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const {context, calls} = harness({fetch: url => Number(new URL(url).searchParams.get('offset')) === 0
    ? first : response([firstPage[49], position({asset: 'closed-last', timestamp: 950, totalBought: 30})])});
  const pending = context.fetchClosedPositions(WALLET_A);
  assert.equal(calls.length, 1);
  resolveFirst(response(firstPage));
  const result = await pending;
  assert.equal(calls.length, 2);
  assert.equal(result.rows.length, 51);
  assert.equal(result.truncated, false);
  assert.equal(result.rows[0].isClosed, true);
  assert.equal(result.rows[0].size, 20);
  assert.equal(result.rows[0].cashPnl, 4);
  assert.deepEqual(calls.map(c => new URL(c.url).searchParams.get('offset')), ['0', '50']);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.pathname, '/closed-positions');
    assert.equal(url.searchParams.get('limit'), '50');
    assert.equal(url.searchParams.get('sortBy'), 'TIMESTAMP');
    assert.equal(url.searchParams.get('sortDirection'), 'DESC');
    assert.equal(call.init.cache, 'no-store');
  }
});

test('closed paging stops below the committed start but includes an exactly matching boundary page', async () => {
  const page = Array.from({length: 50}, (_, i) => position({asset: `closed-${i}`, timestamp: 1000 - i}));
  const older = harness({params: {start: '952'}, fetch: async () => response(page)});
  const result = await older.context.fetchClosedPositions(WALLET_A);
  assert.equal(older.calls.length, 1);
  assert.equal(result.truncated, false);
  const boundary = harness({params: {start: '951'}, fetch: async url => response(Number(new URL(url).searchParams.get('offset')) === 0 ? page : [])});
  await boundary.context.fetchClosedPositions(WALLET_A);
  assert.equal(boundary.calls.length, 2, 'timestamps at the inclusive start must not stop pagination early');
});

test('closed paging reports truncation when all allowed pages are full', async () => {
  const {context, calls} = harness({fetch: async url => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return response(Array.from({length: 50}, (_, i) => position({asset: `closed-${offset + i}`, timestamp: 10000 - offset - i})));
  }});
  const result = await context.fetchClosedPositions(WALLET_A);
  assert.equal(calls.length, context.POS_CLOSED_MAX_PAGES);
  assert.equal(result.rows.length, 50 * context.POS_CLOSED_MAX_PAGES);
  assert.equal(result.truncated, true);
});

test('position fees sum only matching BUY and SELL trades in the committed window and export the same estimate', () => {
  const {context} = harness({records: [
    trade({size: 100, price: 0.7}),
    trade({side: 'SELL', size: 50, price: 0.8, timestamp: 160}),
    trade({proxyWallet: WALLET_B, size: 99999}),
    trade({outcome: 'MOUZ', asset: 'mouz-token', size: 99999}),
    trade({timestamp: 99, size: 99999}),
  ], params: {start: '100', end: '200'}});
  context.feeCache.set('mouz-nrg', {rate: 0.02, exponent: 1});
  context.$('sideSel').value = 'SELL';
  const rows = context.positionViewRows();
  const p = rows.find(p => p.proxyWallet === WALLET_A && p.outcome === 'NRG');
  assert.ok(Math.abs(context.positionFeeEstimate(p) - 0.8) < 1e-10);
  assert.equal(context.positionFeeText(p), '$0.80');
  const [headers, values] = context.positionsCsv([p]).split('\n').map(line => line.split(','));
  assert.equal(values[headers.indexOf('feeEstimate')], '0.800000');
  assert.ok(headers.indexOf('feeEstimate') < headers.indexOf('currentValue'));
  for (const field of ['size', 'avgPrice', 'curPrice', 'initialValue', 'currentValue', 'cashPnl']) {
    assert.equal(values[headers.indexOf(field)], '', `unknown ${field} remains blank in CSV`);
  }
});

test('position fees distinguish pending, unavailable and confirmed fee-free schedules', () => {
  const {context} = harness({records: [trade()]});
  const p = context.positionViewRows()[0];
  assert.equal(context.positionFeeEstimate(p), undefined);
  assert.equal(context.positionFeeText(p), '…');
  context.feeCache.set('mouz-nrg', {unavailable: true});
  assert.equal(context.positionFeeText(p), 'Unavailable');
  const [headers, values] = context.positionsCsv([p]).split('\n').map(line => line.split(','));
  assert.equal(values[headers.indexOf('feeEstimate')], '');
  context.feeCache.set('mouz-nrg', null);
  assert.equal(context.positionFeeEstimate(p), 0);
  assert.equal(context.positionFeeText(p), '$0.00');
  assert.equal(context.positionFeeText(position({asset: 'no-trades', conditionId: 'no-trades'})), '—');
});

test('new live activity adds a missing market and its fees once, and an older search response is discarded', async () => {
  const newTrade = trade({transactionHash: 'new-transaction', timestamp: 180});
  let payload = response([newTrade, {...newTrade}]);
  const {context} = harness({params: {start: '100'}, fetch: async () => payload});
  Object.assign(context, {
    fetching: false, posRunSeq: 1, liveActivityCheckedAt: 150,
    API: 'https://data-api.polymarket.com/activity', posHistCache: new Map(),
    filteredRecords: [], posRenderKey: 'old-render',
    posKey: p => `${p.proxyWallet}|${p.conditionId}`,
    applySearch() {}, renderSummary() {}, loadFeesFor() {},
  });
  vm.runInContext(['activityRecordKey', 'refreshPositionActivity'].map(productionFunction).join('\n'), context);
  context.feeCache.set('mouz-nrg', {rate: 0.02, exponent: 1});
  const refreshed = await context.refreshPositionActivity(1);
  assert.equal(refreshed.changed, true);
  assert.equal(refreshed.failed, false);
  assert.equal(context.allRecords.length, 1, 'overlapping duplicate records are counted once');
  const rows = context.positionViewRows();
  assert.equal(rows.length, 1);
  assert.ok(rows[0].isActivityOnly);
  assert.ok(Math.abs(context.positionFeeEstimate(rows[0]) - 0.6) < 1e-10);
  let release;
  payload = new Promise(resolve => { release = resolve; });
  const pending = context.refreshPositionActivity(1);
  context.posRunSeq = 2;
  context.allRecords = [];
  context.positionGroupCache = null;
  release(response([trade({asset: 'stale', conditionId: 'stale'})]));
  assert.equal(await pending, null);
  assert.equal(context.allRecords.length, 0);
  assert.equal(context.positionViewRows().length, 0);
});

test('a bridging record joins asset-only and outcome-only identities in either arrival order, preserving all trade fees once', () => {
  const assetOnly = trade({outcome: '', outcomeIndex: 999, size: 100, timestamp: 150});
  const outcomeOnly = trade({asset: '', size: 50, timestamp: 160});
  const bridge = trade({size: 25, timestamp: 170});
  for (const records of [[assetOnly, outcomeOnly, bridge], [outcomeOnly, assetOnly, bridge]]) {
    const snapshot = position();
    const {context} = harness({records, positions: [snapshot]});
    context.feeCache.set('mouz-nrg', {rate: 0.02, exponent: 1});
    assert.equal(context.positionActivityGroups().size, 1);
    assert.equal(context.positionTradesFor(assetOnly).length, 3);
    assert.equal(context.positionTradesFor(outcomeOnly).length, 3);
    const rows = context.positionViewRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0], snapshot);
    assert.ok(Math.abs(context.positionFeeEstimate(rows[0]) - 1.05) < 1e-10);
    assert.equal(context.positionFeeText(rows[0]), '$1.05');
    assert.notEqual(context.positionGroupKey(position({asset: '', outcome: '', outcomeIndex: 0})),
      context.positionGroupKey(position({asset: '', outcome: '', outcomeIndex: undefined})),
      'outcome index zero must not collapse into an unspecified outcome');
  }
});

test('a recovered history snapshot rerenders without new holdings or activity and recognizes redemption outside the display date', async () => {
  const tradedAt = Date.parse('2026-09-17T04:00:00Z') / 1000;
  const redeemedAt = Date.parse('2026-09-18T04:00:00Z') / 1000;
  const {context, calls} = harness({records: [trade({timestamp: tradedAt}), trade({type: 'REDEEM', timestamp: redeemedAt, usdcSize: 100})],
    fetch: async () => response([position({totalBought: 100, realizedPnl: 30, timestamp: redeemedAt})])});
  context.$('dateFrom').value = '2026-09-17';
  context.$('dateTo').value = '2026-09-17';
  assert.ok(context.positionViewRows()[0].isActivityOnly);
  let renders = 0;
  Object.assign(context, {
    posRunSeq: 1, posLoaded: true, posLoading: false, posTruncated: false,
    liveBusy: false, liveActive: false, livePositionError: '', livePriceError: '', nextLiveRefreshAt: 0, nextHistoryRefreshAt: 0,
    LIVE_MS: 3000, LIVE_MAX_TOKENS: 600, LIVE_CHUNK: 300,
    document: {hidden: false},
    refreshPositionHoldings: async () => ({changed: new Map(), totalDelta: 0, structureChanged: false, failedWallets: []}),
    refreshPositionActivity: async () => ({changed: false, failed: false}),
    updateRefreshCountdown() {}, applyLivePrices() {}, refreshPortfolioValue() {},
    renderPositions: () => { renders++; context.posRendered = context.visiblePositions(); },
  });
  vm.runInContext(['refreshPositionHistory', 'pollLiveHoldings'].map(productionFunction).join('\n'), context);
  await context.pollLiveHoldings();
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/closed-positions');
  assert.equal(renders, 1, 'a history-only change must refresh the visible table');
  assert.equal(context.posRendered.length, 1);
  assert.equal(context.posStatus(context.posRendered[0]), 'redeemed');
  assert.equal(context.posRendered[0].isActivityOnly, undefined);
  assert.equal(context.posRendered[0].cashPnl, 30);
  assert.equal(context.posRendered[0].payout, 100);
  assert.ok(context.nextHistoryRefreshAt > Date.now());
});

test('fee loading retries missing IDs among closed markets and never labels failed metadata as fee-free', async () => {
  const records = [trade({asset: 'open-token', conditionId: 'open-market'}), trade({asset: 'closed-token', conditionId: 'closed-market'})];
  const {context, calls} = harness({records, fetch: async url => response(new URL(url).searchParams.get('closed') === 'false'
    ? [{conditionId: 'open-market', feesEnabled: false}]
    : [{conditionId: 'closed-market', feesEnabled: true, feeSchedule: JSON.stringify({rate: 0.02, exponent: 1})}])});
  Object.assign(context, {feeInflight: new Set(), refreshFeeCells() {}, renderSummary() {}});
  vm.runInContext(productionFunction('loadFeesFor'), context);
  await context.loadFeesFor(records);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.get('closed'), 'false');
  assert.deepEqual(new URL(calls[0].url).searchParams.getAll('condition_ids'), ['open-market', 'closed-market']);
  assert.equal(new URL(calls[1].url).searchParams.get('closed'), 'true');
  assert.deepEqual(new URL(calls[1].url).searchParams.getAll('condition_ids'), ['closed-market']);
  assert.equal(context.positionFeeText(position({asset: 'open-token', conditionId: 'open-market'})), '$0.00');
  assert.equal(context.positionFeeText(position({asset: 'closed-token', conditionId: 'closed-market'})), '$0.60');
  assert.equal(context.feeInflight.size, 0);
  const failed = harness({records: [trade()], fetch: async () => response({}, 503)});
  Object.assign(failed.context, {feeInflight: new Set(), refreshFeeCells() {}, renderSummary() {}});
  vm.runInContext(productionFunction('loadFeesFor'), failed.context);
  await failed.context.loadFeesFor(failed.context.allRecords);
  assert.deepEqual(failed.calls.map(call => new URL(call.url).searchParams.get('closed')), ['false', 'false', 'true', 'true']);
  assert.equal(failed.context.positionFeeEstimate(position()), undefined);
  assert.equal(failed.context.positionFeeText(position()), 'Unavailable');
  assert.equal(failed.context.feeCache.get('mouz-nrg').unavailable, true);
  assert.equal(failed.context.feeInflight.size, 0);
});

test('Open includes not redeemed and Close combines loss, redeemed and sold without reclassifying unknown history', () => {
  const {context} = harness();
  const rows = [
    position(),
    position({redeemable: true, curPrice: 1}),
    position({redeemable: true, curPrice: 0, currentValue: 0}),
    position({isRedeemed: true, currentValue: 0}),
    position({isClosed: true, currentValue: 0}),
    position({isActivityOnly: true, size: null, currentValue: null}),
  ];
  assert.deepEqual(rows.map(p => context.positionStatusGroup(p)), ['open', 'open', 'close', 'close', 'close', null]);
  assert.equal(context.posStatus(rows[1]), 'notredeemed');
  context.posStatusFilter = new Set(['open']);
  assert.deepEqual(rows.filter(p => context.matchesPositionStatus(p)), rows.slice(0, 2));
  context.posStatusFilter = new Set(['close']);
  assert.deepEqual(rows.filter(p => context.matchesPositionStatus(p)), rows.slice(2, 5));
  context.posStatusFilter = new Set(['open', 'close']);
  assert.equal(rows.filter(p => context.matchesPositionStatus(p)).length, 6);
  context.posStatusFilter = new Set();
  assert.equal(rows.filter(p => context.matchesPositionStatus(p)).length, 6);
});
