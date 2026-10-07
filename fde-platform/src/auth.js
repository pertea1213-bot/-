'use strict';
const crypto = require('crypto');
const { verifyPassword, HttpError } = require('./util');
const policy = require('./policy');

const TTL_MS = 12 * 60 * 60 * 1000;

function getSecret(db) {
  const r = db.prepare(`SELECT value FROM settings WHERE key='session_secret'`).get();
  if (r) return r.value;
  const v = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO settings (key,value) VALUES ('session_secret',?)`).run(v);
  return v;
}
const b64 = (b) => Buffer.from(b).toString('base64url');
function sign(db, user) {
  const payload = b64(JSON.stringify({ u: user.username, r: user.role, exp: Date.now() + TTL_MS }));
  const sig = crypto.createHmac('sha256', getSecret(db)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verify(db, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', getSecret(db)).update(payload).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!p || Date.now() > p.exp) return null;
  // 역할은 토큰이 아니라 DB 의 현재 값을 기준으로 한다(역할 변경·비활성화 즉시 반영)
  const u = db.prepare('SELECT username, display_name, role, active FROM users WHERE username=?').get(p.u);
  if (!u || !u.active) return null;
  return u;
}

const attempts = new Map(); // ip → [timestamps]
function rateLimited(ip) {
  const t = Date.now(); const arr = (attempts.get(ip) || []).filter((x) => t - x < 60000);
  attempts.set(ip, arr);
  return arr.length >= 8;
}
function noteAttempt(ip) { const arr = attempts.get(ip) || []; arr.push(Date.now()); attempts.set(ip, arr); }

function login(db, ip, username, password) {
  if (rateLimited(ip)) throw new HttpError(429, '로그인 시도가 너무 많습니다. 1분 뒤에 다시 시도하세요.');
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || ''));
  if (!u || !u.active || !verifyPassword(String(password || ''), u.pw_hash)) { noteAttempt(ip); throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.'); }
  return { token: sign(db, u), user: { username: u.username, display_name: u.display_name, role: u.role, role_label: policy.ROLES[u.role].label } };
}

function authMiddleware(db) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const u = verify(db, h.startsWith('Bearer ') ? h.slice(7) : null);
    if (!u) return res.status(401).json({ error: '인증이 필요합니다.' });
    req.actor = { username: u.username, role: u.role, display_name: u.display_name };
    next();
  };
}

module.exports = { login, verify, authMiddleware, sign };
