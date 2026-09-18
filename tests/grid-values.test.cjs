const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ValuesMath = require('../assets/values-math.js');
const ValuesData = require('../assets/values-data.js');
const ValuesGroups = require('../assets/values-groups.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function productionFunction(name) {
  const match = html.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  }', 'm'));
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}

const WALLET = '0x' + 'a'.repeat(40);
const OTHER_WALLET = '0x' + 'b'.repeat(40);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function harness(options = {}) {
  const view = options.view ?? 'activity';
  const records = options.rows ?? [];
  const configuration = options.config ?? [{field: view === 'positions' ? 'cashPnl' : 'usdcSize', op: 'sum'}];
  const groupIds = options.groups ?? [];
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
    ValuesMath, ValuesData, ValuesGroups, Intl, esc,
    $: element,
    valuePanels: Object.fromEntries(['activity', 'positions'].map(name => [name, {
      getConfig: () => name === view ? configuration : [],
      getGroups: () => name === view ? groupIds : []
    }])),
    actCols: config(11, ['Time', 'Wallet', 'Type', 'Market', 'Outcome', 'Side', 'Size', 'Price', 'USDC', 'Fee (est.)', 'Tx']),
    posCols: config(12, ['Wallet', 'Market', 'Outcome', 'Shares', 'Avg price', 'Cur price', 'Cost', 'Value', 'PnL', 'End date', 'Fees (est.)', 'Market time']),
    gridState: {
      activity: {signature: null, collapsed: new Set()},
      positions: {signature: null, collapsed: new Set()}
    },
    valuesHelpers: helpers,
    ...helpers,
    fetching: false, posLoading: false, feedTruncated: false,
    posTruncated: false, posError: null, posFailedWallets: [],
    filteredRecords: records,
    visiblePositions: () => records,
    renderedCount: options.cap ?? records.length,
    posRendered: records.slice(0, options.cap ?? records.length),
    expandedPos: new Set(),
    rowHtml: (row, index) => `<tr class="activity-leaf" data-i="${index}"><td>${esc(row.title)}</td></tr>`,
    posRowHtml: (row, index) => `<tr class="pos-row" data-pi="${index}"><td>${esc(row.title)}</td></tr>`,
    positionMarketTimeText: row => row.marketTime ?? '—',
    short: value => value.slice(0, 6) + '…' + value.slice(-4),
    fmtTime: value => 'Time ' + value,
    allPositions: [], lastParams: {}, dateBound: () => null,
    positionGroupFor: () => undefined,
    positionActivityGroups: () => new Map()
  });
  const fieldsSource = html.match(/^  const gridFields = \{[^]*?^  };/m);
  assert.ok(fieldsSource, 'Missing grid field metadata');
  vm.runInContext(fieldsSource[0] + '\n' + [
    'valueFieldForColumn', 'gridGroupValue', 'gridAggregateCell', 'gridSummaryRow', 'refreshValues',
    'positionGroupKey', 'positionViewRows'
  ].map(productionFunction).join('\n'), context);
  return {context, elements, element, configuration, groupIds};
}

function numberInCell(markup, field) {
  const cell = markup.match(new RegExp('<td[^>]*data-value-field="' + field + '"[^>]*>([^]*?)</td>'));
  assert.ok(cell, `Missing aggregate cell ${field}`);
  return cell[1].match(/class="grid-number[^"]*">([^<]*)/)[1];
}

