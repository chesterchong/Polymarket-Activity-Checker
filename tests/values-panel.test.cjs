const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ValuesMath = require('../assets/values-math.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'values-panel.js'), 'utf8');
const STORAGE_KEY = 'pmac_activity_grid_values';
const LEGACY_KEY = 'pmac_activity_row_groups';
const plain = value => JSON.parse(JSON.stringify(value));

function harness(saved = [{field: 'usdcSize', op: 'sum'}]) {
  const document = {activeElement: null};
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.listeners = new Map();
      this.className = '';
      this.textContent = '';
      this.value = '';
      this.classList = {
        contains: value => this.className.split(/\s+/).includes(value),
        add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
        remove: (...values) => { this.className = this.className.split(/\s+/).filter(value => !values.includes(value)).join(' '); },
        toggle: (value, on) => {
          const enabled = on ?? !this.classList.contains(value);
          this.classList[enabled ? 'add' : 'remove'](value);
          return enabled;
        }
      };
    }
    append(...nodes) {
      nodes.forEach(node => { node.parent = this; this.children.push(node); });
    }
    replaceChildren(...nodes) {
      this.children.forEach(node => { node.parent = null; });
      this.children = [];
      this.append(...nodes);
      if (this.tagName === 'SELECT') this.value = this.children[0]?.value ?? '';
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    emit(name, detail = {}) {
      const event = {target: this, preventDefault() { this.defaultPrevented = true; }, ...detail};
      for (const listener of this.listeners.get(name) ?? []) listener(event);
      return event;
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; }
    querySelectorAll(selector) {
      const selectors = selector.split(',');
      const matches = node => selectors.some(part => {
        if (part.startsWith('.')) return node.classList.contains(part.slice(1));
        const role = part.match(/^\[data-role="([^"]+)"\]$/);
        return role && node.dataset.role === role[1];
      });
      const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
      return selector === '*' ? descendants : descendants.filter(matches);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  }
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_, tag) => new Element(tag);
  const storage = new Map([[STORAGE_KEY, JSON.stringify(saved)], [LEGACY_KEY, '["1","3"]']]);
  const reads = [], writes = [], callbacks = [];
  const context = vm.createContext({
    document,
    window: {ValuesMath},
    localStorage: {
      getItem(key) { reads.push(key); return storage.get(key) ?? null; },
      setItem(key, value) { writes.push(key); storage.set(key, value); }
    }
  });
  vm.runInContext(source, context);
  const container = document.createElement('aside');
  const panel = context.window.ValuesPanel.create({
    container,
    storageKey: STORAGE_KEY,
    groupStorageKey: LEGACY_KEY,
    groupFields: [{id: '1', label: 'Wallet'}],
    fields: [
      {id: 'usdcSize', label: 'USDC'},
      {id: 'price', label: 'Price', defaultOp: 'avg'},
      {id: 'feeEstimate', label: 'Fee (est.)'}
    ],
    defaults: [{field: 'usdcSize', op: 'sum'}],
    onConfigChange: config => callbacks.push(config)
  });
  const rows = () => container.querySelectorAll('.vp-row');
  const row = id => rows().find(node => node.dataset.id === id);
  return {panel, container, document, storage, reads, writes, callbacks, rows, row};
}

test('restores saved values and operations without reading legacy groups or firing a callback', () => {
  const saved = [{field: 'feeEstimate', op: 'max'}, {field: 'price', op: 'avg'}];
  const h = harness(saved);
  assert.deepEqual(plain(h.panel.getConfig()), saved);
  assert.deepEqual(h.rows().map(row => row.dataset.id), ['feeEstimate', 'price']);
  assert.equal(h.row('feeEstimate').querySelector('.vp-operation').value, 'max');
  assert.equal(h.row('price').querySelector('.vp-operation').value, 'avg');
  assert.deepEqual(h.reads, [STORAGE_KEY]);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.callbacks, []);
  assert.equal(h.panel.getGroups, undefined);
  assert.equal(h.container.querySelectorAll('.vp-title').length, 1);
  assert.equal(h.container.querySelector('.vp-title').textContent, 'Values');
});

test('add, operation change, keyboard reorder and removal persist copied configuration', () => {
  const h = harness();
  const add = h.container.querySelector('.vp-add-select');
  add.value = 'price';
  add.emit('change');
  assert.deepEqual(plain(h.panel.getConfig()), [
    {field: 'usdcSize', op: 'sum'}, {field: 'price', op: 'avg'}
  ]);
  const operation = h.row('price').querySelector('.vp-operation');
  assert.equal(h.document.activeElement, operation);
  operation.value = 'max';
  operation.emit('change');
  const event = h.row('price').querySelector('.vp-handle').emit('keydown', {altKey: true, key: 'ArrowUp'});
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(h.rows().map(row => row.dataset.id), ['price', 'usdcSize']);
  assert.equal(h.document.activeElement, h.row('price').querySelector('.vp-handle'));
  h.row('usdcSize').querySelector('.vp-remove').emit('click');
  const expected = [{field: 'price', op: 'max'}];
  assert.deepEqual(plain(h.panel.getConfig()), expected);
  assert.deepEqual(JSON.parse(h.storage.get(STORAGE_KEY)), expected);
  assert.deepEqual(h.writes, Array(4).fill(STORAGE_KEY));
  assert.equal(h.callbacks.length, 4);
  assert.deepEqual(plain(h.callbacks[0]), [{field: 'usdcSize', op: 'sum'}, {field: 'price', op: 'avg'}]);
  h.callbacks.at(-1)[0].op = 'min';
  const readback = h.panel.getConfig();
  readback[0].field = 'feeEstimate';
  assert.deepEqual(plain(h.panel.getConfig()), expected);
  assert.equal(h.storage.get(LEGACY_KEY), '["1","3"]');
});

test('live refresh preserves the operation selector and its focus', () => {
  const h = harness([{field: 'price', op: 'avg'}]);
  const operation = h.row('price').querySelector('.vp-operation');
  operation.focus();
  h.panel.refresh();
  h.panel.refresh();
  assert.equal(h.row('price').querySelector('.vp-operation'), operation);
  assert.equal(h.document.activeElement, operation);
  assert.equal(operation.value, 'avg');
  assert.deepEqual(h.callbacks, []);
  assert.deepEqual(h.writes, []);
});
