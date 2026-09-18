(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ValuesMath = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  const operations = new Set(['sum', 'avg', 'min', 'max', 'count']);

  function finiteNumber(value) {
    if (typeof value === 'string' && value.trim() !== '') value = Number(value);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  // Neumaier compensation preserves small values when profits and losses cancel.
  function compensatedSum(values, scale) {
    let sum = 0;
    let correction = 0;
    for (const value of values) {
      const next = value / scale;
      const combined = sum + next;
      correction += Math.abs(sum) >= Math.abs(next)
        ? (sum - combined) + next
        : (next - combined) + sum;
      sum = combined;
    }
    return sum + correction;
  }

  function aggregate(samples, operation) {
    const op = operations.has(operation) ? operation : 'sum';
    const values = [];
    let total = 0;
    let missing = 0;
    let pending = 0;
    let min = Infinity;
    let max = -Infinity;
    let magnitude = 0;

    for (const sample of Array.isArray(samples) ? samples : []) {
      const wrapped = sample !== null && typeof sample === 'object';
      if (wrapped && sample.status === 'skip') continue;
      total += 1;
      if (wrapped && sample.status === 'pending') {
        pending += 1;
        continue;
      }
      if (wrapped && sample.status !== 'ready') {
        missing += 1;
        continue;
      }
      const value = finiteNumber(wrapped ? sample.value : sample);
      if (value === null) {
        missing += 1;
        continue;
      }
      values.push(value);
      min = Math.min(min, value);
      max = Math.max(max, value);
      magnitude = Math.max(magnitude, Math.abs(value));
    }

    const count = values.length;
    let value = null;
    if (op === 'count') {
      value = count;
    } else if (!count) {
      if (op === 'sum' && total === 0) value = 0;
    } else if (op === 'min') {
      value = min;
    } else if (op === 'max') {
      value = max;
    } else {
      const sum = compensatedSum(values, 1);
      if (Number.isFinite(sum)) {
        value = op === 'avg' ? sum / count : sum;
      } else {
        // Rescale only after overflow, so a representable average or cancelled
        // total still works even when the intermediate sum exceeds MAX_VALUE.
        const scaled = compensatedSum(values, magnitude || 1);
        value = (op === 'avg' ? scaled / count : scaled) * magnitude;
      }
      // An unrepresentable total is unknown, never Infinity or NaN in the UI.
      if (!Number.isFinite(value)) value = null;
    }

    if (Object.is(value, -0)) value = 0;
    return {value, count, total, missing, pending, partial: missing > 0 || pending > 0};
  }

  // A deliberately empty selection stays empty. Malformed storage falls back
  // to defaults; unknown operations use sum and duplicate fields keep the first.
  function normalizeConfig(config, allowedFields, defaults) {
    const allowed = new Set(Array.isArray(allowedFields) || allowedFields instanceof Set
      ? allowedFields : []);
    const source = Array.isArray(config) ? config : (Array.isArray(defaults) ? defaults : []);
    const seen = new Set();
    const result = [];
    for (const item of source) {
      if (!item || typeof item !== 'object' || typeof item.field !== 'string'
        || !allowed.has(item.field) || seen.has(item.field)) continue;
      seen.add(item.field);
      result.push({field: item.field, op: operations.has(item.op) ? item.op : 'sum'});
    }
    return result;
  }

  return {aggregate, normalizeConfig};
});