test('activity group totals and footer include every matching row beyond the displayed page', () => {
  const rows = Array.from({length: 150}, (_, index) => ({
    type: 'TRADE', proxyWallet: WALLET, usdcSize: 1, fee: 0, title: 'Row ' + index
  }));
  const {context, element} = harness({rows, cap: 2, groups: ['1']});
  context.refreshValues();
  assert.equal(numberInCell(element('activityTotals').innerHTML, 'usdcSize'), '$150.00');
  assert.equal(numberInCell(element('tableBody').innerHTML, 'usdcSize'), '$150.00');
  assert.equal((element('tableBody').innerHTML.match(/class="activity-leaf"/g) ?? []).length, 2);
  assert.match(element('activityTotals').innerHTML, /grid-group-count">150</);
});

test('position footer and grouped aggregates include rows beyond the 1000-row render cap', () => {
  const rows = Array.from({length: 1205}, (_, index) => ({
    proxyWallet: WALLET, asset: String(index), outcome: 'Yes', cashPnl: -1,
    currentValue: 2, fee: 0, title: 'Position ' + index
  }));
  const {context, element} = harness({view: 'positions', rows, cap: 1000, groups: ['0']});
  context.refreshValues();
  assert.equal(numberInCell(element('positionTotals').innerHTML, 'cashPnl'), '-$1,205.00');
  assert.equal(numberInCell(element('posBody').innerHTML, 'cashPnl'), '-$1,205.00');
  assert.equal((element('posBody').innerHTML.match(/class="pos-row"/g) ?? []).length, 1000);
});

test('wallet grouping is case-insensitive while outcome groups remain distinct', () => {
  const rows = [
    {proxyWallet: WALLET, outcome: 'Yes'},
    {proxyWallet: WALLET.toUpperCase(), outcome: 'No'},
    {proxyWallet: OTHER_WALLET, outcome: 'Yes'}
  ];
  const {context} = harness({view: 'positions', rows});
  const tree = ValuesGroups.build(rows, ['0', '2'], (row, field) => context.gridGroupValue('positions', row, field));
  assert.equal(tree.length, 2);
  assert.deepEqual(tree[0].children.map(node => node.label), ['Yes', 'No']);
  assert.equal(tree[0].rows.length, 2);
  assert.notEqual(tree[0].children[0].key, tree[1].children[0].key);
  assert.deepEqual(JSON.parse(tree[0].children[1].key), [['0', WALLET], ['2', 'No']]);
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

test('collapsing a group hides its leaves without altering the group subtotal or footer', () => {
  const rows = [
    {type: 'TRADE', proxyWallet: WALLET, usdcSize: 10, fee: 0},
    {type: 'TRADE', proxyWallet: WALLET, usdcSize: 5, fee: 0},
    {type: 'TRADE', proxyWallet: OTHER_WALLET, usdcSize: 2, fee: 0}
  ];
  const {context, element} = harness({rows, groups: ['1']});
  context.refreshValues();
  const footer = element('activityTotals').innerHTML;
  const key = JSON.stringify([['1', WALLET]]);
  context.gridState.activity.collapsed.add(key);
  context.refreshValues();
  assert.equal((element('tableBody').innerHTML.match(/class="activity-leaf"/g) ?? []).length, 1);
  assert.match(element('tableBody').innerHTML, /aria-expanded="false"/);
  assert.equal(numberInCell(element('tableBody').innerHTML, 'usdcSize'), '$15.00');
  assert.equal(element('activityTotals').innerHTML, footer);
  context.gridState.activity.collapsed.delete(key);
  context.refreshValues();
  assert.equal((element('tableBody').innerHTML.match(/class="activity-leaf"/g) ?? []).length, 3);
});

test('grouped history rows survive fresh objects from the production position view', () => {
  const latest = {type: 'TRADE', proxyWallet: WALLET, asset: 'history-token',
    conditionId: 'history-market', outcome: 'Yes', title: 'Historical trade'};
  const activityGroup = {latest, trades: [latest]};
  const {context, element} = harness({view: 'positions', groups: ['0']});
  context.positionActivityGroups = () => new Map([['history', activityGroup]]);
  context.visiblePositions = () => context.positionViewRows();
  context.posRendered = context.visiblePositions();
  assert.equal(context.posRendered[0].isActivityOnly, true);
  assert.notEqual(context.visiblePositions()[0], context.posRendered[0]);
  context.refreshValues();
  assert.match(element('posBody').innerHTML, /class="grid-group-row"/);
  assert.match(element('posBody').innerHTML, /class="pos-row"/);
  assert.match(element('posBody').innerHTML, /Historical trade/);
});

test('history identities distinguish both outcomes of the same market without token IDs', () => {
  const latest = outcome => ({type: 'TRADE', proxyWallet: WALLET, conditionId: 'shared-market',
    outcome, title: outcome + ' history'});
  const yes = latest('Yes'), no = latest('No');
  const groups = new Map([
    ['yes', {latest: yes, trades: [yes]}],
    ['no', {latest: no, trades: [no]}]
  ]);
  const {context, element} = harness({view: 'positions', groups: ['0', '2']});
  context.positionActivityGroups = () => groups;
  context.visiblePositions = () => context.positionViewRows();
  context.posRendered = context.visiblePositions();
  context.refreshValues();
  assert.match(element('posBody').innerHTML, /data-pi="0"><td>Yes history/);
  assert.match(element('posBody').innerHTML, /data-pi="1"><td>No history/);
});
