const express = require('express');
const { login } = require('../lib/auth');

const router = express.Router();

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  const token = login(password || '');
  if (!token) return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  res.json({ token });
});

module.exports = router;
