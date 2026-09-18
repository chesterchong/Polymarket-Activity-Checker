const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ValuesMath = require('../assets/values-math.js');
const ValuesData = require('../assets/values-data.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function productionFunction(name) {
  const match = html.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  }', 'm'));
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}

const WALLET = '0x' + 'a'.repeat(40);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function harness(options = {}) {
  const view = options.view ?? 'activity';
  const records = options.rows ?? [];
  const configuration = options.config ?? [{field: view === 'positions' ? 'cashPnl' : 'usdcSize', op: 'sum'}];
  const groupIds = options.obsoleteGroups ?? [];
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, innerHTML: '', textContent: '', dataset: {}, children: [],
      classList: {
        contains: name => name === 'on' ? id === 'tabPositions' && view === 'positions'
          : name === 'active' && id === (view === 'positions' ? 'posWrap' : 'tableWrap'),
        toggle() {}
      },
      querySelectorAll: () => [],
      insertAdjacentHTML(where, value) { this.innerHTML += value; }
    });
    return elements.get(id);
  }
  const config = (count, names) => ({
    order: Array.from({length: count}, (_, index) => index), hidden: new Set(), colNames: names
  });
  const helpers = {
    computeFeeFor: row => row.type === 'TRADE' ? row.fee : null,
    feeUnavailable: row => row.unavailable === true,
    positionFeeEstimate: row => row.fee,
    positionTradesFor: row => row.trades ?? []
  };
  const context = vm.createContext({
    ValuesMath, ValuesData, Intl, esc,
    $: element,
    valuePanels: Object.fromEntries(['activity', 'positions'].map(name => [name, {
      getConfig: () => name === view ? configuration : [],
      // Previously persisted grouping preferences must not alter the flat table.
      groupIds: name === view ? groupIds : []
    }])),
    actCols: config(11, ['Time', 'Wallet', 'Type', 'Market', 'Outcome', 'Side', 'Size', 'Price', 'USDC', 'Fee (est.)', 'Tx']),
    posCols: config(12, ['Wallet', 'Market', 'Outcome', 'Shares', 'Avg price', 'Cur price', 'Cost', 'Value', 'PnL', 'End date', 'Fees (est.)', 'Market time']),
    valuesHelpers: helpers,
    ...helpers,
    fetching: false, posLoading: false, feedTruncated: false,
    posTruncated: false, posError: null, posFailedWallets: [],
    filteredRecords: records,
    visiblePositions: () => records,
    renderedCount: options.cap ?? records.length,
    posRendered: records.slice(0, options.cap ?? records.length)
  });
  const fieldsSource = html.match(/^  const gridFields = \{[^]*?^  };/m);
  assert.ok(fieldsSource, 'Missing grid field metadata');
  vm.runInContext(fieldsSource[0] + '\n' + [
    'valueFieldForColumn', 'gridAggregateCell', 'gridSummaryRow', 'refreshValues'
  ].map(productionFunction).join('\n'), context);
  // Refreshing aggregate values must never replace rows, their order, or expanded details.
  for (const id of ['tableBody', 'posBody']) {
    const body = element(id);
    const markup = `<tr data-existing="${id}"><td>Existing row</td></tr><tr class="expanded-detail"><td>Details</td></tr>`;
    Object.defineProperty(body, 'innerHTML', {
      get: () => markup,
      set: () => assert.fail(`Values refresh rewrote ${id}`)
    });
  }
  return {context, elements, element, configuration};
}

function numberInCell(markup, field) {
  const cell = markup.match(new RegExp('<td[^>]*data-value-field="' + field + '"[^>]*>([^]*?)</td>'));
  assert.ok(cell, `Missing aggregate cell ${field}`);
  return cell[1].match(/class="grid-number[^"]*">([^<]*)/)[1];
}

