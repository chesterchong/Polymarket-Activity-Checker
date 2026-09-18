(function () {
  'use strict';

  const COLUMN_TYPE = 'application/x-pmac-column';
  const FIELD_TYPE = 'application/x-pmac-value-column';
  const ORDER_TYPE = 'application/x-pmac-panel-order';
  const OPERATIONS = ['sum', 'avg', 'min', 'max', 'count'];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    if (kind === 'grip') {
      [4, 8, 12].forEach(y => [5, 10].forEach(x => {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', x);
        dot.setAttribute('cy', y);
        dot.setAttribute('r', '1');
        dot.setAttribute('fill', 'currentColor');
        svg.append(dot);
      }));
    } else {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      svg.append(path);
    }
    return svg;
  }

  function create({ container, fields, defaults, storageKey, onConfigChange }) {
    const fieldMap = new Map(fields.map(field => [field.id, field]));
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch (_) { /* Storage is optional. */ }
    let config = window.ValuesMath.normalizeConfig(saved, [...fieldMap.keys()], defaults);
    let dragField = null;
    let dragging = null;
    container.classList.add('vp-panel');
    const heading = element('div', 'vp-heading');
    const sigma = element('span', 'vp-sigma', 'Σ');
    sigma.setAttribute('aria-hidden', 'true');
    heading.append(sigma, element('h3', 'vp-title', 'Values'));
    const list = element('div', 'vp-list');
    const drop = element('div', 'vp-drop');
    const addSelect = element('select', 'vp-add-select');
    addSelect.setAttribute('aria-label', 'Add value');
    drop.append(addSelect);
    const announcer = element('span', 'vp-sr-only');
    announcer.setAttribute('role', 'status');
    container.replaceChildren(heading, list, drop, announcer);

    function getConfig() { return config.map(item => ({ ...item })); }
    function persist() {
      try { localStorage.setItem(storageKey, JSON.stringify(config)); } catch (_) { /* Keep this session usable. */ }
      if (onConfigChange) onConfigChange(getConfig());
    }
    function accepts(id) { return fieldMap.has(id) && !config.some(item => item.field === id); }
    function announce(text) { announcer.textContent = text; }

    function render(focusId, focusRole = 'handle') {
      list.replaceChildren();
      for (const item of config) {
        const id = item.field, field = fieldMap.get(id);
        const row = element('div', 'vp-row');
        row.dataset.id = id;
        const handle = element('button', 'vp-handle');
        handle.type = 'button';
        handle.draggable = true;
        handle.dataset.role = 'handle';
        handle.setAttribute('aria-label', `Reorder ${field.label} value`);
        handle.title = 'Drag to reorder · Alt + ↑ / ↓';
        handle.append(icon('grip'));
        const label = element('span', 'vp-label', field.label);
        label.title = field.label;
        const operation = element('select', 'vp-operation');
        operation.dataset.role = 'operation';
        operation.setAttribute('aria-label', `${field.label} aggregation`);
        OPERATIONS.forEach(op => {
          const option = element('option', '', op);
          option.value = op;
          operation.append(option);
        });
        operation.value = item.op;
        operation.addEventListener('change', () => { item.op = operation.value; persist(); });
        const remove = element('button', 'vp-remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${field.label} value`);
        remove.title = `Remove ${field.label}`;
        remove.append(icon('close'));
        remove.addEventListener('click', () => {
          const at = config.indexOf(item);
          config.splice(at, 1);
          persist();
          const next = config[Math.min(at, config.length - 1)]?.field;
          render(next);
          if (!next) addSelect.focus();
          announce(`${field.label} removed`);
        });
        handle.addEventListener('keydown', event => {
          if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const from = config.indexOf(item);
          move(from, from + (event.key === 'ArrowUp' ? -1 : 1));
        });
        handle.addEventListener('dragstart', event => {
          dragging = id;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(ORDER_TYPE, JSON.stringify({ id, storageKey }));
          row.classList.add('is-dragging');
        });
        handle.addEventListener('dragend', clearDrag);
        row.addEventListener('dragover', event => {
          if (!dragging || dragging === id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          list.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
          row.classList.add('is-drop-target');
        });
        row.addEventListener('dragleave', event => {
          if (!row.contains(event.relatedTarget)) row.classList.remove('is-drop-target');
        });
        row.addEventListener('drop', event => {
          if (!dragging) return;
          event.preventDefault();
          move(config.findIndex(value => value.field === dragging), config.indexOf(item));
          clearDrag();
        });
        row.append(handle, label, operation, remove);
        list.append(row);
      }
      const remaining = fields.filter(field => accepts(field.id));
      const placeholder = element('option', '', remaining.length ? 'Add a numeric column' : 'All values added');
      placeholder.value = '';
      addSelect.replaceChildren(placeholder);
      remaining.forEach(field => {
        const option = element('option', '', field.label);
        option.value = field.id;
        addSelect.append(option);
      });
      addSelect.disabled = !remaining.length;
      drop.classList.toggle('is-full', !remaining.length);
      if (focusId) {
        const row = Array.from(list.children).find(node => node.dataset.id === focusId);
        row?.querySelector(`[data-role="${focusRole}"]`)?.focus();
      }
      markDrag();
    }

    function move(from, to) {
      if (from < 0 || to < 0 || to >= config.length || from === to) return;
      const [item] = config.splice(from, 1);
      config.splice(to, 0, item);
      persist();
      render(item.field);
      announce(`${fieldMap.get(item.field).label}, position ${to + 1} of ${config.length}`);
    }
    function addField(id) {
      if (!accepts(id)) return false;
      const field = fieldMap.get(id);
      config.push({ field: id, op: OPERATIONS.includes(field.defaultOp) ? field.defaultOp : 'sum' });
      persist();
      render(id, 'operation');
      announce(`${field.label} added`);
      return true;
    }
    function markDrag() {
      drop.classList.toggle('can-drop', accepts(dragField));
      if (!dragField) drop.classList.remove('is-drag-over');
    }
    function clearDrag() {
      dragging = null;
      list.querySelectorAll('.is-dragging,.is-drop-target').forEach(node => node.classList.remove('is-dragging', 'is-drop-target'));
      drop.classList.remove('is-drag-over');
    }
    addSelect.addEventListener('change', () => { if (addSelect.value) addField(addSelect.value); });
    drop.addEventListener('dragover', event => {
      const types = Array.from(event.dataTransfer?.types || []);
      if (dragging || (dragField ? !accepts(dragField) : !types.includes(COLUMN_TYPE) && !types.includes(FIELD_TYPE))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      drop.classList.add('is-drag-over');
    });
    drop.addEventListener('dragleave', event => {
      if (!drop.contains(event.relatedTarget)) drop.classList.remove('is-drag-over');
    });
    drop.addEventListener('drop', event => {
      event.preventDefault();
      let field = dragField;
      try { field = JSON.parse(event.dataTransfer.getData(COLUMN_TYPE)).valueField; } catch (_) {
        try { field = JSON.parse(event.dataTransfer.getData(FIELD_TYPE)).field; } catch (_) { /* Keep known source. */ }
      }
      dragField = null;
      markDrag();
      addField(field);
    });

    render();
    return {
      refresh() {}, setActive() {},
      addField,
      setDragField(fieldId) { dragField = fieldId; markDrag(); },
      setDragColumn(column) { dragField = column?.valueField || null; markDrag(); },
      hasFields() { return config.length > 0; },
      getConfig
    };
  }
  window.ValuesPanel = { create };
})();
