const crypto = require('crypto');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const sessions = new Map(); // token -> expiresAt

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

function login(password) {
  if (password !== ADMIN_PASSWORD) return null;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function logout(token) {
  sessions.delete(token);
}

function isValidToken(token) {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!isValidToken(token)) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  next();
}

module.exports = { login, logout, requireAdmin };