test('activity total includes every matching row beyond the displayed page', () => {
  const rows = Array.from({length: 150}, (_, index) => ({
    type: 'TRADE', proxyWallet: WALLET, usdcSize: 1, fee: 0, title: 'Row ' + index
  }));
  const {context, element} = harness({rows, cap: 2});
  context.refreshValues();
  const footer = element('activityTotals').innerHTML;
  assert.equal(numberInCell(footer, 'usdcSize'), '$150.00');
  assert.match(footer, /grid-total-count">150</);
  assert.equal((footer.match(/<tr /g) ?? []).length, 1);
  assert.match(footer, /class="grid-total-row"/);
});

test('position total includes rows beyond the 1000-row render cap', () => {
  const rows = Array.from({length: 1205}, (_, index) => ({
    proxyWallet: WALLET, asset: String(index), outcome: 'Yes', cashPnl: -1,
    currentValue: 2, fee: 0, title: 'Position ' + index
  }));
  const {context, element} = harness({view: 'positions', rows, cap: 1000});
  context.refreshValues();
  const footer = element('positionTotals').innerHTML;
  assert.equal(numberInCell(footer, 'cashPnl'), '-$1,205.00');
  assert.match(footer, /grid-total-count">1,205</);
  assert.equal((footer.match(/<tr /g) ?? []).length, 1);
});

for (const view of ['activity', 'positions']) {
  test(`${view} ignores obsolete grouping preferences and preserves flat rows on refresh`, () => {
    const row = {type: 'TRADE', proxyWallet: WALLET, usdcSize: 12, cashPnl: 3, fee: 0};
    const {context, element} = harness({view, rows: [row], obsoleteGroups: ['0', '2']});
    const otherFooter = element(view === 'positions' ? 'activityTotals' : 'positionTotals');
    otherFooter.innerHTML = 'Previous view total';
    context.refreshValues();
    row.usdcSize = 20;
    row.cashPnl = 5;
    context.refreshValues();
    const footer = element(view === 'positions' ? 'positionTotals' : 'activityTotals');
    assert.equal(numberInCell(footer.innerHTML, view === 'positions' ? 'cashPnl' : 'usdcSize'),
      view === 'positions' ? '$5.00' : '$20.00');
    assert.doesNotMatch(footer.innerHTML, /grid-group|aria-expanded/);
    assert.equal(element('activityValues').hidden, view !== 'activity');
    assert.equal(element('positionValues').hidden, view !== 'positions');
    assert.equal(otherFooter.innerHTML, 'Previous view total');
    assert.equal(footer.hidden, false);
  });
}

test('an empty values selection clears and hides only its active footer', () => {
  const {context, element} = harness({config: []});
  element('activityTotals').innerHTML = 'Previous total';
  element('positionTotals').innerHTML = 'Other total';
  context.refreshValues();
  assert.equal(element('activityTotals').hidden, true);
  assert.equal(element('activityTotals').innerHTML, '');
  assert.equal(element('positionTotals').innerHTML, 'Other total');
});

test('aggregates preserve unknown data and explain partial fee coverage', () => {
  const rows = [
    {type: 'TRADE', usdcSize: 0, fee: 0},
    {type: 'TRADE', usdcSize: null},
    {type: 'TRADE', usdcSize: -5, unavailable: true},
    {type: 'DEPOSIT', usdcSize: 20}
  ];
  const {context} = harness({rows});
  const samples = new Map(rows.map((row, index) => [row, ValuesData.activity(rows, context.valuesHelpers)[index]]));
  const fees = context.gridAggregateCell('activity', rows, 'feeEstimate', 'sum', samples);
  assert.match(fees.html, /grid-number">\$0\.00</);
  assert.equal(fees.title, '1 of 3 values included · 1 unavailable · 1 loading');
  const total = context.gridAggregateCell('activity', rows, 'usdcSize', 'sum', samples);
  assert.match(total.html, /grid-number">\$15\.00</);
  assert.equal(total.title, '3 of 4 values included · 1 unavailable');
  const count = context.gridAggregateCell('activity', rows, 'usdcSize', 'count', samples);
  assert.match(count.html, /grid-number">3</);
  const unknown = context.gridAggregateCell('activity', [rows[1]], 'usdcSize', 'sum', samples);
  assert.match(unknown.html, /grid-number">—</);
});

test('progressive loading keeps interim totals marked and empty loading is never a false zero', () => {
  const row = {type: 'TRADE', usdcSize: 12, fee: 0};
  const {context} = harness({rows: [row]});
  context.fetching = true;
  const samples = new Map([[row, ValuesData.activity([row], context.valuesHelpers)[0]]]);
  const interim = context.gridAggregateCell('activity', [row], 'usdcSize', 'sum', samples);
  assert.match(interim.html, /grid-number">\$12\.00</);
  assert.match(interim.html, /grid-partial/);
  assert.match(interim.title, /Loading/);
  const empty = context.gridAggregateCell('activity', [], 'usdcSize', 'sum', new Map());
  assert.match(empty.html, /grid-number">—</);
  context.fetching = false;
  context.feedTruncated = true;
  assert.match(context.gridAggregateCell('activity', [row], 'usdcSize', 'sum', samples).title, /Incomplete history/);
});

test('redeemed Value uses payout and PnL is not reduced by estimated fees', () => {
  const rows = [{isRedeemed: true, payout: 50, currentValue: 0, cashPnl: 20, fee: 2}];
  const {context} = harness({view: 'positions', rows});
  const samples = new Map([[rows[0], ValuesData.positions(rows, context.valuesHelpers)[0]]]);
  assert.match(context.gridAggregateCell('positions', rows, 'value', 'sum', samples).html, /\$50\.00/);
  assert.match(context.gridAggregateCell('positions', rows, 'cashPnl', 'sum', samples).html, /grid-number pos">\$20\.00/);
});

test('a truly empty completed search has a zero sum and count but no average', () => {
  const {context, element} = harness();
  context.refreshValues();
  const footer = element('activityTotals').innerHTML;
  assert.equal(numberInCell(footer, 'usdcSize'), '$0.00');
  assert.match(footer, /grid-total-count">0</);
  assert.doesNotMatch(footer, /grid-partial/);
  const count = context.gridAggregateCell('activity', [], 'usdcSize', 'count', new Map());
  assert.match(count.html, /grid-number">0</);
  const average = context.gridAggregateCell('activity', [], 'usdcSize', 'avg', new Map());
  assert.match(average.html, /grid-number">—</);
});
