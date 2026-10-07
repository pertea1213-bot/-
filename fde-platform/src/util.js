'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}
const bad = (m, x) => new HttpError(400, m, x);
const forbidden = (m, x) => new HttpError(403, m, x);
const notFound = (m) => new HttpError(404, m || '대상을 찾을 수 없습니다.');
const conflict = (m, x) => new HttpError(409, m, x);

/** 시각 정규화. 날짜만 오면 하루의 끝(23:59:59.999Z)으로 본다 — 기준일 당일 기록을 포함하기 위해. */
function normTs(v, endOfDay = true) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return endOfDay ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw bad(`시각 형식이 올바르지 않습니다: ${s}`);
  return d.toISOString();
}
const isoNow = (clock) => (clock ? clock() : new Date()).toISOString();
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : null);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function verifyPassword(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const c = crypto.scryptSync(String(pw), salt, 32);
  const e = Buffer.from(h, 'hex');
  return c.length === e.length && crypto.timingSafeEqual(c, e);
}

const jparse = (s, d = null) => {
  if (s == null || s === '') return d;
  try { return JSON.parse(s); } catch { return d; }
};

/** null/빈 분모는 임의로 100%로 바꾸지 않는다. */
function ratio(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 10000) / 100;
}

module.exports = { HttpError, bad, forbidden, notFound, conflict, normTs, isoNow, dayOf, sha256, hashPassword, verifyPassword, jparse, ratio };
