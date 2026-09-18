const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function productionFunction(name) {
  const match = html.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  }', 'm'));
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}
function response(body, status = 200) {
  return {ok: status >= 200 && status < 300, status, headers: {get: () => null}, json: async () => body};
}
function harness(options = {}) {
  const calls = [];
  let now = Date.parse('2026-09-17T10:00:00Z'), refreshes = 0;
  class ClockDate extends Date { static now() { return now; } }
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal, Date: ClockDate,
    marketTimeCache: new Map(), marketTimeInflight: new Map(), marketTimeRetryAt: new Map(),
    TZ_IANA: {ET: 'America/New_York', 'GMT+8': 'Asia/Singapore'}, tzSel: 'ET',
    posRendered: [], sleep: async () => {},
    refreshMarketTimeCells() { refreshes++; },
    fetch: async (url, init) => {
      calls.push({url: String(url), init});
      return options.fetch ? options.fetch(String(url), init) : response([]);
    },
  });
  const names = ['parseMarketTime', 'extractMarketTime', 'cacheMarketTime', 'marketTimeIds',
    'positionMarketTimes', 'formatMarketTime', 'positionMarketTimeText', 'positionMarketTimeTitle',
    'positionMarketTimeValue', 'fetchWithRetry', 'loadMarketTimesFor'];
  vm.runInContext(names.map(productionFunction).join('\n'), context, {filename: 'index.html extracted market time functions'});
  return {context, calls, advance: ms => { now += ms; }, refreshes: () => refreshes};
}

test('Gamma game times normalize the space and short UTC offset without depending on the browser timezone', () => {
  const {context: c} = harness();
  const result = c.parseMarketTime('2026-09-17 10:00:00+00', 'Scheduled game time');
  assert.equal(result.value, '2026-09-17T10:00:00.000Z');
  assert.equal(result.dateOnly, false);
  assert.equal(result.source, 'Scheduled game time');
  assert.equal(c.parseMarketTime('2026-09-17T18:00:00+08:00', 'test').value, result.value);
  for (const invalid of ['', null, 1789610400, 'tomorrow', '2026-09-17T10:00:00', '2026-02-30']) {
    assert.equal(c.parseMarketTime(invalid, 'test'), null);
  }
});

test('scheduled time displays follow ET daylight saving and GMT+8 while CSV keeps the UTC instant', () => {
  const {context: c} = harness();
  const p = {conditionId: 'game', gameStartTime: '2026-09-17 10:00:00+00'};
  assert.match(c.positionMarketTimeText(p), /^17 Sept? 2026, 06:00$/);
  assert.match(c.positionMarketTimeTitle(p), /Scheduled game time: .*06:00 \(ET\)$/);
  c.tzSel = 'GMT+8';
  assert.match(c.positionMarketTimeText(p), /^17 Sept? 2026, 18:00$/);
  assert.match(c.positionMarketTimeTitle(p), /\(GMT\+8\)$/);
  assert.equal(c.positionMarketTimeValue(p), '2026-09-17T10:00:00.000Z');
  c.tzSel = 'ET';
  assert.match(c.positionMarketTimeText({gameStartTime: '2026-01-17T10:00:00Z'}), /05:00$/);
});

test('scheduled game time wins and event start time is the fallback, but multiple distinct events remain ambiguous', () => {
  const {context: c} = harness();
  const game = '2026-09-17T10:00:00Z', event = '2026-09-17T11:00:00Z';
  assert.equal(c.extractMarketTime({gameStartTime: game, eventStartTime: event}).value, '2026-09-17T10:00:00.000Z');
  assert.equal(c.extractMarketTime({gameStartTime: 'unknown', eventStartTime: event}).value, '2026-09-17T11:00:00.000Z');
  assert.equal(c.extractMarketTime({events: [{startTime: event}]}).value, '2026-09-17T11:00:00.000Z');
  assert.equal(c.extractMarketTime({event: {startTime: event}}).value, '2026-09-17T11:00:00.000Z');
  assert.equal(c.extractMarketTime({events: [{startTime: game}, {startTime: event}]}), null);
  assert.equal(c.extractMarketTime({events: [{startTime: event}, {startTime: event}]}).value, '2026-09-17T11:00:00.000Z');
});

