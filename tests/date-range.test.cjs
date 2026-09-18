const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {parseDate, addDays, monthStart, shiftMonth, calendarDays, selectDate, todayInZone} = require('../assets/date-range.js');

test('range selection stays incomplete after the first date and normalizes reverse selections', () => {
  const first = selectDate({start:'', end:''}, '2026-09-18');
  assert.deepEqual(first, {start:'2026-09-18', end:''});
  assert.deepEqual(selectDate(first, '2026-09-14'), {start:'2026-09-14', end:'2026-09-18'});
  assert.deepEqual(first, {start:'2026-09-18', end:''});
});

test('a completed range can be replaced and a single-day range can be applied', () => {
  const next = selectDate({start:'2026-09-14', end:'2026-09-18'}, '2026-10-01');
  assert.deepEqual(next, {start:'2026-10-01', end:''});
  assert.deepEqual(selectDate(next, '2026-10-01'), {start:'2026-10-01', end:'2026-10-01'});
});

test('range selection works across years', () => {
  const first = selectDate({start:'', end:''}, '2027-01-03');
  assert.deepEqual(selectDate(first, '2026-12-29'), {start:'2026-12-29', end:'2027-01-03'});
});

test('calendar navigation clamps end-of-month dates and preserves leap days', () => {
  assert.equal(shiftMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftMonth('2025-01-31', 1), '2025-02-28');
  assert.equal(shiftMonth('2024-02-29', 12), '2025-02-28');
  assert.equal(shiftMonth('2026-01-31', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('calendar uses Monday-first weeks and includes every date exactly once', () => {
  const september = calendarDays('2026-09-18');
  assert.equal(september.length, 42);
  assert.equal(september[0], '');
  assert.equal(september[1], '2026-09-01');
  assert.equal(september[30], '2026-09-30');
  assert.equal(september.filter(Boolean).length, 30);
  assert.equal(new Set(september.filter(Boolean)).size, 30);
  assert.equal(calendarDays('2026-02-01')[6], '2026-02-01');
  assert.equal(calendarDays('2026-06-01')[0], '2026-06-01');
});

test('today follows the selected filter timezone instead of the browser timezone', () => {
  const now = new Date('2026-09-18T01:00:00Z');
  assert.equal(todayInZone('GMT+8', now), '2026-09-18');
  assert.equal(todayInZone('ET', now), '2026-09-17');
  assert.equal(todayInZone('ET', new Date('2026-03-08T04:30:00Z')), '2026-03-07');
  assert.equal(todayInZone('ET', new Date('2026-03-09T04:30:00Z')), '2026-03-09');
});

test('Today selects one complete day in the active timezone and waits for Apply', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/date-range.js'), 'utf8');
  const selectTodaySource = source.slice(source.indexOf('  function selectToday(){'), source.indexOf('  dialog.querySelector(".dr-today")'));
  const now = new Date('2026-10-01T01:00:00Z');
  for(const [timezone, expected] of [['GMT+8', '2026-10-01'], ['ET', '2026-09-30']]){
    let renders = 0;
    const context = vm.createContext({
      timezone,
      todayInZone: zone=>todayInZone(zone, now),
      monthStart,
      draft:{start:'2026-02-10', end:''},
      firstMonth:'2026-02-01', focusDay:'2026-02-10', hoverDay:'2026-02-20',
      from:{value:'2026-01-04'}, to:{value:'2026-01-09'}, dialog:{hidden:false},
      renderMonths(){ renders++; },
    });
    vm.runInContext(selectTodaySource + '\nselectToday();', context);
    assert.equal(context.draft.start, expected);
    assert.equal(context.draft.end, expected);
    assert.equal(context.firstMonth, monthStart(expected));
    assert.equal(context.focusDay, expected);
    assert.equal(context.hoverDay, '');
    assert.equal(renders, 1);
    assert.equal(context.from.value, '2026-01-04');
    assert.equal(context.to.value, '2026-01-09');
    assert.equal(context.dialog.hidden, false);
  }
});

test('malformed or impossible calendar dates do not change a selection', () => {
  const range = {start:'2026-09-18', end:''};
  for(const value of ['', '2026-02-29', '2026-04-31', '2026-13-01', '09/18/2026']){
    assert.equal(parseDate(value), null);
    assert.deepEqual(selectDate(range, value), range);
  }
  assert.ok(parseDate('2024-02-29'));
});
