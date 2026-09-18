const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('  // ---------- shared Columns / Values sidebar ----------');
const end = html.indexOf('  // scrolling any other way', start);
assert.ok(start !== -1 && end > start, 'Production sidebar controller must be present');
const source = html.slice(start, end);

function harness({ saved = {}, positions = false, blockedStorage = false } = {}) {
  const elements = new Map();
  const storage = new Map(Object.entries(saved));
  const focus = [];
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(id === 'tabPositions' && positions ? ['on'] : []);
      elements.set(id, {
        hidden: false, inert: false, attributes: new Map(), listeners: new Map(),
        classList: {
          contains: value => classes.has(value),
          toggle(value, force) { if (force) classes.add(value); else classes.delete(value); }
        },
        setAttribute(key, value) { this.attributes.set(key, String(value)); },
        getAttribute(key) { return this.attributes.get(key); },
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        querySelector() { return { focus() { focus.push(id); } }; }
      });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    $: element,
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage blocked'); storage.set(key, value); }
    }
  });
  vm.runInContext(source, context);
  return { element, storage, focus, click(id, detail = 1) { element(id).listeners.get('click')({ detail }); } };
}

function assertPane(h, active) {
  assert.equal(h.element('sideBar').classList.contains('open'), !!active);
  for (const [name, panel, tab] of [['columns', 'columnsPanel', 'sideTab'], ['values', 'valuesPanel', 'valuesTab']]) {
    assert.equal(h.element(panel).hidden, active !== name, `${name} visibility`);
    assert.equal(h.element(panel).inert, active !== name, `${name} keyboard interaction`);
    assert.equal(h.element(tab).getAttribute('aria-expanded'), String(active === name));
  }
}

test('sidebar swaps between Columns and Values, and clicking the current tab closes it', () => {
  const h = harness();
  assertPane(h, null);
  h.click('sideTab');
  assertPane(h, 'columns');
  h.click('valuesTab');
  assertPane(h, 'values');
  assert.equal(h.storage.get('pmac_sidebar_section'), 'values');
  h.click('valuesTab');
  assertPane(h, null);
  assert.equal(h.storage.get('pmac_cols_open'), '');
  h.click('sideTab');
  assertPane(h, 'columns');
});

test('stored open Values preference is restored; older or unknown preferences use Columns', () => {
  assertPane(harness({ saved: { pmac_cols_open: '1', pmac_sidebar_section: 'values' } }), 'values');
  assertPane(harness({ saved: { pmac_cols_open: '1' } }), 'columns');
  assertPane(harness({ saved: { pmac_cols_open: '1', pmac_sidebar_section: 'obsolete' } }), 'columns');
  assertPane(harness({ saved: { pmac_cols_open: '', pmac_sidebar_section: 'values' } }), null);
});

test('keyboard opening enters the active view controls; mouse opening keeps focus unchanged', () => {
  const activity = harness();
  activity.click('valuesTab', 0);
  assert.deepEqual(activity.focus, ['activityValues']);
  activity.click('sideTab', 0);
  assert.deepEqual(activity.focus, ['activityValues', 'colsList']);
  activity.click('valuesTab', 1);
  assert.deepEqual(activity.focus, ['activityValues', 'colsList']);
  const positions = harness({ positions: true });
  positions.click('valuesTab', 0);
  assert.deepEqual(positions.focus, ['positionValues']);
});

test('sidebar remains usable without browser storage', () => {
  const h = harness({ blockedStorage: true });
  assertPane(h, null);
  assert.doesNotThrow(() => h.click('valuesTab'));
  assertPane(h, 'values');
  h.click('sideTab');
  assertPane(h, 'columns');
});