test('date-only events retain their calendar date and do not invent a midnight time in either zone', () => {
  const {context: c} = harness();
  c.cacheMarketTime({conditionId: 'DATE', events: [{eventDate: '2026-09-17'}]});
  const p = {conditionId: 'date'};
  for (const zone of ['ET', 'GMT+8']) {
    c.tzSel = zone;
    assert.equal(c.positionMarketTimeText(p), '2026-09-17');
    assert.equal(c.positionMarketTimeValue(p), '2026-09-17');
    assert.equal(c.positionMarketTimeTitle(p), 'Event date: 2026-09-17 (time not provided)');
  }
});

test('market creation, closing, trade and redemption dates are never substituted for scheduled market time', () => {
  const {context: c} = harness();
  const p = {conditionId: 'redeemed', startDate: '2026-09-01T12:00:00Z', endDate: '2026-09-17T20:00:00Z',
    createdAt: '2026-09-01T12:00:00Z', timestamp: 1789610400, isRedeemed: true,
    events: [{startDate: '2026-09-01T12:00:00Z', endDate: '2026-09-17T20:00:00Z'}]};
  assert.equal(c.extractMarketTime(p), null);
  c.cacheMarketTime(p);
  assert.equal(c.positionMarketTimeText(p), '—');
  assert.equal(c.positionMarketTimeValue(p), '');
  assert.equal(c.positionMarketTimeTitle(p), 'Scheduled market time unavailable');
});

test('combo schedules require every leg and distinguish multiple scheduled times without choosing an arbitrary leg', () => {
  const {context: c} = harness();
  const p = {isCombo: true, conditionId: 'combo', legs: [{leg_condition_id: 'A'}, {leg_condition_id: 'b'}, {leg_condition_id: 'A'}]};
  assert.deepEqual(Array.from(c.marketTimeIds(p)), ['a', 'b']);
  c.cacheMarketTime({conditionId: 'a', gameStartTime: '2026-09-17T10:00:00Z'});
  assert.equal(c.positionMarketTimeText(p), '—');
  c.cacheMarketTime({conditionId: 'b', gameStartTime: '2026-09-17T11:00:00Z'});
  assert.equal(c.positionMarketTimeText(p), 'Multiple times');
  assert.equal(c.positionMarketTimeValue(p), '2026-09-17T10:00:00.000Z | 2026-09-17T11:00:00.000Z');
  c.cacheMarketTime({conditionId: 'b', gameStartTime: '2026-09-17T10:00:00Z'});
  assert.match(c.positionMarketTimeText(p), /06:00$/);
});

test('bulk metadata lookup checks open then closed markets only for missing condition IDs', async () => {
  const h = harness({fetch: async url => response(new URL(url).searchParams.get('closed') === 'false'
    ? [{conditionId: 'open', gameStartTime: '2026-09-17T10:00:00Z'}]
    : [{conditionId: 'closed', events: [{startTime: '2026-09-16T10:00:00Z'}]}])});
  await h.context.loadMarketTimesFor([{conditionId: 'OPEN'}, {conditionId: 'open'}, {conditionId: 'closed'}]);
  assert.equal(h.calls.length, 2);
  const [open, closed] = h.calls.map(call => new URL(call.url));
  assert.equal(open.hostname, 'gamma-api.polymarket.com');
  assert.equal(open.pathname, '/markets');
  assert.equal(open.searchParams.get('closed'), 'false');
  assert.deepEqual(open.searchParams.getAll('condition_ids'), ['open', 'closed']);
  assert.equal(closed.searchParams.get('closed'), 'true');
  assert.deepEqual(closed.searchParams.getAll('condition_ids'), ['closed']);
  assert.equal(h.context.positionMarketTimeValue({conditionId: 'closed'}), '2026-09-16T10:00:00.000Z');
  assert.equal(h.context.marketTimeInflight.size, 0);
});

