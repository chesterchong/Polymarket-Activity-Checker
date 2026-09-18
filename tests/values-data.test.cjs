const assert = require('node:assert/strict');
const test = require('node:test');
const {activity, positions} = require('../assets/values-data.js');
const {aggregate} = require('../assets/values-math.js');

const activityHelpers = {
  computeFeeFor: record => record.fee,
  feeUnavailable: record => record.unavailable === true
};
const positionHelpers = {
  positionFeeEstimate: position => position.fee,
  positionTradesFor: position => position.trades ?? [],
  feeUnavailable: trade => trade.unavailable === true
};

test('activity preserves numeric fields, negative flows and zeros without coercion', () => {
  const records = [
    {type: 'TRADE', size: 0, price: '0.42', usdcSize: -12, fee: 0},
    {type: 'TRADE', size: null, price: undefined, usdcSize: '', fee: 1.25}
  ];
  assert.deepEqual(activity(records, activityHelpers), [
    {size: 0, price: '0.42', usdcSize: -12, feeEstimate: 0},
    {size: null, price: undefined, usdcSize: '', feeEstimate: 1.25}
  ]);
});

test('non-trade activities do not contribute to fee totals or coverage', () => {
  const records = [{type: 'DEPOSIT', usdcSize: 100}, {type: 'REDEEM', usdcSize: 25}];
  const rows = activity(records, {
    computeFeeFor: () => { throw new Error('Non-trade fee lookup'); },
    feeUnavailable: () => { throw new Error('Non-trade fee status lookup'); }
  });
  assert.deepEqual(rows.map(row => row.feeEstimate), [{status: 'skip'}, {status: 'skip'}]);
  assert.deepEqual(aggregate(rows.map(row => row.feeEstimate), 'sum'), {
    value: 0, count: 0, total: 0, missing: 0, pending: 0, partial: false
  });
});

test('activity fees distinguish loading, unavailable and invalid estimates', () => {
  const rows = activity([
    {type: 'TRADE', fee: 2},
    {type: 'TRADE'},
    {type: 'TRADE', unavailable: true},
    {type: 'TRADE', fee: NaN},
    {type: 'TRADE', fee: Infinity},
    {type: 'TRADE', fee: null}
  ], activityHelpers);
  assert.deepEqual(rows.map(row => row.feeEstimate), [
    2, {status: 'pending'}, {status: 'unavailable'},
    {status: 'unavailable'}, {status: 'unavailable'}, {status: 'unavailable'}
  ]);
  assert.deepEqual(aggregate(rows.map(row => row.feeEstimate), 'sum'), {
    value: 2, count: 1, total: 6, missing: 4, pending: 1, partial: true
  });
});

test('redeemed position value uses payout while PnL remains the displayed cash PnL', () => {
  const rows = positions([
    {size: 20, avgPrice: 0.4, curPrice: 1, initialValue: 8, currentValue: 0,
      isRedeemed: true, payout: 20, cashPnl: 12, fee: 0.25},
    {size: 8, avgPrice: '0.25', curPrice: 0.2, initialValue: 2, currentValue: 1.6,
      payout: 100, cashPnl: -0.4, fee: 0}
  ], positionHelpers);
  assert.deepEqual(rows, [
    {size: 20, avgPrice: 0.4, curPrice: 1, initialValue: 8, value: 20, cashPnl: 12, feeEstimate: 0.25},
    {size: 8, avgPrice: '0.25', curPrice: 0.2, initialValue: 2, value: 1.6, cashPnl: -0.4, feeEstimate: 0}
  ]);
  assert.equal(aggregate(rows.map(row => row.cashPnl), 'sum').value, 11.6);
});

test('historical positions with missing cost, price, PnL or trade history remain unknown', () => {
  const [row] = positions([{
    size: '25', avgPrice: null, initialValue: null, isRedeemed: true, currentValue: 0, cashPnl: null
  }], positionHelpers);
  assert.deepEqual(row, {
    size: '25', avgPrice: null, curPrice: undefined, initialValue: null,
    value: undefined, cashPnl: null, feeEstimate: {status: 'unavailable'}
  });
  assert.equal(aggregate([row.initialValue], 'sum').value, null);
  assert.equal(aggregate([row.value], 'sum').value, null);
  assert.equal(aggregate([row.cashPnl], 'sum').value, null);
});

test('position fee status reflects incomplete trade coverage', () => {
  const rows = positions([
    {fee: 0, trades: []},
    {trades: []},
    {trades: [{fee: 1.5}, {}]},
    {trades: [{}, {unavailable: true}]},
    {fee: NaN, trades: [{}]}
  ], positionHelpers);
  assert.deepEqual(rows.map(row => row.feeEstimate), [
    0, {status: 'unavailable'}, {status: 'pending'}, {status: 'unavailable'}, {status: 'unavailable'}
  ]);
  assert.deepEqual(aggregate(rows.map(row => row.feeEstimate), 'sum'), {
    value: 0, count: 1, total: 5, missing: 3, pending: 1, partial: true
  });
});

test('every filtered row is included without a display cap or extra filtering', () => {
  const records = Array.from({length: 1205}, (_, index) => ({type: 'TRADE', size: index, fee: 0}));
  const activityRows = activity(records, activityHelpers);
  const positionRows = positions(records, positionHelpers);
  assert.equal(activityRows.length, 1205);
  assert.equal(positionRows.length, 1205);
  assert.equal(activityRows.at(-1).size, 1204);
  assert.equal(positionRows.at(-1).size, 1204);
  assert.equal(aggregate(activityRows.map(row => row.size), 'count').value, 1205);
});

test('adapters do not modify records or their arrays and return independent row objects', () => {
  const record = Object.freeze({type: 'TRADE', size: 4, price: '0.5', fee: 0});
  const trade = Object.freeze({unavailable: true});
  const position = Object.freeze({size: 0, cashPnl: null, trades: Object.freeze([trade])});
  const records = Object.freeze([record]);
  const sourcePositions = Object.freeze([position]);
  const [activityRow] = activity(records, activityHelpers);
  const [positionRow] = positions(sourcePositions, positionHelpers);
  activityRow.size = 99;
  positionRow.size = 100;
  assert.equal(record.size, 4);
  assert.equal(position.size, 0);
  assert.deepEqual(position.trades, [trade]);
  assert.deepEqual(activity([], activityHelpers), []);
  assert.deepEqual(positions([], positionHelpers), []);
});
