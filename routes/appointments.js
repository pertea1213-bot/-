const express = require('express');
const db = require('../lib/db');
const { getSlotsForDate, isValidDateStr, getSettings, todayStr } = require('../lib/schedule');

const router = express.Router();

const PHONE_RE = /^[0-9-+ ]{7,20}$/;

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    consultingType: row.consulting_type,
    date: row.date,
    time: row.time,
    memo: row.memo,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/availability?date=YYYY-MM-DD
router.get('/availability', (req, res) => {
  const { date } = req.query;
  if (!isValidDateStr(date)) {
    return res.status(400).json({ error: '유효한 날짜(YYYY-MM-DD)를 입력해주세요.' });
  }
  const result = getSlotsForDate(date);
  res.json(result);
});

// GET /api/consulting-types
router.get('/consulting-types', (req, res) => {
  res.json({ types: getSettings().consultingTypes });
});

// POST /api/appointments  (public booking)
router.post('/appointments', (req, res) => {
  const { name, phone, email, consultingType, date, time, memo } = req.body || {};

  if (!name || !String(name).trim()) return res.status(400).json({ error: '이름을 입력해주세요.' });
  if (!phone || !PHONE_RE.test(String(phone).trim())) return res.status(400).json({ error: '올바른 연락처를 입력해주세요.' });
  if (!consultingType || !String(consultingType).trim()) return res.status(400).json({ error: '상담 유형을 선택해주세요.' });
  if (!isValidDateStr(date)) return res.status(400).json({ error: '유효한 날짜를 선택해주세요.' });
  if (!/^\d{2}:\d{2}$/.test(time || '')) return res.status(400).json({ error: '유효한 시간을 선택해주세요.' });

  const { slots, closed } = getSlotsForDate(date);
  if (closed) return res.status(409).json({ error: '선택하신 날짜는 예약이 불가능합니다.' });
  const slot = slots.find((s) => s.time === time);
  if (!slot) return res.status(409).json({ error: '선택하신 시간은 운영시간이 아닙니다.' });
  if (!slot.available) return res.status(409).json({ error: '이미 예약된 시간입니다. 다른 시간을 선택해주세요.' });

  try {
    const stmt = db.prepare(`
      INSERT INTO appointments (name, phone, email, consulting_type, date, time, memo, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    const info = stmt.run(
      String(name).trim(),
      String(phone).trim(),
      email ? String(email).trim() : null,
      String(consultingType).trim(),
      date,
      time,
      memo ? String(memo).trim() : null
    );
    const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serialize(row));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '이미 예약된 시간입니다. 다른 시간을 선택해주세요.' });
    }
    console.error(err);
    res.status(500).json({ error: '예약 처리 중 오류가 발생했습니다.' });
  }
});

// GET /api/appointments/lookup?phone=...  (public: find my bookings)
router.get('/appointments/lookup', (req, res) => {
  const { phone } = req.query;
  if (!phone || !PHONE_RE.test(String(phone).trim())) {
    return res.status(400).json({ error: '올바른 연락처를 입력해주세요.' });
  }
  const rows = db.prepare(`
    SELECT * FROM appointments
    WHERE phone = ? AND date >= ?
    ORDER BY date ASC, time ASC
  `).all(String(phone).trim(), todayStr());
  res.json({ appointments: rows.map(serialize) });
});

// POST /api/appointments/:id/cancel  (public: cancel own booking, verified by phone)
router.post('/appointments/:id/cancel', (req, res) => {
  const { id } = req.params;
  const { phone } = req.body || {};
  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
  if (!phone || String(phone).trim() !== row.phone) {
    return res.status(403).json({ error: '연락처가 일치하지 않습니다.' });
  }
  if (row.status === 'cancelled') return res.json(serialize(row));
  db.prepare(`UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(id);
  const updated = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  res.json(serialize(updated));
});

module.exports = { router, serialize };