test('confirmed missing schedules are cached, and unrelated metadata cannot satisfy the requested market', async () => {
  const h = harness({fetch: async () => response([{conditionId: 'unrelated', gameStartTime: '2026-09-17T10:00:00Z'}])});
  await h.context.loadMarketTimesFor([{conditionId: 'missing'}]);
  assert.equal(h.context.marketTimeCache.get('missing'), null);
  assert.equal(h.context.marketTimeCache.has('unrelated'), false);
  await h.context.loadMarketTimesFor([{conditionId: 'missing'}]);
  assert.equal(h.calls.length, 2);
});

test('overlapping renders await one in-flight metadata request rather than starting duplicates', async () => {
  let resolveResponse;
  const pending = new Promise(resolve => { resolveResponse = resolve; });
  const h = harness({fetch: () => pending});
  const p = {conditionId: 'same'};
  const first = h.context.loadMarketTimesFor([p]);
  let secondDone = false;
  const second = h.context.loadMarketTimesFor([p]).then(() => { secondDone = true; });
  await Promise.resolve();
  assert.equal(h.calls.length, 1);
  assert.equal(secondDone, false);
  assert.equal(h.context.positionMarketTimeText(p), '…');
  resolveResponse(response([{conditionId: 'same', gameStartTime: '2026-09-17T10:00:00Z'}]));
  await Promise.all([first, second]);
  assert.equal(secondDone, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.context.marketTimeInflight.size, 0);
  assert.equal(h.refreshes(), 1);
});

test('metadata failures are retryable after backoff and are never cached as confirmed missing', async () => {
  let fail = true;
  const h = harness({fetch: async () => fail ? response({}, 503)
    : response([{conditionId: 'retry', gameStartTime: '2026-09-17T10:00:00Z'}])});
  const p = {conditionId: 'retry'};
  await h.context.loadMarketTimesFor([p]);
  assert.equal(h.calls.length, 4, 'open and closed endpoints each retry a transient 503');
  assert.equal(h.context.marketTimeCache.has('retry'), false);
  assert.equal(h.context.marketTimeInflight.size, 0);
  assert.equal(h.context.marketTimeRetryAt.get('retry'), h.context.Date.now() + 30000);
  await h.context.loadMarketTimesFor([p]);
  assert.equal(h.calls.length, 4, 'live renders respect failure backoff');
  h.advance(30000); fail = false;
  await h.context.loadMarketTimesFor([p]);
  assert.equal(h.calls.length, 5);
  assert.equal(h.context.positionMarketTimeValue(p), '2026-09-17T10:00:00.000Z');
  assert.equal(h.context.marketTimeRetryAt.has('retry'), false);
});

test('large lookups batch twenty unique markets without per-row requests', async () => {
  const h = harness({fetch: async url => response(new URL(url).searchParams.getAll('condition_ids')
    .map(conditionId => ({conditionId, gameStartTime: '2026-09-17T10:00:00Z'})))});
  await h.context.loadMarketTimesFor(Array.from({length: 41}, (_, i) => ({conditionId: 'market-' + i})));
  assert.deepEqual(h.calls.map(call => new URL(call.url).searchParams.getAll('condition_ids').length), [20, 20, 1]);
  assert.ok(h.calls.every(call => new URL(call.url).searchParams.get('limit') === '20'));
  assert.equal(h.context.marketTimeCache.size, 41);
});

test('late metadata refresh updates currently rendered positions, not rows captured before a filter change', () => {
  const {context: c} = harness();
  const td = {dataset: {pi: '0'}, textContent: '', title: ''};
  c.document = {querySelectorAll: selector => {
    assert.equal(selector, '#posBody .pos-market-time');
    return [td];
  }};
  c.posRendered = [{conditionId: 'new'}];
  c.cacheMarketTime({conditionId: 'old', gameStartTime: '2026-09-16T10:00:00Z'});
  c.cacheMarketTime({conditionId: 'new', gameStartTime: '2026-09-17T11:00:00Z'});
  vm.runInContext(productionFunction('refreshMarketTimeCells'), c);
  c.refreshMarketTimeCells();
  assert.match(td.textContent, /^17 Sept? 2026, 07:00$/);
  assert.match(td.title, /Scheduled game time: .*07:00/);
});
