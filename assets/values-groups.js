(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ValuesGroups = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  function build(rows, groupIds, getGroupValue) {
    if (!groupIds.length) return [];

    function level(members, depth, parentPath) {
      const field = groupIds[depth];
      const groups = new Map();
      for (const row of members) {
        const value = getGroupValue(row, field);
        const missing = value?.key == null
          || (typeof value.key === 'number' && !Number.isFinite(value.key));
        const key = missing ? null : value.key;
        const path = parentPath.concat([[field, key]]);
        const pathKey = JSON.stringify(path);
        let group = groups.get(pathKey);
        if (!group) {
          group = {
            key: pathKey,
            label: missing ? '—' : String(value.label ?? key),
            field,
            rows: [],
            children: []
          };
          groups.set(pathKey, group);
        }
        group.rows.push(row);
      }
      if (depth + 1 < groupIds.length) {
        for (const group of groups.values()) {
          group.children = level(group.rows, depth + 1, JSON.parse(group.key));
        }
      }
      return Array.from(groups.values());
    }

    return level(rows, 0, []);
  }

  return {build};
});
