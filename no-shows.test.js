const test = require('node:test');
const assert = require('node:assert/strict');
const { isNoShowDue } = require('../src/no-shows');

test('scheduled appointment is due for no-show only after the grace period', () => {
  const now = new Date(2026, 8, 26, 10, 16);
  const appointment = { date: '2026-09-26', timeSlot: '10:00' };

  assert.equal(isNoShowDue(appointment, now, 15), true);
  assert.equal(isNoShowDue(appointment, new Date(2026, 8, 26, 10, 14), 15), false);
});

test('attended appointments and emergency immediate slots are never no-shows', () => {
  const now = new Date(2026, 8, 26, 10, 30);

  assert.equal(isNoShowDue({ date: '2026-09-26', timeSlot: '10:00', checkedIn: true }, now), false);
  assert.equal(isNoShowDue({ date: '2026-09-26', timeSlot: 'Immediate — Emergency Department (24/7)' }, now), false);
});
