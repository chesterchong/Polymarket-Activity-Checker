const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const timezoneSource = html.slice(html.indexOf('  const TZ_KEY ='), html.indexOf('  const fmtTime ='));
const toggleSource = html.slice(html.indexOf('  function applyTz(){'), html.indexOf('  $("rowsSel").addEventListener'));
const clockSource = html.match(/^  function updateDigitalClock\(\)\{[^]*?^  }/m)?.[0];
assert.ok(clockSource, 'Production digital clock function must be present');
assert.ok(toggleSource.includes('timezoneBtn'), 'Production timezone button handler must be present');

function harness({ savedZone, blockedStorage = false } = {}) {
  const now = Date.parse('2026-09-18T12:34:56Z');
  const elements = new Map();
  const saved = new Map(savedZone ? [['pmac_tz', savedZone]] : []);
  const calls = { persistence: [], picker: [], refresh: 0, positions: 0 };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      disabled: false, title: '', textContent: '', innerHTML: '', dateTime: '', dataset: {},
      attributes: new Map(), listeners: new Map(),
      classList: { toggle() {} },
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      addEventListener(name, handler) { this.listeners.set(name, handler); }
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    Date: FakeDate, Intl,
    $: element,
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage blocked'); return saved.get(key) ?? null; },
      setItem(key, value) {
        if (blockedStorage) throw new Error('Storage blocked');
        saved.set(key, value);
        calls.persistence.push([key, value]);
      }
    },
    window: { DateRangePicker: { setTimezone(zone) { calls.picker.push(zone); } } },
    actCols: { colNames: Array(11).fill('') },
    posCols: { colNames: Array(12).fill('') },
    digitalClockZone: '', digitalClockFormatter: null,
    esc: value => value,
    sortDir: 'desc', posRenderKey: 'old',
    buildColsList() {},
    refreshResults() { calls.refresh++; },
    renderPositions() { calls.positions++; }
  });
  vm.runInContext(timezoneSource + '\n' + clockSource + '\n' + toggleSource, context);
  vm.runInContext('applyTz()', context);
  function click() { element('timezoneBtn').listeners.get('click')(); }
  return { context, element, calls, saved, click, zone: () => vm.runInContext('tzSel', context) };
}

function assertLabels(h, zone, time) {
  const next = zone === 'GMT+8' ? 'ET' : 'GMT+8';
  const label = `Time zone: ${zone}. Switch to ${next}`;
  assert.equal(h.element('timezoneBtn').title, label);
  assert.equal(h.element('timezoneBtn').getAttribute('aria-label'), label);
  assert.match(h.element('thTime').innerHTML, new RegExp('^Time \\(' + zone.replace('+', '\\+') + '\\)'));
  assert.equal(h.context.actCols.colNames[0], `Time (${zone})`);
  assert.equal(h.element('marketTimeLabel').textContent, `Market time (${zone})`);
  assert.equal(h.context.posCols.colNames[11], `Market time (${zone})`);
  assert.equal(h.element('digitalClockZone').textContent, zone);
  assert.equal(h.element('digitalClockTime').textContent, time);
  assert.equal(h.calls.picker.at(-1), zone);
}

test('timezone toggle updates clock, headers, picker, and saved preference together', () => {
  const h = harness();
  assertLabels(h, 'GMT+8', '20:34:56');
  h.click();
  assert.equal(h.zone(), 'ET');
  assertLabels(h, 'ET', '08:34:56');
  assert.equal(h.saved.get('pmac_tz'), 'ET');
  assert.equal(h.calls.refresh, 1);
  assert.equal(h.calls.positions, 1);
  assert.equal(h.context.posRenderKey, null);
});

test('every repeated activation switches immediately without disabling the button', () => {
  const h = harness();
  for (const zone of ['ET', 'GMT+8', 'ET', 'GMT+8']) {
    h.click();
    assert.equal(h.zone(), zone);
    assert.equal(h.element('timezoneBtn').disabled, false);
    assertLabels(h, zone, zone === 'ET' ? '08:34:56' : '20:34:56');
    assert.equal(h.saved.get('pmac_tz'), zone);
  }
  assert.equal(h.calls.refresh, 4);
  assert.equal(h.calls.positions, 4);
  assert.equal(h.calls.persistence.length, 4);
});

test('a saved Eastern timezone is labelled correctly before the first toggle', () => {
  const h = harness({ savedZone: 'ET' });
  assertLabels(h, 'ET', '08:34:56');
  h.click();
  assertLabels(h, 'GMT+8', '20:34:56');
  assert.equal(h.saved.get('pmac_tz'), 'GMT+8');
});

test('blocked browser storage does not prevent immediate switching', () => {
  const h = harness({ blockedStorage: true });
  assert.doesNotThrow(h.click);
  assertLabels(h, 'ET', '08:34:56');
  assert.equal(h.element('timezoneBtn').disabled, false);
  assert.doesNotThrow(h.click);
  assertLabels(h, 'GMT+8', '20:34:56');
});
