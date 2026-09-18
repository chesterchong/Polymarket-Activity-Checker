const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const configSource = html.slice(html.indexOf('  function makeTableCfg('), html.indexOf('  const activeColsCfg ='));
const timezoneSource = html.slice(html.indexOf('  const TZ_KEY ='), html.indexOf('  const fmtTime ='));
const orderKey = 'pmac_pos_col_order', hiddenKey = 'pmac_pos_hidden_cols';
const migrationKey = 'pmac_pos_display_defaults_v1';

function storage(values = {}, blocked = false) {
  const saved = new Map(Object.entries(values));
  return {
    saved,
    getItem(key) { if (blocked) throw new Error('Storage blocked'); return saved.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage blocked'); saved.set(key, String(value)); },
  };
}

function configHarness(localStorage = storage()) {
  const context = vm.createContext({
    localStorage,
    document: {
      querySelector(selector) { return {children: Array.from({length: selector.startsWith('#posWrap') ? 12 : 11}, () => ({}))}; },
      createElement() { return {}; },
      head: {appendChild() {}},
    },
  });
  vm.runInContext(configSource, context);
  return {context, positions: vm.runInContext('posCols', context), activity: vm.runInContext('actCols', context)};
}

test('new browsers start with Market time first and Wallet hidden only in Active Position', () => {
  const {positions, activity} = configHarness();
  assert.deepEqual(Array.from(positions.order), [11,0,1,2,3,4,5,6,10,7,8,9]);
  assert.deepEqual(Array.from(positions.hidden), [0]);
  assert.equal(positions.colNames[11], 'Market time (GMT+8)');
  assert.equal(activity.hidden.size, 0);
});

test('existing position preferences migrate once without resetting other ordering or hidden columns', () => {
  const previous = [3,0,8,1,11,2,4,5,6,10,7,9];
  const localStorage = storage({[orderKey]: JSON.stringify(previous), [hiddenKey]: '[6,9,11]'});
  const first = configHarness(localStorage).positions;
  assert.deepEqual(Array.from(first.order), [11,3,0,8,1,2,4,5,6,10,7,9]);
  assert.deepEqual(Array.from(first.hidden), [6,9,0]);
  assert.equal(localStorage.getItem(migrationKey), '1');
  localStorage.setItem(orderKey, JSON.stringify(previous));
  localStorage.setItem(hiddenKey, '[6]');
  const customized = configHarness(localStorage).positions;
  assert.deepEqual(Array.from(customized.order), previous);
  assert.deepEqual(Array.from(customized.hidden), [6]);
});

test('older position settings retain migrated logical visibility while adopting the new defaults', () => {
  const localStorage = storage({[orderKey]: '[8,0,1,2,3,4,5,6,7]', [hiddenKey]: '[7]'});
  const {positions} = configHarness(localStorage);
  assert.equal(positions.order[0], 11);
  assert.deepEqual(Array.from(positions.order).slice(1), [9,0,1,2,3,4,5,6,10,7,8]);
  assert.deepEqual(Array.from(positions.hidden), [8,0]);
});

test('Reset columns restores hidden Wallet and first Market time after user customization', () => {
  const {positions, context} = configHarness();
  positions.order.reverse();
  positions.hidden.clear();
  let listener, applied;
  context.$ = () => ({addEventListener(event, handler) { listener = handler; }});
  context.activeColsCfg = () => positions;
  context.cfgApplyOrder = cfg => { applied = cfg; };
  const resetSource = html.slice(html.indexOf('  $("colsReset").addEventListener'), html.indexOf('  // drag one row'));
  vm.runInContext(resetSource, context);
  listener();
  assert.deepEqual(Array.from(positions.order), [11,0,1,2,3,4,5,6,10,7,8,9]);
  assert.deepEqual(Array.from(positions.hidden), [0]);
  assert.equal(applied, positions);
});

test('display defaults work when browser storage is unavailable', () => {
  const {positions} = configHarness(storage({}, true));
  assert.equal(positions.order[0], 11);
  assert.deepEqual(Array.from(positions.hidden), [0]);
});

test('GMT+8 is the timezone default, while a valid saved choice is retained', () => {
  for (const [saved, expected] of [[undefined, 'GMT+8'], ['invalid', 'GMT+8'], ['ET', 'ET'], ['GMT+8', 'GMT+8'], ['toString', 'GMT+8']]) {
    const context = vm.createContext({localStorage: storage(saved === undefined ? {} : {pmac_tz: saved})});
    vm.runInContext(timezoneSource, context);
    assert.equal(vm.runInContext('tzSel', context), expected);
  }
  const blocked = vm.createContext({localStorage: storage({}, true)});
  vm.runInContext(timezoneSource, blocked);
  assert.equal(vm.runInContext('tzSel', blocked), 'GMT+8');
});
