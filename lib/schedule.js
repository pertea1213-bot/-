const db = require('./db');

function getSettings() {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  return {
    businessStart: row.business_start,
    businessEnd: row.business_end,
    slotMinutes: row.slot_minutes,
    lunchStart: row.lunch_start,
    lunchEnd: row.lunch_end,
    closedWeekdays: JSON.parse(row.closed_weekdays),
    consultingTypes: JSON.parse(row.consulting_types),
  };
}

function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch };
  db.prepare(`
    UPDATE settings SET
      business_start = ?, business_end = ?, slot_minutes = ?,
      lunch_start = ?, lunch_end = ?, closed_weekdays = ?, consulting_types = ?
    WHERE id = 1
  `).run(
    next.businessStart, next.businessEnd, next.slotMinutes,
    next.lunchStart, next.lunchEnd,
    JSON.stringify(next.closedWeekdays), JSON.stringify(next.consultingTypes)
  );
  return getSettings();
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function isValidDateStr(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(new Date(`${dateStr}T00:00:00`).getTime());
}

// Local calendar-day comparison (avoids UTC off-by-one issues).
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSlotsForDate(dateStr) {
  const settings = getSettings();
  const weekday = new Date(`${dateStr}T00:00:00`).getDay();

  if (settings.closedWeekdays.includes(weekday)) {
    return { slots: [], closed: true, reason: 'closed_day' };
  }
  if (dateStr < todayStr()) {
    return { slots: [], closed: true, reason: 'past_date' };
  }

  const start = toMinutes(settings.businessStart);
  const end = toMinutes(settings.businessEnd);
  const lunchStart = settings.lunchStart ? toMinutes(settings.lunchStart) : null;
  const lunchEnd = settings.lunchEnd ? toMinutes(settings.lunchEnd) : null;

  const booked = new Set(
    db.prepare(`SELECT time FROM appointments WHERE date = ? AND status != 'cancelled'`)
      .all(dateStr)
      .map((r) => r.time)
  );

  const slots = [];
  for (let t = start; t + settings.slotMinutes <= end; t += settings.slotMinutes) {
    if (lunchStart !== null && lunchEnd !== null && t < lunchEnd && t + settings.slotMinutes > lunchStart) {
      continue; // overlaps lunch break
    }
    const time = toHHMM(t);
    slots.push({ time, available: !booked.has(time) });
  }

  return { slots, closed: false };
}

module.exports = {
  getSettings,
  updateSettings,
  getSlotsForDate,
  isValidDateStr,
  todayStr,
};
