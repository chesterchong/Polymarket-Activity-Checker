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
      path.setAttribute('d', kind === 'group' ? 'M2 4h2m2 0h8M2 8h2m2 0h8M2 12h2m2 0h8' : 'M4 4l8 8M12 4l-8 8');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      svg.append(path);
    }
    return svg;
  }

  function readStorage(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
  }

  function create({ container, fields, defaults, storageKey, groupFields = [], groupStorageKey = storageKey + '_groups', onConfigChange }) {
    const fieldMap = new Map(fields.map(field => [field.id, field]));
    const groupMap = new Map(groupFields.map(field => [field.id, field]));
    let config = window.ValuesMath.normalizeConfig(readStorage(storageKey), [...fieldMap.keys()], defaults);
    const savedGroups = readStorage(groupStorageKey);
    let groups = Array.isArray(savedGroups) ? [...new Set(savedGroups.filter(id => groupMap.has(id)))] : [];
    let dragColumn = null;
    let dragging = null;
    container.classList.add('vp-panel');
    const announcer = element('span', 'vp-sr-only');
    announcer.setAttribute('role', 'status');
    const zones = {};

    for (const kind of ['group', 'value']) {
      const section = element('section', 'vp-section');
      const heading = element('div', 'vp-heading');
      heading.append(kind === 'group' ? icon('group') : element('span', 'vp-sigma', 'Σ'));
      heading.append(element('h3', 'vp-title', kind === 'group' ? 'Row groups' : 'Values'));
      const list = element('div', 'vp-list');
      const drop = element('div', 'vp-drop');
      const select = element('select', 'vp-add-select');
      select.setAttribute('aria-label', kind === 'group' ? 'Add row group' : 'Add value');
      drop.append(select);
      section.append(heading, list, drop);
      zones[kind] = { section, list, drop, select };
    }
    container.replaceChildren(zones.group.section, zones.value.section, announcer);

    function getConfig() { return config.map(item => ({ ...item })); }
    function getGroups() { return groups.slice(); }
    function persist() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(config));
        localStorage.setItem(groupStorageKey, JSON.stringify(groups));
      } catch (_) { /* Storage is optional. */ }
      if (onConfigChange) onConfigChange(getConfig(), getGroups());
    }
    function announce(text) { announcer.textContent = text; }
    function ids(kind) { return kind === 'group' ? groups : config.map(item => item.field); }
    function mapFor(kind) { return kind === 'group' ? groupMap : fieldMap; }
    function externalId(kind, column = dragColumn) { return column ? (kind === 'group' ? column.id : column.valueField) : null; }
    function accepts(kind, id) { return mapFor(kind).has(id) && !ids(kind).includes(id); }

    function render(focusKind, focusId, focusRole = 'handle') {
      for (const kind of ['group', 'value']) {
        const zone = zones[kind];
        zone.list.replaceChildren();
        for (const id of ids(kind)) {
          const field = mapFor(kind).get(id);
          const row = element('div', 'vp-row');
          row.dataset.id = id;
          const handle = element('button', 'vp-handle');
          handle.type = 'button';
          handle.draggable = true;
          handle.dataset.role = 'handle';
          handle.setAttribute('aria-label', `Reorder ${field.label} ${kind === 'group' ? 'group' : 'value'}`);
          handle.title = 'Drag to reorder · Alt + ↑ / ↓';
          handle.append(icon('grip'));
          const label = element('span', 'vp-label', field.label);
          label.title = field.label;
          row.append(handle, label);
          if (kind === 'value') {
            const item = config.find(entry => entry.field === id);
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
            row.append(operation);
          }
          const remove = element('button', 'vp-remove');
          remove.type = 'button';
          remove.setAttribute('aria-label', `Remove ${field.label} ${kind === 'group' ? 'group' : 'value'}`);
          remove.title = `Remove ${field.label}`;
          remove.append(icon('close'));
          remove.addEventListener('click', () => {
            const at = ids(kind).indexOf(id);
            if (kind === 'group') groups = groups.filter(value => value !== id);
            else config = config.filter(item => item.field !== id);
            persist();
            const next = ids(kind)[Math.min(at, ids(kind).length - 1)];
            render(kind, next);
            if (!next) zone.select.focus();
            announce(`${field.label} removed`);
          });
          handle.addEventListener('keydown', event => {
            if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const from = ids(kind).indexOf(id);
            move(kind, from, from + (event.key === 'ArrowUp' ? -1 : 1));
          });
          handle.addEventListener('dragstart', event => {
            dragging = { kind, id };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(ORDER_TYPE, JSON.stringify({ kind, id, storageKey }));
            row.classList.add('is-dragging');
          });
          handle.addEventListener('dragend', clearDrag);
          row.addEventListener('dragover', event => {
            if (!dragging || dragging.kind !== kind || dragging.id === id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            zone.list.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
            row.classList.add('is-drop-target');
          });
          row.addEventListener('dragleave', event => {
            if (!row.contains(event.relatedTarget)) row.classList.remove('is-drop-target');
          });
          row.addEventListener('drop', event => {
            if (!dragging || dragging.kind !== kind) return;
            event.preventDefault();
            move(kind, ids(kind).indexOf(dragging.id), ids(kind).indexOf(id));
            clearDrag();
          });
          row.append(remove);
          zone.list.append(row);
        }
        const remaining = [...mapFor(kind).values()].filter(field => !ids(kind).includes(field.id));
        const placeholder = element('option', '', kind === 'group' ? 'Drop a column here to group rows' : 'Drop another numeric column');
        placeholder.value = '';
        zone.select.replaceChildren(placeholder);
        remaining.forEach(field => {
          const option = element('option', '', field.label);
          option.value = field.id;
          zone.select.append(option);
        });
        zone.select.disabled = !remaining.length;
        zone.drop.classList.toggle('is-full', !remaining.length);
      }
      if (focusId) {
        const row = Array.from(zones[focusKind].list.children).find(node => node.dataset.id === focusId);
        row?.querySelector(`[data-role="${focusRole}"]`)?.focus();
      }
      markDrag();
    }

    function move(kind, from, to) {
      const items = kind === 'group' ? groups : config;
      if (from < 0 || to < 0 || to >= items.length || from === to) return;
      const [item] = items.splice(from, 1);
      items.splice(to, 0, item);
      const id = kind === 'group' ? item : item.field;
      persist();
      render(kind, id);
      announce(`${mapFor(kind).get(id).label}, position ${to + 1} of ${items.length}`);
    }

    function add(kind, id) {
      if (!accepts(kind, id)) return false;
      const field = mapFor(kind).get(id);
      if (kind === 'group') groups.push(id);
      else config.push({ field: id, op: OPERATIONS.includes(field.defaultOp) ? field.defaultOp : 'sum' });
      persist();
      render(kind, id, kind === 'value' ? 'operation' : 'handle');
      announce(`${field.label} added`);
      return true;
    }

    function markDrag() {
      for (const kind of ['group', 'value']) {
        zones[kind].drop.classList.toggle('can-drop', accepts(kind, externalId(kind)));
        if (!dragColumn) zones[kind].drop.classList.remove('is-drag-over');
      }
    }
    function clearDrag() {
      dragging = null;
      container.querySelectorAll('.is-dragging,.is-drop-target').forEach(node => node.classList.remove('is-dragging', 'is-drop-target'));
      for (const zone of Object.values(zones)) zone.drop.classList.remove('is-drag-over');
    }
    for (const kind of ['group', 'value']) {
      const zone = zones[kind];
      zone.select.addEventListener('change', () => { if (zone.select.value) add(kind, zone.select.value); });
      zone.drop.addEventListener('dragover', event => {
        const types = Array.from(event.dataTransfer?.types || []);
        if (dragging || (dragColumn ? !accepts(kind, externalId(kind)) : !types.includes(COLUMN_TYPE) && !(kind === 'value' && types.includes(FIELD_TYPE)))) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        zone.drop.classList.add('is-drag-over');
      });
      zone.drop.addEventListener('dragleave', event => {
        if (!zone.drop.contains(event.relatedTarget)) zone.drop.classList.remove('is-drag-over');
      });
      zone.drop.addEventListener('drop', event => {
        event.preventDefault();
        let column = dragColumn;
        try { column = JSON.parse(event.dataTransfer.getData(COLUMN_TYPE)); } catch (_) {
          if (kind === 'value') {
            try { column = { valueField: JSON.parse(event.dataTransfer.getData(FIELD_TYPE)).field }; } catch (_) { /* Keep known source. */ }
          }
        }
        const id = externalId(kind, column);
        dragColumn = null;
        markDrag();
        add(kind, id);
      });
    }

    render();
    return {
      refresh() {},
      setActive() {},
      addField(fieldId) { return add('value', fieldId); },
      addGroup(fieldId) { return add('group', fieldId); },
      setDragField(fieldId) { dragColumn = fieldId === null ? null : { valueField: fieldId }; markDrag(); },
      setDragColumn(column) { dragColumn = column ? { id: column.id, valueField: column.valueField } : null; markDrag(); },
      hasFields() { return config.length > 0; },
      getConfig,
      getGroups
    };
  }

  window.ValuesPanel = { create };
})();
