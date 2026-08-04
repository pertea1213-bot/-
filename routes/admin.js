const express = require('express');
const db = require('../lib/db');
const { login, requireAdmin } = require('../lib/auth');
const { getSettings, updateSettings } = require('../lib/schedule');
const { serialize } = require('./appointments');

const router = express.Router();

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  const token = login(password || '');
  if (!token) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  res.json({ token });
});

router.use(requireAdmin);

// GET /api/admin/appointments?date=&status=
router.get('/appointments', (req, res) => {
  const { date, status } = req.query;
  let sql = 'SELECT * FROM appointments WHERE 1=1';
  const params = [];
  if (date) {
    sql += ' AND date = ?';
    params.push(date);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY date ASC, time ASC';
  const rows = db.prepare(sql).all(...params);
  res.json({ appointments: rows.map(serialize) });
});

const VALID_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

// PATCH /api/admin/appointments/:id
router.patch('/appointments/:id', (req, res) => {
  const { id } = req.params;
  const { status, memo } = req.body || {};
  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '예약을 찾을 수 없습니다.' });

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: '유효하지 않은 상태입니다.' });
    }
    db.prepare(`UPDATE appointments SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  }
  if (memo !== undefined) {
    db.prepare(`UPDATE appointments SET memo = ?, updated_at = datetime('now') WHERE id = ?`).run(memo, id);
  }
  const updated = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  res.json(serialize(updated));
});

// DELETE /api/admin/appointments/:id
router.delete('/appointments/:id', (req, res) => {
  const { id } = req.params;
  const info = db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
  res.status(204).end();
});

// GET /api/admin/settings
router.get('/settings', (req, res) => {
  res.json(getSettings());
});

// PUT /api/admin/settings
router.put('/settings', (req, res) => {
  const { businessStart, businessEnd, slotMinutes, lunchStart, lunchEnd, closedWeekdays, consultingTypes } = req.body || {};

  if (businessStart && !/^\d{2}:\d{2}$/.test(businessStart)) return res.status(400).json({ error: '운영 시작 시간 형식이 올바르지 않습니다.' });
  if (businessEnd && !/^\d{2}:\d{2}$/.test(businessEnd)) return res.status(400).json({ error: '운영 종료 시간 형식이 올바르지 않습니다.' });
  if (slotMinutes !== undefined && (!Number.isInteger(slotMinutes) || slotMinutes <= 0)) {
    return res.status(400).json({ error: '상담 시간(분)은 양의 정수여야 합니다.' });
  }
  if (closedWeekdays !== undefined && (!Array.isArray(closedWeekdays) || closedWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
    return res.status(400).json({ error: '휴무 요일 형식이 올바르지 않습니다.' });
  }
  if (consultingTypes !== undefined && (!Array.isArray(consultingTypes) || consultingTypes.some((t) => typeof t !== 'string' || !t.trim()))) {
    return res.status(400).json({ error: '상담 유형 형식이 올바르지 않습니다.' });
  }

  const updated = updateSettings({
    ...(businessStart && { businessStart }),
    ...(businessEnd && { businessEnd }),
    ...(slotMinutes !== undefined && { slotMinutes }),
    ...(lunchStart !== undefined && { lunchStart: lunchStart || null }),
    ...(lunchEnd !== undefined && { lunchEnd: lunchEnd || null }),
    ...(closedWeekdays !== undefined && { closedWeekdays }),
    ...(consultingTypes !== undefined && { consultingTypes }),
  });
  res.json(updated);
});

module.exports = router;
